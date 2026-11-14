// Shared-build links (save-shared-build / get-shared-build). Pure helpers + handler factories: the real Redis, clock and random source are passed in, tests pass fakes.
//
// New entries are stored as an envelope  { v: 2, build: <the build state>, meta: { createdAt, origin, themeRole, automation, isTest, testReason, host } }.
// OLD entries (6-character ids, written before this change) are the bare build state with no "v": get still returns them exactly as before and never touches their expiry.
const crypto = require('crypto');
const { readOrigin, classifyTest } = require('./abandoned-log');

const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';    // no O/0, I/1
const NEW_ID_LENGTH = 10;
const MAX_BYTES = 60 * 1024;                              // size cap (see the report: the biggest real-shaped build measured is far below this)
const TTL_SECONDS = 365 * 24 * 60 * 60;                   // new links: 12 months, restarted every time a link is opened
const SAVE_LIMIT = { max: 60, windowSeconds: 3600 };      // 60 saves per IP per hour
const GET_LIMIT = { max: 600, windowSeconds: 3600 };      // 600 opens per IP per hour (stops id guessing, never blocks a person)
const MAX_DEPTH = 12;

const ALLOWED_ORIGINS = ['https://loamlabsusa.com', 'https://www.loamlabsusa.com', 'https://e6f6c8-2.myshopify.com', 'http://127.0.0.1:9292', 'http://localhost:9292'];
const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/[a-z0-9-]+\.shopifypreview\.com$/];
function originAllowed(origin) {
  const o = String(origin || '').trim().toLowerCase();
  return !!o && (ALLOWED_ORIGINS.includes(o) || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(o)));
}

// The fields getCleanBuildStateForSaving() in the theme writes (variant-builder.js), plus the optional Release 35 fields the theme may add.
const BUILD_KEYS = ['step', 'buildType', 'ridingStyle', 'ridingStyleDisplay', 'spokeInterface', 'system', 'standardStudio', 'customerSupplied', 'ownParts', 'specs', 'components', 'selectedOptionalAddons', 'buildId', '_ui'];
const META_KEYS = ['origin', 'themeRole', 'automation', 'testBuild', 'isTest'];
const BUILD_TYPES = ['Front', 'Rear', 'Wheel Set'];
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function depthOk(v, d = 0) {
  if (d > MAX_DEPTH) return false;
  if (Array.isArray(v)) return v.every((x) => depthOk(x, d + 1));
  if (v && typeof v === 'object') return Object.keys(v).every((k) => depthOk(v[k], d + 1));
  return true;
}
function hasBadKey(v) {
  if (Array.isArray(v)) return v.some(hasBadKey);
  if (v && typeof v === 'object') return Object.keys(v).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype' || hasBadKey(v[k]));
  return false;
}

/** @returns {{ok:true, build:object, meta:object}|{ok:false, error:string}} */
function checkBuild(body) {
  if (!isPlain(body)) return { ok: false, error: 'The build must be a JSON object.' };
  const keys = Object.keys(body);
  if (!keys.length) return { ok: false, error: 'No build data provided' };
  const unknown = keys.filter((k) => !BUILD_KEYS.includes(k) && !META_KEYS.includes(k));
  if (unknown.length) return { ok: false, error: 'Unexpected field in the build: ' + String(unknown[0]).slice(0, 40) };
  if (body.buildType !== null && body.buildType !== undefined && !BUILD_TYPES.includes(body.buildType)) return { ok: false, error: 'buildType must be Front, Rear or Wheel Set.' };   // null = an in-progress save still on Step 1
  if (!isPlain(body.components)) return { ok: false, error: 'components must be an object.' };
  if (!Object.keys(body.components).every((k) => /^(front|rear)[A-Za-z]{2,20}$/.test(k) && (body.components[k] === null || isPlain(body.components[k])))) return { ok: false, error: 'components has an unexpected entry.' };
  if (!isPlain(body.specs)) return { ok: false, error: 'specs must be an object.' };
  for (const k of ['system', 'standardStudio', 'customerSupplied', 'ownParts', 'selectedOptionalAddons', '_ui']) if (body[k] != null && !isPlain(body[k])) return { ok: false, error: k + ' must be an object.' };
  for (const k of ['step']) if (body[k] != null && typeof body[k] !== 'number') return { ok: false, error: k + ' must be a number.' };
  for (const k of ['ridingStyle', 'ridingStyleDisplay', 'spokeInterface', 'buildId']) if (body[k] != null && typeof body[k] !== 'string') return { ok: false, error: k + ' must be text.' };
  if (!depthOk(body)) return { ok: false, error: 'The build is nested too deeply.' };
  if (hasBadKey(body)) return { ok: false, error: 'The build has a forbidden key.' };
  const build = {}; const meta = {};
  for (const k of keys) (META_KEYS.includes(k) ? meta : build)[k] = body[k];
  return { ok: true, build, meta };
}

