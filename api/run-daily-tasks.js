// LoamLabs Master Task Runner - v5.2 (Fixed Syntax)
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

// --- TASK 1: Abandoned Build Report ---
const renderWheelComponents = (wheelComponents) => {
  if (!wheelComponents || wheelComponents.length === 0) return '';
  return wheelComponents.map(component => `<tr><td class="component-label">${component.type}</td><td class="component-name">${component.name}</td></tr>`).join('');
};

async function sendAbandonedBuildReport() {
    console.log("Task: Abandoned Build Report...");
    const builds = await redis.lrange('abandoned_builds', 0, -1);
    if (builds.length === 0) return { status: 'success', message: 'No builds.' };
    
    const buildsHtml = builds.map((build, index) => {
        let visitorHtml = '';
        if (build.visitor) {
            if (build.visitor.isLoggedIn) {
                const customerUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId}`;
                visitorHtml = `<tr><td>User</td><td><strong><a href="${customerUrl}">${build.visitor.email}</a></strong></td></tr>`;
            } else {
                visitorHtml = `<tr><td>User</td><td>Anonymous: ${build.visitor.anonymousId}</td></tr>`;
            }
        }
        return `<div class="build-section"><h3>Build #${index + 1}</h3><table class="data-table">${visitorHtml}<tr><td>Type</td><td>${build.buildType}</td></tr></table></div>`;
    }).join('');

    const emailHtml = `<html><body>${buildsHtml}</body></html>`;
    await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: [REPORT_EMAIL_TO], subject: `Abandoned Build Report`, html: emailHtml });
    await redis.del('abandoned_builds');
    return { status: 'success' };
}

// --- TASK 2: Data Audit ---
async function runDataAudit() {
    console.log("Task: Data Audit...");
    const client = new shopify.clients.Graphql({ session: getSession() });
    const QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub'") { edges { node { id title status tags onlineStoreUrl variants(first: 50) { edges { node { id title metafields(first: 5, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
    
    let allProducts = [], hasNextPage = true, cursor = null;
    while (hasNextPage) {
        const response = await client.query({ data: { query: QUERY, variables: { cursor } } });
        const pageData = response.body.data.products;
        allProducts.push(...pageData.edges.map(e => e.node));
        hasNextPage = pageData.pageInfo.hasNextPage;
        cursor = pageData.pageInfo.endCursor;
    }

    let issues = [];
    for (const p of allProducts) {
        if (p.status !== 'ACTIVE') continue;
        const meta = Object.fromEntries(p.metafields.edges.map(e => [e.node.key, e.node.value]));
        if (p.tags.includes('component:rim') && !meta.rim_washer_policy) issues.push(`- ${p.title}: Missing Rim Policy`);
        if (p.tags.includes('component:hub') && !meta.hub_type) issues.push(`- ${p.title}: Missing Hub Type`);
    }

    if (issues.length > 0) {
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: 'Data Audit Alert', html: `<ul>${issues.join('')}</ul>` });
    }
    return { status: 'success' };
}

// --- TASK 3: Oversell Audit ---
async function runOversellAudit() {
    console.log("Task: Oversell Audit...");
    const client = new shopify.clients.Graphql({ session: getSession() });
    const response = await client.query({ data: { query: `query { productVariants(first: 100, query: "inventory_total:<0") { edges { node { id title inventoryQuantity product { id title } } } } }` } });
    const variants = response.body.data.productVariants.edges;
    if (variants.length > 0) {
        console.log("Negative inventory found.");
    }
    return { status: 'success' };
}

// --- TASK 4: Vendor Watcher ---
async function triggerVendorWatcher() {
    console.log("Task: Vendor Watcher...");
    try {
        await fetch('https://loamlabs-ops-dashboard.vercel.app/api/sync', { method: 'GET', headers: { 'x-loam-secret': CRON_SECRET } });
        return { status: 'success' };
    } catch (e) { return { status: 'error' }; }
}

// --- TASK 5: Library SEO Metafield Sync (RE-CODED FOR SYNTAX SAFETY) ---
async function updateLibrarySEO() {
    console.log("Task: SEO Metafield Sync...");
    try {
        const response = await fetch('https://loamlabs-component-api.vercel.app/api/get-components');
        const data = await response.json();

        let html = '<div class="ll-seo-static-library">';
        const clean = (val) => (val === null || val === undefined || val === "" || val === "-" || val === "null") ? null : val;
        
        // Rims
        html += '<h2>Professional Bicycle Rim Specifications & ERD Database</h2>';
        const rimsByTitle = data.rims.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in rimsByTitle) {
            const variants = rimsByTitle[title];
            html += '<h3>' + variants[0].Vendor + ' ' + title + '</h3>';
            html += '<table border="1"><tr><th>Size</th><th>ERD</th><th>Weight</th></tr>';
            
            const sizes = variants.reduce((acc, v) => {
                if (!acc[v['Option1 Value']]) {
                    const w = clean(v['Variant Metafield: custom.weight_g [number_decimal]']) || clean(v['Metafield: custom.weight_g [number_decimal]']);
                    acc[v['Option1 Value']] = { 
                        erd: clean(v['Variant Metafield: custom.rim_erd [number_decimal]']) || 'N/A', 
                        weight: w ? w + 'g' : 'N/A' 
                    };
                }
                return acc;
            }, {});

            for (const s in sizes) {
                html += '<tr><td>' + s + '</td><td>' + sizes[s].erd + '</td><td>' + sizes[s].weight + '</td></tr>';
            }
            html += '</table>';
        }

        // Hubs
        html += '<h2>Bicycle Hub Technical Dimensions</h2>';
        const hubsByTitle = data.hubs.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in hubsByTitle) {
            const rep = hubsByTitle[title][0];
            html += '<h3>' + rep.Vendor + ' ' + title + '</h3><ul>';
            html += '<li>Type: ' + (clean(rep['Metafield: custom.hub_type [single_line_text_field]']) || 'Standard') + '</li>';
            html += '<li>Flange: ' + (clean(rep['Metafield: custom.hub_flange_diameter_left [number_decimal]']) || 'N/A') + '</li></ul>';
        }

        html += '</div>';

        const client = new shopify.clients.Graphql({ session: getSession() });
        const pageId = "gid://shopify/Page/105432123456";
        const mutation = `mutation metafieldUpsert($metafields: [MetafieldUpsertInput!]!) { metafieldsUpsert(metafields: $metafields) { metafields { id } userErrors { field message } } }`;
        const vars = { metafields: [{ ownerId: pageId, namespace: "custom", key: "seo_library_content", value: html, type: "multi_line_text_field" }] };
        
        await client.query({ data: { query: mutation, variables: vars } });
        console.log("SEO Metafield Updated.");
        return { status: 'success' };
    } catch (err) {
        console.error("SEO Task Failed:", err.message);
        return { status: 'error' };
    }
}

// --- MAIN HANDLER ---
module.exports = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (process.env.VERCEL_ENV === 'production' && authHeader !== `Bearer ${CRON_SECRET}`) {
       return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
        console.log("--- STARTING DAILY TASKS ---");
        const results = await Promise.allSettled([
            sendAbandonedBuildReport(), 
            runDataAudit(),
            runOversellAudit(),
            triggerVendorWatcher(),
            updateLibrarySEO()
        ]);
        return res.status(200).json({ message: 'Executed', results });
    } catch (error) {
        return res.status(500).json({ message: 'Error', error: error.message });
    }
};
