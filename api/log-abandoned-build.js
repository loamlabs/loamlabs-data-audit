// This file receives and stores the abandoned build data (Node.js Version)
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  // --- CORS Headers (Node.js style) ---
  // This tells the browser that requests from your Shopify store are allowed.
  res.setHeader('Access-Control-Allow-Origin', 'https://loamlabsusa.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // --- CORS Preflight Handling (Node.js style) ---
  // This handles the browser's OPTIONS security check.
  if (req.method === 'OPTIONS') {
    res.status(204).send(''); // 204 No Content
    return;
  }

  // --- POST Handling (Node.js style) ---
  if (req.method === 'POST') {
    try {
      // Vercel's Node.js runtime automatically parses the body for us
      const buildData = req.body;
      
      const dataToStore = {
          ...buildData,
          capturedAt: new Date().toISOString(),
      };

      await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));

      // Respond with 202 Accepted.
      res.status(202).json({ message: 'Build data accepted.' });

    } catch (error) {
      console.error('Error in log-abandoned-build:', error);
      // Always send success to the browser
      res.status(202).json({ message: 'Error processed.' });
    }
    return;
  }
  
  // If not OPTIONS or POST, deny it.
  res.status(405).json({ message: 'Method Not Allowed' });
}
