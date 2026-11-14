// lib/abandoned-log.js
// Keeps a permanent history of abandoned builds in Supabase. Pure helpers plus one network call with an injected fetch (so it is testable).
// The daily Master Cron still emails and then deletes the Redis list; this copy is taken the moment a packet arrives.
//   - no email, name or customer id is stored: the visitor is a one-way hash, plus "logged in" or "anonymous"
//   - dedupe: one row per build id + parts fingerprint; a repeat leave updates last_seen / times_seen (done in the database function, see sql/)
//   - saving is best effort: it never throws and never delays the answer by more than a few seconds
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clip = (v, n) => (v === undefined || v === null ? null : String(v).slice(0, n));

/** phone | tablet | desktop | unknown, from the browser's User-Agent header */
function deviceFromUserAgent(ua) {
    const s = String(ua || '').toLowerCase();
    if (!s) return 'unknown';
    if (/ipad|tablet|(android(?!.*mobile))/.test(s)) return 'tablet';
    if (/iphone|ipod|android.*mobile|mobile|windows phone/.test(s)) return 'phone';
    return 'desktop';
}

/** { kind: 'logged_in'|'anonymous'|'unknown', key: one-way hash } : never the email or the name */
function visitorKey(visitor, salt = '') {
    if (visitor && visitor.isLoggedIn && visitor.customerId) return { kind: 'logged_in', key: sha(`c|${visitor.customerId}|${salt}`).slice(0, 32) };
    if (visitor && visitor.anonymousId) return { kind: 'anonymous', key: sha(`a|${visitor.anonymousId}|${salt}`).slice(0, 32) };
    return { kind: 'unknown', key: null };
}

/** the same parts in any order give the same fingerprint */
function partsFingerprint(components) {
    const names = [];
    for (const side of ['front', 'rear']) for (const c of ((components || {})[side] || [])) names.push(`${side}:${c.type}:${c.name}`);
    return sha(names.sort().join('|')).slice(0, 24);
}

// ---- origin (how the build started), sent by the theme from Release 35; old themes send nothing and read as 'unknown' -----------------------------
const ORIGIN_KINDS = ['scratch', 'preset', 'precfg_link', 'curated', 'share', 'resume', 'saved', 'cart_edit'];
/** { kind, ref, entry, changed, addedToCart } : kind is 'unknown' for an old theme or anything not on the list; changed is true/false/null */
function readOrigin(packet) {
    const o = packet && packet.origin && typeof packet.origin === 'object' ? packet.origin : null;
    if (!o) return { kind: 'unknown', ref: null, entry: null, changed: null, addedToCart: false };
    const kind = ORIGIN_KINDS.includes(String(o.kind)) ? String(o.kind) : 'unknown';
    return { kind, ref: clip(o.ref, 80), entry: clip(o.entry, 20), changed: typeof o.changed === 'boolean' ? o.changed : null, addedToCart: o.addedToCart === true };
}

// ---- test builds: agents testing the builder must not look like customers --------------------------------------------------------------
// 1. MARKER (works today, no theme change): the visitor id starts with TEST- (set in the browser before testing, see TEST BUILD RULE) or the packet says
//    testBuild: true. These are DROPPED: not emailed, not saved.
// 2. THEME ROLE (after the theme change): the packet carries themeRole; anything but 'main' (the live theme) is a test.
// 3. ORIGIN (works today): real customers come from the shop's own domain. A request from any other site (the myshopify.com address, a preview host)
//    is treated as a test. Rules 2 and 3 are FLAGGED, not lost: not emailed, saved in Supabase with is_test = true so a wrong guess can be recovered.
const DEFAULT_LIVE_HOSTS = ['loamlabsusa.com', 'www.loamlabsusa.com'];
function classifyTest(packet, headers = {}, { liveHosts = DEFAULT_LIVE_HOSTS } = {}) {
    const vid = String((packet && packet.visitor && (packet.visitor.anonymousId || '')) || '');
    if (/^test[-_]/i.test(vid) || (packet && (packet.testBuild === true || packet.isTest === true))) return { isTest: true, drop: true, reason: 'marker' };
    if (packet && packet.automation === true) return { isTest: true, drop: false, reason: 'automation' };   // a browser driven by a script (navigator.webdriver): flagged, kept in Supabase
    const role = packet && packet.themeRole;
    if (role && String(role).toLowerCase() !== 'main') return { isTest: true, drop: false, reason: 'theme_role:' + String(role).slice(0, 20) };
    const origin = String(headers.origin || headers.Origin || '').trim();
    if (origin) {
        let host = ''; try { host = new URL(origin).hostname.toLowerCase(); } catch (e) { host = origin.toLowerCase(); }
        if (!liveHosts.map((h) => h.toLowerCase()).includes(host)) return { isTest: true, drop: false, reason: 'origin:' + host.slice(0, 60) };
    }
    return { isTest: false, drop: false, reason: null };
}

