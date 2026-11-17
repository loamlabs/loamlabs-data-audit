const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { geometryReviewLine, GEOMETRY_REVIEW_KEYS } = require('../lib/data-health');

const P = { hub_flange_offset_left: '37.0', hub_flange_offset_right: '25.0', hub_flange_diameter_left: '58.0', hub_spoke_hole_diameter: '2.6' };
const V = (title, m) => ({ title, metafields: m });

test('no variant carries its own geometry (every product today): no review line', () => {
  assert.equal(geometryReviewLine('Spank HEX Rear Hub', P, [V('32h / Black', { weight_g: '315' }), V('32h / Blue', {})]), null);
});
test('a variant value equal to the product value is not flagged (also 37 against 37.0)', () => {
  assert.equal(geometryReviewLine('Hub', P, [V('a', { hub_flange_offset_left: '37' }), V('b', { hub_flange_offset_left: '37.00' })]), null);
});
test('a variant value that differs from the product value is flagged, with the count and one example', () => {
  const line = geometryReviewLine('Spank HEX Rear Hub', P, [V('32h / Black', {}), V('32h / Blue / R135', { hub_flange_offset_left: '34', hub_flange_offset_right: '22' }), V('32h / Green / R135', { hub_flange_offset_left: '34' })]);
  assert.match(line, /\*\*Spank HEX Rear Hub\*\*/);
  assert.match(line, /`hub_flange_offset_left` on 2 of 3 variants \(for example "32h \/ Blue \/ R135": 34, product 37\)/);
  assert.match(line, /`hub_flange_offset_right` on 1 of 3 variants/);
});
test('a product with no value of its own for a key (a master) is never flagged for it; blank or unreadable variant values are ignored', () => {
  assert.equal(geometryReviewLine('Master', {}, [V('a', { hub_flange_offset_left: '34' })]), null);
  assert.equal(geometryReviewLine('Hub', P, [V('a', { hub_flange_offset_left: '' }), V('b', { hub_flange_offset_left: 'abc' })]), null);
});
test('weight is not a review key (weights legitimately differ per variant); the straight-pull offsets and hole diameter are', () => {
  assert.ok(!GEOMETRY_REVIEW_KEYS.includes('weight_g'));
  for (const k of ['hub_sp_offset_spoke_hole_left', 'hub_sp_offset_spoke_hole_right', 'hub_spoke_hole_diameter', 'hub_flange_diameter_right']) assert.ok(GEOMETRY_REVIEW_KEYS.includes(k), k);
  assert.match(geometryReviewLine('Hub', { weight_g: '300', hub_sp_offset_spoke_hole_left: '1.5' }, [V('a', { weight_g: '280', hub_sp_offset_spoke_hole_left: '0.6' })]), /hub_sp_offset_spoke_hole_left/);
  assert.equal(geometryReviewLine('Hub', { weight_g: '300' }, [V('a', { weight_g: '280' })]), null);
});
test('the daily audit checks hubs only (not System hubs), counts the lines as issues and lists them in the report; the paging of variants is already there', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'run-daily-tasks.js'), 'utf8');
  assert.match(src, /product\.tags\.includes\('component:hub'\) && !systemHub/);
  assert.match(src, /errors\.geometryReview\.length/);
  assert.match(src, /Hub geometry: variant differs from product/);
  assert.match(src, /loadRemainingVariants\(client, p\)/);
});
