// This is the "master" file for all scheduled tasks (CommonJS Version)
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { Resend } = require('resend');
const { Redis } = require('@upstash/redis');

// --- SHARED CONFIGURATION ---
const {
  SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, RESEND_API_KEY, REPORT_EMAIL_TO,
  UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET
} = process.env;

const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
const resend = new Resend(RESEND_API_KEY);
const shopify = shopifyApi({
  apiSecretKey: 'not-used-for-admin-token', adminApiAccessToken: SHOPIFY_ADMIN_API_TOKEN,
  isCustomStoreApp: true, hostName: SHOPIFY_STORE_DOMAIN.replace('https://', ''), apiVersion: LATEST_API_VERSION,
});

function getSession() { return { id: 'data-audit-session', shop: SHOPIFY_STORE_DOMAIN, accessToken: SHOPIFY_ADMIN_API_TOKEN, state: 'not-used', isOnline: false }; }

// --- Task 1: Abandoned Build Report Logic ---
const renderWheelComponents = (wheelComponents) => {
  if (!wheelComponents || wheelComponents.length === 0) return '';
  return wheelComponents.map(component => `
    <tr>
      <td class="component-label">${component.type}</td>
      <td class="component-name">${component.name}</td>
    </tr>
  `).join('');
};

async function sendAbandonedBuildReport() {
    console.log("Running Task: Send Abandoned Build Report...");
    const builds = await redis.lrange('abandoned_builds', 0, -1);
    if (builds.length === 0) {
        console.log("Report Task: No abandoned builds to report.");
        return { status: 'success', message: 'No builds to report.' };
    }
    const buildsHtml = builds.map((build, index) => {
        let visitorHtml = '';
        if (build.visitor) {
            if (build.visitor.isLoggedIn) {
                const customerUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId}`;
                const visitorName = `${build.visitor.firstName || ''} ${build.visitor.lastName || ''}`.trim();
                visitorHtml = `<tr><td>User</td><td><strong><a href="${customerUrl}" target="_blank">${visitorName || 'Customer'}</a></strong><br><small>${build.visitor.email}</small></td></tr>`;
            } else {
                visitorHtml = `<tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${build.visitor.anonymousId}</small></td></tr>`;
            }
        }
        const hasFrontComponents = build.components && build.components.front && build.components.front.length > 0;
        const hasRearComponents = build.components && build.components.rear && build.components.rear.length > 0;
        return `
            <div class="build-section">
                <h3>Build #${index + 1} (ID: ${build.buildId})</h3>
                <p>Captured: ${new Date(build.capturedAt).toLocaleString()}</p>
                <table class="data-table">${visitorHtml}<tr><td>Type</td><td><strong>${build.buildType}</strong></td></tr><tr><td>Style</td><td>${build.ridingStyleDisplay}</td></tr>${hasFrontComponents ? `<tr><td colspan="2" class="subheader">Front Wheel</td></tr>${renderWheelComponents(build.components.front)}` : ''}${hasRearComponents ? `<tr><td colspan="2" class="subheader">Rear Wheel</td></tr>${renderWheelComponents(build.components.rear)}` : ''}<tr><td>Subtotal</td><td><strong>${'$' + ((build.subtotal || 0) / 100).toFixed(2)}</strong></td></tr></table>
            </div>
        `;
    }).join('');
    const emailHtml = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}a{color:#007bff;text-decoration:none}.container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}.build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}.data-table{border-collapse:collapse;width:100%}.data-table td{padding:8px;border:1px solid #ddd}.data-table td:first-child{font-weight:bold;width:120px;}.component-label{font-weight:normal !important;padding-left:25px !important;}.component-name{font-weight:bold;}.subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}</style></head><body><div class="container"><h2>Daily Abandoned Build Report</h2><p>Found <strong>${builds.length}</strong> significant build(s) that were started but not added to the cart in the last 24 hours.</p>${buildsHtml}</div></body></html>`;
    await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: [REPORT_EMAIL_TO], subject: `Abandoned Build Report: ${builds.length} build(s)`, html: emailHtml });
    await redis.del('abandoned_builds');
    return { status: 'success', message: `Report sent for ${builds.length} builds.` };
}

// --- Task 2: Data Audit Logic ---
async function runDataAudit() {
    console.log("Running Task: Data Audit...");
    const PAGINATED_PRODUCTS_QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 20, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
    const client = new shopify.clients.Graphql({ session: getSession() });
    let allProducts = [], hasNextPage = true, cursor = null;
    do {
        const response = await client.query({ data: { query: PAGINATED_PRODUCTS_QUERY, variables: { cursor } } });
        const pageData = response.body.data.products;
        allProducts.push(...pageData.edges.map(edge => edge.node));
        hasNextPage = pageData.pageInfo.hasNextPage; cursor = pageData.pageInfo.endCursor;
    } while (hasNextPage);
    let errors = { unpublished: [], missingData: [] };
    for (const product of allProducts) {
        if (product.tags.includes('audit:exclude')) continue;
        const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
        if (!isPublished) { errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\``); continue; }
        const productMetafields = Object.fromEntries(product.metafields.edges.map(e => [e.node.key, e.node.value]));
        const productErrors = [];
        const hasProductWeight = !!productMetafields.weight_g;
        let allVariantsHaveWeight = product.variants.edges.length > 0;
        for (const { node: variant } of product.variants.edges) {
            const variantMetafields = Object.fromEntries(variant.metafields.edges.map(e => [e.node.key, e.node.value]));
            if (!variantMetafields.weight_g) { allVariantsHaveWeight = false; break; }
        }
        if (!hasProductWeight && !allVariantsHaveWeight) productErrors.push("Missing: `weight_g` at either Product or Variant level.");
        if (product.tags.includes('component:rim')) {
            const requiredRimMetafields = ['rim_washer_policy', 'rim_spoke_hole_offset', 'rim_target_tension_kgf'];
            requiredRimMetafields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`${key}\``); });
            product.variants.edges.forEach(({ node: v }) => {
                const vM = Object.fromEntries(v.metafields.edges
