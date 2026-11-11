const { Redis } = require('@upstash/redis');
const { buildRow, saveRow } = require('../lib/abandoned-log');

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

// createHandler takes its connections as arguments so tests can pass fakes; the exported handler below uses the real ones.
function createHandler({ redis, fetchFn = fetch, env = process.env }) {
  const handler = async (req, res) => {
    // RELAXED CORS: Allows standard domain and myshopify previews
    const origin = req.headers.origin || 'https://loamlabsusa.com';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method === 'POST') {
      try {
        const rawBody = await readRawBody(req);

        if (!rawBody) {
          return res.status(400).json({ message: 'Empty body' });
        }

        // We parse the JSON manually because we removed the Content-Type header
        const buildData = JSON.parse(rawBody);

        const dataToStore = {
            ...buildData,
            capturedAt: new Date().toISOString(),
            source: 'abandonment_tracker'
        };

        // Push to Redis (unchanged: the daily email still reads and empties this list)
        await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));

        console.log(`Successfully recorded abandoned build: ${buildData.buildId}`);

        // Also keep a permanent copy in Supabase. Best effort: a problem here is logged and never changes the answer.
        try {
          const row = buildRow(dataToStore, req.headers, { salt: env.ABANDONED_HASH_SALT || '' });
          const saved = await saveRow({ row, url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchFn });
          if (!saved.ok) console.warn('Abandoned build history not saved:', saved.reason);
        } catch (e) {
          console.warn('Abandoned build history error:', e.message);
        }

        res.status(202).json({ message: 'Accepted' });
      } catch (error) {
        console.error('Error recording build:', error.message);
        res.status(202).json({ message: 'Error handled' });
      }
      return;
    }

    res.status(405).json({ message: 'Method Not Allowed' });
  };
  handler.config = { api: { bodyParser: false } };
  return handler;
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const handler = createHandler({ redis });
module.exports = handler;
module.exports.createHandler = createHandler;
