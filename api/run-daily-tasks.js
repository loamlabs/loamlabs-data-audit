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
    const PAGINATED_PRODUCTS_QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke' OR tag:'component:nipple'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 50, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 50, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
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
        // --- 1. THE UNIVERSAL WEIGHT RULE ---
        const hasProductWeight = !!productMetafields['weight_g'];

        product.variants.edges.forEach(({ node: v }) => {
            const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value]));
            const fullTitleText = `${product.title} ${v.title}`.toLowerCase();
            
            if (!hasProductWeight && !vM['weight_g']) {
                productErrors.push(`Variant "${v.title}" missing: \`weight_g\` (No fallback found on Product level)`);
            }

            // --- 2. COMPONENT: RIM (VARIANT CHECKS) ---
            if (product.tags.includes('component:rim')) {
                if (!vM['wheel_spec_position']) productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_position\``);
                if (!vM['wheel_spec_internal_width_mm']) productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_internal_width_mm\``);
                
                // Rim Brake Rule
                if (fullTitleText.includes('rim brake')) {
                    if (!vM['wheel_spec_brake_interface']) productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_brake_interface\` (Required because "Rim Brake" is in title)`);
                }
            }

            // --- 3. COMPONENT: HUB (VARIANT CHECKS) ---
            if (product.tags.includes('component:hub')) {
                if (!vM['wheel_spec_brake_interface']) productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_brake_interface\``);
                if (!vM['wheel_spec_hub_spacing']) productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_hub_spacing\``);

                // Position & Title Match Rule
                const pos = vM['wheel_spec_position'];
                if (!pos) {
                    productErrors.push(`Variant "${v.title}" missing: \`wheel_spec_position\``);
                } else {
                    if (pos.toLowerCase().includes('front') && !fullTitleText.includes('front')) {
                        productErrors.push(`Variant "${v.title}" mismatch: Position is "Front", but 'Front' is missing from the title.`);
                    }
                    if (pos.toLowerCase().includes('rear') && !fullTitleText.includes('rear')) {
                        productErrors.push(`Variant "${v.title}" mismatch: Position is "Rear", but 'Rear' is missing from the title.`);
                    }
                }

                // Lacing Override Rule
                const lacingPolicy = vM['hub_lacing_policy'] || productMetafields['hub_lacing_policy'];
                if (lacingPolicy && lacingPolicy.includes('Use Manual Override Field')) {
                    if (!vM['hub_manual_cross_value'] && !productMetafields['hub_manual_cross_value']) {
                        productErrors.push(`Variant "${v.title}" missing: \`hub_manual_cross_value\` (Required by Lacing Policy)`);
                    }
                }

                // Straight Pull Offset Rule
                if (productMetafields['hub_type'] === 'Straight Pull') {
                    if (!vM['hub_sp_offset_spoke_hole_left']) productErrors.push(`Variant "${v.title}" missing: \`hub_sp_offset_spoke_hole_left\``);
                    if (!vM['hub_sp_offset_spoke_hole_right']) productErrors.push(`Variant "${v.title}" missing: \`hub_sp_offset_spoke_hole_right\``);
                }
            }
        });

        // --- 4. COMPONENT: RIM (PRODUCT CHECKS) ---
        if (product.tags.includes('component:rim')) {
            const reqRimProductFields = ['rim_depth_mm', 'rim_washer_policy', 'rim_spoke_hole_offset', 'nipple_washer_thickness', 'rim_target_tension_kgf'];
            reqRimProductFields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Field: \`${key}\``); });
        }

        // --- 5. COMPONENT: HUB (PRODUCT CHECKS) ---
        if (product.tags.includes('component:hub')) {
            const reqHubProductFields = ['hub_type', 'hub_spoke_hole_diameter', 'hub_flange_offset_right', 'hub_flange_offset_left', 'hub_flange_diameter_right', 'hub_flange_diameter_left'];
            reqHubProductFields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Field: \`${key}\``); });

            // Freehub Rule (Rear Hubs Only)
            const isRearHub = product.title.toLowerCase().includes('rear') || product.tags.includes('position:rear');
            if (isRearHub) {
                if (!productMetafields['freehub']) productErrors.push(`Missing Product Field: \`freehub\` (Required for Rear Hubs)`);
                if (!productMetafields['freehub_variant_map']) productErrors.push(`Missing Product Field: \`freehub_variant_map\` (Required for Rear Hubs)`);
            }

            // Lacing Policy Rule (Straight Pull or Hook Flange)
            const hubType = productMetafields['hub_type'];
            if (hubType === 'Straight Pull' || hubType === 'Hook Flange') {
                if (!productMetafields['hub_lacing_policy']) {
                    // Check if it exists on variants before failing
                    let foundOnVariant = false;
                    product.variants.edges.forEach(({ node: v }) => {
                        const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value]));
                        if (vM['hub_lacing_policy']) foundOnVariant = true;
                    });
                    if (!foundOnVariant) productErrors.push(`Missing Field: \`hub_lacing_policy\` (Required for ${hubType} hubs)`);
                }
            }
        }

        // --- 6. COMPONENT: SPOKE (PRODUCT CHECKS) ---
        if (product.tags.includes('component:spoke')) {
            const reqSpokeProductFields = ['spoke_hub_interface', 'spoke_diameter_spec', 'spoke_model_group', 'spoke_type', 'spoke_cross_section_area_mm2', 'inventory_monitoring_enabled', 'inventory_alert_threshold'];
            reqSpokeProductFields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Field: \`${key}\``); });
        }

        // --- 7. COMPONENT: NIPPLE (PRODUCT CHECKS) ---
        if (product.tags.includes('component:nipple')) {
            if (!productMetafields['rim_compatible_nipple_types']) productErrors.push(`Missing Product Field: \`rim_compatible_nipple_types\``);
        }

        // --- ERROR COMPILATION ---
        if (productErrors.length > 0) errors.missingData.push(`- **${product.title}**:<br><ul>${productErrors.map(e => `<li>${e}</li>`).join('')}</ul>`);
    }
    const totalIssues = errors.unpublished.length + errors.missingData.length;
    if (totalIssues > 0) {
        let emailHtml = `<h1>Data Health Report (${totalIssues} issues)</h1>`;
        if (errors.unpublished.length > 0) emailHtml += `<hr><h2>Unpublished (${errors.unpublished.length})</h2><ul>${errors.unpublished.map(e => `<li>${e}</li>`).join('')}</ul>`;
        if (errors.missingData.length > 0) emailHtml += `<hr><h2>Missing Data (${errors.missingData.length})</h2><ul>${errors.missingData.map(e => `<li>${e}</li>`).join('')}</ul>`;
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: `Data Health Report: ${totalIssues} Issues Found`, html: emailHtml });
    }
    return { status: 'success', message: `Audit complete. Found ${totalIssues} issues.` };
}

