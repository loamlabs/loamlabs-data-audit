const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Helper function to manually read the request body
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

// This is the main handler function
const handler = async (req, res) => {
  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', 'https://loamlabsusa.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method === 'POST') {
    try {
      const rawBody = await readRawBody(req);
      const buildData = JSON.parse(rawBody);
      
      const dataToStore = {
          ...buildData,
          capturedAt: new Date().toISOString(),
      };

      await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));
      
      res.status(202).json({ message: 'Build data accepted.' });
    } catch (error) {
      console.error('Error in log-abandoned-build:', error);
      res.status(202).json({ message: 'Error processed.' });
    }
    return;
  }
  
  res.status(405).json({ message: 'Method Not Allowed' });
};

// THIS IS THE CRITICAL FIX.
// We attach the config object as a property of the handler function itself.
// This is the correct way to export both in a single CommonJS module for Vercel.
handler.config = {
  api: {
    bodyParser: false,
  },
};

module.exports = handler;
