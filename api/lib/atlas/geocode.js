// Forward geocoding: place names / addresses -> lat/lng, so uploaded tables
// that have an address column but no coordinates can still be placed.
//
// Free OSM services only. Photon (komoot.io) is primary because it tolerates
// bulk politely; Nominatim is the fallback for whatever Photon is down for or
// cannot answer — it is better at full structured addresses, and it only ever
// sees the leftovers, which keeps us far inside its usage policy. Both are
// shared community infrastructure: every outbound request goes through one
// module-wide queue (see throttled), and every answer — including "nothing
// found" — is remembered in a persistent cache, so re-importing the same file
// costs the services nothing.
//
// The honesty problem this module exists for: a full street address in much
// of the world (very much including India) usually resolves to the LOCALITY
// centroid, not the building. Twenty different addresses in one neighbourhood
// then land on one identical point, and a map that draws them as precise pins
// is lying. So every result carries a confidence the caller must act on:
//   exact        a building / street / POI level hit — the pin is the thing
//   approximate  an area centroid (suburb, city, region) — do not trust the pin
//   failed       nothing found (reason: 'empty' | 'not-found' | 'unreachable')
// and markCollisions() flags the give-away pattern that per-result
// classification alone can miss: several DIFFERENT inputs on the SAME point.
//
// Result shape (every function below returns / arrays of):
//   { query, lat, lng, confidence, label, provider,
//     cached?, collided?, reason?, at? }
// lat/lng are numbers or null; provider is 'photon' | 'nominatim' | null;
// label is the provider's human-readable name for what it matched.
//
// Region bias: pass { country } (ISO3, what the rest of the atlas speaks) or
// an explicit { bbox } as [w, s, e, n] degrees. The atlas always knows its
// region — callers should always pass one of them, or "Springfield" lands on
// the wrong continent. country is turned into a bbox via country-bboxes.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PHOTON_URL = 'https://photon.komoot.io/api/';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
// Same identity string we already send geoBoundaries — anonymous UAs get blocked.
const USER_AGENT = 'LOKA-Atlas (mithun@socratus.org)';

// Nominatim's usage policy is one request per second, ABSOLUTE — per service,
// not per import — so the queue below is shared module-wide and the default
// gap keeps a 10% margin over the policy so scheduling jitter can never dip
// under it. Photon publishes no hard number, but it is a donated service and
// gets the same courtesy. Callers may slow this down (opts.delayMs) but the
// floor of 1000 ms is not theirs to lower.
const MIN_GAP_MS = 1100;
const FETCH_TIMEOUT_MS = 10000; // a hung provider must not stall a batch forever

// Cap on queries that would actually hit the network in one geocodeMany call.
// The cap is about wall-clock, not row count: 2000 fresh lookups at ~1.1 s
// each is already ~37 minutes. Cached rows are free and do not count.
export const MAX_UNCACHED_QUERIES = 2000;

// One cache for all atlases, next to the geoBoundaries cache. "Not found" is
// remembered too — a miss that is re-asked on every import is a bug — but with
// a TTL, because OSM grows and last month's miss may resolve today.
export const CACHE_FILE = path.join(DATA_DIR, 'geocache', 'geocode.json');
const FAILED_TTL_MS = 30 * 24 * 3600 * 1000;
const FLUSH_EVERY = 20; // a batch can run half an hour; a crash at minute 29 must not lose the answers already paid for

// An object whose own bbox spans more than this is an AREA, and the point we
// were given is its centroid — approximate no matter how object-like the tags
// look. ~0.02 deg is ~2.2 km: comfortably above any single building, below a
// suburb.
const EXTENT_APPROX_DEG = 0.02;
const COLLISION_DP = 5; // ~1.1 m — distinct buildings never coincide this tightly, a shared centroid is bit-identical

/* ---------------- pure helpers (unit-testable, no network) ---------------- */

// Cache key + dedupe identity. Conservative on purpose: case, whitespace and
// comma noise never change what a geocoder answers, but slashes and digits in
// Indian plot numbers ("12/2") absolutely do, so punctuation stays.
export function normaliseQuery(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(, )+/g, ', ')
    .replace(/^[,\s]+|[,\s]+$/g, '');
}

// The bias inputs change what the providers answer, so they are part of the
// key — otherwise two atlases in different regions would poison each other's
// cache with the wrong homonym. bbox is rounded to 0.1 deg so trivially
// different boxes over the same region still share entries.
export function cacheKey(query, { country, bbox } = {}) {
  const b = Array.isArray(bbox) && bbox.length === 4
    ? bbox.map((n) => Number(n).toFixed(1)).join(',') : '';
  return normaliseQuery(query) + '|' + String(country || '').toUpperCase() + '|' + b;
}