// --- Task 3: Negative Inventory (Oversell) Audit ---
async function runOversellAudit() {
    console.log("Running Task: Negative Inventory Audit...");
    const OVERSELL_QUERY = `query { productVariants(first: 250, query: "inventory_total:<0") { edges { node { id title sku inventoryQuantity product { id title } } } } }`;
    const client = new shopify.clients.Graphql({ session: getSession() });
    const response = await client.query({ data: { query: OVERSELL_QUERY } });
    const variants = response.body.data.productVariants.edges.map(edge => edge.node);
    if (variants.length === 0) return { status: 'success', message: 'No negative inventory found.' };
    let newIssues = [], snoozedIssues = [];
    for (const variant of variants) {
        if (variant.inventoryQuantity >= 0) continue;
        const redisKey = `oversell_reported:${variant.id}`; 
        const alreadyReported = await redis.get(redisKey);
        const itemData = { title: `${variant.product.title} - ${variant.title}`, sku: variant.sku || 'No SKU', qty: variant.inventoryQuantity, adminUrl: `https://${SHOPIFY_STORE_DOMAIN}/admin/products/${variant.product.id.split('/').pop()}/variants/${variant.id.split('/').pop()}` };
        if (!alreadyReported) {
            newIssues.push(itemData);
            await redis.set(redisKey, 'true', { ex: 604800 });
        } else snoozedIssues.push(itemData);
    }
    if (newIssues.length > 0) {
        const renderTable = (items, color, isNew) => items.map(item => `<tr><td style="padding:10px; border:1px solid #ddd; color: ${isNew ? '#333' : '#777'};"><strong>${item.title}</strong><br><small>SKU: ${item.sku}</small></td><td style="padding:10px; border:1px solid #ddd; text-align:center; color:${color};"><strong>${item.qty}</strong></td><td style="padding:10px; border:1px solid #ddd; text-align:center;"><a href="${item.adminUrl}" style="background:${isNew ? '#000' : '#888'}; color:#fff; padding:5px 10px; text-decoration:none; border-radius:4px; font-size:11px;">View</a></td></tr>`).join('');
        const emailHtml = `<div style="font-family:sans-serif; max-width:600px; color:#333; line-height: 1.5;"><h2 style="color:#d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">⚠️ New Negative Inventory Alert</h2><p>The following <strong>new</strong> items have fallen into negative stock:</p><table style="width:100%; border-collapse:collapse;"><tr style="background:#f4f4f4;"><th style="padding:10px; border:1px solid #ddd; text-align:left;">Product</th><th style="padding:10px; border:1px solid #ddd;">Qty</th><th style="padding:10px; border:1px solid #ddd;">Action</th></tr>${renderTable(newIssues, 'red', true)}</table>${snoozedIssues.length > 0 ? `<h3 style="color:#666;">Snoozed Issues</h3><table style="width:100%; border-collapse:collapse;">${renderTable(snoozedIssues, '#999', false)}</table>` : ''}</div>`;
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: `Oversell Alert: ${newIssues.length} New Item(s)`, html: emailHtml });
    }
    return { status: 'success', message: 'Oversell Audit Complete.' };
}

