// Run with: npm test  (no network: fake Redis and fake Supabase)
// Origin tag, cart-bound packets, test flags (on the real rows of Nov 11-12 2026) and the daily email text.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRow, readOrigin, classifyTest, partsFingerprint } = require('../lib/abandoned-log');
const { detectTests, loadKnownFingerprints, fetchRecentRows, flagRow, writeFlags, rowFromPacket, rowKey } = require('../lib/abandoned-flags');
const { renderReport, originLabel, timeEst } = require('../lib/abandoned-email');
const { createHandler } = require('../api/log-abandoned-build');
const real = require('./fixtures/abandoned_rows_nov11_12.json');

const anon = (id) => ({ isLoggedIn: false, anonymousId: id });
const packet = (over = {}) => ({
  buildId: 'b-1', buildType: 'Wheel Set', ridingStyleDisplay: 'Mountain', subtotal: 150000,
  components: { front: [{ type: 'Rim', name: 'Rim A (29" / 28h)' }], rear: [{ type: 'Rim', name: 'Rim A (29" / 28h)' }] },
  visitor: anon('real-1'), quickBuildGenerated: false, ...over,
});
const TEST_IDS = real.filter((r) => [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 25, 26, 27, 28, 29, 30, 31, 32].includes(r.id)).map((r) => r.id);
const REAL_IDS = [20, 21, 22, 24, 33];

