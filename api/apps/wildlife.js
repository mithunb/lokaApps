import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { getFlashModel } from '../lib/models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(__dirname, '..', 'data', 'wildlife-cache.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 500;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('wildlife: GEMINI_API_KEY is not set — endpoint will 500');
}
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const cache = new Map();
loadCache();

function cacheKey(city) {
  return String(city || '').trim().toLowerCase();
}

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) {
      if (v && v.data && typeof v.ts === 'number') cache.set(k, v);
    }
    console.log(`[wildlife] loaded ${cache.size} cached cities`);
  } catch {
    // no cache yet
  }
}

let persistPending = false;
function persistCache() {
  if (persistPending) return;
  persistPending = true;
  setImmediate(() => {
    persistPending = false;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const tmp = CACHE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache)));
      fs.renameSync(tmp, CACHE_FILE);
    } catch (e) {
      console.warn('[wildlife] cache persist failed:', e.message);
    }
  });
}

function trimCache() {
  if (cache.size <= MAX_ENTRIES) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = sorted.slice(0, cache.size - MAX_ENTRIES);
  for (const [k] of toRemove) cache.delete(k);
}

const schema = {
  type: Type.OBJECT,
  properties: {
    locationName: { type: Type.STRING },
    categories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          speciesList: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                scientificName: { type: Type.STRING },
                spottingLocations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      address: { type: Type.STRING },
                    },
                    required: ['name', 'address'],
                  },
                },
              },
              required: ['name', 'scientificName'],
            },
          },
        },
        required: ['name', 'speciesList'],
      },
    },
  },
  required: ['locationName', 'categories'],
};

const PROMPT = (location) => `
Return wildlife commonly observed in and around "${location}".

- locationName: echo back "${location}".
- categories: 3–5 groupings (e.g. "Birds", "Mammals", "Reptiles", "Insects",
  "Plants", "Fish"). Only include categories that actually have species for
  this location.
- Each category.speciesList: 3–6 notable species.
  - name: common English name.
  - scientificName: binomial in italics-ready plain text, no asterisks.
  - spottingLocations (optional but preferred): 1–2 real parks, lakes,
    reserves, or neighbourhoods in or near "${location}" where the species
    is frequently seen, each with a short address (city or area, not a
    full postal address). Omit the field entirely if you're unsure.

Be concise. No commentary outside the JSON.
`.trim();

async function fetchFromGemini(location) {
  const response = await ai.models.generateContent({
    model: getFlashModel(),
    contents: PROMPT(location),
    config: { responseMimeType: 'application/json', responseSchema: schema },
  });
  const text = response.text ?? '';
  return JSON.parse(text);
}

async function handleLookup(req, res) {
  if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { location, refresh } = req.body ?? {};
  if (!location || typeof location !== 'string') {
    return res.status(400).json({ error: 'location (string) is required' });
  }

  const key = cacheKey(location);
  const now = Date.now();

  if (!refresh) {
    const hit = cache.get(key);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Cache-Age-Seconds', String(Math.round((now - hit.ts) / 1000)));
      return res.type('application/json').send(JSON.stringify(hit.data));
    }
  }

  try {
    const data = await fetchFromGemini(location);
    cache.set(key, { ts: now, city: location, data });
    trimCache();
    persistCache();
    res.setHeader('X-Cache', refresh ? 'REFRESH' : 'MISS');
    return res.type('application/json').send(JSON.stringify(data));
  } catch (err) {
    console.error('wildlife error', err);
    return res.status(502).json({ error: 'upstream model error' });
  }
}

function handleRecent(req, res) {
  const now = Date.now();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 12));
  const entries = [...cache.entries()]
    .filter(([, v]) => now - v.ts < CACHE_TTL_MS)
    .map(([key, v]) => ({ key, city: v.city, ts: v.ts, data: v.data }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
  res.json({ count: entries.length, entries });
}

export default async function wildlife(req, res) {
  if (req.method === 'GET') return handleRecent(req, res);
  return handleLookup(req, res);
}
