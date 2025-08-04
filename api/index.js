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
    
    const PAGINATED_PRODUCTS_QUERY = `
    query($cursor: String) {
      products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke' OR tag:'component:valvestem'") {
        edges {
          node {
            id
            title
            status
            tags
            onlineStoreUrl
            productType
            vendor
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  metafields(first: 10, namespace: "custom") {
                    edges { node { key value } }
                  }
                }
              }
            }
            metafields(first: 20, namespace: "custom") {
              edges { node { key value } }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;

    try {
        const client = new shopify.clients.Graphql({ session: getSession() });
        let allProducts = [];
        let hasNextPage = true;
        let cursor = null;

        do {
            const response = await client.query({ 
                data: { 
                    query: PAGINATED_PRODUCTS_QUERY,
                    variables: { cursor: cursor }
                }
            });
            const pageData = response.body.data.products;
            allProducts.push(...pageData.edges.map(edge => edge.node));
            hasNextPage = pageData.pageInfo.hasNextPage;
            cursor = pageData.pageInfo.endCursor;
        } while (hasNextPage);
        
        console.log(`Finished fetching all pages. Found ${allProducts.length} total component products to audit.`);

        let errors = {
            unpublished: [],
            missingData: [],
        };

        for (const product of allProducts) {
            if (product.tags.includes('audit:exclude')) continue;

            const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
            if (!isPublished) {
                errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\` and is \`${product.onlineStoreUrl ? 'published' : 'NOT published'}\` to the Online Store.`);
                continue; 
            }

            const productMetafields = Object.fromEntries(product.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
            const productErrors = [];

            // --- RIM CHECKS (WITH NEW LOGIC) ---
            if (product.tags.includes('component:rim')) {
                // Corrected metafield name and added conditional check
                const washerPolicy = productMetafields.rim_washer_policy;
                if (!washerPolicy) {
                    productErrors.push(`Missing Product Metafield: \`custom.rim_washer_policy\``);
                } else if (washerPolicy === 'Optional' || washerPolicy === 'Mandatory') {
                    if (!productMetafields.nipple_washer_thickness) { // Corrected name
                        productErrors.push(`Missing Product Metafield for washer policy "${washerPolicy}": \`custom.nipple_washer_thickness\``);
                    }
                }
                ['rim_spoke_hole_offset', 'rim_target_tension_kgf'].forEach(key => {
                    if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`custom.${key}\``);
                });
                product.variants.edges.forEach(({ node: variant }) => {
                    const variantMetafields = Object.fromEntries(variant.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
                    if (!variantMetafields.rim_erd) productErrors.push(`Variant "${variant.title}" is missing Metafield: \`custom.rim_erd\``);
                });
            }

            // --- HUB CHECKS ---
            if (product.tags.includes('component:hub')) {
                // (Hub logic remains the same)
            }

            // --- SPOKE CHECKS ---
            if (product.tags.includes('component:spoke')) {
                // (Spoke logic remains the same)
            }

            // --- VALVE STEM CHECKS ---
            if (product.tags.includes('component:valvestem')) {
                // (Valve stem logic remains the same)
            }

            if (productErrors.length > 0) {
                errors.missingData.push(`- **${product.title}**:<br><ul>${productErrors.map(e => `<li>${e}</li>`).join('')}</ul>`);
            }
        }
        
        const totalIssues = errors.unpublished.length + errors.missingData.length;
        if (totalIssues > 0) {
            // (Email sending logic remains the same)
        } else {
            console.log("Data health check complete. No issues found.");
        }

        res.status(200).send(`Audit complete. Found ${totalIssues} issues after scanning ${allProducts.length} products.`);
    } catch (error) {
        console.error("An error occurred during the audit:", error);
        res.status(500).send("An internal error occurred.");
    }
};

// (getSession helper function remains the same)
function getSession() {
    return {
        id: 'data-audit-session',
        shop: SHOPIFY_STORE_DOMAIN,
        accessToken: SHOPIFY_ADMIN_API_TOKEN,
        state: 'not-used',
        isOnline: false,
    };
}
