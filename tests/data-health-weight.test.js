const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { weightIssueLine, isWeightPlaceholder } = require('../lib/data-health');

const P = (tags, title = 'Some Hub') => ({ title, tags });

test('rim, hub and nipple: a variant with its own weight_g is fine; one without is flagged, even when the product has a weight (no product fallback)', () => {
  for (const t of ['component:rim', 'component:hub', 'component:nipple']) {
    assert.equal(weightIssueLine(P([t]), { weight_g: '315' }, {}, '32h / Black'), null, t);
    assert.match(weightIssueLine(P([t]), {}, { weight_g: '315' }, '32h / Black'), /Variant "32h \/ Black" missing: `weight_g` \(variant only: no product fallback\)/, t);
    assert.match(weightIssueLine(P([t]), {}, {}, 'x'), /missing/);
  }
});
test('the placeholders "Your Own Hub" and "Your Own Rim" are skipped; a product tagged watcher-ignore is skipped', () => {
  assert.equal(weightIssueLine(P(['component:hub'], 'Your Own Hub'), {}, {}, 'a'), null);
  assert.equal(weightIssueLine(P(['component:rim'], 'Your Own Rim'), {}, {}, 'a'), null);
  assert.equal(weightIssueLine(P(['component:hub', 'watcher-ignore']), {}, {}, 'a'), null);
  assert.equal(isWeightPlaceholder('Your Own Hubcap Rim'), false); assert.equal(isWeightPlaceholder('Spank Your Own'), false); assert.equal(isWeightPlaceholder(' your own hub '), true);
});
test('freehubs, valve stems and accessories are never flagged (no tag of ours checks them, and the function returns nothing for them)', () => {
  for (const t of ['component:freehub', 'component:valvestem', 'accessory']) assert.equal(weightIssueLine(P([t]), {}, {}, 'x'), null, t);
});
test('spokes keep their own rule: variant weight, or the product base weight (spoke_base_weight_g, or the older weight_g); flagged only when none exists', () => {
  assert.equal(weightIssueLine(P(['component:spoke']), {}, { spoke_base_weight_g: '5.95' }, 'x'), null);
  assert.equal(weightIssueLine(P(['component:spoke']), {}, { weight_g: '5.95' }, 'x'), null);
  assert.equal(weightIssueLine(P(['component:spoke']), { weight_g: '5.9' }, {}, 'x'), null);
  assert.match(weightIssueLine(P(['component:spoke']), {}, {}, 'x'), /missing/);
});
test('the daily audit uses the new check for every variant (the old universal variant-then-product check is gone) and stays report-only', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'run-daily-tasks.js'), 'utf8');
  assert.match(src, /weightIssueLine\(product, vM, productMetafields, v\.title\)/);
  assert.ok(!/Universal Weight Check/.test(src));
  assert.ok(!/getMetafield\(vM, 'weight_g'\)/.test(src));
});
