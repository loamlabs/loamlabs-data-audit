const { Redis } = require('@upstash/redis');
const { buildRow, saveRow, classifyTest, readOrigin, DEFAULT_LIVE_HOSTS } = require('../lib/abandoned-log');

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

        // Test builds (agents testing the builder) must not look like customers: see classifyTest in lib/abandoned-log.js
        const liveHosts = env.ABANDONED_LIVE_HOSTS ? String(env.ABANDONED_LIVE_HOSTS).split(',').map((h) => h.trim()).filter(Boolean) : DEFAULT_LIVE_HOSTS;
        const test = classifyTest(dataToStore, req.headers, { liveHosts });
        if (test.drop) {
          console.log(`Ignored test build (${test.reason}): ${buildData.buildId}`);
          return res.status(202).json({ message: 'Accepted' });
        }

        // Push to Redis (unchanged for real visitors: the daily email still reads and empties this list). Flagged test builds are not emailed.
        // A build that went into the cart (origin.addedToCart, sent by the theme from Release 35) is saved with that flag but is not an abandonment: not emailed.
        const cartBound = readOrigin(dataToStore).addedToCart;
        if (!test.isTest && !cartBound) {
          await redis.lpush('abandoned_builds', JSON.stringify(dataToStore));
          console.log(`Successfully recorded abandoned build: ${buildData.buildId}`);
        } else if (cartBound && !test.isTest) {
          console.log(`Cart-bound build kept out of the email: ${buildData.buildId}`);
        } else {
          console.log(`Test build kept out of the email (${test.reason}): ${buildData.buildId}`);
        }

        // Also keep a permanent copy in Supabase. Best effort: a problem here is logged and never changes the answer.
        try {
          const row = buildRow(dataToStore, req.headers, { salt: env.ABANDONED_HASH_SALT || '', isTest: test.isTest, testReason: test.reason });
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