function newId(randomInt = crypto.randomInt) { let s = ''; for (let i = 0; i < NEW_ID_LENGTH; i++) s += ID_ALPHABET[randomInt(ID_ALPHABET.length)]; return s; }
const idValid = (id) => typeof id === 'string' && (id.length === 6 || id.length === NEW_ID_LENGTH) && [...id].every((c) => ID_ALPHABET.includes(c));

const clientIp = (req) => String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim().slice(0, 64);
/** one counter per IP per window; a Redis problem lets the request through (the builder must keep working) */
async function overLimit(redis, kind, ip, { max, windowSeconds }, now = Date.now()) {
  try {
    const key = `rl:share:${kind}:${ip}:${Math.floor(now / (windowSeconds * 1000))}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, windowSeconds + 60);
    return n > max;
  } catch (e) { return false; }
}

function cors(req, res, methods) {
  const origin = req.headers && req.headers.origin;
  if (originAllowed(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function createSaveHandler({ redis, now = () => Date.now(), randomInt = crypto.randomInt }) {
  return async (req, res) => {
    cors(req, res, 'POST, OPTIONS');
    const origin = req.headers && req.headers.origin;
    if (req.method === 'OPTIONS') return res.status(originAllowed(origin) ? 204 : 403).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!originAllowed(origin)) return res.status(403).json({ error: 'This site may not save builds.' });
    if (await overLimit(redis, 'save', clientIp(req), SAVE_LIMIT, now())) return res.status(429).json({ error: 'Too many saves. Please try again later.' });
    try {
      const body = req.body;
      const text = JSON.stringify(body === undefined ? null : body);
      if (Buffer.byteLength(text) > MAX_BYTES) return res.status(413).json({ error: 'This build is too large to save as a link.' });
      const checked = checkBuild(body);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      const o = readOrigin(checked.meta);
      const t = classifyTest(checked.meta, { origin });
      let host = ''; try { host = new URL(origin).hostname; } catch (e) { host = ''; }
      const entry = { v: 2, build: checked.build, meta: { createdAt: new Date(now()).toISOString(), origin: o, themeRole: checked.meta.themeRole ? String(checked.meta.themeRole).slice(0, 20) : null, automation: checked.meta.automation === true, isTest: t.isTest, testReason: t.reason, host } };
      const value = JSON.stringify(entry);
      for (let i = 0; i < 6; i++) {
        const id = newId(randomInt);
        const set = await redis.set(`shared_build:${id}`, value, { nx: true, ex: TTL_SECONDS });   // nx: never overwrite an existing id
        if (set) return res.status(200).json({ shareId: id });
      }
      return res.status(500).json({ error: 'Could not make a link. Please try again.' });
    } catch (error) {
      console.error('Error saving shared build:', error.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

function createGetHandler({ redis, now = () => Date.now() }) {
  return async (req, res) => {
    cors(req, res, 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
    if (await overLimit(redis, 'get', clientIp(req), GET_LIMIT, now())) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    try {
      const raw = req.query && req.query.id;
      const id = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      if (!id) return res.status(400).json({ error: 'No share ID provided' });
      if (!idValid(id)) return res.status(400).json({ error: 'That share link is not valid.' });
      const data = await redis.get(`shared_build:${id}`);
      if (!data) return res.status(404).json({ error: 'Build not found or link has expired.' });
      const entry = typeof data === 'string' ? JSON.parse(data) : data;
      if (entry && entry.v === 2 && entry.build) {
        try { await redis.expire(`shared_build:${id}`, TTL_SECONDS); } catch (e) { /* the link still opens */ }   // new links only: restart the 12 months
        return res.status(200).json(entry.build);
      }
      return res.status(200).json(entry);   // old entry: returned as it always was, expiry untouched
    } catch (error) {
      console.error('Error retrieving shared build:', error.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}

module.exports = { ID_ALPHABET, NEW_ID_LENGTH, MAX_BYTES, TTL_SECONDS, SAVE_LIMIT, GET_LIMIT, ALLOWED_ORIGINS, BUILD_KEYS, META_KEYS, originAllowed, checkBuild, newId, idValid, overLimit, createSaveHandler, createGetHandler };
