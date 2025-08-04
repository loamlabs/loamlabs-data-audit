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

    const allProductsQuery = `
    query {
      products(first: 250, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke' OR tag:'component:valvestem'") {
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
      }
    }`;

    try {
        const client = new shopify.clients.Graphql({ session: getSession() });
        const response = await client.query({ data: allProductsQuery });
        const products = response.body.data.products.edges.map(edge => edge.node);

        let errors = {
            unpublished: [],
            missingData: [],
        };

        for (const product of products) {
            // Level 1: Exclusion Check
            if (product.tags.includes('audit:exclude')) {
                continue; // Skip this product
            }

            // Level 2: Publishing Check
            const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
            if (!isPublished) {
                errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\` and Online Store URL is \`${product.onlineStoreUrl ? 'present' : 'missing'}\`.`);
                continue; // Don't check metafields for unpublished products
            }

            // Level 3: Metafield Data Check
            const productMetafields = Object.fromEntries(product.metafields.edges.map(edge => [edge.node.key, edge.node.value]));
            
            // --- Audit Logic for each component type ---
            // (A simplified version of the full audit logic goes here)
            // This is where you would place your detailed metafield checks
        }

        const totalIssues = errors.unpublished.length + errors.missingData.length;
        if (totalIssues > 0) {
            let emailHtml = `<h1>Weekly Data Health Report (${totalIssues} issues found)</h1>`;

            if (errors.unpublished.length > 0) {
                emailHtml += `<hr><h2>Unpublished or Draft Components (${errors.unpublished.length})</h2>
                              <p>The following components are tagged for the builder but are not Active and published to the Online Store.</p>
                              <ul>${errors.unpublished.map(e => `<li>${e}</li>`).join('')}</ul>`;
            }

            if (errors.missingData.length > 0) {
                 emailHtml += `<hr><h2>Components with Missing Data (${errors.missingData.length})</h2>
                               <p>The following components are published but are missing critical metafield data.</p>
                               <ul>${errors.missingData.map(e => `<li>${e}</li>`).join('')}</ul>`;
            }

            await resend.emails.send({
                from: 'LoamLabs Audit <alerts@loamlabsusa.com>',
                to: REPORT_EMAIL_TO,
                subject: `Data Health Report: ${totalIssues} Issues Found`,
                html: emailHtml,
            });
            console.log(`Report sent with ${totalIssues} issues.`);
        } else {
            console.log("Data health check complete. No issues found.");
        }

        res.status(200).send(`Audit complete. Found ${totalIssues} issues.`);
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
