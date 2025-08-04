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
    let log = ["Audit started..."];

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
            variants(first: 50) {
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

        // --- PAGINATION LOOP ---
        // This loop will continue fetching pages until Shopify says there are no more.
        do {
            const response = await client.query({ 
                data: { 
                    query: PAGINATED_PRODUCTS_QUERY,
                    variables: { cursor: cursor }
                }
            });

            const pageData = response.body.data.products;
            allProducts.push(...pageData.edges.map(edge => edge.node)); // Add the new products to our master list

            hasNextPage = pageData.pageInfo.hasNextPage;
            cursor = pageData.pageInfo.endCursor;
            
            log.push(`Fetched a page of products. Products so far: ${allProducts.length}. More pages to fetch: ${hasNextPage}`);

        } while (hasNextPage);
        // --- END PAGINATION LOOP ---
        
        log.push(`\nFinished fetching all pages. Found ${allProducts.length} total component products to audit.`);

        let errors = {
            unpublished: [],
            missingData: [],
        };

        for (const product of allProducts) {
            log.push(`--- Auditing Product: ${product.title} ---`);

            // Level 1: Exclusion Check
            if (product.tags.includes('audit:exclude')) {
                log.push(" -> Has 'audit:exclude' tag. Skipping.");
                continue;
            }

            // Level 2: Publishing Check
            const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
            log.push(` -> Checking publishing status... [Status: ${product.status}, Published: ${!!product.onlineStoreUrl}] -> ${isPublished ? 'OK' : 'FAIL'}`);
            if (!isPublished) {
                errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\` and is \`${product.onlineStoreUrl ? 'published' : 'NOT published'}\` to the Online Store.`);
                continue; 
            }

            // Level 3: Metafield Data Check (Placeholder - to be built out)
            log.push(" -> Checking metafields...");
        }

        console.log(log.join('\n')); // Print the detailed log to Vercel

        const totalIssues = errors.unpublished.length + errors.missingData.length;
        if (totalIssues > 0) {
            // ... (email sending logic will go here) ...
            console.log(`Report would be sent with ${totalIssues} issues.`);
        } else {
            console.log("Data health check complete. No issues found.");
        }

        res.status(200).send(`Audit complete. Found ${totalIssues} issues after scanning ${allProducts.length} products.`);
    } catch (error) {
        console.error("An error occurred during the audit:", error);
        res.status(500).send("An internal error occurred.");
    }
};

// Helper function to create a Shopify session
function getSession() {
    return {
        id: 'data-audit-session',
        shop: SHOPIFY_STORE_DOMAIN,
        accessToken: SHOPIFY_ADMIN_API_TOKEN,
        state: 'not-used',
        isOnline: false,
    };
}