// OSM keys whose hit is a discrete addressable object — the pin IS the thing.
const EXACT_OSM_KEYS = new Set([
  'building', 'amenity', 'shop', 'tourism', 'leisure', 'office', 'craft',
  'historic', 'man_made', 'healthcare', 'emergency', 'aeroway', 'railway',
  'public_transport', 'highway',
]);
// Keys whose hit is a named AREA summarised to a centroid — the pin marks the
// middle of a region containing the queried thing, not the thing.
const APPROX_OSM_KEYS = new Set(['place', 'boundary', 'landuse']);
// Nominatim's addresstype equivalents of the exact set above.
const EXACT_ADDRESSTYPES = new Set([
  'building', 'house', 'road', 'street', 'amenity', 'shop', 'office',
  'tourism', 'leisure', 'craft', 'man_made', 'railway', 'aeroway', 'historic',
  'emergency', 'healthcare', 'public_transport',
]);

// raw is one untouched provider result (a Photon GeoJSON feature, or one
// Nominatim json/jsonv2 item); provider is 'photon' | 'nominatim'.
// Default stance is 'approximate': exact is claimed only on positive
// evidence, because an over-claimed pin lies while an under-claimed one is
// merely cautious.
export function classifyConfidence(raw, provider) {
  if (!raw) return 'failed';
  if (provider === 'photon') {
    const p = raw.properties || raw;
    // house/street is Photon saying "address-level" in so many words; a long
    // road's wide extent must not demote it, so this outranks the extent check
    if (p.type === 'house' || p.type === 'street') return 'exact';
    if (Array.isArray(p.extent) && p.extent.length === 4) {
      const span = Math.max(Math.abs(p.extent[2] - p.extent[0]), Math.abs(p.extent[3] - p.extent[1]));
      if (span > EXTENT_APPROX_DEG) return 'approximate';
    }
    if (APPROX_OSM_KEYS.has(p.osm_key)) return 'approximate';
    if (EXACT_OSM_KEYS.has(p.osm_key)) return 'exact';
    return 'approximate';
  }
  // Nominatim: jsonv2 says `category`, v1 says `class` — accept both.
  const cls = raw.class || raw.category || '';
  const type = raw.type || '';
  const addresstype = raw.addresstype || '';
  if (cls === 'highway' || addresstype === 'road' || addresstype === 'street') return 'exact';
  if (cls === 'place' && (type === 'house' || type === 'houses')) return 'exact';
  if (Array.isArray(raw.boundingbox) && raw.boundingbox.length === 4) {
    // boundingbox is [minlat, maxlat, minlon, maxlon] as strings
    const bb = raw.boundingbox.map(Number);
    const span = Math.max(Math.abs(bb[1] - bb[0]), Math.abs(bb[3] - bb[2]));
    if (span > EXTENT_APPROX_DEG) return 'approximate';
  }
  if (APPROX_OSM_KEYS.has(cls)) return 'approximate';
  if (EXACT_ADDRESSTYPES.has(addresstype) || EXACT_OSM_KEYS.has(cls)) return 'exact';
  // place_rank >= 26 is Nominatim's own street-or-finer threshold — catches
  // exact hits whose class we did not enumerate
  if (Number(raw.place_rank) >= 26) return 'exact';
  // unrecognised but prominent = a big named thing, i.e. a centroid (this is
  // the one honest use of `importance`; it coincides with the default stance)
  if (Number(raw.importance) >= 0.5) return 'approximate';
  return 'approximate';
}

// Different inputs landing on the SAME point is the centroid give-away: the
// provider answered "somewhere in <area>" for all of them. Per-result
// classification can be fooled one row at a time; the pile-up cannot.
// Annotates results in place with collided: true and returns the groups
// ({ point, indices, queries }) for callers that want to report them.
export function markCollisions(results, precision = COLLISION_DP) {
  const byPoint = new Map();
  results.forEach((r, i) => {
    if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number') return;
    const k = r.lat.toFixed(precision) + ',' + r.lng.toFixed(precision);
    (byPoint.get(k) || byPoint.set(k, []).get(k)).push(i);
  });
  const groups = [];
  for (const [point, indices] of byPoint) {
    const distinct = new Set(indices.map((i) => normaliseQuery(results[i].query)));
    // one address uploaded many times is repetition, not a lie — skip it
    if (distinct.size < 2) continue;
    for (const i of indices) results[i].collided = true;
    groups.push({ point, indices, queries: [...distinct] });
  }
  return groups;
}

