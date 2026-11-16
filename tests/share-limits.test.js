// Run with: npm test (no network). Limits for a Share Build button every visitor can press (Nov 15):
// all visitors together 300 new links an hour and 2,000 a day; limits inside a build; one-hour de-duplication per IP; a daily save counter and one Data Health line above 500 saves a day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const S = require('../lib/share-build');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'share', n + '.json'), 'utf8'));
const FIXTURES = fs.readdirSync(path.join(__dirname, 'fixtures', 'share')).map((f) => f.replace(/\.json$/, ''));
const LIVE = 'https://loamlabsusa.com';
const HOUR = 3600 * 1000, T0 = Date.UTC(2026, 10, 16, 10, 0, 0);

function fakeRedis(opts = {}) {
  const store = new Map(); const ttl = new Map(); const calls = [];
  return {
    store, ttl, calls,
    async set(k, v, o = {}) { calls.push(['set', k, o]); if (opts.failSet) throw new Error('down'); if (o.nx && store.has(k)) return null; store.set(k, v); if (o.ex) ttl.set(k, o.ex); return 'OK'; },
    async get(k) { calls.push(['get', k]); if (opts.failGet) throw new Error('down'); const v = store.get(k); if (v === undefined) return null; if (typeof v === 'number') return v; try { return JSON.parse(v); } catch (e) { return v; } },
    async incr(k) { if (opts.failIncr) throw new Error('down'); const n = (store.get(k) || 0) + 1; store.set(k, n); return n; },
    async expire(k, s) { calls.push(['expire', k, s]); ttl.set(k, s); return 1; },
  };
}
function res() { const r = { code: 200, headers: {}, body: undefined }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; }
const post = (body, ip = '1.2.3.4') => ({ method: 'POST', headers: { origin: LIVE, 'content-type': 'application/json', 'x-forwarded-for': ip }, body });
async function save(h, body, ip) { const r = res(); await h(post(body, ip), r); return r; }
const uniq = (i) => { const b = fx('real-standard-s41'); b.buildId = 'B-' + i; return b; };   // a different build each time

test('all visitors together: 300 new links an hour, then 429 "busy"; the next hour starts fresh; one visitor is not blamed (their own limit is separate)', async () => {
  const redis = fakeRedis(); let now = T0; const h = S.createSaveHandler({ redis, now: () => now });
  for (let i = 0; i < 300; i++) { const r = await save(h, uniq(i), '10.0.' + Math.floor(i / 50) + '.' + (i % 50)); assert.equal(r.code, 200, 'save ' + i); }
  const over = await save(h, uniq(300), '9.9.9.9'); assert.equal(over.code, 429); assert.match(over.body.error, /busy/);
  now += HOUR; const next = await save(h, uniq(301), '9.9.9.9'); assert.equal(next.code, 200);
  assert.equal(S.SAVE_GLOBAL_HOUR.max, 300); assert.equal(S.SAVE_GLOBAL_DAY.max, 2000);
});
test('all visitors together: 2,000 a day, then 429 until the next UTC day', async () => {
  const redis = fakeRedis(); let now = T0; const h = S.createSaveHandler({ redis, now: () => now }); let n = 0;
  for (let hour = 0; hour < 7; hour++) { for (let i = 0; i < 300 && n < 2000; i++, n++) { const r = await save(h, uniq(n), 'ip-' + n); assert.equal(r.code, 200, 'save ' + n); } now += HOUR; }
  assert.equal(n, 2000);   // 7 hours later, still the same UTC day (10:00 to 17:00)
  const over = await save(h, uniq(5000), 'late-ip'); assert.equal(over.code, 429);
  now = Date.UTC(2026, 10, 17, 0, 5, 0); const fresh = await save(h, uniq(5001), 'late-ip'); assert.equal(fresh.code, 200);
});
test('refused or repeated requests do not use up the shared limits: bad builds, too-large builds and de-duplicated clicks are not counted', async () => {
  const redis = fakeRedis(); const h = S.createSaveHandler({ redis, now: () => T0 });
  await save(h, { evil: 1 }, '5.5.5.5'); await save(h, { ...fx('real-standard-s41'), extra: 'x'.repeat(S.MAX_STRING_CHARS + 1) }, '5.5.5.5');
  const first = await save(h, uniq(1), '6.6.6.6'); for (let i = 0; i < 20; i++) assert.equal((await save(h, uniq(1), '6.6.6.6')).body.shareId, first.body.shareId);
  const keys = [...redis.store.keys()].filter((k) => k.startsWith('rl:share:save-all-hour')); assert.equal(redis.store.get(keys[0]), 1, 'one counted save in the hour');
});

