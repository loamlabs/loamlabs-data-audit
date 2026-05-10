const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  const origin = req.headers.origin || 'https://loamlabsusa.com';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    try {
      const { id } = req.query;
      
      if (!id) {
        return res.status(400).json({ error: 'No share ID provided' });
      }

      // Retrieve the data from Redis
      const buildData = await redis.get(`shared_build:${id}`);
      
      if (!buildData) {
        return res.status(404).json({ error: 'Build not found or link has expired (60 day limit).' });
      }

      // Upstash automatically parses JSON if it detects it, so we can just return it
      return res.status(200).json(buildData);

    } catch (error) {
      console.error('Error retrieving shared build:', error.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  
  return res.status(405).json({ error: 'Method Not Allowed' });
};
