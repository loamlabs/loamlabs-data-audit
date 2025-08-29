import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const buildData = req.body;
    const dataToStore = { ...buildData, capturedAt: new Date().toISOString() };
    await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));
    return res.status(202).json({ message: 'Build data accepted.' });
  } catch (error) {
    console.error('Error in log-abandoned-build:', error);
    return res.status(202).json({ message: 'Error processed.' });
  }
}
