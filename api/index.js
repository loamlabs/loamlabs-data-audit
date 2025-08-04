// Import the necessary tools (libraries)
const shopifyApi = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { Resend } = require('resend');

// --- CONFIGURATION ---
const {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_ADMIN_API_TOKEN,
  RESEND_API_KEY,
  REPORT_EMAIL_TO,
} = process.env;

// Initialize clients
const shopify = shopifyApi.shopifyApi({
  apiSecretKey: 'not-used-for-admin-token',
  adminApiAccessToken: SHOPIFY_ADMIN_API_TOKEN,
  isCustomStoreApp: true,
  hostName: SHOPIFY_STORE_DOMAIN.replace('https://', ''),
  apiVersion: shopifyApi.LATEST_API_VERSION,
});
const resend = new Resend(RESEND_API_KEY);

// --- The main audit function ---
module.exports = async (req, res) => {
    console.log("Data audit function triggered...");
    
    // (The PAGINATED_PRODUCTS_QUERY remains the same)
    const PAGINATED_PRODUCTS_QUERY = `...`; // Same as previous version

    try {
        const client = new shopify.clients.Graphql({ session: getSession() });
        let allProducts = [];
        // ... (Pagination loop remains the same) ...

        let errors = {
            unpublished: [],
            missingData: [],
        };

        for (const product of allProducts) {
            // ... (Exclusion and Publishing checks remain the same) ...

            // --- LEVEL 3: DETAILED METAFIELD DATA CHECK ---
            const productMetafields = Object.fromEntries(product.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
            const productErrors = [];

            // --- RIM CHECKS ---
            if (product.tags.includes('component:rim')) {
                const requiredProductFields = ['rim_spoke_hole_offset', 'rim_nipple_washer_thickness_mm', 'rim_washer_policy', 'rim_target_tension_kgf'];
                requiredProductFields.forEach(key => {
                    if (!productMetafields[key]) {
                        productErrors.push(`Missing Product Metafield: \`custom.${key}\``);
                    }
                });
                product.variants.edges.forEach(variantEdge => {
                    const variant = variantEdge.node;
                    const variantMetafields = Object.fromEntries(variant.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
                    if (!variantMetafields.rim_erd) {
                        productErrors.push(`Variant "${variant.title}" is missing Metafield: \`custom.rim_erd\``);
                    }
                });
            }

            // --- HUB CHECKS ---
            if (product.tags.includes('component:hub')) {
                const hubType = productMetafields.hub_type;
                const requiredProductFields = ['hub_type', 'hub_flange_diameter_left', 'hub_flange_diameter_right', 'hub_flange_offset_left', 'hub_flange_offset_right'];
                requiredProductFields.forEach(key => {
                    if (!productMetafields[key]) {
                        productErrors.push(`Missing Product Metafield: \`custom.${key}\``);
                    }
                });

                if (hubType === 'Classic Flange' && !productMetafields.hub_spoke_hole_diameter) {
                    productErrors.push(`Missing Product Metafield for 'Classic Flange' hub: \`custom.hub_spoke_hole_diameter\``);
                }
                if (hubType === 'Straight Pull') {
                    product.variants.edges.forEach(variantEdge => {
                        const variant = variantEdge.node;
                        const variantMetafields = Object.fromEntries(variant.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
                        if (!variantMetafields.hub_sp_offset_spoke_hole_left || !variantMetafields.hub_sp_offset_spoke_hole_right) {
                            productErrors.push(`Variant "${variant.title}" is missing 'Straight Pull' Metafields: \`custom.hub_sp_offset_spoke_hole_left/right\``);
                        }
                    });
                }
            }
            
            // (Add similar detailed checks for Spokes and Valve Stems here...)

            if (productErrors.length > 0) {
                errors.missingData.push(`- **${product.title}**:<br><ul>${productErrors.map(e => `<li>${e}</li>`).join('')}</ul>`);
            }
        }
        
        // ... (Email sending logic remains the same) ...

        res.status(200).send(`Audit complete. Found ${errors.unpublished.length + errors.missingData.length} issues after scanning ${allProducts.length} products.`);
    } catch (error) {
        console.error("An error occurred during the audit:", error);
        res.status(500).send("An internal error occurred.");
    }
};

// (getSession helper function remains the same)
