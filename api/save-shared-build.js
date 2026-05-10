const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  // Relaxed CORS for Shopify
  const origin = req.headers.origin || 'https://loamlabsusa.com';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'POST') {
    try {
      const buildState = req.body;
      if (!buildState || Object.keys(buildState).length === 0) {
        return res.status(400).json({ error: 'No build data provided' });
      }

      // Generate a short, random 6-character ID (Uppercase & Numbers, excluding confusing letters like O/0, I/1)
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let shareId = '';
      for (let i = 0; i < 6; i++) {
        shareId += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      // Save to Redis with a 60-day expiration (60 days * 24h * 60m * 60s = 5184000 seconds)
      await redis.set(`shared_build:${shareId}`, JSON.stringify(buildState), { ex: 5184000 });

      // Return the short ID to the frontend
      return res.status(200).json({ shareId });

    } catch (error) {
      console.error('Error saving shared build:', error.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  
  return res.status(405).json({ error: 'Method Not Allowed' });
};