test('de-duplication: the same build from the same IP within an hour gets the same link; another IP, another build, another origin flag, or an expired entry gets a new one', async () => {
  const redis = fakeRedis(); const h = S.createSaveHandler({ redis, now: () => T0 }); const g = S.createGetHandler({ redis });
  const a = await save(h, uniq(1), '1.1.1.1'), b = await save(h, uniq(1), '1.1.1.1'); assert.equal(a.code, 200); assert.equal(b.body.shareId, a.body.shareId);
  assert.equal([...redis.store.keys()].filter((k) => k.startsWith('shared_build:')).length, 1, 'one entry stored');
  assert.notEqual((await save(h, uniq(1), '2.2.2.2')).body.shareId, a.body.shareId);
  assert.notEqual((await save(h, uniq(2), '1.1.1.1')).body.shareId, a.body.shareId);
  assert.notEqual((await save(h, { ...uniq(1), testBuild: true }, '1.1.1.1')).body.shareId, a.body.shareId, 'a test-marked copy is its own entry');
  const dk = [...redis.store.keys()].find((k) => k.startsWith('shared_dedupe:')); assert.equal(redis.ttl.get(dk), S.DEDUPE_SECONDS); assert.equal(S.DEDUPE_SECONDS, 3600);
  const opened = await (async () => { const r = res(); await g({ method: 'GET', headers: { 'x-forwarded-for': '1.1.1.1' }, query: { id: a.body.shareId } }, r); return r; })(); assert.deepEqual(opened.body, uniq(1));
  redis.store.delete('shared_build:' + a.body.shareId);   // the entry is gone (expired): the next click makes a new link, never a dead id
  const c = await save(h, uniq(1), '1.1.1.1'); assert.notEqual(c.body.shareId, a.body.shareId); assert.equal(c.code, 200);
});
test('de-duplication failure never blocks a save: a Redis read error on the lookup still saves', async () => {
  const redis = fakeRedis(); const h = S.createSaveHandler({ redis, now: () => T0 }); redis.get = async () => { throw new Error('down'); };
  assert.equal((await save(h, uniq(1), '1.1.1.1')).code, 200);
});

test('inside the build: a text over 4,000 characters, a list over 200 items or a group over 100 keys is refused with a clear message; exactly at the limit is accepted', async () => {
  const h = S.createSaveHandler({ redis: fakeRedis(), now: () => T0 });
  const withSpecs = (specs) => ({ ...fx('real-standard-s41'), specs });
  for (const [bad, ok] of [[{ note: 'x'.repeat(4001) }, { note: 'x'.repeat(4000) }], [{ list: new Array(201).fill(1) }, { list: new Array(200).fill(1) }], [Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['k' + i, i])), Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['k' + i, i]))]]) {
    const r = await save(h, withSpecs(bad), 'a'); assert.equal(r.code, 400, JSON.stringify(r.body)); assert.match(r.body.error, /too long/);
    assert.equal((await save(h, withSpecs(ok), 'b' + Math.random())).code, 200);
  }
  const nested = { ...fx('real-standard-s41') }; nested.components = { ...nested.components, frontRequiredAddons: [{ a: 'y'.repeat(4001) }] };
  assert.equal((await save(h, nested, 'c')).code, 400);
  const big = { ...fx('real-standard-s41'), specs: { note: 'x'.repeat(S.MAX_BYTES) } }; assert.equal((await save(h, big, 'd')).code, 413, 'the total size cap still answers first');
});
test('inside the build: all ' + FIXTURES.length + ' real fixtures (up to 40 KB, longest text 400, longest list 30, most keys 40) are accepted and open back identical', async () => {
  const redis = fakeRedis(); const h = S.createSaveHandler({ redis, now: () => T0 }); const g = S.createGetHandler({ redis });
  assert.equal(FIXTURES.length, 7);
  for (const n of FIXTURES) { const b = fx(n); assert.ok(S.limitsOk(b), n); const r = await save(h, b, 'ip-' + n); assert.equal(r.code, 200, n + ' ' + JSON.stringify(r.body)); const o = res(); await g({ method: 'GET', headers: { origin: LIVE, 'x-forwarded-for': 'z' }, query: { id: r.body.shareId } }, o); assert.deepEqual(o.body, b, n); }
  assert.equal(S.MAX_STRING_CHARS, 4000); assert.equal(S.MAX_ARRAY_ITEMS, 200); assert.equal(S.MAX_OBJECT_KEYS, 100);
});

