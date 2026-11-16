// Run with: npm test (no network). Second lock on save-shared-build: no text value may contain < or >.
// Quote marks and equals signs stay allowed (real builds have inch marks like 29").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../lib/share-build');

const fx = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'share', n + '.json'), 'utf8'));
const FIXTURES = fs.readdirSync(path.join(__dirname, 'fixtures', 'share')).map((f) => f.replace(/\.json$/, ''));
const LIVE = 'https://loamlabsusa.com';

function fakeRedis() {
  const store = new Map();
  return {
    store,
    async set(k, v, o = {}) { if (o.nx && store.has(k)) return null; store.set(k, v); return 'OK'; },
    async get(k) { const v = store.get(k); if (v === undefined) return null; if (typeof v === 'number') return v; try { return JSON.parse(v); } catch (e) { return v; } },
    async incr(k) { const n = (store.get(k) || 0) + 1; store.set(k, n); return n; },
    async expire() { return 1; },
  };
}
function res() { const r = { code: 200, headers: {}, body: undefined }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; }
async function save(h, body) { const r = res(); await h({ method: 'POST', headers: { origin: LIVE, 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body }, r); return r; }

const ATTACKS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '</div><b>',
  'a > b',
  'x<y',
  '>',
  '<',
  '<script>',          // already-decoded angle brackets
  '<!--',
  'Nice wheels <iframe src="https://evil.example"></iframe>',
];

test('attack strings are refused with a plain 400 and nothing is saved (in a spec, a nested object, an array entry, a buildId)', async () => {
  for (const evil of ATTACKS) {
    const places = {
      spec: (b) => { b.specs.riderNote = evil; },
      nested: (b) => { b.system = { a: { b: { c: evil } } }; },
      array: (b) => { b.components.frontSpokes = [{ name: 'ok' }, { name: evil }]; },
      buildId: (b) => { b.buildId = evil; },
      ui: (b) => { b._ui = { label: evil }; },
    };
    for (const [where, put] of Object.entries(places)) {
      const redis = fakeRedis(); const h = S.createSaveHandler({ redis });
      const b = fx('real-standard-s41'); put(b);
      const r = await save(h, b);
      assert.equal(r.code, 400, where + ' / ' + JSON.stringify(evil));
      assert.match(r.body.error, /not allowed/);
      assert.deepEqual([...redis.store.keys()].filter((k) => !k.startsWith('rl:')), [], 'nothing stored (only the per-visitor rate counter exists): ' + where + ' / ' + evil);
    }
  }
});

test('quote marks, equals signs, ampersands and other punctuation are NOT refused (29" inch marks)', async () => {
  for (const ok of ['29" Enduro rim', '27.5" x 32h', 'a=b', 'He said "hi"', "it's fine", '50% & 50%', 'Rider (tall) / wide: 100-110 mm; 3x']) {
    assert.equal(S.hasAngle(ok), false, ok);
    const redis = fakeRedis(); const h = S.createSaveHandler({ redis });
    const b = fx('real-standard-s41'); b.specs.riderNote = ok;
    const r = await save(h, b);
    assert.equal(r.code, 200, ok);
  }
});

test('all ' + FIXTURES.length + ' real saved builds still contain no < or > and are still accepted and open back identical', async () => {
  for (const name of FIXTURES) {
    const b = fx(name);
    assert.equal(S.hasAngle(b), false, name + ' has no angle brackets');
    const redis = fakeRedis(); const h = S.createSaveHandler({ redis });
    const r = await save(h, b);
    assert.equal(r.code, 200, name + ' ' + JSON.stringify(r.body));
    const g = S.createGetHandler({ redis }); const gr = res();
    await g({ method: 'GET', headers: { origin: LIVE, 'x-forwarded-for': '1.2.3.4' }, query: { id: r.body.shareId } }, gr);
    assert.equal(gr.code, 200, name);
    const got = gr.body.build || gr.body;
    const expected = JSON.parse(JSON.stringify(b)); for (const k of S.META_KEYS) delete expected[k];
    assert.deepEqual(got, expected, name);
  }
});

test('angle brackets in a key name are not looked at (only text values, as asked)', () => {
  assert.equal(S.hasAngle({ '<k>': 'fine' }), false);
  assert.equal(S.hasAngle({ k: ['a', { z: 'b>' }] }), true);
});
