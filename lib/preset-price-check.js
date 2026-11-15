// Preset price drift check (read only). For every pre-configured System wheelset product (tag i9-preset) it recomputes the price the builder would charge
// (parts at list price, SYSTEM10 = 10% off the parts in the three smart collections, minimum 6 counted items, a $0 line is not counted) and compares it with the
// page: variant prices, compare-at and the preset_price_check metafield. Nothing is written anywhere. The result is a list of plain-text findings; the daily
// Data Health task adds them to its email (silent when the list is empty).
//
// The arithmetic is the same as PresetBuilds.systemPrice() in the theme (assets/preset-builds.js): the percentage is taken per unit and the fraction of a cent dropped.
const SYSTEM10 = { percent: 10, minQuantity: 6 };

// The parts the presets are built from (store ids, read Nov 15). Hubs and the spoke bundle have one price on every variant (checked on every run).
// Assembly: We Are One carbon rims $40 per wheel, Industry Nine aluminum rims $0 (an unknown rim type is reported, never guessed).
const PARTS = {
  collections: { systemBuildComponents: '514480439603', systemAlloyRims: '514480472371', accessoriesBuilder: '514481914163' },
  hubs: {
    Hydra2: { front: '10262087991603', rear: '10262112010547' },   // Industry Nine Hydra2 SYSTEM Front / Rear Hub - 6-Bolt
    Solix: { front: '10261675311411', rear: '10261918318899' },     // Industry Nine Solix SYSTEM Front / Rear Hub - Centerlock
  },
  spokes: '15442698666291',                                           // Industry Nine SYSTEM Spokes (one bundle per wheel)
  assemblyService: '9742784004403',
  assemblyVariant: { 0: '67810649014579', 40: '51504906535219' },   // Assembly Service variants $0 and $40
};

const toCents = (v) => Math.round(Number(v) * 100);
const money = (c) => '$' + (c / 100).toFixed(2);
const gidNum = (id) => String(id || '').split('/').pop();

/** lines: [{ cents, qty, inCollection }]. Returns { listCents, discountCents, totalCents, counted, applies } */
function systemPrice(lines) {
  let list = 0, counted = 0, disc = 0;
  for (const l of lines) { list += l.cents * l.qty; if (l.inCollection && l.cents > 0) counted += l.qty; }
  const applies = counted >= SYSTEM10.minQuantity;
  if (applies) for (const l of lines) if (l.inCollection && l.cents > 0) disc += Math.floor(l.cents * SYSTEM10.percent / 100) * l.qty;
  return { listCents: list, discountCents: disc, totalCents: list - disc, counted, applies };
}

/**
 * One preset against the live parts.
 * preset: { handle, title, variantPrices: [cents], variantCompareAt: [cents|null], meta: { preset_hub_model, preset_front_rim_variant, preset_rear_rim_variant, preset_price_check } }
 * catalog: { rimVariant(id) -> { cents, productId, tags[] } | null, hub(model, side) -> { cents, minCents, maxCents, productId } | null, spokes -> same, assembly(cents) -> { cents, productId } | null, inCollection(productId) -> bool }
 * @returns {string[]} findings (empty = the page matches the parts)
 */
