// lib/abandoned-flags.js
// "Looks like a test" checks for abandoned builds that carry no TEST- marker. Pure detection plus two best-effort Supabase calls (injected fetch).
// FLAG, never drop: a flagged row stays in abandoned_builds_log with is_test = true and the reason in test_reason; it is only kept out of the email's build list
// and counted in the email's Test line. Used by the daily job (api/run-daily-tasks.js) and by scripts/flag-old-abandoned-rows.js.
//
//   (a) pattern:known_fingerprint  a parts fingerprint on the known-test list, seen from 3+ different visitors in the window
//   (b) pattern:fixed_interval     4+ packets in a row, each a new anonymous visitor, with gaps within 10% of the run's median gap
//   (c) repeat_parts:N             the same parts from 3+ different visitors in the window: SOFT. Counted and shown in the email, never hidden (a popular real preset could repeat)
//   (d) automation                 the browser said navigator.webdriver (packet field `automation`)
const fs = require('fs');
const path = require('path');
const { partsFingerprint } = require('./abandoned-log');

const MIN_VISITORS = 3;
const MIN_RUN = 4;
const TOLERANCE = 0.10;

const rowKey = (r) => `${r.build_id}|${r.parts_fingerprint}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** the list of known test fingerprints: the file next to this one plus the optional setting ABANDONED_TEST_FINGERPRINTS (comma separated) */
function loadKnownFingerprints(env = process.env) {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(path.join(__dirname, 'abandoned-test-fingerprints.json'), 'utf8')).fingerprints.map((f) => f.fingerprint); } catch (e) { list = []; }
    const extra = env && env.ABANDONED_TEST_FINGERPRINTS ? String(env.ABANDONED_TEST_FINGERPRINTS).split(',').map((s) => s.trim()).filter(Boolean) : [];
    return [...new Set([...list, ...extra])];
}

/** @param rows [{ build_id, parts_fingerprint, visitor_kind, visitor_key, first_seen, automation, is_test }]
 *  @returns { hard: Map(rowKey -> reason), soft: Map(rowKey -> reason) } : only rows NOT already is_test */
function detectTests(rows, { knownFingerprints = [], minVisitors = MIN_VISITORS, minRun = MIN_RUN, tolerance = TOLERANCE } = {}) {
    const hard = new Map(); const soft = new Map();
    const list = (rows || []).filter((r) => r && r.build_id && r.parts_fingerprint);
    const fresh = (r) => !r.is_test;

    // (d) automation
    for (const r of list) if (fresh(r) && r.automation === true) hard.set(rowKey(r), 'automation');

    // visitors per fingerprint
    const visitors = new Map();
    for (const r of list) { if (!r.visitor_key) continue; if (!visitors.has(r.parts_fingerprint)) visitors.set(r.parts_fingerprint, new Set()); visitors.get(r.parts_fingerprint).add(r.visitor_key); }
    const known = new Set(knownFingerprints);
    for (const r of list) {
        if (!fresh(r) || hard.has(rowKey(r))) continue;
        const n = (visitors.get(r.parts_fingerprint) || new Set()).size;
        if (known.has(r.parts_fingerprint) && n >= minVisitors) hard.set(rowKey(r), 'pattern:known_fingerprint');      // (a)
    }

    // (b) rhythm over all anonymous rows in time order (rows already flagged still count as part of the rhythm)
    const anon = list.filter((r) => r.visitor_kind === 'anonymous' && r.visitor_key && r.first_seen).sort((a, b) => new Date(a.first_seen) - new Date(b.first_seen));
    let i = 0;
    while (i < anon.length - 1) {
        const seen = new Set([anon[i].visitor_key]); const gaps = []; let j = i;
        while (j + 1 < anon.length) {
            const next = anon[j + 1]; if (seen.has(next.visitor_key)) break;
            const gap = (new Date(next.first_seen) - new Date(anon[j].first_seen)) / 1000;
            const tryGaps = [...gaps, gap]; const med = median(tryGaps);
            if (!(med > 0) || !tryGaps.every((g) => Math.abs(g - med) <= tolerance * med)) break;
            gaps.push(gap); seen.add(next.visitor_key); j++;
        }
        if (gaps.length + 1 >= minRun) { for (let k = i; k <= j; k++) if (fresh(anon[k]) && !hard.has(rowKey(anon[k]))) hard.set(rowKey(anon[k]), 'pattern:fixed_interval'); i = j + 1; }
        else i++;
    }

    // (c) soft: same parts from 3+ visitors
    for (const r of list) {
        if (!fresh(r) || hard.has(rowKey(r))) continue;
        const n = (visitors.get(r.parts_fingerprint) || new Set()).size;
        if (n >= minVisitors) soft.set(rowKey(r), `repeat_parts:${n}`);
    }
    return { hard, soft };
}

const base = (url) => `${String(url).replace(/\/$/, '')}/rest/v1/abandoned_builds_log`;
const hdr = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, ...extra });

/** rows saved since `sinceIso` (best effort: resolves { ok, rows }) */
async function fetchRecentRows({ url, key, sinceIso, fetchFn = fetch, timeoutMs = 8000 }) {
    if (!url || !key) return { ok: false, rows: [], reason: 'Supabase not configured' };
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const cols = 'build_id,parts_fingerprint,visitor_kind,visitor_key,first_seen,last_seen,automation,is_test,test_reason,added_to_cart,origin_kind';
        const res = await fetchFn(`${base(url)}?select=${cols}&last_seen=gte.${encodeURIComponent(sinceIso)}&order=first_seen.asc&limit=5000`, { headers: hdr(key), signal: ctl.signal });
        if (!res.ok) return { ok: false, rows: [], reason: `Supabase answered ${res.status}` };
        return { ok: true, rows: await res.json() };
    } catch (e) { return { ok: false, rows: [], reason: e.name === 'AbortError' ? 'timed out' : String(e.message).slice(0, 80) }; }
    finally { clearTimeout(timer); }
}

/** set is_test = true + test_reason on one row (build id + fingerprint); soft = reason only. Best effort, never throws. */
async function flagRow({ url, key, buildId, fingerprint, reason, soft = false, fetchFn = fetch, timeoutMs = 5000 }) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
        const body = soft ? { test_reason: reason } : { is_test: true, test_reason: reason };
        const res = await fetchFn(`${base(url)}?build_id=eq.${encodeURIComponent(buildId)}&parts_fingerprint=eq.${encodeURIComponent(fingerprint)}`, {
            method: 'PATCH', headers: hdr(key, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }), body: JSON.stringify(body), signal: ctl.signal,
        });
        return res.ok ? { ok: true } : { ok: false, reason: `Supabase answered ${res.status}` };
    } catch (e) { return { ok: false, reason: String(e.message).slice(0, 80) }; }
    finally { clearTimeout(timer); }
}

/** write the flags found by detectTests; returns how many updates worked */
async function writeFlags({ url, key, rows, hard, soft, fetchFn = fetch }) {
    const byKey = new Map(rows.map((r) => [rowKey(r), r]));
    let written = 0, failed = 0;
    for (const [k, reason] of hard) { const r = byKey.get(k); const o = await flagRow({ url, key, buildId: r.build_id, fingerprint: r.parts_fingerprint, reason, fetchFn }); o.ok ? written++ : failed++; }
    for (const [k, reason] of soft) { const r = byKey.get(k); if (r.test_reason === reason) continue; const o = await flagRow({ url, key, buildId: r.build_id, fingerprint: r.parts_fingerprint, reason, soft: true, fetchFn }); o.ok ? written++ : failed++; }
    return { written, failed };
}

/** a Redis packet as a row, for the fallback when Supabase cannot be read */
function rowFromPacket(p) {
    const v = p.visitor || {};
    return { build_id: String(p.buildId || '').slice(0, 80), parts_fingerprint: partsFingerprint(p.components), visitor_kind: v.isLoggedIn ? 'logged_in' : (v.anonymousId ? 'anonymous' : 'unknown'),
        visitor_key: v.isLoggedIn ? `c${v.customerId}` : (v.anonymousId || null), first_seen: p.capturedAt, automation: p.automation === true, is_test: false };
}

module.exports = { MIN_VISITORS, MIN_RUN, TOLERANCE, rowKey, loadKnownFingerprints, detectTests, fetchRecentRows, flagRow, writeFlags, rowFromPacket };