// ---- per-part extras (sent by the theme from Release 41; older themes send only type and name) ------------------------------------------------
// Each component may carry: variantId (Shopify variant id, digits; a gid://shopify/ProductVariant/123 text is reduced to 123), handle (product handle),
// vendor (text) and priceCents (whole cents at the time of the leave). Anything missing or not valid is simply left out of that component; the rest of the
// component and the packet are kept. They are stored inside the component in the components JSON (no SQL change). They never enter the parts fingerprint.
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
function partExtras(c) {
    const out = {};
    if (!c || typeof c !== 'object') return out;
    const vid = String(c.variantId === undefined || c.variantId === null ? '' : c.variantId).replace(/^gid:\/\/shopify\/ProductVariant\//, '');
    if (/^\d{1,20}$/.test(vid)) out.variantId = vid;
    if (typeof c.handle === 'string' && HANDLE_RE.test(c.handle.trim())) out.handle = c.handle.trim().toLowerCase();
    if (typeof c.vendor === 'string' && c.vendor.trim()) out.vendor = clip(c.vendor.trim(), 80);
    const p = typeof c.priceCents === 'number' ? c.priceCents : (typeof c.priceCents === 'string' && /^\d+(\.\d+)?$/.test(c.priceCents.trim()) ? Number(c.priceCents) : NaN);
    if (Number.isFinite(p) && p >= 0 && p <= 10000000) out.priceCents = Math.round(p);
    return out;
}

/** @returns the row to save, or null when the packet has no build id */
function buildRow(packet, headers = {}, { salt = '', now = () => new Date().toISOString(), isTest = false, testReason = null } = {}) {
    if (!packet || !packet.buildId) return null;
    const comps = { front: [], rear: [] };
    for (const side of ['front', 'rear']) comps[side] = (((packet.components || {})[side]) || []).slice(0, 40).map((c) => ({ type: clip(c && c.type, 60), name: clip(c && c.name, 240), ...partExtras(c) }));
    const v = visitorKey(packet.visitor, salt);
    const og = readOrigin(packet);
    return {
        p_build_id: clip(packet.buildId, 80),
        p_parts_fingerprint: partsFingerprint(comps),
        p_captured_at: packet.capturedAt || now(),
        p_source: clip(packet.source || 'abandonment_tracker', 40),
        p_build_type: clip(packet.buildType, 20),
        p_riding_style: clip(packet.ridingStyleDisplay, 80),
        p_curated: packet.quickBuildGenerated === true,
        p_quick_goal: clip(packet.quickBuildGoal, 40),
        p_quick_material: clip(packet.quickBuildMaterial, 40),
        p_subtotal_cents: Number.isFinite(Number(packet.subtotal)) ? Math.round(Number(packet.subtotal)) : null,
        p_visitor_kind: v.kind,
        p_visitor_key: v.key,
        p_device: deviceFromUserAgent(headers['user-agent'] || headers['User-Agent']),
        p_components: comps,
        p_is_test: !!isTest,
        p_test_reason: testReason ? clip(testReason, 80) : null,
        p_origin_kind: og.kind,
        p_origin_ref: og.ref,
        p_origin_entry: og.entry,
        p_origin_changed: og.changed,
        p_added_to_cart: og.addedToCart,
        p_automation: !!(packet && packet.automation === true),
    };
}

/** best effort: resolves { ok } and never throws */
async function saveRow({ row, url, key, fetchFn = fetch, timeoutMs = 3000 }) {
    if (!row) return { ok: false, reason: 'no build id' };
    if (!url || !key) return { ok: false, reason: 'Supabase not configured' };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const res = await fetchFn(`${String(url).replace(/\/$/, '')}/rest/v1/rpc/log_abandoned_build`, {
            method: 'POST', signal: ctl.signal,
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(row),
        });
        return res.ok ? { ok: true } : { ok: false, reason: `Supabase answered ${res.status}` };
    } catch (e) { return { ok: false, reason: e.name === 'AbortError' ? 'timed out' : String(e.message).slice(0, 80) }; }
    finally { clearTimeout(timer); }
}

module.exports = { partExtras, DEFAULT_LIVE_HOSTS, ORIGIN_KINDS, readOrigin, classifyTest, deviceFromUserAgent, visitorKey, partsFingerprint, buildRow, saveRow };
