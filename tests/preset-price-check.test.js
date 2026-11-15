// Run with: npm test (no network). Numbers are the live store's on Nov 15: rims We Are One carbon $495 / I9 aluminum $124, Hydra2 and Solix front hub $240, rear $510, SYSTEM spokes $295 per wheel, assembly $40 (carbon) or $0 (aluminum).
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/preset-price-check');

const c = (d) => Math.round(d * 100);
function catalog(o = {}) {
  const rims = { C: { cents: c(495), productId: 'rimC', tags: ['weareone', 'carbonrim'] }, A: { cents: c(124), productId: 'rimA', tags: ['industrynine', 'aluminumrim', 'component:rim'] }, ...(o.rims || {}) };
  const hub = (m, s) => ({ productId: m + s, cents: s === 'front' ? c(240) : c(510), minCents: s === 'front' ? c(240) : c(510), maxCents: s === 'front' ? c(240) : c(510), ...((o.hub || {})[m + s] || {}) });
  const out = new Set(o.notInCollection || []);
  return {
    rimVariant: (id) => rims[id] || null,
    hub: (m, s) => (m === 'Hydra2' || m === 'Solix' ? hub(m, s) : null),
    spokes: () => ({ productId: 'spk', cents: c(295), minCents: c(295), maxCents: c(295), ...(o.spokes || {}) }),
    assembly: (cents) => ({ cents, productId: 'asm' }),
    inCollection: (pid) => !out.has(pid),
  };
}
const preset = (kind, o = {}) => {
  const carbon = kind === 'carbon';
  const total = carbon ? 216900 : 142920, list = carbon ? 241000 : 158800, disc = list - total;
  return { handle: 'p-' + kind, variantPrices: [total, total, total], variantCompareAt: [list, list, list],
    meta: { preset_hub_model: o.hub || 'Hydra2', preset_front_rim_variant: carbon ? 'C' : 'A', preset_rear_rim_variant: carbon ? 'C' : 'A', preset_price_check: JSON.stringify({ listCents: list, discountCents: disc, totalCents: total }), ...(o.meta || {}) } };
};

test('systemPrice reproduces the cart arithmetic the builder uses: carbon $2,169.00 (8 counted), aluminum $1,429.20 (6 counted, exactly the minimum)', () => {
  const carbon = P.systemPrice([{ cents: 49500, qty: 2, inCollection: true }, { cents: 24000, qty: 1, inCollection: true }, { cents: 51000, qty: 1, inCollection: true }, { cents: 29500, qty: 2, inCollection: true }, { cents: 4000, qty: 2, inCollection: true }]);
  assert.deepEqual(carbon, { listCents: 241000, discountCents: 24100, totalCents: 216900, counted: 8, applies: true });
  const alloy = P.systemPrice([{ cents: 12400, qty: 2, inCollection: true }, { cents: 24000, qty: 1, inCollection: true }, { cents: 51000, qty: 1, inCollection: true }, { cents: 29500, qty: 2, inCollection: true }, { cents: 0, qty: 2, inCollection: true }]);
  assert.deepEqual(alloy, { listCents: 158800, discountCents: 15880, totalCents: 142920, counted: 6, applies: true });
  assert.equal(P.systemPrice([{ cents: 999, qty: 6, inCollection: true }]).discountCents, 6 * 99);   // fraction of a cent dropped per unit
  assert.equal(P.systemPrice([{ cents: 10000, qty: 5, inCollection: true }]).applies, false);       // 5 items: no discount
});
test('clean: the carbon and aluminum presets (Hydra2 and Solix) match the parts, so nothing is reported', () => {
  for (const [k, hub] of [['carbon', 'Hydra2'], ['alloy', 'Hydra2'], ['carbon', 'Solix'], ['alloy', 'Solix']]) assert.deepEqual(P.checkPreset(preset(k, { hub }), catalog()), [], k + hub);
});
test('drift: a page price that is low (the Nov 14 case, $10.80 low) is named with the amount', () => {
  const p = preset('carbon'); p.variantPrices = [215820, 215820, 215820];
  const f = P.checkPreset(p, catalog()); assert.equal(f.length, 1); assert.match(f[0], /page price \$2158\.20, parts after the 10% = \$2169\.00 \(page is LOW by \$10\.80; list \$2410\.00\)/);
});
test('drift: a part price change shows up (spokes $295 to $285 makes the page HIGH); compare-at and preset_price_check differences are reported', () => {
  const f = P.checkPreset(preset('alloy'), catalog({ spokes: { cents: c(285), minCents: c(285), maxCents: c(285) } }));
  assert.ok(f.some((x) => /page is HIGH by \$18\.00/.test(x)), f.join('|')); assert.ok(f.some((x) => /compare-at/.test(x))); assert.ok(f.some((x) => /preset_price_check says/.test(x)));
  const p = preset('carbon'); p.variantCompareAt = [null, null, null]; assert.ok(P.checkPreset(p, catalog()).some((x) => /compare-at is empty/.test(x)));
  const q = preset('carbon', { meta: { preset_price_check: 'not json' } }); assert.ok(P.checkPreset(q, catalog()).some((x) => /preset_price_check is missing or not readable/.test(x)));
});
test('drift: variants with different prices, a part that left the SYSTEM10 collections, and fewer than 6 counted items', () => {
  const p = preset('carbon'); p.variantPrices = [216900, 216900, 200000]; assert.ok(P.checkPreset(p, catalog()).some((x) => /variants have different prices/.test(x)));
  const f = P.checkPreset(preset('alloy'), catalog({ notInCollection: ['rimA'] }));
  assert.ok(f.some((x) => /front rim \(\$124\.00\) is not in a SYSTEM10 collection/.test(x))); assert.ok(f.some((x) => /only 4 counted items/.test(x)));
});
test('unusable input is reported, never guessed: unknown hub model, missing rim variant, unknown rim type, hub variants at different prices', () => {
  assert.match(P.checkPreset(preset('carbon', { hub: 'Hydra3' }), catalog())[0], /not one the check knows/);
  assert.match(P.checkPreset(preset('carbon', { meta: { preset_front_rim_variant: 'ZZ' } }), catalog())[0], /front rim variant ZZ not found/);
  assert.match(P.checkPreset(preset('alloy'), catalog({ rims: { A: { cents: 12400, productId: 'rimA', tags: ['reserve'] } } }))[0], /assembly price unknown for the rim type/);
  assert.ok(P.checkPreset(preset('carbon'), catalog({ hub: { Hydra2front: { minCents: 20000, maxCents: 24000 } } })).some((x) => /front hub product has different prices/.test(x)));
});

