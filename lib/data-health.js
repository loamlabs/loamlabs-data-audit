// Data Health email tidy-up (pure helpers, unit tested).
//  1. System hubs (tag i9_system) are not checked for the seven hub geometry fields: spoke lengths for System orders come from I9's own chart (keyed by variant id in the
//     spoke automation), the builder's length estimate is skipped for System builds, and the Studio preview falls back to sample numbers when they are blank.
//  2. The email prints one line per product: the missing field names with how many variants each affects, instead of one line per variant per field.

const SYSTEM_HUB_SKIPPED_FIELDS = [
  'hub_spoke_hole_diameter', 'hub_flange_diameter_left', 'hub_flange_diameter_right',
  'hub_flange_offset_left', 'hub_flange_offset_right', 'hub_sp_offset_spoke_hole_left', 'hub_sp_offset_spoke_hole_right',
];
const isSystemHub = (product) => !!product && Array.isArray(product.tags) && product.tags.includes('component:hub') && product.tags.includes('i9_system');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * productErrors: the strings the audit collects for one product. Variant messages look like
 *   Variant "<title>" missing: `key` (optional note)      or      Variant "<title>" mismatch: <text>
 * Everything else (for example "Missing Product Field: `x`") is a product-level message.
 * @returns {{ missing: Map<string, {variants:string[], note:string}>, mismatches: Map<string,string[]>, product: string[] }}
 */
function groupProductErrors(productErrors) {
  const missing = new Map(), mismatches = new Map(), product = [];
  for (const e of productErrors) {
    let m = /^Variant "([\s\S]*)" missing: `([^`]+)`(?: \(([^)]*)\))?$/.exec(e);
    if (m) { const g = missing.get(m[2]) || { variants: [], note: '' }; g.variants.push(m[1]); if (m[3] && !g.note) g.note = m[3]; missing.set(m[2], g); continue; }
    m = /^Variant "([\s\S]*)" mismatch: ([\s\S]*)$/.exec(e);
    if (m) { const g = mismatches.get(m[2]) || []; g.push(m[1]); mismatches.set(m[2], g); continue; }
    product.push(e);
  }
  return { missing, mismatches, product };
}

/**
 * One line for one product.
 * variantsChecked: variants the audit looked at; variantsTotal: variants the product has (the audit reads the first 50 only).
 */
function collapseProductLine(title, productErrors, variantsChecked, variantsTotal) {
  const { missing, mismatches, product } = groupProductErrors(productErrors);
  const n = variantsChecked;
  const parts = [];
  const all = [], some = [];
  for (const [key, g] of missing) {
    const k = new Set(g.variants).size;
    (k >= n ? all : some).push(k >= n ? '`' + key + '`' : '`' + key + '` (' + k + ')');
  }
  if (all.length) parts.push('missing on all ' + n + ' variants: ' + all.join(', '));
  if (some.length) parts.push('missing on some variants (of ' + n + '): ' + some.join(', '));
  for (const [text, vs] of mismatches) parts.push('mismatch on ' + new Set(vs).size + ' of ' + n + ' variants: ' + text);
  for (const p of product) parts.push(p);
  const note = variantsTotal && variantsTotal > variantsChecked ? ' [only the first ' + variantsChecked + ' of ' + variantsTotal + ' variants are checked]' : '';
  return `- **${title}**${note}: ${parts.join('; ')}`;
}

/** The single line that replaces the hub field noise. */
function systemHubsLine(titles) {
  return titles.length ? `<p><em>System hubs skipped (${titles.length} products: ${titles.map(esc).join('; ')}): spoke lengths for System builds come from the I9 chart, so the seven hub geometry fields are not checked on them.</em></p>` : '';
}

module.exports = { SYSTEM_HUB_SKIPPED_FIELDS, isSystemHub, groupProductErrors, collapseProductLine, systemHubsLine };