function checkPreset(preset, catalog) {
  const out = []; const name = preset.handle;
  const m = preset.meta || {};
  const model = m.preset_hub_model;
  const fr = catalog.rimVariant(m.preset_front_rim_variant), rr = catalog.rimVariant(m.preset_rear_rim_variant);
  const hf = catalog.hub(model, 'front'), hr = catalog.hub(model, 'rear'), sp = catalog.spokes();
  if (!fr) out.push(`${name}: front rim variant ${m.preset_front_rim_variant || '(missing)'} not found`);
  if (!rr) out.push(`${name}: rear rim variant ${m.preset_rear_rim_variant || '(missing)'} not found`);
  if (!hf || !hr) out.push(`${name}: hub model "${model || '(missing)'}" is not one the check knows (Hydra2 or Solix)`);
  if (!sp) out.push(`${name}: the System spoke product was not found`);
  if (out.length) return out;
  for (const [what, p] of [['front hub', hf], ['rear hub', hr], ['spoke bundle', sp]]) if (p.minCents !== p.maxCents) out.push(`${name}: the ${what} product has different prices on its variants (${money(p.minCents)} to ${money(p.maxCents)}), so the check cannot pick one`);
  // assembly per wheel from the rim type
  const asmFor = (rim) => { const t = rim.tags || []; if (t.includes('weareone')) return 40; if (t.includes('industrynine') && t.includes('aluminumrim')) return 0; return null; };
  const af = asmFor(fr), ar = asmFor(rr);
  if (af === null || ar === null) { out.push(`${name}: assembly price unknown for the rim type (tags: ${(af === null ? fr : rr).tags.join(', ')}); add the rule to the check`); return out; }
  const asm = [catalog.assembly(af * 100), catalog.assembly(ar * 100)];
  if (!asm[0] || !asm[1]) { out.push(`${name}: the Assembly Service variant for ${money(af * 100)} / ${money(ar * 100)} was not found`); return out; }
  const lines = [
    { role: 'front rim', cents: fr.cents, qty: 1, productId: fr.productId },
    { role: 'rear rim', cents: rr.cents, qty: 1, productId: rr.productId },
    { role: 'front hub', cents: hf.cents, qty: 1, productId: hf.productId },
    { role: 'rear hub', cents: hr.cents, qty: 1, productId: hr.productId },
    { role: 'spokes (front wheel)', cents: sp.cents, qty: 1, productId: sp.productId },
    { role: 'spokes (rear wheel)', cents: sp.cents, qty: 1, productId: sp.productId },
    { role: 'front assembly', cents: asm[0].cents, qty: 1, productId: asm[0].productId },
    { role: 'rear assembly', cents: asm[1].cents, qty: 1, productId: asm[1].productId },
  ].map((l) => ({ ...l, inCollection: catalog.inCollection(l.productId) }));
  const exp = systemPrice(lines);
  if (!exp.applies) out.push(`${name}: only ${exp.counted} counted items in the SYSTEM10 collections (needs ${SYSTEM10.minQuantity}); the 10% would not apply`);
  for (const l of lines) if (l.cents > 0 && !l.inCollection) out.push(`${name}: ${l.role} (${money(l.cents)}) is not in a SYSTEM10 collection, so it gets no 10%`);
  const prices = preset.variantPrices, compare = preset.variantCompareAt;
  const distinctP = [...new Set(prices)], distinctC = [...new Set(compare.map((c) => (c == null ? 'none' : c)))];
  if (distinctP.length !== 1) out.push(`${name}: variants have different prices (${distinctP.map(money).join(', ')})`);
  else if (distinctP[0] !== exp.totalCents) out.push(`${name}: page price ${money(distinctP[0])}, parts after the 10% = ${money(exp.totalCents)} (${distinctP[0] < exp.totalCents ? 'page is LOW by ' : 'page is HIGH by '}${money(Math.abs(exp.totalCents - distinctP[0]))}; list ${money(exp.listCents)})`);
  if (distinctC.length !== 1) out.push(`${name}: variants have different compare-at prices`);
  else if (distinctC[0] !== exp.listCents) out.push(`${name}: compare-at ${distinctC[0] === 'none' ? 'is empty' : money(distinctC[0])}, parts at list = ${money(exp.listCents)}`);
  let chk = null; try { chk = m.preset_price_check ? JSON.parse(m.preset_price_check) : null; } catch (e) { chk = null; }
  if (!chk) out.push(`${name}: preset_price_check is missing or not readable`);
  else if (chk.listCents !== exp.listCents || chk.discountCents !== exp.discountCents || chk.totalCents !== exp.totalCents) out.push(`${name}: preset_price_check says list ${money(chk.listCents)} / discount ${money(chk.discountCents)} / total ${money(chk.totalCents)}; the parts give ${money(exp.listCents)} / ${money(exp.discountCents)} / ${money(exp.totalCents)}`);
  return out;
}

// ---------- Shopify reads (Admin GraphQL, read only). `client.query({ data: { query, variables } })` as in api/run-daily-tasks.js ----------
const q = async (client, query, variables) => { const r = await client.query({ data: { query, variables } }); const b = r.body; if (b.errors) throw new Error(JSON.stringify(b.errors).slice(0, 200)); return b.data; };