// --- NEW Task 4: Remote Vendor Watcher Trigger (RECONFIGURED FOR OPS DASHBOARD) ---
async function triggerVendorWatcher() {
    console.log("Running Task: Triggering Remote Vendor Watcher...");
    try {
        const response = await fetch('https://loamlabs-ops-dashboard.vercel.app/api/sync', {
            method: 'GET',
            headers: { 'x-loam-secret': CRON_SECRET } 
        });
        const data = await response.json();
        console.log("Vendor Watcher Response:", data);
        return { status: 'success', message: 'Vendor Watcher triggered successfully.' };
    } catch (err) {
        console.error("Vendor Watcher Trigger Failed:", err.message);
        return { status: 'error', message: `Trigger failed: ${err.message}` };
    }
}

// --- NEW Task 5: Library SEO Metafield Sync (SEO PROJECT) ---
async function updateLibrarySEO() {
    console.log("Running Task: Update Library SEO Metafield...");
    try {
        const response = await fetch('https://loamlabs-component-api.vercel.app/api/get-components', {
            headers: { 'Referer': 'https://loamlabsusa.com/' }
        });
        
        const data = await response.json();
        if (!data || !data.rims) throw new Error("Invalid API Data");

        let html = `<div class="ll-seo-static-library">`;
        const clean = (val) => (val === null || val === undefined || val === "" || val === "-" || val === "null") ? null : val;

        // --- RIMS (Prioritized for SEO) ---
        html += `<h2>Rim ERD & Weight Database</h2>`;
        const rimsByTitle = data.rims.reduce((acc, item) => {
            if (item?.Title) {
                if (!acc[item.Title]) acc[item.Title] = [];
                acc[item.Title].push(item);
            }
            return acc;
        }, {});

        for (const title in rimsByTitle) {
            // CHARACTER LIMIT SAFETY GATE
            if (html.length > 60000) break; 

            const variants = rimsByTitle[title];
            const vendor = variants[0].Vendor || '';
            let specLines = variants.map(v => {
                const erd = clean(v['Variant Metafield: custom.rim_erd [number_decimal]']);
                const weight = clean(v['Variant Metafield: custom.weight_g [number_decimal]']) || clean(v['Metafield: custom.weight_g [number_decimal]']);
                return `${v['Option1 Value']}:ERD ${erd || 'N/A'}${weight ? ',' + weight + 'g' : ''}`;
            });
            html += `<p><strong>${vendor} ${title}</strong>:${[...new Set(specLines)].join('|')}</p>`;
        }

        // --- HUBS (Only if space remains) ---
        if (html.length < 55000) {
            html += `<h2>Hub Technical Specifications</h2>`;
            const hubsByTitle = data.hubs.reduce((acc, item) => {
                if (item?.Title) {
                    if (!acc[item.Title]) acc[item.Title] = [];
                    acc[item.Title].push(item);
                }
                return acc;
            }, {});

            for (const title in hubsByTitle) {
                if (html.length > 64000) break; 
                const rep = hubsByTitle[title][0];
                const fdl = clean(rep['Metafield: custom.hub_flange_diameter_left [number_decimal]']);
                const fdr = clean(rep['Metafield: custom.hub_flange_diameter_right [number_decimal]']);
                const cL = clean(rep['Variant Metafield: custom.hub_lacing_cross_left [number_decimal]']);
                const cR = clean(rep['Variant Metafield: custom.hub_lacing_cross_right [number_decimal]']);
                const sL = clean(rep['Variant Metafield: custom.hub_spoke_count_left [number_decimal]']);
                const sR = clean(rep['Variant Metafield: custom.hub_spoke_count_right [number_decimal]']);

                let engineeringSpecs = '';
                if (cL !== null || cR !== null) {
                    engineeringSpecs += ` Cross Pattern: ${cL ?? 'N/A'}/${cR ?? 'N/A'}.`;
                }
                if (sL !== null || sR !== null) {
                    engineeringSpecs += ` Spoke Distribution: ${sL ?? 'N/A'}/${sR ?? 'N/A'}.`;
                }
                html += `<p><strong>${rep.Vendor || ''} ${title}</strong>:Flange ${fdl || 'N/A'}/${fdr || 'N/A'}</p>`;
            }
        }

        html += `</div>`;
        console.log("Final SEO HTML Length:", html.length);

        const client = new shopify.clients.Graphql({ session: getSession() });
        const pageId = "gid://shopify/Page/152231215411"; // CORRECTED ID

        const mutation = `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
                metafields { id }
                userErrors { field message }
            }
        }`;

        const vars = {
            metafields: [{
                ownerId: pageId,
                namespace: "custom",
                key: "seo_library_content",
                value: html,
                type: "multi_line_text_field"
            }]
        };
        
        const res = await client.query({ data: { query: mutation, variables: vars } });
        
        if (res.body.data.metafieldsSet.userErrors.length > 0) {
            console.error("Shopify Metafield Error:", res.body.data.metafieldsSet.userErrors);
            return { status: 'error' };
        }

        console.log("Library SEO Metafield Updated Successfully.");
        return { status: 'success' };
    } catch (err) {
        console.error("Library SEO Task Failed:", err.message);
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
        console.log("--- MAIN HANDLER STARTED ---");
        const results = await Promise.allSettled([
            sendAbandonedBuildReport(), 
            runDataAudit(),
            runOversellAudit(),
            triggerVendorWatcher(),
            updateLibrarySEO() // Added SEO Task here
        ]);
        
        console.log("All daily tasks finished.", results);
        
        results.forEach((result, index) => { 
            const taskNames = ['Abandoned Report', 'Data Audit', 'Oversell Audit', 'Vendor Watcher Trigger', 'Library SEO'];
            if (result.status === 'rejected') {
                console.error(`Task "${taskNames[index]}" failed:`, result.reason); 
            }
        });

        return res.status(200).json({ message: 'All daily tasks executed.', results });
    } catch (error) {
        console.error('A critical error occurred:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
