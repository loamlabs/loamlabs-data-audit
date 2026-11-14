// Run with: npm test  (no network: fake Redis and fake Supabase)
// Per-part extras in the abandoned-build packet: variantId, handle, vendor, priceCents (sent by the theme from Release 41).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRow, partExtras, partsFingerprint } = require('../lib/abandoned-log');
const { renderReport } = require('../lib/abandoned-email');
const { createHandler } = require('../api/log-abandoned-build');

const anon = (id) => ({ isLoggedIn: false, anonymousId: id });
const OLD = { type: 'Rim', name: 'Rim A (29" / 28h / Black)' };
const FULL = { type: 'Rim', name: 'Rim A (29" / 28h / Black)', variantId: '51901373710643', handle: 'rim-a-carbon', vendor: 'We Are One', priceCents: 62500 };
const packet = (front, rear, over = {}) => ({ buildId: 'b-1', buildType: 'Wheel Set', ridingStyleDisplay: 'Mountain', subtotal: 150000, components: { front, rear }, visitor: anon('real-1'), quickBuildGenerated: false, ...over });

function fakeRes() { const r = { headers: {}, code: null, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; } }; return r; }
const fakeReq = (body) => ({ method: 'POST', headers: { origin: 'https://loamlabsusa.com', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome' }, on(ev, cb) { if (ev === 'data') cb(Buffer.from(body)); if (ev === 'end') cb(); } });
const collector = () => { const pushes = []; const sent = []; const h = createHandler({ redis: { lpush: async (k, v) => { pushes.push(JSON.parse(v)); } }, env: { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'K' }, fetchFn: async (u, i) => { sent.push(JSON.parse(i.body)); return { ok: true }; } }); return { h, pushes, sent }; };

test('new fields present: stored inside each component (components JSON), nothing else in the row changes', () => {
  const row = buildRow(packet([FULL], [{ ...FULL, variantId: '51901373710644', priceCents: 62500 }]));
  assert.deepEqual(row.p_components.front[0], { type: 'Rim', name: OLD.name, variantId: '51901373710643', handle: 'rim-a-carbon', vendor: 'We Are One', priceCents: 62500 });
  assert.equal(row.p_components.rear[0].variantId, '51901373710644');
  const plain = buildRow(packet([OLD], [OLD]));
  const { p_components: a, p_captured_at: t1, ...restNew } = row; const { p_components: b, p_captured_at: t2, ...restOld } = plain;   // (capture time is the clock)
  assert.deepEqual(restNew, restOld, 'every other column is the same as for a packet without the fields');
});

test('old packet (the live theme today: type and name only): stored exactly as now, byte for byte', () => {
  const row = buildRow(packet([OLD], [OLD]));
  assert.deepEqual(row.p_components, { front: [{ type: 'Rim', name: OLD.name }], rear: [{ type: 'Rim', name: OLD.name }] });
  assert.equal(JSON.stringify(row.p_components), '{"front":[{"type":"Rim","name":"Rim A (29\\" / 28h / Black)"}],"rear":[{"type":"Rim","name":"Rim A (29\\" / 28h / Black)"}]}');
});

test('partly present: only the valid fields are kept, the others are left out; mixed components in one packet', () => {
  const row = buildRow(packet([{ ...OLD, variantId: 777, vendor: 'DT Swiss' }, { type: 'Hub', name: 'Hub X', priceCents: 0 }, OLD], []));
  assert.deepEqual(row.p_components.front[0], { type: 'Rim', name: OLD.name, variantId: '777', vendor: 'DT Swiss' });
  assert.deepEqual(row.p_components.front[1], { type: 'Hub', name: 'Hub X', priceCents: 0 });
  assert.deepEqual(row.p_components.front[2], { type: 'Rim', name: OLD.name });
});

test('junk values: gid text is reduced to the number; bad ids, handles, prices are dropped; long text is clipped; nothing throws', () => {
  assert.deepEqual(partExtras({ variantId: 'gid://shopify/ProductVariant/4455' }), { variantId: '4455' });
  assert.deepEqual(partExtras({ variantId: '12a', handle: 'has space', vendor: '   ', priceCents: -5 }), {});
  assert.deepEqual(partExtras({ variantId: 'x'.repeat(40), handle: 'x'.repeat(300), priceCents: 1e12 }), {});
  assert.deepEqual(partExtras({ priceCents: 'abc' }), {}); assert.deepEqual(partExtras({ priceCents: NaN }), {}); assert.deepEqual(partExtras({ priceCents: Infinity }), {});
  assert.deepEqual(partExtras({ priceCents: '450.5' }), { priceCents: 451 }); assert.deepEqual(partExtras({ priceCents: 4500.4 }), { priceCents: 4500 });
  assert.equal(partExtras({ vendor: 'V'.repeat(500) }).vendor.length, 80);
  assert.deepEqual(partExtras({ handle: 'Rim-A_Carbon' }), { handle: 'rim-a_carbon' });
  assert.deepEqual(partExtras({ variantId: { a: 1 }, handle: ['x'], vendor: { a: 1 }, priceCents: {} }), {});
  assert.deepEqual(partExtras(null), {}); assert.deepEqual(partExtras('text'), {}); assert.deepEqual(partExtras(undefined), {});
  const row = buildRow(packet([{ type: 'Rim', name: 'n', variantId: { evil: 1 }, handle: '<script>', vendor: 5, priceCents: 'free' }], []));
  assert.deepEqual(row.p_components.front[0], { type: 'Rim', name: 'n' });
  const longRow = buildRow(packet([{ type: 'Rim', name: 'n', extra: 'unknown field is not copied', handle: 'ok' }], []));
  assert.deepEqual(longRow.p_components.front[0], { type: 'Rim', name: 'n', handle: 'ok' }, 'unknown fields are not stored');
});

test('the parts fingerprint does not change with the extras (same build, with or without ids and prices, is the same row)', () => {
  const a = buildRow(packet([OLD], [OLD])), b = buildRow(packet([FULL], [FULL]));
  assert.equal(a.p_parts_fingerprint, b.p_parts_fingerprint);
  assert.equal(buildRow(packet([{ ...FULL, priceCents: 99999 }], [FULL])).p_parts_fingerprint, b.p_parts_fingerprint, 'a price change is not a different build');
  assert.equal(partsFingerprint({ front: [FULL], rear: [] }), partsFingerprint({ front: [OLD], rear: [] }));
});

test('collector end to end: a packet with the fields is emailed (Redis) as sent and saved with the extras; a packet without them is saved as before', async () => {
  let c = collector(); let res = fakeRes();
  await c.h(fakeReq(JSON.stringify(packet([FULL], [FULL]))), res);
  assert.equal(res.code, 202); assert.equal(c.pushes.length, 1); assert.equal(c.sent.length, 1);
  assert.equal(c.sent[0].p_components.front[0].variantId, '51901373710643'); assert.equal(c.sent[0].p_components.front[0].priceCents, 62500);
  c = collector(); res = fakeRes(); await c.h(fakeReq(JSON.stringify(packet([OLD], [OLD]))), res);
  assert.equal(res.code, 202); assert.deepEqual(c.sent[0].p_components.front[0], { type: 'Rim', name: OLD.name });
  c = collector(); res = fakeRes(); await c.h(fakeReq(JSON.stringify(packet([{ ...OLD, variantId: { bad: 1 }, priceCents: 'x' }], []))), res);
  assert.equal(res.code, 202); assert.deepEqual(c.sent[0].p_components.front[0], { type: 'Rim', name: OLD.name }, 'junk never breaks a save');
});

test('the daily report is unchanged by the new fields (same text with and without them)', () => {
  const a = renderReport({ builds: [packet([OLD], [OLD])] }), b = renderReport({ builds: [packet([FULL], [FULL])] });
  assert.equal(a.html, b.html); assert.equal(a.subject, b.subject);
});

test('test and origin handling untouched: a TEST- visitor with extras is still dropped, a flagged automation build is still saved as test, origin still read', async () => {
  let c = collector(); await c.h(fakeReq(JSON.stringify(packet([FULL], [FULL], { visitor: anon('TEST-agent-b') }))), fakeRes());
  assert.equal(c.pushes.length, 0); assert.equal(c.sent.length, 0);
  c = collector(); await c.h(fakeReq(JSON.stringify(packet([FULL], [FULL], { automation: true }))), fakeRes());
  assert.equal(c.pushes.length, 0); assert.equal(c.sent[0].p_is_test, true); assert.equal(c.sent[0].p_components.front[0].priceCents, 62500);
  c = collector(); await c.h(fakeReq(JSON.stringify(packet([FULL], [FULL], { origin: { kind: 'preset', ref: 'H2', entry: 'step3', changed: false, addedToCart: false } }))), fakeRes());
  assert.equal(c.sent[0].p_origin_kind, 'preset');
});
