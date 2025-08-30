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

// --- Task 1: Abandoned Build Report Logic (FINAL CORRECTED VERSION) ---
async function sendAbandonedBuildReport() {
    console.log("Running Task: Send Abandoned Build Report...");
    
    // Step 1: Get all the builds from the Redis list.
    // The Upstash client automatically parses the JSON, so this is an array of objects.
    const builds = await redis.lrange('abandoned_builds', 0, -1);

    // Step 2: If there are no builds, log it and exit successfully.
    if (builds.length === 0) {
        console.log("Report Task: No abandoned builds to report.");
        return { status: 'success', message: 'No builds to report.' };
    }

    // Step 3: Prepare the email content.
    // THE FIX: The unnecessary JSON.parse has been removed. 'builds' is already the correct format.
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
    
    // Step 4: Try to send the email.
    await resend.emails.send({
        from: 'LoamLabs Audit <info@loamlabsusa.com>',
        to: [REPORT_EMAIL_TO],
        subject: `Abandoned Build Report: ${builds.length} build(s)`,
        html: emailHtml
    });
    console.log(`Report Task: Successfully sent report for ${builds.length} builds.`);

    // Step 5: Only delete the data from Redis AFTER the email has been sent successfully.
    await redis.del('abandoned_builds');
    console.log("Report Task: Cleared reported builds from Redis.");

    return { status: 'success', message: `Report sent for ${builds.length} builds.` };
}

// --- Task 2: Data Audit Logic (FINAL CORRECTED VERSION 2) ---
async function runDataAudit() {
    console.log("Running Task: Data Audit (Comprehensive)...");
    const PAGINATED_PRODUCTS_QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 20, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
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

        // --- General Weight Check (for all components) ---
        const hasProductWeight = !!productMetafields.weight_g;
        let allVariantsHaveWeight = product.variants.edges.length > 0;
        for (const { node: variant } of product.variants.edges) {
            const variantMetafields = Object.fromEntries(variant.metafields.edges.map(e => [e.node.key, e.node.value]));
            if (!variantMetafields.weight_g) { allVariantsHaveWeight = false; break; }
        }
        if (!hasProductWeight && !allVariantsHaveWeight) {
            productErrors.push("Missing: `weight_g` at either the Product level or for ALL Variants.");
        }

        // --- Rim Specific Checks ---
        if (product.tags.includes('component:rim')) {
            const requiredRimMetafields = ['rim_washer_policy', 'rim_spoke_hole_offset', 'rim_target_tension_kgf'];
            requiredRimMetafields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`${key}\``); });
            if (['Optional', 'Mandatory'].includes(productMetafields.rim_washer_policy) && !productMetafields.nipple_washer_thickness) {
                productErrors.push("Missing Product Metafield: `nipple_washer_thickness` (required by washer policy).");
            }
            product.variants.edges.forEach(({ node: v }) => {
                const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value]));
                if (!vM.rim_erd) productErrors.push(`Variant "${v.title}" missing: \`rim_erd\``);
            });
        }

        // --- Hub Specific Checks ---
        if (product.tags.includes('component:hub')) {
            const requiredHubMetafields = ['hub_type', 'hub_flange_diameter_left', 'hub_flange_diameter_right', 'hub_flange_offset_left', 'hub_flange_offset_right', 'hub_spoke_hole_diameter'];
            requiredHubMetafields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`${key}\``); });
            const lacingPolicy = productMetafields.hub_lacing_policy || 'Standard';
            product.variants.edges.forEach(({ node: v }) => {
                const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value]));
                if (productMetafields.hub_type === 'Straight Pull') {
                    const spMetafields = ['hub_sp_offset_spoke_hole_left', 'hub_sp_offset_spoke_hole_right'];
                    spMetafields.forEach(key => { if (!vM[key]) productErrors.push(`Variant "${v.title}" missing: \`${key}\` (required for Straight Pull).`); });
                }
                if (lacingPolicy === 'Use Manual Override Field') {
                    if (!vM.hub_manual_cross_value) productErrors.push(`Variant "${v.title}" missing: \`hub_manual_cross_value\` (required by lacing policy).`);
                }
            });
        }

        // --- Spoke Specific Checks ---
        if (product.tags.includes('component:spoke')) {
            // --- MODIFICATION: Using corrected metafield name 'spoke_cross_section_area_mm2' ---
            if (!productMetafields.spoke_cross_section_area_mm2) {
                productErrors.push("Missing Product Metafield: `spoke_cross_section_area_mm2`");
            }
        }

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
    // SECURITY: We check for the Vercel cron secret, but allow direct manual runs for testing.
    const authHeader = req.headers.authorization;
    if (process.env.VERCEL_ENV === 'production' && authHeader !== `Bearer ${CRON_SECRET}`) {
       return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
        console.log("--- MAIN HANDLER STARTED ---");
        const results = await Promise.allSettled([sendAbandonedBuildReport(), runDataAudit()]);
        console.log("All daily tasks finished.", results);
        results.forEach((result, index) => { if (result.status === 'rejected') console.error(`Task ${index === 0 ? 'Report' : 'Audit'} failed:`, result.reason); });
        return res.status(200).json({ message: 'All daily tasks executed.', results });
    } catch (error) {
        console.error('A critical error occurred in the main task handler:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