async function loadPresets(client) {
  const out = []; let cursor = null, more = true;
  while (more) {
    const d = await q(client, `query($c:String){products(first:25,after:$c,query:"tag:i9-preset"){pageInfo{hasNextPage endCursor} nodes{id handle title status metafields(first:30,namespace:"custom"){nodes{key value}} variants(first:100){nodes{id price compareAtPrice}}}}}`, { c: cursor });
    for (const p of d.products.nodes) out.push({ id: p.id, handle: p.handle, title: p.title, status: p.status, meta: Object.fromEntries(p.metafields.nodes.map((x) => [x.key, x.value])), variantPrices: p.variants.nodes.map((v) => toCents(v.price)), variantCompareAt: p.variants.nodes.map((v) => (v.compareAtPrice == null ? null : toCents(v.compareAtPrice))) });
    more = d.products.pageInfo.hasNextPage; cursor = d.products.pageInfo.endCursor;
  }
  return out;
}

async function loadCatalog(client, presets) {
  const rimIds = [...new Set(presets.flatMap((p) => [p.meta.preset_front_rim_variant, p.meta.preset_rear_rim_variant]).filter(Boolean))];
  const rims = new Map();
  for (let i = 0; i < rimIds.length; i += 50) {
    const d = await q(client, `query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id price product{id tags}}}}`, { ids: rimIds.slice(i, i + 50).map((x) => 'gid://shopify/ProductVariant/' + x) });
    for (const n of d.nodes) if (n) rims.set(gidNum(n.id), { cents: toCents(n.price), productId: gidNum(n.product.id), tags: n.product.tags });
  }
  const prod = async (id) => { const d = await q(client, `query($id:ID!){product(id:$id){id priceRangeV2{minVariantPrice{amount} maxVariantPrice{amount}}}}`, { id: 'gid://shopify/Product/' + id }); const p = d.product; return p ? { productId: id, cents: toCents(p.priceRangeV2.minVariantPrice.amount), minCents: toCents(p.priceRangeV2.minVariantPrice.amount), maxCents: toCents(p.priceRangeV2.maxVariantPrice.amount) } : null; };
  const hubs = {}; for (const [model, s] of Object.entries(PARTS.hubs)) hubs[model] = { front: await prod(s.front), rear: await prod(s.rear) };
  const spokes = await prod(PARTS.spokes);
  const asm = {}; for (const [dollars, vid] of Object.entries(PARTS.assemblyVariant)) { const d = await q(client, `query($id:ID!){productVariant(id:$id){id price}}`, { id: 'gid://shopify/ProductVariant/' + vid }); if (d.productVariant) asm[Number(dollars) * 100] = { cents: toCents(d.productVariant.price), productId: PARTS.assemblyService }; }
  const members = new Set();
  for (const id of Object.values(PARTS.collections)) {
    let cursor = null, more = true;
    while (more) { const d = await q(client, `query($id:ID!,$c:String){collection(id:$id){products(first:250,after:$c){pageInfo{hasNextPage endCursor} nodes{id}}}}`, { id: 'gid://shopify/Collection/' + id, c: cursor }); if (!d.collection) throw new Error('collection ' + id + ' not found'); for (const n of d.collection.products.nodes) members.add(gidNum(n.id)); more = d.collection.products.pageInfo.hasNextPage; cursor = d.collection.products.pageInfo.endCursor; }
  }
  return { rimVariant: (id) => rims.get(String(id)) || null, hub: (model, side) => (hubs[model] && hubs[model][side]) || null, spokes: () => spokes, assembly: (cents) => asm[cents] || null, inCollection: (pid) => members.has(String(pid)) };
}

/** Runs the whole check. Returns { checked, findings[] }. A failure to read is reported as one finding, never thrown (the other daily tasks must go on). */
async function runPresetPriceCheck(client) {
  try {
    const presets = (await loadPresets(client)).filter((p) => p.status === 'ACTIVE');
    if (!presets.length) return { checked: 0, findings: ['No active preset products (tag i9-preset) were found; the check read nothing.'] };
    const catalog = await loadCatalog(client, presets);
    const findings = presets.flatMap((p) => checkPreset(p, catalog));
    return { checked: presets.length, findings };
  } catch (e) { return { checked: 0, findings: ['The preset price check could not run: ' + String(e.message).slice(0, 200)] }; }
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderSection(result) { return result.findings.length ? `<hr><h2>Preset price drift (${result.findings.length})</h2><p>${result.checked} preset wheelsets checked against the live part prices and the 10% System discount.</p><ul>${result.findings.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''; }

module.exports = { SYSTEM10, PARTS, systemPrice, checkPreset, loadPresets, loadCatalog, runPresetPriceCheck, renderSection };
