// Run with: npm test  (no network: fake Redis and fake Supabase)
const test = require('node:test');
const assert = require('node:assert/strict');
const { deviceFromUserAgent, visitorKey, partsFingerprint, buildRow, saveRow, classifyTest } = require('../lib/abandoned-log');
const { createHandler } = require('../api/log-abandoned-build');

// the shape the builder really sends (variant-builder.js getMinimalBuildStateForReporting + getVisitorIdentifier)
const packet = (over = {}) => ({
  buildId: 'b-123', buildType: 'Wheel Set', ridingStyleDisplay: 'Enduro', subtotal: 189900,
  components: { front: [{ type: 'Rim', name: 'Rim A (29" / 28h)' }, { type: 'Hub', name: 'Hub A (28h)' }], rear: [{ type: 'Rim', name: 'Rim A (29" / 28h)' }] },
  visitor: { isLoggedIn: true, customerId: 'gid://c/1', email: 'secret@example.com', firstName: 'Pat', lastName: 'Lee' },
  quickBuildGenerated: true, quickBuildGoal: 'Best Value', quickBuildMaterial: 'Aluminum', ...over,
});

test('device from user agent', () => {
  assert.equal(deviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148'), 'phone');
  assert.equal(deviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'phone');
  assert.equal(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), 'desktop');
  assert.equal(deviceFromUserAgent(''), 'unknown');
});

test('visitor is a one-way hash: no email, name or customer id is stored', () => {
  const row = buildRow(packet(), { 'user-agent': 'x' }, { salt: 's' });
  const text = JSON.stringify(row);
  assert.ok(!text.includes('secret@example.com') && !text.includes('Pat') && !text.includes('gid://c/1'));
  assert.equal(row.p_visitor_kind, 'logged_in'); assert.equal(row.p_visitor_key.length, 32);
  assert.deepEqual(visitorKey({ isLoggedIn: false, anonymousId: 'abc' }, 's').kind, 'anonymous');
  assert.equal(visitorKey({ isLoggedIn: false, anonymousId: 'abc' }, 's').key, visitorKey({ isLoggedIn: false, anonymousId: 'abc' }, 's').key);   // same visitor, same key
  assert.equal(visitorKey(null).kind, 'unknown');
});

test('row fields: build, curated flag, subtotal, components, device', () => {
  const row = buildRow(packet({ capturedAt: '2026-11-10T12:00:00Z', source: 'abandonment_tracker' }), { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' });
  assert.equal(row.p_build_id, 'b-123'); assert.equal(row.p_build_type, 'Wheel Set'); assert.equal(row.p_curated, true); assert.equal(row.p_quick_goal, 'Best Value');
  assert.equal(row.p_subtotal_cents, 189900); assert.equal(row.p_device, 'phone'); assert.equal(row.p_components.front.length, 2); assert.equal(row.p_captured_at, '2026-11-10T12:00:00Z');
  assert.equal(buildRow(packet({ quickBuildGenerated: false })).p_curated, false);
  assert.equal(buildRow({ subtotal: 1 }), null);          // no build id: nothing to save
});

test('same parts in a different order give the same fingerprint (a repeat leave dedupes); different parts do not', () => {
  const a = packet().components; const b = { front: [...a.front].reverse(), rear: a.rear };
  assert.equal(partsFingerprint(a), partsFingerprint(b));
  assert.notEqual(partsFingerprint(a), partsFingerprint({ front: a.front, rear: [{ type: 'Rim', name: 'Rim B' }] }));
});

test('saveRow: right address, key in headers, row as the body; failures never throw', async () => {
  let seen; const ok = async (url, init) => { seen = { url, init }; return { ok: true, status: 200 }; };
  const row = buildRow(packet());
  assert.deepEqual(await saveRow({ row, url: 'https://x.supabase.co/', key: 'K', fetchFn: ok }), { ok: true });
  assert.equal(seen.url, 'https://x.supabase.co/rest/v1/rpc/log_abandoned_build'); assert.equal(seen.init.headers.apikey, 'K'); assert.equal(JSON.parse(seen.init.body).p_build_id, 'b-123');
  assert.equal((await saveRow({ row, url: 'https://x', key: 'K', fetchFn: async () => ({ ok: false, status: 401 }) })).ok, false);
  assert.equal((await saveRow({ row, url: 'https://x', key: 'K', fetchFn: async () => { throw new Error('boom'); } })).ok, false);
  const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }));
  const t = await saveRow({ row, url: 'https://x', key: 'K', fetchFn: hang, timeoutMs: 20 }); assert.deepEqual([t.ok, t.reason], [false, 'timed out']);
  assert.equal((await saveRow({ row, url: '', key: '' })).ok, false);                       // not configured: quietly skipped
});

function fakeRes() { const r = { headers: {}, code: null, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; }
const fakeReq = (body, ua = 'Mozilla/5.0 (iPhone) Mobile') => ({ method: 'POST', headers: { origin: 'https://loamlabsusa.com', 'user-agent': ua }, on(ev, cb) { if (ev === 'data') cb(Buffer.from(body)); if (ev === 'end') cb(); } });

test('collector: the Redis list is filled exactly as before AND a copy is saved; the answer is the same 202', async () => {
  const pushes = []; const redis = { lpush: async (k, v) => { pushes.push([k, JSON.parse(v)]); } }; const sent = [];
  const h = createHandler({ redis, env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true, status: 200 }; } });
  const res = fakeRes(); await h(fakeReq(JSON.stringify(packet())), res);
  assert.equal(res.code, 202); assert.equal(pushes.length, 1); assert.equal(pushes[0][0], 'abandoned_builds'); assert.equal(pushes[0][1].buildId, 'b-123'); assert.equal(pushes[0][1].source, 'abandonment_tracker');
  assert.equal(sent.length, 1); assert.equal(sent[0].p_device, 'phone'); assert.equal(h.config.api.bodyParser, false);
});

