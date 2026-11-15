// Run with: npm test (no network). The audit itself is run with a fake Shopify client and a fake mail sender (modules swapped in before the file is loaded).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const H = require('../lib/data-health');

const q = (t) => '`' + t + '`';

test('isSystemHub: only hubs tagged i9_system (not Classic hubs, not rims)', () => {
  assert.equal(H.isSystemHub({ tags: ['component:hub', 'hub_type:system', 'i9_system'] }), true);
  assert.equal(H.isSystemHub({ tags: ['component:hub', 'hub_type:classic_flange'] }), false);
  assert.equal(H.isSystemHub({ tags: ['component:rim', 'i9_system'] }), false);
  assert.equal(H.isSystemHub(null), false);
});
test('collapse: 7 fields x 21 variants (147 lines) become ONE line with the field names; partial and mismatch findings are counted; product fields kept', () => {
  const keys = H.SYSTEM_HUB_SKIPPED_FIELDS; const errs = [];
  for (let i = 0; i < 21; i++) for (const k of keys) errs.push(`Variant "24h / Black / v${i}" missing: ${q(k)} (No fallback found on Product level)`);
  assert.equal(errs.length, 147);
  const line = H.collapseProductLine('Industry Nine Solix SYSTEM Front Hub - Centerlock', errs, 21, 21);
  assert.equal(line.split('\n').length, 1);
  assert.match(line, /^- \*\*Industry Nine Solix SYSTEM Front Hub - Centerlock\*\*: missing on all 21 variants: `hub_spoke_hole_diameter`, /);
  for (const k of keys) assert.ok(line.includes(q(k)), k);
  const mixed = [`Variant "A" missing: ${q('freehub')}`, `Variant "B" missing: ${q('freehub')}`, 'Variant "C" mismatch: Position is "Rear", but \'Rear\' is missing from Title.', 'Variant "D" mismatch: Position is "Rear", but \'Rear\' is missing from Title.', 'Missing Product Field: `rim_target_tension_kgf`'];
  const l2 = H.collapseProductLine('X', mixed, 4, 4);
  assert.match(l2, /missing on some variants \(of 4\): `freehub` \(2\)/); assert.match(l2, /mismatch on 2 of 4 variants: Position is "Rear"/); assert.match(l2, /Missing Product Field: `rim_target_tension_kgf`/);
});
test('collapse: says so when a product has more variants than the audit reads (the first 50)', () => {
  const line = H.collapseProductLine('Big hub', [`Variant "a" missing: ${q('x')}`], 50, 84);
  assert.match(line, /\[only the first 50 of 84 variants are checked\]/);
  assert.doesNotMatch(H.collapseProductLine('Small', [`Variant "a" missing: ${q('x')}`], 4, 4), /only the first/);
});
test('systemHubsLine: one line, empty when nothing was skipped, product names escaped', () => {
  assert.equal(H.systemHubsLine([]), '');
  const l = H.systemHubsLine(['A <b>', 'B']); assert.equal(l.split('\n').length, 1); assert.match(l, /System hubs skipped \(2 products: A &lt;b&gt;; B\)/); assert.match(l, /I9 chart/);
});