// ---------- packets and origin ----------
test('old packet (no origin): unknown origin, not cart-bound, not automation; the rest of the row is as before', () => {
  const row = buildRow(packet(), { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome' });
  assert.equal(row.p_origin_kind, 'unknown'); assert.equal(row.p_origin_ref, null); assert.equal(row.p_origin_changed, null);
  assert.equal(row.p_added_to_cart, false); assert.equal(row.p_automation, false); assert.equal(row.p_build_id, 'b-1'); assert.equal(row.p_device, 'desktop');
  assert.deepEqual(readOrigin(null), { kind: 'unknown', ref: null, entry: null, changed: null, addedToCart: false });
});

test('each origin kind is read; an unknown kind reads as unknown; long text is cut', () => {
  for (const kind of ['scratch', 'preset', 'precfg_link', 'curated', 'share', 'resume', 'saved', 'cart_edit']) {
    const row = buildRow(packet({ origin: { kind, ref: 'H2-FUSE29C', entry: 'step3', changed: false, addedToCart: false } }));
    assert.equal(row.p_origin_kind, kind); assert.equal(row.p_origin_ref, 'H2-FUSE29C'); assert.equal(row.p_origin_entry, 'step3'); assert.equal(row.p_origin_changed, false);
  }
  assert.equal(buildRow(packet({ origin: { kind: 'hacked' } })).p_origin_kind, 'unknown');
  assert.equal(buildRow(packet({ origin: { kind: 'preset', ref: 'x'.repeat(500), changed: 'yes' } })).p_origin_ref.length, 80);
  assert.equal(buildRow(packet({ origin: { kind: 'preset', changed: 'yes' } })).p_origin_changed, null);   // only a real boolean counts
  assert.equal(buildRow(packet({ automation: true })).p_automation, true);
});

function fakeRes() { const r = { headers: {}, code: null, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; }
const fakeReq = (body) => ({ method: 'POST', headers: { origin: 'https://loamlabsusa.com', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome' }, on(ev, cb) { if (ev === 'data') cb(Buffer.from(body)); if (ev === 'end') cb(); } });
const collector = () => { const pushes = []; const sent = []; const h = createHandler({ redis: { lpush: async (k, v) => { pushes.push(JSON.parse(v)); } }, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true }; } }); return { h, pushes, sent }; };

test('collector: an old packet is emailed (Redis) and saved exactly as before', async () => {
  const c = collector(); const res = fakeRes(); await c.h(fakeReq(JSON.stringify(packet())), res);
  assert.equal(res.code, 202); assert.equal(c.pushes.length, 1); assert.equal(c.sent.length, 1); assert.equal(c.sent[0].p_origin_kind, 'unknown'); assert.equal(c.sent[0].p_is_test, false);
});

test('collector: a packet with an origin goes to Redis with its origin, and is saved with it', async () => {
  const c = collector(); await c.h(fakeReq(JSON.stringify(packet({ origin: { kind: 'preset', ref: 'SX-WHISP29C', entry: 'step3', changed: true, addedToCart: false } }))), fakeRes());
  assert.equal(c.pushes[0].origin.ref, 'SX-WHISP29C'); assert.equal(c.sent[0].p_origin_kind, 'preset'); assert.equal(c.sent[0].p_origin_changed, true);
});

test('collector: cart-bound packet is saved with added_to_cart but NOT put in the email list', async () => {
  const c = collector(); const res = fakeRes(); await c.h(fakeReq(JSON.stringify(packet({ origin: { kind: 'scratch', addedToCart: true } }))), res);
  assert.equal(res.code, 202); assert.equal(c.pushes.length, 0); assert.equal(c.sent.length, 1); assert.equal(c.sent[0].p_added_to_cart, true); assert.equal(c.sent[0].p_is_test, false);
});

test('collector: automation true is flagged (saved, is_test, not emailed); TEST- marker is still dropped completely', async () => {
  let c = collector(); await c.h(fakeReq(JSON.stringify(packet({ automation: true }))), fakeRes());
  assert.equal(c.pushes.length, 0); assert.equal(c.sent[0].p_is_test, true); assert.equal(c.sent[0].p_test_reason, 'automation'); assert.equal(c.sent[0].p_automation, true);
  c = collector(); await c.h(fakeReq(JSON.stringify(packet({ visitor: anon('TEST-agent-b'), automation: true }))), fakeRes());
  assert.equal(c.pushes.length, 0); assert.equal(c.sent.length, 0);                           // dropped, as today
  assert.equal(classifyTest(packet({ visitor: anon('test_x') }), {}).drop, true);
  assert.equal(classifyTest(packet({ testBuild: true }), {}).drop, true);
});

// ---------- test flags on the real rows ----------
const known = loadKnownFingerprints({});

test('known-fingerprint list has the five fingerprints of the six Agent B builds and accepts more from the setting', () => {
  assert.equal(known.length, 5);
  assert.equal(loadKnownFingerprints({ ABANDONED_TEST_FINGERPRINTS: 'abc, def' }).length, 7);
});

test('real rows, all checks: exactly the 25 test rows are flagged; the 5 real rows are untouched', () => {
  const { hard, soft } = detectTests(real, { knownFingerprints: known });
  const flagged = real.filter((r) => hard.has(rowKey(r))).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(flagged, [...TEST_IDS].sort((a, b) => a - b)); assert.equal(flagged.length, 25);
  for (const id of REAL_IDS) assert.ok(!hard.has(rowKey(real.find((r) => r.id === id))));
  assert.equal(soft.size, 0);
});

test('(a) known fingerprints alone flag all 25 even when the timing is irregular; fewer than 3 visitors does not', () => {
  const jitter = real.map((r, i) => ({ ...r, first_seen: new Date(Date.parse(r.first_seen) + (i * 7919) % 5000 * 1000).toISOString() }));
  const { hard } = detectTests(jitter, { knownFingerprints: known, minRun: 999 });
  assert.equal([...hard.values()].filter((v) => v === 'pattern:known_fingerprint').length, 25);
  const two = real.filter((r) => r.id === 8 || r.id === 14);                                // the Front $626 build from only 2 visitors
  assert.equal(detectTests(two, { knownFingerprints: known }).hard.size, 0);
});

test('(b) fixed-interval rhythm alone (no fingerprint list) flags the test runs and never the real visitors', () => {
  const { hard } = detectTests(real, { knownFingerprints: [] });
  const ids = real.filter((r) => hard.has(rowKey(r))).map((r) => r.id);
  assert.ok(ids.length >= 20 && ids.every((id) => TEST_IDS.includes(id)), 'flagged: ' + ids.join(','));
  assert.ok([...hard.values()].every((v) => v === 'pattern:fixed_interval'));
  // the same visitor repeating, or irregular gaps, is not a rhythm
  const same = real.slice(0, 6).map((r) => ({ ...r, visitor_key: 'one-visitor' })); assert.equal(detectTests(same, {}).hard.size, 0);
  const irregular = real.slice(0, 6).map((r, i) => ({ ...r, first_seen: new Date(Date.UTC(2026, 10, 11, 12, 0, 0) + [0, 60, 400, 460, 1500, 1520][i] * 1000).toISOString(), parts_fingerprint: 'p' + i }));
  assert.equal(detectTests(irregular, {}).hard.size, 0);
  assert.equal(detectTests(real.slice(0, 3), {}).hard.size, 0);                              // 3 in a row is below the 4 needed
});

test('(c) the same parts from 3+ visitors is only a soft note (stays visible, not is_test)', () => {
  const rows = ['a', 'b', 'c'].map((v, i) => ({ build_id: 'x' + i, parts_fingerprint: 'fp-popular', visitor_kind: 'anonymous', visitor_key: v, first_seen: new Date(Date.UTC(2026, 10, 12, 10 + i * 3)).toISOString(), is_test: false }));
  const { hard, soft } = detectTests(rows, { knownFingerprints: [] });
  assert.equal(hard.size, 0); assert.equal(soft.size, 3); assert.equal([...soft.values()][0], 'repeat_parts:3');
});

test('(d) automation true is flagged by the daily check too; rows already is_test are not flagged again', () => {
  const rows = [{ build_id: 'z', parts_fingerprint: 'f', visitor_kind: 'anonymous', visitor_key: 'k', first_seen: '2026-11-12T10:00:00Z', automation: true, is_test: false }];
  assert.equal(detectTests(rows, {}).hard.get('z|f'), 'automation');
  assert.equal(detectTests([{ ...rows[0], is_test: true }], {}).hard.size, 0);
});

test('fake Supabase: read the last 24 hours, write the flag (PATCH is_test + reason), failures never throw', async () => {
  const calls = []; const fetchFn = async (u, i = {}) => { calls.push({ u, m: i.method || 'GET', b: i.body && JSON.parse(i.body) }); return { ok: true, status: 200, json: async () => [{ build_id: 'b', parts_fingerprint: 'f' }] }; };
  const got = await fetchRecentRows({ url: 'https://x.supabase.co/', key: 'K', sinceIso: '2026-11-11T00:00:00Z', fetchFn });
  assert.equal(got.ok, true); assert.match(calls[0].u, /^https:\/\/x\.supabase\.co\/rest\/v1\/abandoned_builds_log\?select=/); assert.match(calls[0].u, /last_seen=gte\./);
  await flagRow({ url: 'https://x.supabase.co', key: 'K', buildId: 'b 1', fingerprint: 'f', reason: 'pattern:fixed_interval', fetchFn });
  assert.equal(calls[1].m, 'PATCH'); assert.match(calls[1].u, /build_id=eq\.b%201&parts_fingerprint=eq\.f/); assert.deepEqual(calls[1].b, { is_test: true, test_reason: 'pattern:fixed_interval' });
  await flagRow({ url: 'https://x', key: 'K', buildId: 'b', fingerprint: 'f', reason: 'repeat_parts:3', soft: true, fetchFn }); assert.deepEqual(calls[2].b, { test_reason: 'repeat_parts:3' });
  assert.equal((await flagRow({ url: 'https://x', key: 'K', buildId: 'b', fingerprint: 'f', reason: 'r', fetchFn: async () => { throw new Error('down'); } })).ok, false);
  assert.equal((await fetchRecentRows({ url: '', key: '', sinceIso: 'x' })).ok, false);
  assert.equal((await fetchRecentRows({ url: 'https://x', key: 'K', sinceIso: 'x', fetchFn: async () => ({ ok: false, status: 500 }) })).ok, false);
  const w = await writeFlags({ url: 'https://x', key: 'K', rows: [{ build_id: 'b', parts_fingerprint: 'f' }], hard: new Map([['b|f', 'automation']]), soft: new Map(), fetchFn });
  assert.deepEqual(w, { written: 1, failed: 0 });
});

test('a Redis packet becomes a row for the check when Supabase cannot be read', () => {
  const row = rowFromPacket({ ...packet(), capturedAt: '2026-11-12T10:00:00Z', automation: true });
  assert.equal(row.parts_fingerprint, partsFingerprint(packet().components)); assert.equal(row.visitor_kind, 'anonymous'); assert.equal(row.visitor_key, 'real-1'); assert.equal(row.automation, true);
});

// ---------- the email ----------
const withOrigin = (over, o) => ({ ...packet({ capturedAt: '2026-11-11T14:05:22Z', ...over }), origin: o });

test('email: origin lines', () => {
  assert.equal(originLabel(withOrigin({}, { kind: 'scratch' })), 'Scratch');
  assert.equal(originLabel(withOrigin({}, { kind: 'preset', ref: 'H2-FUSE29C', changed: true })), 'Preset H2-FUSE29C, changed');
  assert.equal(originLabel(withOrigin({}, { kind: 'share', changed: false })), 'Share link, unchanged');
  assert.equal(originLabel(withOrigin({}, { kind: 'precfg_link', ref: 'Reserve 30|HD', changed: false })), 'Preconfigured build Reserve 30|HD, unchanged');
  assert.equal(originLabel(withOrigin({}, { kind: 'cart_edit' })), 'Edit from cart');
  assert.equal(originLabel(packet()), 'Unknown (old theme)');
  assert.equal(originLabel(packet({ quickBuildGenerated: true })), 'Curated (old theme)');
});

test('email: times are 12-hour Eastern', () => { assert.equal(timeEst('2026-11-11T14:05:22Z'), 'Nov 11, 9:05 AM EST'); assert.equal(timeEst('nonsense'), ''); });

test('email: title with origin counts and a Test bucket; the Test line is visible', () => {
  const builds = [withOrigin({ buildId: 'a' }, { kind: 'scratch' }), withOrigin({ buildId: 'b' }, { kind: 'preset', ref: 'X', changed: true }), withOrigin({ buildId: 'c' }, { kind: 'preset', ref: 'Y', changed: false }),
    withOrigin({ buildId: 'd' }, { kind: 'share', changed: false }), withOrigin({ buildId: 'e', quickBuildGenerated: true, quickBuildMaterial: 'Carbon', quickBuildGoal: 'Best Value' }, { kind: 'curated' })];
  const tests = Array.from({ length: 25 }, (_, i) => ({ build: packet({ buildId: 't' + i }), reason: i < 20 ? 'pattern:known_fingerprint' : 'pattern:fixed_interval' }));
  const r = renderReport({ builds, tests });
  assert.equal(r.subject, 'Abandoned Build Report: 5 build(s) (1 Scratch / 2 Preset / 1 Share / 1 Curated) + 25 Test not shown');
  assert.match(r.html, /25 test build\(s\) not shown/); assert.match(r.html, /20 known test builds, 5 fixed-interval pattern/);
  assert.match(r.html, /Preset X, changed/); assert.match(r.html, /Curated Quick Builds \(1\)/); assert.match(r.html, /Manual Custom Builds \(4\)/); assert.match(r.html, /Nov 11, 9:05 AM EST/);
  assert.ok(!r.html.includes('t0)'), 'test builds are counted, not listed');
});

test('email: without test rows the title has no Test part; old-theme builds read as Unknown; Manual / Curated split stays', () => {
  const r = renderReport({ builds: [packet({ buildId: 'a' }), packet({ buildId: 'b', quickBuildGenerated: true, quickBuildMaterial: 'Aluminum', quickBuildGoal: 'Best Value' })] });
  assert.equal(r.subject, 'Abandoned Build Report: 2 build(s) (1 Unknown / 1 Curated)');
  assert.ok(!/Test/.test(r.subject)); assert.ok(!/Test:/.test(r.html)); assert.match(r.html, /Unknown \(old theme\)/); assert.match(r.html, /Profile: Aluminum Best Value/);
});

test('email: only test builds still gives a visible email; nothing at all gives none; cart-bound builds are not listed; soft note shows', () => {
  const only = renderReport({ builds: [], tests: [{ build: packet(), reason: 'automation' }] });
  assert.equal(only.subject, 'Abandoned Build Report: 0 build(s) (0 Curated) + 1 Test not shown'); assert.match(only.html, /1 automated browser/);
  assert.equal(renderReport({ builds: [], tests: [] }), null);
  const cart = renderReport({ builds: [withOrigin({ buildId: 'a' }, { kind: 'scratch', addedToCart: true }), withOrigin({ buildId: 'b' }, { kind: 'scratch' })] });
  assert.match(cart.subject, /^Abandoned Build Report: 1 build\(s\)/);
  const soft = renderReport({ builds: [packet({ buildId: 'r' })], repeats: new Map([['r', 4]]) }); assert.match(soft.html, /Same parts from 4 visitors in 24 hours/);
  assert.match(renderReport({ builds: [packet({ buildId: '<b>x</b>' })] }).html, /&lt;b&gt;x&lt;\/b&gt;/);          // text from the browser is escaped
});