/* ---------------- persistent cache (tmp + rename, like imports.js) ---------------- */

export function loadCache(file = CACHE_FILE) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && typeof c.entries === 'object' && c.entries) return c;
  } catch {}
  return { version: 1, entries: {} };
}

export function saveCache(cache, file = CACHE_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, file);
}

function cacheGet(cache, key) {
  const e = cache.entries[key];
  if (!e) return null;
  // successes are kept forever (a building does not move); misses expire so
  // OSM's growth eventually gets a second chance
  if (e.confidence === 'failed' && Date.now() - (e.at || 0) > FAILED_TTL_MS) return null;
  return e;
}

/* ---------------- politeness queue ---------------- */

// One queue for ALL outbound requests, module-wide, because the 1 req/s rule
// is per service, not per import — two concurrent imports must share a clock.
// Each HTTP request is its own job, so even a Photon call and its Nominatim
// fallback are gapped; nothing ever runs in parallel.
let queueTail = Promise.resolve();
let lastStartAt = 0;
function throttled(fn, gapMs) {
  const job = queueTail.then(async () => {
    const wait = lastStartAt + gapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStartAt = Date.now();
    return fn();
  });
  queueTail = job.then(() => {}, () => {}); // a failed lookup must not wedge the queue
  return job;
}

/* ---------------- providers ---------------- */

async function fetchJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 429/5xx are the provider's problem today, not the address's — throw, so
  // the failure is treated as transient and never cached as "no such place"
  if (res.status === 429 || res.status >= 500) throw new Error('geocoder http ' + res.status);
  if (!res.ok) return null; // other 4xx: this query is unanswerable, a real miss
  return res.json();
}

// Photon takes bbox as a HARD filter. That is what we want from the primary:
// the atlas knows its region, and an out-of-region homonym is worse than a
// miss (the fallback below casts the wider net).
async function queryPhoton(query, bias, fetchImpl) {
  const u = new URL(PHOTON_URL);
  u.searchParams.set('q', query);
  u.searchParams.set('limit', '1');
  u.searchParams.set('lang', 'en');
  if (bias.bbox) u.searchParams.set('bbox', bias.bbox.join(','));
  const data = await fetchJson(u, fetchImpl);
  const f = data && Array.isArray(data.features) ? data.features[0] : null;
  return f && f.geometry && Array.isArray(f.geometry.coordinates) ? f : null;
}

