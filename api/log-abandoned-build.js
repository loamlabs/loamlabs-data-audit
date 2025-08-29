import { Redis } from '@upstash/redis';

// This config object is the key. It tells Vercel to disable its automatic body parser.
export const config = {
  api: {
    bodyParser: false,
  },
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Helper function to manually read the request body
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
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
      // Manually read the raw body and parse it as JSON
      const rawBody = await readRawBody(req);
      const buildData = JSON.parse(rawBody.toString());
      
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
}