// ---- the whole audit, with a fake store ----
function loadAudit(fakeProducts) {
  const file = path.join(__dirname, '..', 'api', 'run-daily-tasks.js');
  Object.assign(process.env, { SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_API_TOKEN: 't', RESEND_API_KEY: 'k', REPORT_EMAIL_TO: 'to@example.invalid', UPSTASH_REDIS_REST_URL: 'https://example.invalid', UPSTASH_REDIS_REST_TOKEN: 't', CRON_SECRET: 's' });
  const sent = []; const queries = [];
  const fakes = {
    '@shopify/shopify-api': { LATEST_API_VERSION: '2024-04', shopifyApi: () => ({ clients: { Graphql: class { async query({ data }) { queries.push(data.query); if (/i9-preset/.test(data.query)) return { body: { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }; return { body: { data: { products: { edges: fakeProducts.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } } } } }; } } } }) },
    '@shopify/shopify-api/adapters/node': {},
    resend: { Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { id: 'x' }; } }; } } },
    '@upstash/redis': { Redis: class { } },
  };
  const orig = Module._load; Module._load = function (req, parent, ...r) { return Object.prototype.hasOwnProperty.call(fakes, req) ? fakes[req] : orig.call(this, req, parent, ...r); };
  try {
    const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.__runDataAudit = runDataAudit;', file);
    return { run: m.exports.__runDataAudit, sent, queries };
  } finally { Module._load = orig; }
}
const mf = (o) => ({ edges: Object.entries(o).map(([key, value]) => ({ node: { key, value } })) });
const variant = (title, o = {}) => ({ node: { id: 'v-' + title, title, metafields: mf({ weight_g: '300', wheel_spec_brake_interface: '["6-Bolt"]', wheel_spec_hub_spacing: '15x110mm', wheel_spec_position: 'Front', ...o }) } });
const sysHub = (title, n, total) => ({ id: 'p-' + title, title, status: 'ACTIVE', onlineStoreUrl: 'https://x/' + title, tags: ['component:hub', 'hub_type:system', 'i9_system'], productType: 'Hub', vendor: 'Industry Nine', variantsCount: { count: total }, variants: { edges: Array.from({ length: n }, (_, i) => variant('24h / v' + i)) }, metafields: mf({ hub_type: 'System' }) });
const draft = (title) => ({ id: 'd-' + title, title, status: 'DRAFT', onlineStoreUrl: null, tags: ['component:rim'], productType: 'Rim', vendor: 'Ibis', variantsCount: { count: 1 }, variants: { edges: [] }, metafields: mf({}) });

test('the audit with System hubs: no hub geometry findings, ONE skipped line, a Classic hub missing a field still reported as one collapsed line, query asks for variantsCount', async () => {
  const classic = { id: 'p-c', title: 'Classic Hub Front', status: 'ACTIVE', onlineStoreUrl: 'https://x/c', tags: ['component:hub'], productType: 'Hub', vendor: 'DT', variantsCount: { count: 3 }, variants: { edges: [variant('a'), variant('b'), variant('c')] }, metafields: mf({ hub_type: 'Classic Flange' }) };
  const a = loadAudit([sysHub('Industry Nine Hydra2 SYSTEM Front Hub - 6-Bolt', 50, 84), sysHub('Industry Nine Solix SYSTEM Front Hub - Centerlock', 21, 21), classic, draft('Ibis S35 Carbon')]);
  const r = await a.run(); assert.equal(r.status, 'success');
  assert.equal(a.sent.length, 1); const html = a.sent[0].html;
  assert.ok(a.queries[0].includes('variantsCount { count }'));
  assert.doesNotMatch(html, /Industry Nine (Hydra2|Solix) SYSTEM[^<]*\*\*:/);                 // System hubs have no Missing Data entry
  assert.match(html, /System hubs skipped \(2 products: Industry Nine Hydra2 SYSTEM Front Hub - 6-Bolt; Industry Nine Solix SYSTEM Front Hub - Centerlock\)/);
  assert.equal((html.match(/System hubs skipped/g) || []).length, 1);
  const cl = /<li>- \*\*Classic Hub Front\*\*[^<]*<\/li>/.exec(html); assert.ok(cl, 'classic hub line'); assert.match(cl[0], /missing on all 3 variants: `hub_spoke_hole_diameter`, `hub_flange_diameter_left`/);
  assert.ok((html.match(/<li>Variant/g) || []).length === 0, 'no per-variant lines are left');
  assert.match(html, /Ibis S35 Carbon/);                                                         // the unpublished list is unchanged
  assert.ok(html.length < 5000, 'email is short: ' + html.length);
});
test('a clean System hub adds nothing about hubs to the email (only the unrelated preset line is left, as no presets exist in the fake store)', async () => {
  const hubOk = sysHub('Industry Nine Solix SYSTEM Rear Hub - Centerlock', 2, 2);
  for (const e of hubOk.variants.edges) e.node.metafields = mf({ weight_g: '1', wheel_spec_brake_interface: 'x', wheel_spec_hub_spacing: 'y', wheel_spec_position: 'Rear', freehub: 'XD', freehub_variant_map: '{}' });
  hubOk.title = 'Industry Nine Solix SYSTEM Rear Hub - Centerlock';
  const a = loadAudit([hubOk]); await a.run();
  assert.equal(a.sent.length, 1, 'only the preset line (no presets found) can send; nothing about hubs');
  assert.doesNotMatch(a.sent[0].html, /SYSTEM Rear Hub[^<]*\*\*:/);
});
