const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

const handler = async (req, res) => {
  // 1. RELAXED CORS FOR TESTING
  // This allows us to test from myshopify.com or the primary domain
  const origin = req.headers.origin;
  if (origin && (origin.includes('loamlabsusa.com') || origin.includes('shopify.com'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method === 'POST') {
    console.log("--- ABANDONED BUILD ATTEMPT DETECTED ---");
    try {
      const rawBody = await readRawBody(req);
      console.log("Raw Body Received:", rawBody);

      if (!rawBody) {
        console.error("Empty body received");
        return res.status(400).json({ message: 'Empty body' });
      }

      const buildData = JSON.parse(rawBody);
      
      // Validation Check: Ensure it's a "Significant" build
      if (!buildData.buildId) {
        console.warn("Received data missing buildId. Potential junk data.");
      }

      const dataToStore = {
          ...buildData,
          capturedAt: new Date().toISOString(),
          debugOrigin: origin || 'unknown'
      };

      const pushResult = await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));
      console.log("Successfully pushed to Redis. List length:", pushResult);
      
      res.status(202).json({ message: 'Build data accepted.' });
    } catch (error) {
      console.error('CRITICAL ERROR in log-abandoned-build:', error.message);
      // Return 500 so the browser console actually shows an error during testing
      res.status(500).json({ message: error.message });
    }
    return;
  }
  
  res.status(405).json({ message: 'Method Not Allowed' });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;
