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

/** @returns the row to save, or null when the packet has no build id */
function buildRow(packet, headers = {}, { salt = '', now = () => new Date().toISOString() } = {}) {
    if (!packet || !packet.buildId) return null;
    const comps = { front: [], rear: [] };
    for (const side of ['front', 'rear']) comps[side] = (((packet.components || {})[side]) || []).slice(0, 40).map((c) => ({ type: clip(c && c.type, 60), name: clip(c && c.name, 240) }));
    const v = visitorKey(packet.visitor, salt);
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

module.exports = { deviceFromUserAgent, visitorKey, partsFingerprint, buildRow, saveRow };