// Nominatim gets viewbox WITHOUT bounded=1 — a soft bias, deliberately looser
// than Photon's filter, so an address that is genuinely outside the atlas
// region still resolves instead of failing silently.
async function queryNominatim(query, bias, fetchImpl) {
  const u = new URL(NOMINATIM_URL);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('limit', '1');
  u.searchParams.set('addressdetails', '0');
  if (bias.bbox) u.searchParams.set('viewbox', bias.bbox.join(','));
  const data = await fetchJson(u, fetchImpl);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

function fromPhoton(f) {
  const p = f.properties || {};
  const [lng, lat] = f.geometry.coordinates;
  // Photon has no display_name; compose one so the caller can show the user
  // what was actually matched (the single best check against a wrong hit)
  const label = [
    p.name,
    [p.housenumber, p.street].filter(Boolean).join(' '),
    p.district, p.city, p.state, p.country,
  ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
  return { lat, lng, confidence: classifyConfidence(f, 'photon'), label, provider: 'photon' };
}

function fromNominatim(item) {
  return {
    lat: Number(item.lat),
    lng: Number(item.lon),
    confidence: classifyConfidence(item, 'nominatim'),
    label: item.display_name || item.name || '',
    provider: 'nominatim',
  };
}

function failed(reason) {
  return { lat: null, lng: null, confidence: 'failed', reason, label: '', provider: null };
}

async function lookupOne(query, bias, cfg) {
  try {
    const feat = await throttled(() => queryPhoton(query, bias, cfg.fetchImpl), cfg.gapMs);
    if (feat) return fromPhoton(feat);
  } catch {
    // Photon down or rate-limited — the fallback decides the outcome
  }
  try {
    const item = await throttled(() => queryNominatim(query, bias, cfg.fetchImpl), cfg.gapMs);
    if (item) return fromNominatim(item);
    // the last-resort provider answered and found nothing: a real miss, worth
    // remembering so the next import of this file does not re-ask
    return failed('not-found');
  } catch {
    // nobody answered — NOT cacheable: an outage must not masquerade as
    // "no such place" for the next 30 days
    return failed('unreachable');
  }
}

/* ---------------- bias resolution ---------------- */

let countryBboxes = null;
function bboxForCountry(iso3) {
  if (!countryBboxes) {
    try {
      countryBboxes = JSON.parse(fs.readFileSync(path.join(__dirname, 'country-bboxes.json'), 'utf8'));
    } catch { countryBboxes = {}; }
  }
  return countryBboxes[String(iso3 || '').toUpperCase()] || null;
}

function resolveBias({ country, bbox } = {}) {
  const b = Array.isArray(bbox) && bbox.length === 4 ? bbox.map(Number) : bboxForCountry(country);
  return { bbox: b || null };
}

function cfgFrom(opts = {}) {
  return {
    fetchImpl: opts.fetchImpl || fetch,
    // the floor is Nominatim's terms, not a tunable
    gapMs: Math.max(1000, Number(opts.delayMs) || MIN_GAP_MS),
  };
}

/* ---------------- public lookups ---------------- */

// One query. opts: { country?, bbox?, delayMs?, fetchImpl?, cacheFile? }
// -> { query, lat, lng, confidence, label, provider, cached?, reason? }
export async function geocodeOne(query, opts = {}) {
  const raw = String(query == null ? '' : query);
  const q = normaliseQuery(raw);
  if (!q) return { query: raw, ...failed('empty') };
  const cacheFile = opts.cacheFile || CACHE_FILE;
  const cache = loadCache(cacheFile);
  const key = cacheKey(q, opts);
  const hit = cacheGet(cache, key);
  if (hit) return { query: raw, ...hit, cached: true };
  const res = await lookupOne(q, resolveBias(opts), cfgFrom(opts));
  if (res.reason !== 'unreachable') {
    cache.entries[key] = { ...res, at: Date.now() };
    // the cache is an optimisation; a write failure must not fail the lookup
    try { saveCache(cache, cacheFile); } catch {}
  }
  return { query: raw, ...res };
}

// Many queries, results aligned by index with the input. Identical rows share
// one lookup, cached rows are free, and only what would actually hit the
// network counts against MAX_UNCACHED_QUERIES — so a re-import of an
// already-geocoded file of any size costs nothing and never trips the cap.
// opts: { country?, bbox?, onProgress?, delayMs?, fetchImpl?, cacheFile? }
// onProgress is called after each network lookup with
// { done, total, query, result } (total = unique uncached queries).
export async function geocodeMany(queries, opts = {}) {
  if (!Array.isArray(queries)) throw new Error('geocodeMany expects an array of queries');
  const cacheFile = opts.cacheFile || CACHE_FILE;
  const bias = resolveBias(opts);
  const cfg = cfgFrom(opts);
  const cache = loadCache(cacheFile);

  const rows = queries.map((raw) => {
    const s = String(raw == null ? '' : raw);
    const q = normaliseQuery(s);
    return { raw: s, q, key: q ? cacheKey(q, opts) : null };
  });

  const need = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r.key || seen.has(r.key) || cacheGet(cache, r.key)) continue;
    seen.add(r.key);
    need.push(r);
  }
  if (need.length > MAX_UNCACHED_QUERIES) {
    const mins = Math.round((need.length * cfg.gapMs) / 60000);
    throw new Error(
      `geocoding needs ${need.length} network lookups (cap ${MAX_UNCACHED_QUERIES}); ` +
      `at the polite rate of one per ${cfg.gapMs} ms that is ~${mins} minutes. ` +
      'Split the file, or include coordinate columns for most rows.');
  }

  const fetched = new Map(); // key -> live result (including uncacheable transient failures)
  let done = 0, dirty = 0;
  for (const { key, q } of need) {
    const res = await lookupOne(q, bias, cfg);
    fetched.set(key, res);
    if (res.reason !== 'unreachable') {
      cache.entries[key] = { ...res, at: Date.now() };
      if (++dirty >= FLUSH_EVERY) {
        try { saveCache(cache, cacheFile); } catch {}
        dirty = 0;
      }
    }
    done++;
    if (opts.onProgress) {
      try { opts.onProgress({ done, total: need.length, query: q, result: res }); } catch {}
    }
  }
  if (dirty) { try { saveCache(cache, cacheFile); } catch {} }

  const results = rows.map((r) => {
    if (!r.key) return { query: r.raw, ...failed('empty') };
    if (fetched.has(r.key)) return { query: r.raw, ...fetched.get(r.key) };
    return { query: r.raw, ...cacheGet(cache, r.key), cached: true };
  });
  markCollisions(results);
  return results;
}
