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
async function sendAbandonedBuildReport() {
    console.log("Running Task: Send Abandoned Build Report...");
    const buildsJson = await redis.lrange('abandoned_builds', 0, -1);
    if (buildsJson.length > 0) { await redis.del('abandoned_builds'); }
    if (buildsJson.length === 0) { console.log("Report Task: No abandoned builds to report."); return { status: 'success', message: 'No builds to report.' }; }
    const builds = buildsJson.map(b => JSON.parse(b));
    let buildsHtml = '';
    builds.forEach((build, index) => {
        const getComp = (pos, type) => {
            const component = build.components[`${pos}${type}`];
            if (component && component.title) { return `${component.title} (${component.variantTitle || ''})`; }
            return '<em>Not Selected</em>';
        };
        let visitorHtml = '';
        if (build.visitor) {
            if (build.visitor.isLoggedIn) {
                const customerUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId}`;
                visitorHtml = `<tr><td>User</td><td><strong><a href="${customerUrl}" target="_blank">${build.visitor.firstName || ''} ${build.visitor.lastName || ''}</a></strong><br><small>${build.visitor.email}</small></td></tr>`;
            } else { visitorHtml = `<tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${build.visitor.anonymousId}</small></td></tr>`; }
        }
        buildsHtml += `<div class="build-section"><h3>Build #${index + 1} (ID: ${build.buildId})</h3><p>Captured: ${new Date(build.capturedAt).toLocaleString()}</p><table class="data-table">${visitorHtml}<tr><td>Type</td><td><strong>${build.buildType}</strong></td></tr><tr><td>Style</td><td>${build.ridingStyleDisplay}</td></tr>${(build.buildType === 'Front' || build.buildType === 'Wheel Set') ? `<tr><td colspan="2" class="subheader">Front Wheel</td></tr><tr><td>Front Rim</td><td>${getComp('front', 'Rim')}</td></tr><tr><td>Front Hub</td><td>${getComp('front', 'Hub')}</td></tr>` : ''}${(build.buildType === 'Rear' || build.buildType === 'Wheel Set') ? `<tr><td colspan="2" class="subheader">Rear Wheel</td></tr><tr><td>Rear Rim</td><td>${getComp('rear', 'Rim')}</td></tr><tr><td>Rear Hub</td><td>${getComp('rear', 'Hub')}</td></tr>` : ''}<tr><td>Subtotal</td><td><strong>${'$' + ((build.subtotal || 0) / 100).toFixed(2)}</strong></td></tr></table></div>`;
    });
    const emailHtml = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}a{color:#007bff;text-decoration:none}.container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}.build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}.data-table{border-collapse:collapse;width:100%}.data-table td{padding:8px;border:1px solid #ddd}.data-table td:first-child{font-weight:bold;width:120px}.subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}</style></head><body><div class="container"><h2>Daily Abandoned Build Report</h2><p>Found <strong>${builds.length}</strong> significant build(s) that were started but not added to the cart in the last 24 hours.</p>${buildsHtml}</div></body></html>`;
    await resend.emails.send({ from: 'Builder Reports <reports@loamlabsusa.com>', to: [REPORT_EMAIL_TO], subject: `Abandoned Build Report: ${builds.length} build(s)`, html: emailHtml });
    console.log(`Report Task: Successfully sent report for ${builds.length} builds.`);
    return { status: 'success', message: `Report sent for ${builds.length} builds.` };
}

// --- Task 2: Data Audit Logic ---
async function runDataAudit() {
    console.log("Running Task: Data Audit...");
    const PAGINATED_PRODUCTS_QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke' OR tag:'component:valvestem'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 20, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
    const client = new shopify.clients.Graphql({ session: getSession() });
    let allProducts = [], hasNextPage = true, cursor = null;
    do {
        const response = await client.query({ data: { query: PAGINATED_PRODUCTS_QUERY, variables: { cursor } } });
        const pageData = response.body.data.products;
        allProducts.push(...pageData.edges.map(edge => edge.node));
        hasNextPage = pageData.pageInfo.hasNextPage; cursor = pageData.pageInfo.endCursor;
    } while (hasNextPage);
    console.log(`Audit Task: Found ${allProducts.length} total component products to audit.`);
    let errors = { unpublished: [], missingData: [] };
    for (const product of allProducts) {
        if (product.tags.includes('audit:exclude')) continue;
        const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
        if (!isPublished) { errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\``); continue; }
        const productMetafields = Object.fromEntries(product.metafields.edges.map(e => [e.node.key, e.node.value]));
        const productErrors = [];
        if (product.tags.includes('component:rim')) { const wP = productMetafields.rim_washer_policy; if (!wP) productErrors.push(`Missing: \`rim_washer_policy\``); else if (wP === 'Optional' || wP === 'Mandatory') { if (!productMetafields.nipple_washer_thickness) productErrors.push(`Missing for washer policy: \`nipple_washer_thickness\``); } ['rim_spoke_hole_offset', 'rim_target_tension_kgf'].forEach(k => { if (!productMetafields[k]) productErrors.push(`Missing: \`${k}\``); }); product.variants.edges.forEach(({ node: v }) => { const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value])); if (!vM.rim_erd) productErrors.push(`Variant "${v.title}" missing: \`rim_erd\``); }); }
        if (productErrors.length > 0) errors.missingData.push(`- **${product.title}**:<br><ul>${productErrors.map(e => `<li>${e}</li>`).join('')}</ul>`);
    }
    const totalIssues = errors.unpublished.length + errors.missingData.length;
    if (totalIssues > 0) {
        let emailHtml = `<h1>Data Health Report (${totalIssues} issues)</h1>`;
        if (errors.unpublished.length > 0) emailHtml += `<hr><h2>Unpublished (${errors.unpublished.length})</h2><ul>${errors.unpublished.map(e => `<li>${e}</li>`).join('')}</ul>`;
        if (errors.missingData.length > 0) emailHtml += `<hr><h2>Missing Data (${errors.missingData.length})</h2><ul>${errors.missingData.map(e => `<li>${e}</li>`).join('')}</ul>`;
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: `Data Health Report: ${totalIssues} Issues Found`, html: emailHtml });
        console.log(`Audit Task: Report sent with ${totalIssues} issues.`);
        return { status: 'success', message: `Audit complete. Found ${totalIssues} issues.` };
    } else {
        console.log("Audit Task: Audit complete. No issues found.");
        return { status: 'success', message: 'Audit complete. No issues found.' };
    }
}

// --- MAIN HANDLER ---
module.exports = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${CRON_SECRET}`) { return res.status(401).json({ message: 'Unauthorized' }); }
    try {
        const results = await Promise.allSettled([sendAbandonedBuildReport(), runDataAudit()]);
        console.log("All daily tasks finished.", results);
        results.forEach((result, index) => { if (result.status === 'rejected') console.error(`Task ${index === 0 ? 'Report' : 'Audit'} failed:`, result.reason); });
        return res.status(200).json({ message: 'All daily tasks executed.', results });
    } catch (error) {
        console.error('A critical error occurred in the main task handler:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