test('daily save counter: counts only new links (not repeats, not refusals), by UTC day, kept 3 days; the line appears only above 500 a day', async () => {
  const redis = fakeRedis(); const h = S.createSaveHandler({ redis, now: () => T0 });
  await save(h, uniq(1), 'x'); await save(h, uniq(1), 'x'); await save(h, { bad: 1 }, 'x'); await save(h, uniq(2), 'x');
  const key = S.saveCountKey(T0); assert.equal(key, 'stats:share:saves:2026-11-16'); assert.equal(redis.store.get(key), 2); assert.equal(redis.ttl.get(key), 3 * 86400);
  assert.equal(await S.shareSavesLine(redis, T0), '');
  redis.store.set(key, 500); assert.equal(await S.shareSavesLine(redis, T0), '', '500 exactly is not above');
  redis.store.set(key, 501); assert.match(await S.shareSavesLine(redis, T0), /Share Build saved 501 links on 2026-11-16 \(alert level 500 a day\)/);
  assert.equal(S.SAVE_COUNT_ALERT, 500);
  assert.equal(await S.shareSavesLine({ get: async () => { throw new Error('down'); } }, T0), '', 'a Redis problem never breaks the email');
  const redis2 = fakeRedis({ failIncr: true }); assert.equal((await save(S.createSaveHandler({ redis: redis2, now: () => T0 }), uniq(9), 'q')).code, 200, 'the counter is only a report: a failure there never blocks a save');
});

// ---- the daily email, with a fake store and fake mail ----
function loadAudit(redisCounts) {
  const file = path.join(__dirname, '..', 'api', 'run-daily-tasks.js');
  Object.assign(process.env, { SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_API_TOKEN: 't', RESEND_API_KEY: 'k', REPORT_EMAIL_TO: 'to@example.invalid', UPSTASH_REDIS_REST_URL: 'https://example.invalid', UPSTASH_REDIS_REST_TOKEN: 't', CRON_SECRET: 's' });
  const sent = [];
  const fakes = {
    '@shopify/shopify-api': { LATEST_API_VERSION: '2024-04', shopifyApi: () => ({ clients: { Graphql: class { async query({ data }) { if (/i9-preset/.test(data.query)) return { body: { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'g/1', handle: 'p', title: 'p', status: 'DRAFT', metafields: { nodes: [] }, variants: { nodes: [] } }] } } } }; return { body: { data: { products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } } }; } } } }) },
    '@shopify/shopify-api/adapters/node': {},
    resend: { Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { id: 'x' }; } }; } } },
    '@upstash/redis': { Redis: class { async get(k) { return redisCounts[k] === undefined ? null : redisCounts[k]; } } },
  };
  const orig = Module._load; Module._load = function (req, parent, ...r) { return Object.prototype.hasOwnProperty.call(fakes, req) ? fakes[req] : orig.call(this, req, parent, ...r); };
  try { const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__runDataAudit = runDataAudit;', file); return { run: m.exports.__runDataAudit, sent }; } finally { Module._load = orig; }
}
test('Data Health email: no Share Build line at 500 saves yesterday or fewer; one counted line above 500', async () => {
  const yesterday = S.saveCountKey(Date.now() - 86400000);
  const quiet = loadAudit({ [yesterday]: 500 }); await quiet.run(); assert.ok(quiet.sent.every((m) => !/Share Build/.test(m.html)), 'no line at 500');
  const busy = loadAudit({ [yesterday]: 650 }); await busy.run();
  assert.equal(busy.sent.length, 1); assert.match(busy.sent[0].html, /<h2>Share Build \(1\)<\/h2><p>Share Build saved 650 links on \d{4}-\d\d-\d\d/); assert.match(busy.sent[0].subject, /Issues Found/);
});