// ---- the Shopify reads and the task wiring, with a fake client ----
function fakeClient(o = {}) {
  const calls = [];
  const mk = (h, vp, ca) => ({ id: 'gid://shopify/Product/1', handle: h, title: h, status: o.status || 'ACTIVE', metafields: { nodes: [{ key: 'preset_hub_model', value: 'Hydra2' }, { key: 'preset_front_rim_variant', value: 'C' }, { key: 'preset_rear_rim_variant', value: 'C' }, { key: 'preset_price_check', value: JSON.stringify({ listCents: 241000, discountCents: 24100, totalCents: 216900 }) }] }, variants: { nodes: [{ id: 'v1', price: vp, compareAtPrice: ca }, { id: 'v2', price: vp, compareAtPrice: ca }] } });
  const prices = { 10262087991603: ['240.00', '240.00'], 10262112010547: ['510.00', '510.00'], 10261675311411: ['240.00', '240.00'], 10261918318899: ['510.00', '510.00'], 15442698666291: ['295.00', '295.00'] };
  return {
    calls,
    async query({ data: { query, variables } }) {
      calls.push(query); if (o.fail) throw new Error('Throttled');
      if (/products\(first:25,after/.test(query)) return { body: { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: o.noPresets ? [] : [mk('p1', o.price || '2169.00', '2410.00')] } } } };
      if (/nodes\(ids/.test(query)) return { body: { data: { nodes: variables.ids.map((id) => ({ id, price: '495.00', product: { id: 'gid://shopify/Product/9', tags: ['weareone'] } })) } } };
      if (/priceRangeV2/.test(query)) { const id = variables.id.split('/').pop(); const pr = prices[id]; return { body: { data: { product: { id: variables.id, priceRangeV2: { minVariantPrice: { amount: pr[0] }, maxVariantPrice: { amount: pr[1] } } } } } }; }
      if (/productVariant\(/.test(query)) return { body: { data: { productVariant: { id: variables.id, price: variables.id.endsWith('67810649014579') ? '0.00' : '40.00' } } } };
      if (/collection\(/.test(query)) return { body: { data: { collection: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: ['9', '10262087991603', '10262112010547', '10261675311411', '10261918318899', '15442698666291', '9742784004403'].map((n) => ({ id: 'gid://shopify/Product/' + n })) } } } } };
      throw new Error('unexpected query');
    },
  };
}
test('runPresetPriceCheck against a fake store: clean = no findings and no email section; a low price is found; only read queries are sent', async () => {
  const ok = await P.runPresetPriceCheck(fakeClient()); assert.deepEqual(ok, { checked: 1, findings: [] }); assert.equal(P.renderSection(ok), '');
  const bad = await P.runPresetPriceCheck(fakeClient({ price: '2158.20' })); assert.equal(bad.findings.length, 1); assert.match(P.renderSection(bad), /Preset price drift \(1\)/);
  const cl = fakeClient(); await P.runPresetPriceCheck(cl); assert.ok(cl.calls.every((x) => !/mutation/i.test(x)));
});
test('failures never throw: a read error or no presets becomes one line; draft presets are not checked', async () => {
  assert.match((await P.runPresetPriceCheck(fakeClient({ fail: true }))).findings[0], /could not run: Throttled/);
  assert.match((await P.runPresetPriceCheck(fakeClient({ noPresets: true }))).findings[0], /No active preset products/);
  assert.match((await P.runPresetPriceCheck(fakeClient({ status: 'DRAFT' }))).findings[0], /No active preset products/);
});
test('the daily task is wired: the check runs inside the Data Health audit, its findings count and are added to the email; still silent when clean', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'api', 'run-daily-tasks.js'), 'utf8');
  assert.match(src, /require\('\.\.\/lib\/preset-price-check'\)/); assert.match(src, /await runPresetPriceCheck\(client\)/);
  assert.match(src, /errors\.missingData\.length \+ presetResult\.findings\.length/); assert.match(src, /emailHtml \+= renderPresetSection\(presetResult\)/);
  assert.match(src, /if \(totalIssues > 0\)/);
});