test('collector: Supabase down or not configured does not change the Redis write or the answer', async () => {
  const pushes = []; const redis = { lpush: async (...a) => { pushes.push(a); } };
  const down = createHandler({ redis, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async () => { throw new Error('down'); } });
  let res = fakeRes(); await down(fakeReq(JSON.stringify(packet())), res); assert.equal(res.code, 202); assert.equal(pushes.length, 1);
  const none = createHandler({ redis, env: {}, fetchFn: async () => { throw new Error('should not be called'); } });
  res = fakeRes(); await none(fakeReq(JSON.stringify(packet())), res); assert.equal(res.code, 202); assert.equal(pushes.length, 2);
});

test('collector: unchanged behaviour for OPTIONS, wrong method and a Redis failure', async () => {
  const h = createHandler({ redis: { lpush: async () => { throw new Error('redis down'); } }, env: {}, fetchFn: async () => ({ ok: true }) });
  let res = fakeRes(); await h({ method: 'OPTIONS', headers: {} }, res); assert.equal(res.code, 204);
  res = fakeRes(); await h({ method: 'GET', headers: {} }, res); assert.equal(res.code, 405);
  res = fakeRes(); await h(fakeReq(JSON.stringify(packet())), res); assert.equal(res.code, 202); assert.equal(res.body.message, 'Error handled');
});

const anon = (id) => ({ isLoggedIn: false, anonymousId: id });
const live = { origin: 'https://loamlabsusa.com' };

test('classifyTest: a normal visitor from the live shop is real', () => {
  assert.deepEqual(classifyTest(packet({ visitor: anon('9f1c-real') }), live), { isTest: false, drop: false, reason: null });
  assert.equal(classifyTest(packet({ visitor: anon('x') }), { origin: 'https://www.loamlabsusa.com' }).isTest, false);
  assert.equal(classifyTest(packet({ visitor: anon('x') }), {}).isTest, false);          // older beacon without an origin: treated as real
});

test('classifyTest: the TEST- marker is dropped, in any case, and testBuild:true too', () => {
  for (const id of ['TEST-agent-b', 'test_agent-c', 'Test-backend2']) assert.deepEqual([classifyTest(packet({ visitor: anon(id) }), live).isTest, classifyTest(packet({ visitor: anon(id) }), live).drop], [true, true]);
  assert.equal(classifyTest(packet({ visitor: anon('x'), testBuild: true }), live).drop, true);
  assert.equal(classifyTest(packet({ visitor: anon('contest-winner') }), live).isTest, false);   // only a PREFIX counts
});

test('classifyTest: other theme role or other website is a test that is flagged (kept in Supabase, not emailed)', () => {
  const r1 = classifyTest(packet({ visitor: anon('x'), themeRole: 'unpublished' }), live); assert.deepEqual([r1.isTest, r1.drop], [true, false]); assert.match(r1.reason, /theme_role:unpublished/);
  assert.equal(classifyTest(packet({ visitor: anon('x'), themeRole: 'main' }), live).isTest, false);
  const r2 = classifyTest(packet({ visitor: anon('x') }), { origin: 'https://e6f6c8-2.myshopify.com' }); assert.deepEqual([r2.isTest, r2.drop], [true, false]); assert.match(r2.reason, /origin:e6f6c8-2.myshopify.com/);
  assert.equal(classifyTest(packet({ visitor: anon('x') }), { origin: 'https://staging.example.com' }, { liveHosts: ['staging.example.com'] }).isTest, false);   // override list
});

test('buildRow carries the test flag and reason', () => {
  const row = buildRow(packet(), {}, { isTest: true, testReason: 'origin:x' }); assert.equal(row.p_is_test, true); assert.equal(row.p_test_reason, 'origin:x');
  assert.equal(buildRow(packet()).p_is_test, false);
});

test('collector: marker build is dropped completely (no Redis, no Supabase) and still answers 202', async () => {
  const pushes = []; const sent = []; const redis = { lpush: async (...a) => { pushes.push(a); } };
  const h = createHandler({ redis, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(i.body); return { ok: true }; } });
  const res = fakeRes(); await h(fakeReq(JSON.stringify(packet({ visitor: anon('TEST-agent-b') }))), res);
  assert.equal(res.code, 202); assert.equal(pushes.length, 0); assert.equal(sent.length, 0);
});

test('collector: a build from another website is NOT emailed (no Redis) but is saved flagged is_test', async () => {
  const pushes = []; const sent = []; const redis = { lpush: async (...a) => { pushes.push(a); } };
  const h = createHandler({ redis, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true }; } });
  const req = fakeReq(JSON.stringify(packet({ visitor: anon('x') }))); req.headers.origin = 'https://e6f6c8-2.myshopify.com';
  const res = fakeRes(); await h(req, res);
  assert.equal(res.code, 202); assert.equal(pushes.length, 0); assert.equal(sent.length, 1); assert.equal(sent[0].p_is_test, true); assert.match(sent[0].p_test_reason, /^origin:/);
});

test('collector: a real visitor is exactly as before (Redis + saved with is_test false)', async () => {
  const pushes = []; const sent = []; const redis = { lpush: async (...a) => { pushes.push(a); } };
  const h = createHandler({ redis, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true }; } });
  const res = fakeRes(); await h(fakeReq(JSON.stringify(packet({ visitor: anon('real-1') }))), res);
  assert.equal(pushes.length, 1); assert.equal(sent[0].p_is_test, false);
});
