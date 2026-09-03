// LOKA Atlas API — instance wizard backend.
// Mounted by server.js as an Express Router at /api/atlas (see the `router` export).
//
// Design notes:
// - Anyone can create & publish a PUBLIC atlas without login (free-tier layers).
// - Magic-link registration is required only to save drafts or build PRIVATE atlases.
// - Layers whose catalog `cost` is "approval" park the instance as pending-approval
//   and email the admin signed approve/deny links.
// - Builds run through the FIFO queue in lib/atlas/jobs.js (Python orchestrator).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as reg from '../lib/atlas/registry.js';
import * as auth from '../lib/atlas/auth.js';
import { sendMail } from '../lib/mailer.js';
import {
  enqueueBuild, getJob, setJobDoneHook, setStrandedBuildHook, DATASETS_ROOT, PRIVATE_ROOT,
} from '../lib/atlas/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const CATALOG_FILE = path.join(REPO_ROOT, 'atlas', 'setup', 'catalog.json');
const GEOCACHE_DIR = path.join(reg.DATA_DIR, 'geocache');

const FREE_AREA_DEG2 = Number(process.env.ATLAS_MAX_AREA_DEG2) || 6;   // beyond this: admin approval
const HARD_AREA_DEG2 = Number(process.env.ATLAS_HARD_AREA_DEG2) || 40; // beyond this: refuse politely
const MAX_INSTANCES = Number(process.env.ATLAS_MAX_INSTANCES) || 50;
const PER_IP_PER_DAY = Number(process.env.ATLAS_PER_IP_PER_DAY) || 3;
const ADMIN_EMAIL = process.env.ATLAS_ADMIN_EMAIL || 'mithun@socratus.org';

export const router = express.Router();
// Data ingests carry whole tables; everything else stays small.
const jsonBig = express.json({ limit: '10mb' });
const jsonStd = express.json({ limit: '2mb' });
router.use((req, res, next) => (req.path === '/layers/ingest' ? jsonBig : jsonStd)(req, res, next));

/* Every refusal leaves a trace. Twice now a person has hit a wall in the setup
   flow and reported "something went wrong", and the log held nothing at all —
   because a clean 4xx writes to no stream, so there was nothing to read and
   nothing to do but guess. One line per non-2xx, naming the route, the status
   and whatever the body said, turns the next report into a diagnosis.
   Successes stay silent; this is for the ones that failed. */
router.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) {
      const why = (body && (body.error || body.message)) || '(no message)';
      console.warn(`[atlas] ${res.statusCode} ${req.method} ${req.path} — ${why}`);
    }
    return send(body);
  };
  next();
});

/* ================= catalog ================= */

let catalogCache = null, catalogMtime = 0;
function catalog() {
  const mtime = fs.statSync(CATALOG_FILE).mtimeMs;
  if (!catalogCache || mtime !== catalogMtime) {
    catalogCache = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    catalogMtime = mtime;
  }
  return catalogCache;
}
function tierOf(iso3) {
  return iso3 === 'IND' ? 'india' : 'global';
}
function layersForTier(tier) {
  return catalog().layers.filter((l) => l.tiers.includes(tier));
}

router.get('/catalog', (req, res) => {
  const iso3 = String(req.query.iso3 || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) return res.status(400).json({ error: 'iso3 required' });
  const tier = tierOf(iso3);
  res.json({ tier, layers: layersForTier(tier) });
});

router.get('/config', (_req, res) => {
  res.json({ freeAreaDeg2: FREE_AREA_DEG2, hardAreaDeg2: HARD_AREA_DEG2 });
});

/* ================= geography (geoBoundaries picker data) ================= */

const GB_API = (iso3, lvl) =>
  `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM${lvl}/`;

async function loadAdmin(iso3, level) {
  fs.mkdirSync(GEOCACHE_DIR, { recursive: true });
  const cacheFile = path.join(GEOCACHE_DIR, `${iso3}-ADM${level}.json`);
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}

  const metaRes = await fetch(GB_API(iso3, level), {
    headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' },
  });
  if (!metaRes.ok) throw new Error(`geoBoundaries meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const gjUrl = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!gjUrl) throw new Error('no geometry URL in geoBoundaries response');
  const gjRes = await fetch(gjUrl, { headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' } });
  if (!gjRes.ok) throw new Error(`geoBoundaries geojson ${gjRes.status}`);
  const gj = await gjRes.json();

  const features = (gj.features || []).map((f) => ({
    type: 'Feature',
    properties: {
      name: f.properties.shapeName || f.properties.shapeID,
      id: f.properties.shapeID || f.properties.shapeName,
    },
    geometry: f.geometry,
    bbox: featureBbox(f.geometry),
  }));
  const doc = {
    iso3, level, fetchedAt: Date.now(),
    fullResUrl: meta.gjDownloadURL || gjUrl,
    license: meta.boundaryLicense || 'CC-BY 4.0',
    features,
  };
  const tmp = cacheFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, cacheFile);
  return doc;
}

function featureBbox(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  eachCoord(geom, (x, y) => {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  });
  return [w, s, e, n];
}
function eachCoord(geom, fn) {
  const walk = (c) => {
    if (typeof c[0] === 'number') fn(c[0], c[1]);
    else c.forEach(walk);
  };
  if (geom && geom.coordinates) walk(geom.coordinates);
}
// ray-cast against outer rings — plenty for assigning admin2 to a parent in the picker
function pointInGeom(x, y, geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : [];
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// Which ADM depths does geoBoundaries actually have for this country? (cached probe)
const MAX_LEVEL = 4;

/* What the builders can actually honour, per country.

   India's boundary layer always resolves to the official district list
   whatever level was picked, so a subdistrict or a locality is a choice that
   cannot change the atlas — only confuse it. Typing "kolkata" returned three
   rows all reading Kolkata; the one labelled "district" was 92 km² against
   the official district's 186, and picking it is what killed a build. All
   three produce the same atlas, so only the two real levels are offered.

   Everywhere else the builder draws exactly the level that was picked, so
   every level is honest. null means no limit. */
function buildableLevels(iso3) {
  return tierOf(iso3) === 'india' ? [1, 2] : null;
}


/* ---- free-text place search (backs the box that replaces the drill-down) ---- */

// Mid-file import, same pattern as the matching.js import further down —
// imports hoist, and this keeps the search block self-contained.
import { aliasSpellings } from '../lib/atlas/place-aliases.js';

// iso3 -> display name for result labels ("…, India"). The setup wizard already
// ships this list; reading it here (like CATALOG_FILE above) keeps one source
// of truth instead of a second hand-kept country table.
const COUNTRY_NAMES = (() => {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'atlas', 'setup', 'countries.json'), 'utf8'));
    return Object.fromEntries(list.map((c) => [c.iso3, c.name]));
  } catch (e) {
    console.warn('[atlas] countries.json missing:', e.message);
    return {};
  }
})();

// Display-only words for the label. geoBoundaries has no per-country level
// vocabulary; these fit the countries we serve today (India first) and read
// better than "ADM3". A wrong word is cosmetic — id/level stay authoritative.
const LEVEL_WORDS = { 1: 'state', 2: 'district', 3: 'subdistrict', 4: 'locality' };

// dice() below this reads as noise in a live search box. matching.js keeps
// CANDIDATE_FLOOR at 0.5, but those candidates feed a human-vetted fix-list;
// here every row shown must be a plausible "did you mean".
const SEARCH_FUZZY_FLOOR = 0.6;
const SEARCH_LEVEL_RETRY_MS = 5 * 60 * 1000;

// Slim per-level name index: {id, name, n: norm(name), bbox} only. WHY: loadAdmin
// re-parses its cache file on every call — fine for one-shot picker fetches, but
// IND ADM3+ADM4 alone are ~70 MB of JSON and search fires per keystroke. Dropping
// geometry shrinks all of India to ~2 MB (measured), cheap enough to keep for the
// process lifetime — safe, because cache files are written exactly once.
const searchIndex = new Map();       // `${iso3}-ADM${level}` -> { entries: [...] }
const searchIndexFailAt = new Map(); // same key -> Date.now() of last failure

async function searchLevelIndex(iso3, level) {
  const key = `${iso3}-ADM${level}`;
  const hit = searchIndex.get(key);
  if (hit) return hit;
  // Negative-cache failures: without this, a level geoBoundaries doesn't have
  // (or an offline source) would trigger a fresh network attempt per keystroke.
  const failedAt = searchIndexFailAt.get(key);
  if (failedAt && Date.now() - failedAt < SEARCH_LEVEL_RETRY_MS) return null;
  try {
    const doc = await loadAdmin(iso3, level);
    const entries = (doc.features || [])
      .filter((f) => f.properties && f.properties.id && f.properties.name)
      .map((f) => ({ id: f.properties.id, name: f.properties.name, n: norm(f.properties.name), bbox: f.bbox }));
    const idx = { entries };
    searchIndex.set(key, idx);
    searchIndexFailAt.delete(key);
    return idx;
  } catch {
    searchIndexFailAt.set(key, Date.now());
    return null;
  }
}

// Ancestor chain for one matched unit, memoised per unit — ancestorChainOf
// re-loads every level above the unit on each call, so a top-8 of ADM4 units
// would cost dozens of multi-MB parses per keystroke without the memo; with it
// each unit pays once per process, and live typing keeps resurfacing the same
// top units. The index carries no geometry, so the unit's centroid falls back
// to its bbox midpoint (the fallback ancestorChainOf already defines) tested
// against real ancestor polygons; a midpoint that lands in a neighbour can
// mislabel the trail, but that is display-only and rare at these levels.
const ancestorMemo = new Map(); // `${iso3}|${unitId}` -> [{level, id, name}]
async function searchAncestorsOf(iso3, level, unit) {
  const key = `${iso3}|${unit.id}`;
  let chain = ancestorMemo.get(key);
  if (!chain) {
    const raw = level > 1
      ? await ancestorChainOf(iso3, level, [{ id: unit.id, name: unit.name, bbox: unit.bbox }]) : [];
    chain = raw
      .map((e) => ({ level: e.level, id: e.units[0] && e.units[0].id, name: e.units[0] && e.units[0].name }))
      .filter((e) => e.id);
    ancestorMemo.set(key, chain);
  }
  return chain;
}

// GET /geo/search?iso3=IND&q=bengaluru&limit=8
// Ranked matches across every admin level — the endpoint behind the text box
// that replaces the country→state→district drill-down. Response:
//   { matches: [{ id, name, level, label, parents, bbox, alias? }] }
// - label:   "district · Karnātaka, India" — level word, then containers inner→outer
// - parents: [{ level, id, name }] outermost first (level 1 … level-1)
// - alias:   { typed, inData }, present when an exact/prefix match went through
//            a renaming, so the UI can say "Bengaluru (listed as Bangalore in
//            the boundary data)" — never set on merely-fuzzy matches
router.get('/geo/search', async (req, res) => {
  const iso3 = String(req.query.iso3 || '').toUpperCase();
  const q = String(req.query.q || '').trim();
  const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 8));
  if (!/^[A-Z]{3}$/.test(iso3)) return res.status(400).json({ error: 'iso3 required' });
  if (!q) return res.status(400).json({ error: 'q required' });
  const spellings = aliasSpellings(q); // [norm(q), …renaming spellings], self first
  const qn = spellings[0];
  if (qn.length < 2) return res.json({ matches: [] }); // one letter matches half the country — wait for more input

  try {
    // Which levels exist here: trust the /geo/levels probe when it has run,
    // otherwise try 1..MAX_LEVEL and let the negative cache absorb levels that
    // turn out not to exist. (Never write the probe file from here —
    // /geo/levels owns it, and two writers is how caches rot.)
    let avail = null;
    try { avail = JSON.parse(fs.readFileSync(path.join(GEOCACHE_DIR, `${iso3}-levels.json`), 'utf8')).levels; } catch {}
    const reach = buildableLevels(iso3);
    const levels = (avail || Array.from({ length: MAX_LEVEL }, (_, i) => i + 1))
      .filter((l) => l >= 1 && l <= MAX_LEVEL)
      .filter((l) => !reach || reach.includes(l))   // never offer ground no builder can draw
      .sort((a, b) => a - b);

    const found = [];
    let exact = 0;
    for (const L of levels) {
      // Early stop: once shallower levels supply `limit` exact matches, deeper
      // levels cannot change the answer — the sort below orders equal-tier
      // matches by level, so a deeper unit can never displace those exacts from
      // the top slice. Lossless, and it is what keeps a query like "karnataka"
      // from paying for ADM3/ADM4 (35 MB parses, or a network fetch) it cannot
      // benefit from.
      if (exact >= limit) break;
      const idx = await searchLevelIndex(iso3, L);
      if (!idx) continue;
      for (const e of idx.entries) {
        // exact → prefix → fuzzy, each tried against every equivalent spelling,
        // so "bengaluru" reaches data that says "Bangalore" and vice versa
        let tier = 0, score = 0, via = qn;
        if (spellings.includes(e.n)) {
          tier = 3; score = 1; via = e.n;
        } else {
          const pre = spellings.find((s) => e.n.startsWith(s)); // self-first order: a direct prefix outranks an alias prefix for attribution
          if (pre) {
            tier = 2; score = pre.length / e.n.length; via = pre; // fuller coverage (shorter names) first
          } else {
            let best = 0, bestVia = qn;
            for (const s of spellings) {
              const d = dice(s, e.n);
              if (d > best) { best = d; bestVia = s; } // strict >: ties credit the typed spelling, not an alias
            }
            if (best >= SEARCH_FUZZY_FLOOR) { tier = 1; score = best; via = bestVia; }
          }
        }
        if (!tier) continue;
        if (tier === 3) exact++;
        found.push({ tier, score, level: L, via, unit: e });
      }
    }

    // Rank: exact, then prefix, then fuzzy; equal scores resolve to the higher
    // (shallower) level, then the shorter name — someone typing "bengaluru"
    // wants the district before a taluk or village of the same name. Scores are
    // bucketed to hundredths so float dust cannot shuffle the level order.
    found.sort((a, b) =>
      (b.tier - a.tier) ||
      (Math.round(b.score * 100) - Math.round(a.score * 100)) ||
      (a.level - b.level) ||
      (a.unit.name.length - b.unit.name.length) ||
      a.unit.name.localeCompare(b.unit.name));

    const country = COUNTRY_NAMES[iso3] || iso3;
    const matches = [];
    for (const m of found.slice(0, limit)) {
      const parents = await searchAncestorsOf(iso3, m.level, m.unit);
      const crumbs = [...parents.map((p) => p.name).reverse(), country];
      const row = {
        id: m.unit.id,
        name: m.unit.name,
        level: m.level,
        label: `${LEVEL_WORDS[m.level] || 'ADM' + m.level} · ${crumbs.join(', ')}`,
        parents,
        bbox: m.unit.bbox,
      };
      // The match went through a renaming — hand the UI both spellings so the
      // person who typed "Bengaluru" understands why the map says "Bangalore".
      // Exact/prefix tiers only: a FUZZY hit that happened to score via an alias
      // spelling (kolkata ~ Cuttack via "calcutta") is a different place, and
      // claiming "listed as Cuttack in the boundary data" would be a lie.
      if (m.via !== qn && m.tier >= 2) row.alias = { typed: q, inData: m.unit.name };
      matches.push(row);
    }
    res.json({ matches });
  } catch (e) {
    console.warn('[atlas] geo/search failed:', e.message);
    res.status(502).json({ error: 'search failed: ' + e.message });
  }
});

// Work out WHICH REGION a file is about, so someone who does not know the places
// in their own data can still answer "where is it?". Every row is read (bounded
// by the same 5,000-row ceiling as an upload) — a sample could not report an
// honest "96 of 104 rows", and could miss a small group sitting in another state
// entirely, which is exactly the group that would later go unplaced.
// Response: { iso3, mode, level, units, bbox, coverage, rows, matchedRows,
//             unreadRows, sharedRows, parents, ancestors }
router.post('/geo/infer', async (req, res) => {
  const b = req.body || {};
  let iso3 = String(b.iso3 || '').toUpperCase();
  const points = Array.isArray(b.points) ? b.points
    .map((p) => [Number(p && p[0]), Number(p && p[1])])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180)
    .slice(0, MAX_ROWS) : [];
  const names = Array.isArray(b.names)
    ? b.names.map((n) => String(n == null ? '' : n).trim()).filter(Boolean).slice(0, MAX_ROWS) : [];
  if (!points.length && !names.length) return res.status(400).json({ error: 'points or names required' });
  try {
    // no country given: coordinates can resolve it; bare place names cannot
    if (!/^[A-Z]{3}$/.test(iso3)) {
      if (!points.length) {
        return res.status(400).json({ error: 'couldn’t tell the country from place names alone — choose it', needsCountry: true });
      }
      iso3 = await resolveCountryFromPoints(points);
      if (!iso3) {
        return res.status(400).json({ error: 'couldn’t tell the country from this data — choose it', needsCountry: true });
      }
    }
    let avail;
    try { avail = JSON.parse(fs.readFileSync(path.join(GEOCACHE_DIR, `${iso3}-levels.json`), 'utf8')).levels; }
    catch { avail = [1, 2, 3, 4]; }
    let r = null, mode = null;
    if (points.length) { r = await inferRegionFromPoints(iso3, points, avail); mode = 'points'; }
    else { r = await inferRegionFromNames(iso3, names, avail); mode = 'names'; }
    if (!r || !r.units.length) {
      return res.json({ iso3, mode, level: null, units: [], bbox: null, coverage: 0,
                        rows: (r && r.rows) || points.length || names.length, matchedRows: 0,
                        unreadRows: (r && r.unreadRows) || 0, parents: [], ancestors: [] });
    }
    const parents = await parentUnitsOf(iso3, r.level, r.units);
    const ancestors = await ancestorChainOf(iso3, r.level, r.units);
    // geometry rides along for the confirmation map, but a huge covering set
    // (data spread across dozens of units) would bloat the response — drop it then
    const units = r.units.length <= 60 ? r.units : r.units.map(({ geometry, ...u }) => u);
    res.json({ iso3, mode, level: r.level, units, bbox: r.bbox,
               coverage: Number(r.coverage.toFixed(3)),
               rows: r.rows, matchedRows: r.matchedRows, unreadRows: r.unreadRows,
               sharedRows: r.sharedRows || 0,
               parents, ancestors });
  } catch (e) {
    console.warn('[atlas] geo/infer failed:', e.message);
    res.status(502).json({ error: 'inference failed: ' + e.message });
  }
});

/* ============ data-first: infer the region from the uploaded data ============ */

const INFER_MIN_COVERAGE = 0.9;
function unionBboxOf(units) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const u of units) {
    const b = u.bbox;
    if (!b || b.length !== 4) continue;
    if (b[0] < w) w = b[0]; if (b[1] < s) s = b[1]; if (b[2] > e) e = b[2]; if (b[3] > n) n = b[3];
  }
  return w <= e && s <= n ? [w, s, e, n] : null;
}

// points [[lng,lat]…] → admin units whose union covers them. Prefer the district
// level (a fragmented finer set "steps up" to its district parent naturally);
// fall back to level 1 only when district coverage is poor.
async function inferRegionFromPoints(iso3, points, avail) {
  const order = [2, 1, 3, 4].filter((l) => avail.includes(l));
  let best = null;
  for (const L of order) {
    let doc; try { doc = await loadAdmin(iso3, L); } catch { continue; }
    const feats = doc.features || [];
    const byId = new Map(feats.map((f) => [f.properties.id, f]));
    const counts = new Map();
    let covered = 0;
    for (const [x, y] of points) {
      let hit = null;
      for (const f of feats) {
        const b = f.bbox;
        if (b && b[0] <= x && x <= b[2] && b[1] <= y && y <= b[3] && pointInGeom(x, y, f.geometry)) { hit = f; break; }
      }
      if (hit) { covered++; counts.set(hit.properties.id, (counts.get(hit.properties.id) || 0) + 1); }
    }
    const coverage = points.length ? covered / points.length : 0;
    const units = [...counts.keys()].map((id) => {
      const f = byId.get(id);
      return { id, name: f.properties.name, bbox: f.bbox, geometry: f.geometry };
    });
    const cand = { level: L, coverage, units, bbox: unionBboxOf(units),
                   rows: points.length, matchedRows: covered, unreadRows: 0 };
    if (coverage >= INFER_MIN_COVERAGE && units.length) return cand;
    if (!best || coverage > best.coverage) best = cand;
  }
  return best;
}

// names — ONE ENTRY PER ROW, repeats included. Coverage is measured in rows, not
// in distinct spellings, because "96 of 104 rows" is the sentence the person is
// shown and a per-spelling rate would quietly flatter a file that says "Deoria"
// ninety times. Every row is read; each distinct spelling is still only looked
// up once, so repetition costs nothing.
//
// SHARED NAMES ARE SETTLED LAST, ON PURPOSE. Place names repeat: "Ramgarh" is
// seven different places at level 3, spread 1,500km apart, and 221 names at that
// level are shared. Taking the first one the boundary file happens to list would
// anchor an atlas anywhere — and the offending row could be row one, before there
// is anything to compare it against. So the names that can only mean one place
// are counted first and become the anchor; only then is each shared name settled
// to whichever of its candidates sits nearest that anchor. When NOTHING is
// certain — every name in the file shared — the candidates are asked which
// arrangement is most tightly packed, so the file still lands in one region
// instead of scattering across the country.
//
// The exact lookup is instant. Guessing the nearest spelling is not, so it runs
// last and on a budget; running out stops the guessing, never the counting — the
// rows it could not reach are reported as unread rather than called misses. And
// once a level explains nearly all the rows, finer levels are not scanned at all.
const INFER_FUZZY_BUDGET = 400;
function bboxCentre(b) {
  return (b && b.length === 4) ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
}
function farness(a, b) {
  if (!a || !b) return Infinity;
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;                       // squared degrees: only ever compared
}
// Nothing certain to anchor to: try each candidate of the best-represented shared
// name as a hypothesis, let every other shared name fall to its nearest candidate,
// and keep the hypothesis with the least total spread.
function anchorFromSpread(deferred) {
  let seed = null;
  for (const d of deferred) if (!seed || d[1] > seed[1]) seed = d;
  if (!seed) return null;
  let bestC = null, bestCost = Infinity;
  for (const f of seed[2].slice(0, 12)) {
    const c = bboxCentre(f.bbox);
    if (!c) continue;
    let cost = 0;
    for (const [, n, cands] of deferred) {
      let near = Infinity;
      for (const g of cands) near = Math.min(near, farness(bboxCentre(g.bbox), c));
      if (Number.isFinite(near)) cost += near * n;
    }
    if (cost < bestCost) { bestCost = cost; bestC = c; }
  }
  return bestC;
}
async function inferRegionFromNames(iso3, names, avail) {
  const order = [2, 3, 4, 1].filter((l) => avail.includes(l));
  const tally = new Map();                       // spelling -> how many rows carry it
  for (const nm of names) tally.set(nm, (tally.get(nm) || 0) + 1);
  const rows = names.length;
  let best = null;
  for (const L of order) {
    let doc; try { doc = await loadAdmin(iso3, L); } catch { continue; }
    const feats = doc.features || [];
    const byId = new Map(feats.map((f) => [f.properties.id, f]));
    const byName = new Map();                    // EVERY place sharing a name, not the first
    for (const f of feats) {
      const k = norm(f.properties.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(f);
    }

    const hitU = new Map();
    let matchedRows = 0, unreadRows = 0, sharedRows = 0;
    const deferred = [];                         // [spelling, rows, candidates]
    const unknown = [];                          // [spelling, rows]

    // 1) the names that can only mean one place — these anchor everything else
    let ax = 0, ay = 0, aw = 0;
    for (const [nm, n] of tally) {
      const cands = byName.get(norm(nm));
      if (!cands) { unknown.push([nm, n]); continue; }
      if (cands.length > 1) { deferred.push([nm, n, cands]); continue; }
      const f = cands[0];
      matchedRows += n;
      hitU.set(f.properties.id, (hitU.get(f.properties.id) || 0) + n);
      const c = bboxCentre(f.bbox);
      if (c) { ax += c[0] * n; ay += c[1] * n; aw += n; }
    }

    // 2) AT THE END: every shared name goes to its candidate nearest the anchor
    const anchor = aw ? [ax / aw, ay / aw] : anchorFromSpread(deferred);
    for (const [, n, cands] of deferred) {
      let pick = cands[0], bestD = Infinity;
      for (const f of cands) {
        const d = farness(bboxCentre(f.bbox), anchor);
        if (d < bestD) { bestD = d; pick = f; }
      }
      matchedRows += n; sharedRows += n;
      hitU.set(pick.properties.id, (hitU.get(pick.properties.id) || 0) + n);
    }

    // 3) last, and budgeted: no place is spelled like this, so guess the nearest
    // spelling — and where scores tie, prefer the region the rest of the data is in
    let guesses = 0;
    for (const [nm, n] of unknown) {
      if (guesses >= INFER_FUZZY_BUDGET) { unreadRows += n; continue; }
      guesses++;
      let bs = 0, bf = null, bd = Infinity;
      for (const g of feats) {
        const sc = dice(nm, g.properties.name);
        if (sc < bs) continue;
        const d = farness(bboxCentre(g.bbox), anchor);
        if (sc > bs || d < bd) { bs = sc; bf = g; bd = d; }
      }
      if (bs >= AUTO_ACCEPT && bf) {
        matchedRows += n;
        hitU.set(bf.properties.id, (hitU.get(bf.properties.id) || 0) + n);
      }
    }

    const coverage = rows ? matchedRows / rows : 0;
    const units = [...hitU.keys()].map((id) => {
      const f = byId.get(id);
      return { id, name: f.properties.name, bbox: f.bbox, geometry: f.geometry };
    });
    const cand = { level: L, coverage, units, bbox: unionBboxOf(units),
                   rows, matchedRows, unreadRows, sharedRows };
    if (coverage >= INFER_MIN_COVERAGE && units.length) return cand;
    if (!best || coverage > best.coverage) best = cand;
  }
  return best;
}

// Country bounding boxes (Natural Earth-derived, 173 countries) — the coarse
// sieve for resolving the country FROM the data, so data-first uploads don't
// have to ask. Candidates are verified against real ADM1 geometry, so a loose
// or overlapping bbox only costs a check, never a wrong answer.
const COUNTRY_BBOXES = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'lib', 'atlas', 'country-bboxes.json'), 'utf8')); }
  catch (e) { console.warn('[atlas] country-bboxes.json missing:', e.message); return {}; }
})();
const COUNTRY_PAD = 0.75;   // degrees of slack around each bbox

async function resolveCountryFromPoints(points) {
  const sample = points.slice(0, 50);
  const cx = sample.reduce((s, p) => s + p[0], 0) / sample.length;
  const cy = sample.reduce((s, p) => s + p[1], 0) / sample.length;
  const candidates = Object.entries(COUNTRY_BBOXES)
    .filter(([, b]) => cx >= b[0] - COUNTRY_PAD && cx <= b[2] + COUNTRY_PAD &&
                       cy >= b[1] - COUNTRY_PAD && cy <= b[3] + COUNTRY_PAD)
    .sort((a, b) => ((a[1][2] - a[1][0]) * (a[1][3] - a[1][1])) - ((b[1][2] - b[1][0]) * (b[1][3] - b[1][1])))
    .slice(0, 5)
    .map(([iso3]) => iso3);
  let best = null;
  for (const iso3 of candidates) {
    let doc; try { doc = await loadAdmin(iso3, 1); } catch { continue; }
    const feats = doc.features || [];
    let inside = 0;
    for (const [x, y] of sample) {
      if (feats.some((f) => f.bbox && x >= f.bbox[0] && x <= f.bbox[2] && y >= f.bbox[1] && y <= f.bbox[3] && pointInGeom(x, y, f.geometry))) inside++;
    }
    const coverage = inside / sample.length;
    if (!best || coverage > best.coverage) best = { iso3, coverage };
    if (coverage >= 0.9) break;   // confident — skip the remaining candidates
  }
  return best && best.coverage >= 0.5 ? best.iso3 : null;
}

// Immediate parents (level-1 up) of the inferred units — lets the wizard's
// geography step fetch just the relevant slice instead of the whole country.
async function parentUnitsOf(iso3, level, units) {
  if (level <= 1) return [];
  let doc; try { doc = await loadAdmin(iso3, level - 1); } catch { return []; }
  const parents = new Map();
  for (const u of units) {
    const c = u.geometry ? centroidOf(u.geometry)
      : (u.bbox ? [(u.bbox[0] + u.bbox[2]) / 2, (u.bbox[1] + u.bbox[3]) / 2] : null);
    if (!c) continue;
    const hit = (doc.features || []).find((f) =>
      f.bbox && c[0] >= f.bbox[0] && c[0] <= f.bbox[2] && c[1] >= f.bbox[1] && c[1] <= f.bbox[3] && pointInGeom(c[0], c[1], f.geometry));
    if (hit && !parents.has(hit.properties.id)) parents.set(hit.properties.id, { id: hit.properties.id, name: hit.properties.name, bbox: hit.bbox });
  }
  return [...parents.values()];
}

// The full chain of containers above the inferred units, one entry per level
// (level 1 .. level-1). parentUnitsOf only reaches one level up, which leaves
// the wizard's breadcrumb missing rungs — an ADM3 region would offer no way
// back to its state. Each entry is clickable in the trail.
async function ancestorChainOf(iso3, level, units) {
  const chain = [];
  for (let L = 1; L < level; L++) {
    let doc; try { doc = await loadAdmin(iso3, L); } catch { continue; }
    const seen = new Map();
    for (const u of units) {
      const c = u.geometry ? centroidOf(u.geometry)
        : (u.bbox ? [(u.bbox[0] + u.bbox[2]) / 2, (u.bbox[1] + u.bbox[3]) / 2] : null);
      if (!c) continue;
      const hit = (doc.features || []).find((f) =>
        f.bbox && c[0] >= f.bbox[0] && c[0] <= f.bbox[2] && c[1] >= f.bbox[1] && c[1] <= f.bbox[3] && pointInGeom(c[0], c[1], f.geometry));
      if (hit && !seen.has(hit.properties.id)) seen.set(hit.properties.id, { id: hit.properties.id, name: hit.properties.name, bbox: hit.bbox });
    }
    if (seen.size) chain.push({ level: L, units: [...seen.values()] });
  }
  return chain;
}


/* ================= slug ================= */

router.get('/slug-check', (req, res) => {
  const slug = String(req.query.slug || '');
  res.json({
    slug,
    valid: reg.validSlug(slug),
    available: reg.slugAvailable(slug, DATASETS_ROOT) && !fs.existsSync(path.join(PRIVATE_ROOT, slug)),
  });
});

/* ================= instance creation ================= */

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown';
}
function cap(str, n) {
  return String(str || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
}
function siteBase(req) {
  if (process.env.ATLAS_PUBLIC_BASE) return process.env.ATLAS_PUBLIC_BASE.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8181';
  const proto = req.headers['x-forwarded-proto'] ||
    (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
function validLogo(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 200 * 1024) return null;
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) return null;
  return dataUrl;
}

router.post('/instances', async (req, res) => {
  const b = req.body || {};
  const session = auth.sessionFromReq(req);
  const ip = clientIp(req);

  // Building an atlas requires a verified email (owner decision, 2026-07-30):
  // the signed-in account IS the owner and the contact, so there's no separate
  // contact field and no anonymous instances to reconcile later.
  if (!session && !auth.isAdmin(req)) {
    return res.status(401).json({ error: 'sign in to build an atlas', needsAuth: true });
  }

  // limits first
  if (reg.instanceCount() >= MAX_INSTANCES) {
    return res.status(429).json({ error: 'instance limit reached — contact us to raise it' });
  }
  if (reg.countByIpSince(ip, Date.now() - 24 * 3600 * 1000) >= PER_IP_PER_DAY) {
    return res.status(429).json({ error: 'daily creation limit reached — try again tomorrow' });
  }

  // fields
  const title = cap(b.title, 80);
  const subtitle = cap(b.subtitle, 160);
  const about = cap(b.about, 500);
  const org = cap(b.org, 60);
  // the signed-in account is the owner and the contact (admin token may pass one)
  const email = reg.normEmail(session ? session.email : b.email);
  const visibility = b.visibility === 'private' ? 'private' : 'public';
  if (!title) return res.status(400).json({ error: 'give your atlas a title' });
  if (!org) return res.status(400).json({ error: 'add the organisation or project this atlas belongs to' });

  const branding = {
    orgName: cap(b.branding && b.branding.orgName, 60) || org,
    orgUrl: /^https:\/\/[^\s]+$/.test((b.branding && b.branding.orgUrl) || '') ? b.branding.orgUrl.slice(0, 200) : '',
    footerLine: cap(b.branding && b.branding.footerLine, 160),
    logoData: validLogo(b.branding && b.branding.logoData),
  };

  // region
  const r = b.region || {};
  const iso3 = String(r.iso3 || '').toUpperCase();
  const level = Number(r.level) || 1;
  const shapeIDs = Array.isArray(r.shapeIDs) ? r.shapeIDs.map(String).slice(0, 100) : [];
  if (!/^[A-Z]{3}$/.test(iso3) || !shapeIDs.length) {
    return res.status(400).json({ error: 'region (iso3 + shapeIDs) is required' });
  }
  let regionDoc;
  try {
    regionDoc = await loadAdmin(iso3, level);
  } catch (e) {
    return res.status(502).json({ error: 'boundary source unavailable: ' + e.message });
  }
  const picked = regionDoc.features.filter((f) => shapeIDs.includes(f.properties.id));
  if (!picked.length) return res.status(400).json({ error: 'no matching boundary units' });
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of picked) {
    w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]);
    e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]);
  }
  const areaDeg2 = (e - w) * (n - s);
  if (areaDeg2 > HARD_AREA_DEG2) {
    return res.status(400).json({
      error: 'That region is larger than a single atlas can cover right now — open a unit on the map and pick smaller areas inside it.',
      tooLarge: true,
    });
  }
  // Bigger than the free tier → same approval pipeline as heavy layers.
  const largeRegion = areaDeg2 > FREE_AREA_DEG2;
  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  // tier + layers
  const tier = tierOf(iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : []).filter((id) => allowed.has(id));
  for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  if (!layerIds.length) return res.status(400).json({ error: 'no valid layers chosen' });

  // Slug: derived from the title, never asked for. Uniqueness is the server's
  // job — two atlases may legitimately share a title, so a taken address gets a
  // numeric suffix rather than an error the user can't act on. A caller that
  // pins an explicit slug still gets the strict 409.
  const slugTaken = (s) => !reg.slugAvailable(s, DATASETS_ROOT) || fs.existsSync(path.join(PRIVATE_ROOT, s));
  /* A build that died still holds its address, so a second attempt at
     "Kolkatta" became "kolkatta-2" for a name nobody else wanted. Take the
     address back when — and only when — it belongs to this same person's
     own failed atlas, one that published nothing and left no files behind. */
  const reclaimable = (s) => {
    const prev = reg.getInstance(s);
    if (!prev || prev.status !== 'failed' || prev.publishedAt) return false;
    if (fs.existsSync(path.join(DATASETS_ROOT, s))) return false;
    if (fs.existsSync(path.join(PRIVATE_ROOT, s))) return false;
    return callerRole(req, prev) === 'owner';
  };
  let slug;
  if (b.slug) {
    slug = String(b.slug);
    if (slugTaken(slug)) return res.status(409).json({ error: 'slug unavailable', slug });
  } else {
    const base = reg.validSlug(reg.slugify(`${title}`)) ? reg.slugify(`${title}`) : 'atlas';
    slug = (!slugTaken(base) || reclaimable(base)) ? base : null;
    for (let n = 2; !slug && n <= 99; n++) {
      const cand = (base + '-' + n).slice(0, 40);
      if (!slugTaken(cand) || reclaimable(cand)) slug = cand;
    }
    if (!slug) return res.status(409).json({ error: 'couldn’t find a free web address for that title — try a different one' });
  }

  // cost gate: heavy layers OR a large region both go through admin approval
  const approvalLayers = layerIds.filter((id) => allowed.get(id).cost === 'approval');
  const approvalReasons = [];
  if (approvalLayers.length) approvalReasons.push(`heavy layers: ${approvalLayers.join(', ')}`);
  if (largeRegion) approvalReasons.push(`large region: ${regionLabel} (~${Math.round(areaDeg2 * 12300).toLocaleString('en-IN')} km²)`);
  const needsApproval = approvalReasons.length > 0;
  if (needsApproval && !reg.validEmail(email)) {
    return res.status(400).json({ error: 'this build needs a quick approval from the LOKA team — add a contact email so we can reach you', needsEmail: true });
  }

  const editToken = reg.newToken();
  const viewKey = visibility === 'private' ? reg.newToken() : null;

  const spec = {
    slug, visibility, tier, title, subtitle, about, branding,
    region: {
      iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n],
      simplifiedFile: path.join(GEOCACHE_DIR, `${iso3}-ADM${level}.json`),
      fullResUrl: regionDoc.fullResUrl,
    },
    layers: layerIds,
  };

  reg.createInstance({
    slug, title, subtitle, about, org, email: email || null, branding: { ...branding, logoData: undefined, hasLogo: !!branding.logoData },
    ownerAccount: session ? session.email : null,
    tier, region: { iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n], areaDeg2 }, regionLabel,
    layers: layerIds, visibility,
    tokenHash: reg.hashToken(editToken),
    viewKeyHash: viewKey ? reg.hashToken(viewKey) : null,
    status: needsApproval ? 'pending-approval' : 'building',
    createdAt: Date.now(), publishedAt: null, sizeBytes: 0, createdByIp: ip,
    jobId: null, spec,
  });
  if (session) reg.bindInstance(session.email, slug);

  let jobId = null;
  if (needsApproval) {
    const base = siteBase(req);
    const approve = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'approve')}`;
    const deny = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'deny')}`;
    await sendMail({
      to: ADMIN_EMAIL,
      subject: `[LOKA Atlas] approval needed: ${title} (${slug})`,
      text: `New atlas needs approval (${approvalReasons.join('; ')}).\n\n` +
        `Org: ${org || '—'}\nContact: ${email}\nRegion: ${regionLabel} (${iso3}, ${areaDeg2.toFixed(1)} deg²)\n` +
        `Layers: ${layerIds.join(', ')}\nVisibility: ${visibility}\n\n` +
        `Approve: ${approve}\nDeny:    ${deny}\n`,
    });
  } else {
    jobId = enqueueBuild(spec);
    reg.updateInstance(slug, { jobId });
  }

  res.json({
    slug, jobId, status: needsApproval ? 'pending-approval' : 'building',
    editToken, viewKey: viewKey || undefined,
  });
});

/* ================= approval ================= */

router.get('/admin/action', async (req, res) => {
  const p = auth.readActionToken(String(req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This approval link is invalid or has expired.'));
  const inst = reg.getInstance(p.slug);
  if (!inst) return res.status(404).send(page('Not found', 'That atlas no longer exists.'));
  if (inst.status !== 'pending-approval') {
    return res.send(page('Already handled', `“${inst.title}” is already ${inst.status}.`));
  }
  if (p.action === 'approve') {
    const jobId = enqueueBuild(inst.spec);
    reg.updateInstance(p.slug, { status: 'building', jobId });
    if (inst.email) {
      await sendMail({
        to: inst.email,
        subject: `[LOKA Atlas] approved: ${inst.title}`,
        text: `Your atlas “${inst.title}” was approved and is building now.\nCheck progress in the wizard, or view it soon at your atlas link.`,
      });
    }
    return res.send(page('Approved', `“${inst.title}” approved — build queued.`));
  }
  // A denied REBUILD leaves a working atlas exactly as it was — its status, the
  // area it covers and its layers all go back. Only a first build ends "denied".
  if (inst.rebuildPrior) {
    const prior = inst.rebuildPrior;
    reg.updateInstance(p.slug, {
      status: prior.status, region: prior.region,
      regionLabel: prior.regionLabel, layers: prior.layers,
      rebuildPrior: undefined, rebuildKeepPublished: undefined,
    });
    if (inst.email) {
      await sendMail({
        to: inst.email,
        subject: `[LOKA Atlas] not widened: ${inst.title}`,
        text: `"${inst.title}" stays as it is for now — covering more ground wasn't approved this time.\nYour atlas and its data are untouched. Reply to this email if you'd like to talk it through.`,
      });
    }
    return res.send(page('Left as it was', `"${inst.title}" keeps its current map.`));
  }
  reg.updateInstance(p.slug, { status: 'denied' });
  if (inst.email) {
    await sendMail({
      to: inst.email,
      subject: `[LOKA Atlas] not approved: ${inst.title}`,
      text: `Your atlas “${inst.title}” wasn't approved this time. Reply to this email if you'd like to talk it through.`,
    });
  }
  res.send(page('Denied', `“${inst.title}” denied.`));
});

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title} — LOKA Atlas</title>` +
    `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#2B2723;background:#E6E4DF">` +
    `<h2>${title}</h2><p>${body}</p></body>`;
}

/* ================= admin: the operator's read-only overview ================= */

// Every atlas across every account — public, private, unpublished — for the
// dashboard at /apps/atlas/admin/. Two ways in: the Bearer admin token
// (auth.isAdmin) or a signed-in session whose email is the operator's
// (auth.isAdminSession). Deliberately READ-ONLY: it projects safe fields —
// never tokenHash, viewKeyHash, createdByIp or the build spec, the same
// discipline as collabList() — and it grants no powers anywhere else: acting
// on an atlas still goes through the owner/editor checks above.
router.get('/admin/instances', (req, res) => {
  if (!auth.isAdmin(req) && !auth.isAdminSession(req)) {
    // 401 for the signed-out (signing in could fix it), 403 for anyone else
    const signedIn = !!auth.sessionFromReq(req);
    return res.status(signedIn ? 403 : 401)
      .json({ error: 'operator only', needsAuth: !signedIn });
  }
  res.setHeader('Cache-Control', 'no-store');
  const instances = reg.allInstances().map((i) => ({
    slug: i.slug,
    title: i.title || '',
    org: i.org || '',
    email: i.email || '',
    ownerAccount: i.ownerAccount || '',
    regionLabel: i.regionLabel || '',
    visibility: i.visibility || 'public',
    status: i.status || '',
    layerCount: Array.isArray(i.layers) ? i.layers.length : 0,
    collaboratorCount: Array.isArray(i.collaborators) ? i.collaborators.length : 0,
    sizeBytes: Number(i.sizeBytes) || 0,
    createdAt: i.createdAt || null,
    publishedAt: i.publishedAt || null,
  }));
  res.json({ instances });
});

/* ================= jobs ================= */

/* A build that died with the process leaves its atlas saying "building" for
   ever: the watcher that would have put it right went down with it. An atlas
   stuck there can be neither opened, resumed, nor deleted — it is simply
   stranded, and the person who was building it has no way out. So the first
   thing this router does on boot is put those atlases back.

   A rebuild of a LIVE atlas is the exception worth keeping: the build only
   swaps the data on success, so the published atlas was never touched and
   should stay published. */
setStrandedBuildHook((job) => {
  const inst = reg.getInstance(job.slug);
  if (!inst || inst.status !== 'building') return;
  const keepPublished = !!inst.rebuildKeepPublished;
  reg.updateInstance(job.slug, keepPublished
    ? { status: 'published', failReason: job.message, rebuildKeepPublished: undefined }
    : { status: 'failed', failReason: job.message });
  console.warn(`[atlas] ${job.slug} was left mid-build by a restart — put back to ` +
    (keepPublished ? 'published' : 'failed') + ' so it can be opened or removed');
});

setJobDoneHook((job) => {
  const inst = reg.getInstance(job.slug);
  if (!inst) return;
  const keepPublished = inst.rebuildKeepPublished; // set when rebuilding an already-published atlas
  if (job.status === 'done') {
    reg.updateInstance(job.slug, {
      status: keepPublished ? 'published' : 'built',
      sizeBytes: job.sizeBytes || 0, builtAt: Date.now(), rebuildKeepPublished: undefined,
    });
  } else if (keepPublished) {
    // a published rebuild failed — the build only swaps on success, so the old
    // dataset is untouched and still live; keep it published.
    reg.updateInstance(job.slug, { status: 'published', failReason: job.message, rebuildKeepPublished: undefined });
  } else {
    reg.updateInstance(job.slug, { status: 'failed', failReason: job.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  const j = getJob(String(req.params.id));
  if (!j) return res.status(404).json({ error: 'unknown job' });
  res.json(j);
});

/* ================= instances: read, publish, claim, delete ================= */

// Roles: 'owner' (full control: delete, manage collaborators) or 'editor'
// (an invited collaborator — may edit details/region/layers and add data).
// The edit token and the admin token both act as the owner.
function callerRole(req, inst) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && reg.hashToken(bearer) === inst.tokenHash) return 'owner';
  if (auth.isAdmin(req)) return 'owner';
  const session = auth.sessionFromReq(req);
  if (session) {
    if (inst.ownerAccount && session.email === inst.ownerAccount) return 'owner';
    if (reg.isCollaborator(inst, session.email)) return 'editor';
  }
  return null;
}
function callerCanEdit(req, inst) { return callerRole(req, inst) !== null; }

router.get('/instances', (_req, res) => {
  res.json({ instances: reg.listPublic() });
});

router.get('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const role = callerRole(req, inst);
  if (role) {
    const { tokenHash, viewKeyHash, spec, ...rest } = inst;
    return res.json({ ...rest, canEdit: true, role });
  }
  if (inst.status === 'published' && inst.visibility === 'public') {
    return res.json(reg.publicFields(inst));
  }
  res.status(404).json({ error: 'not found' });
});

// Publishing requires a signed-in account (owner decision: anonymous create &
// build stay friction-free, but a published atlas must be attached to an email
// so it stays manageable and reachable). The instance is bound to the account.
router.post('/instances/:slug/publish', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const session = auth.sessionFromReq(req);
  if (!session && !auth.isAdmin(req)) {
    return res.status(401).json({ error: 'publishing needs a verified email — sign in first', needsAuth: true });
  }
  if (inst.status === 'published') return res.json({ ok: true, already: true });
  if (inst.status !== 'built') return res.status(409).json({ error: `cannot publish while ${inst.status}` });
  if (session) {
    reg.bindInstance(session.email, inst.slug);
    if (!inst.email) reg.updateInstance(inst.slug, { email: session.email });
  }
  reg.updateInstance(inst.slug, { status: 'published', publishedAt: Date.now() });
  res.json({ ok: true });
});

// The way back. Publishing was one-way, which made "live" a decision you could
// only ever take once — and the editor states it as a thing you hold, so it has
// to be a thing you can put down. Unpublishing returns the atlas to `built`:
// the data stays exactly where it is, it simply stops being listed and stops
// answering to people who were not invited.
router.post('/instances/:slug/unpublish', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  // deliberately owner-only: a collaborator can edit an atlas but should not be
  // able to take it off the air for everyone else
  if (callerRole(req, inst) !== 'owner') {
    return res.status(403).json({ error: 'only the owner can take this atlas off the air' });
  }
  if (inst.status !== 'published') return res.json({ ok: true, already: true, status: inst.status });
  reg.updateInstance(inst.slug, { status: 'built', publishedAt: null });
  res.json({ ok: true, status: 'built' });
});

// Email the edit token to its owner — proves possession of the token first,
// so this can't be used to phish tokens for someone else's atlas.
router.post('/instances/:slug/email-token', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer || reg.hashToken(bearer) !== inst.tokenHash) {
    return res.status(403).json({ error: 'edit token required' });
  }
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (linkRate.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'too many emails — try later' });
  hits.push(now);
  linkRate.set(ip, hits);

  const link = inst.visibility === 'private'
    ? `(private atlas — use the view link from the wizard)`
    : `${siteBase(req)}/apps/atlas/a/${inst.slug}`;
  const result = await sendMail({
    to: email,
    subject: `[LOKA Atlas] your edit token for “${inst.title}”`,
    text: `Your atlas: ${inst.title}\nLink: ${link}\n\n` +
      `Edit token (keep it safe — it's the only way to manage this atlas):\n${bearer}\n\n` +
      `Use it to add data layers, publish changes, or delete the atlas.\n`,
  });
  if (!inst.email) reg.updateInstance(inst.slug, { email });
  res.json({ ok: true, sent: !!result.sent, via: result.via || 'log' });
});

router.post('/instances/:slug/claim', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'sign in first', needsAuth: true });
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const tok = (req.body && req.body.editToken) || '';
  if (reg.hashToken(tok) !== inst.tokenHash) return res.status(403).json({ error: 'wrong edit token' });
  reg.bindInstance(session.email, inst.slug);
  res.json({ ok: true });
});

/* ---------- edit: details (no rebuild) + rebuild (layers/region) ---------- */

function datasetDirFor(inst) {
  const root = inst.visibility === 'private' ? PRIVATE_ROOT : DATASETS_ROOT;
  return path.join(root, inst.slug);
}

// Keep the viewer's manifest.json in step with edited details — the viewer reads
// title/subtitle/about/branding from there, not from the registry.
function rewriteManifest(inst) {
  const mf = path.join(datasetDirFor(inst), 'manifest.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { return false; }
  m.title = inst.title;
  m.subtitle = inst.subtitle || '';
  m.about = inst.about || '';
  const b = inst.branding || {};
  const bset = {};
  if (b.orgName) bset.orgName = b.orgName;
  if (b.orgUrl) bset.orgUrl = b.orgUrl;
  if (b.footerLine) bset.footerLine = b.footerLine;
  if (b.hasLogo) bset.logo = 'branding-logo.png';
  if (Object.keys(bset).length) m.branding = bset; else delete m.branding;
  try {
    const tmp = mf + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m, null, 1));
    fs.renameSync(tmp, mf);
    return true;
  } catch { return false; }
}

// Fast edit — text, branding, logo and public/private — with no rebuild.
router.post('/instances/:slug/details', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const b = req.body || {};
  const session = auth.sessionFromReq(req);
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const curB = inst.branding || {};

  // Fields absent from the body are preserved (so a partial call can't wipe them);
  // the wizard always sends the full form, so it behaves as a straight edit.
  const title = has('title') ? cap(b.title, 80) : inst.title;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const org = has('org') ? cap(b.org, 60) : (inst.org || '');
  const bb = has('branding') ? (b.branding || {}) : {};
  const hasB = (k) => has('branding') && Object.prototype.hasOwnProperty.call(bb, k);
  const branding = {
    orgName: hasB('orgName') ? (cap(bb.orgName, 60) || org) : (curB.orgName || org),
    orgUrl: hasB('orgUrl') ? (/^https:\/\/[^\s]+$/.test(bb.orgUrl || '') ? String(bb.orgUrl).slice(0, 200) : '') : (curB.orgUrl || ''),
    footerLine: hasB('footerLine') ? cap(bb.footerLine, 160) : (curB.footerLine || ''),
    hasLogo: !!curB.hasLogo,
  };

  const patch = {
    title,
    subtitle: has('subtitle') ? cap(b.subtitle, 160) : (inst.subtitle || ''),
    about: has('about') ? cap(b.about, 500) : (inst.about || ''),
    email: has('email') && b.email ? cap(b.email, 120) : inst.email,
    org, branding,
  };

  // logo add / replace / remove (written straight into the current dataset dir)
  const curDir = datasetDirFor(inst);
  if (bb.removeLogo) {
    try { fs.rmSync(path.join(curDir, 'branding-logo.png'), { force: true }); } catch { /* ignore */ }
    branding.hasLogo = false;
  } else if (bb.logoData) {
    const valid = validLogo(bb.logoData);
    if (!valid) return res.status(400).json({ error: 'logo must be a PNG under 200 KB' });
    try {
      fs.writeFileSync(path.join(curDir, 'branding-logo.png'), Buffer.from(valid.split(',')[1], 'base64'));
      branding.hasLogo = true;
    } catch { return res.status(500).json({ error: 'could not save the logo' }); }
  }

  // visibility change moves the dataset between the web root and the private root
  let viewKey;
  const newVis = b.visibility === 'private' ? 'private' : b.visibility === 'public' ? 'public' : inst.visibility;
  if (newVis !== inst.visibility) {
    if (newVis === 'private' && !session) return res.status(401).json({ error: 'making an atlas private needs a verified email', needsAuth: true });
    const fromDir = datasetDirFor(inst);
    const toRoot = newVis === 'private' ? PRIVATE_ROOT : DATASETS_ROOT;
    const toDir = path.join(toRoot, inst.slug);
    try {
      fs.mkdirSync(toRoot, { recursive: true });
      if (fs.existsSync(fromDir)) fs.renameSync(fromDir, toDir);
    } catch { return res.status(500).json({ error: 'could not change who can see this atlas' }); }
    patch.visibility = newVis;
    if (newVis === 'private') { viewKey = reg.newToken(); patch.viewKeyHash = reg.hashToken(viewKey); }
    else patch.viewKeyHash = null;
  }

  const updated = reg.updateInstance(inst.slug, patch);
  rewriteManifest(updated);
  res.json({ ok: true, visibility: updated.visibility, viewKey: viewKey || undefined });
});

// Rebuild — change layers and/or region, then rebuild into the same slug. The
// build swaps the dataset atomically on success, so a published atlas has no
// downtime; a published atlas stays published (see the job-done hook).
router.post('/instances/:slug/rebuild', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    return res.status(409).json({ error: 'a build is already running for this atlas' });
  }
  const b = req.body || {};
  const r = b.region;
  const useR = (r && r.iso3 && Array.isArray(r.shapeIDs) && r.shapeIDs.length)
    ? { iso3: String(r.iso3).toUpperCase(), level: Number(r.level) || 1, shapeIDs: r.shapeIDs.map(String).slice(0, 100) }
    : { iso3: inst.region.iso3, level: inst.region.level, shapeIDs: inst.region.shapeIDs };
  if (!/^[A-Z]{3}$/.test(useR.iso3) || !useR.shapeIDs.length) return res.status(400).json({ error: 'region is required' });

  let regionDoc;
  try { regionDoc = await loadAdmin(useR.iso3, useR.level); } catch (e) { return res.status(502).json({ error: 'boundary source unavailable: ' + e.message }); }
  const picked = regionDoc.features.filter((f) => useR.shapeIDs.includes(f.properties.id));
  if (!picked.length) return res.status(400).json({ error: 'no matching boundary units' });
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of picked) { w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]); e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]); }
  const bbox = [w, s, e, n];
  const areaDeg2 = (e - w) * (n - s);
  if (areaDeg2 > HARD_AREA_DEG2) return res.status(400).json({ error: 'That region is larger than a single atlas can cover.', tooLarge: true });

  const tier = tierOf(useR.iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : inst.layers).filter((id) => allowed.has(id));
  for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  if (!layerIds.length) return res.status(400).json({ error: 'pick at least one layer' });

  // A rebuild that crosses into approval territory used to be refused outright
  // with "email us" — a dead end for the case that most needs it: widening an
  // atlas to cover data that turned out to sit outside it. It now enters the same
  // queue a first build uses. The live atlas keeps serving its existing files
  // throughout, because a build only swaps them on success.
  const heavy = layerIds.some((id) => allowed.get(id).cost === 'approval');
  const needsApproval = heavy || areaDeg2 > FREE_AREA_DEG2;

  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  // preserve org branding + logo across the rebuild (read the current logo back
  // into the spec so the builder re-emits it)
  const branding = { orgName: inst.branding && inst.branding.orgName, orgUrl: inst.branding && inst.branding.orgUrl, footerLine: inst.branding && inst.branding.footerLine };
  const logoPath = path.join(datasetDirFor(inst), 'branding-logo.png');
  if (inst.branding && inst.branding.hasLogo && fs.existsSync(logoPath)) {
    try { branding.logoData = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64'); } catch { /* ignore */ }
  }

  const spec = {
    slug: inst.slug, visibility: inst.visibility, tier,
    title: inst.title, subtitle: inst.subtitle, about: inst.about, branding,
    region: {
      iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox,
      simplifiedFile: path.join(GEOCACHE_DIR, `${useR.iso3}-ADM${useR.level}.json`),
      fullResUrl: regionDoc.fullResUrl,
    },
    layers: layerIds,
  };

  const wasPublished = inst.status === 'published';
  reg.updateInstance(inst.slug, {
    tier, region: { iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox, areaDeg2 },
    regionLabel, layers: layerIds, spec,
    rebuildKeepPublished: wasPublished || undefined,
    // The new region is recorded now so an approval needs no extra bookkeeping —
    // but that makes the record describe an area the built files do not cover yet,
    // so the whole prior state is kept and a denial puts every bit of it back.
    rebuildPrior: needsApproval
      ? { status: inst.status, region: inst.region, regionLabel: inst.regionLabel, layers: inst.layers }
      : undefined,
    status: needsApproval ? 'pending-approval' : (wasPublished ? 'published' : 'building'),
  });

  if (needsApproval) {
    const base = siteBase(req);
    const approve = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(inst.slug, 'approve')}`;
    const deny = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(inst.slug, 'deny')}`;
    const why = [];
    if (heavy) why.push('heavy layers');
    if (areaDeg2 > FREE_AREA_DEG2) {
      why.push(`large region: ${regionLabel} (~${Math.round(areaDeg2 * 12300).toLocaleString('en-IN')} km2)`);
    }
    await sendMail({
      to: ADMIN_EMAIL,
      subject: `[LOKA Atlas] widen request: ${inst.title}`,
      text: `"${inst.title}" (${inst.slug}) asks to cover more ground.\n\n`
        + `Reason: ${why.join('; ')}\nWould cover: ${regionLabel}\n\n`
        + `Approve: ${approve}\nDeny:    ${deny}\n\n`
        + `The atlas keeps serving its current map until this is approved.`,
    });
    return res.json({
      ok: true, pendingApproval: true, slug: inst.slug, regionLabel,
      message: 'That covers a lot of ground, so the LOKA team takes a quick look first — '
        + 'usually within a day. Your atlas carries on exactly as it is until then, and '
        + 'your data stays where it is.',
    });
  }

  const jobId = enqueueBuild(spec);
  reg.updateInstance(inst.slug, { jobId });
  res.json({ ok: true, jobId, slug: inst.slug, wasPublished });
});

router.delete('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can delete this atlas' });
  for (const root of [DATASETS_ROOT, PRIVATE_ROOT]) {
    const dir = path.join(root, inst.slug);
    if (dir.startsWith(root) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  reg.deleteInstance(inst.slug);
  res.json({ ok: true });
});

/* ================= collaborators (owner invites editors by email) =================
   Use case: several orgs working one geography pool their data on a single atlas.
   Editors get the full edit flow (details, region, layers, add-data) but cannot
   delete the atlas or manage collaborators. */

const MAX_COLLABORATORS = 20;

function collabList(inst) {
  return (inst.collaborators || []).map((c) => ({
    email: c.email, invitedAt: c.invitedAt, acceptedAt: c.acceptedAt || null,
  }));
}

router.post('/instances/:slug/collaborators', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can invite collaborators' });
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  if (inst.ownerAccount && email === inst.ownerAccount) return res.status(400).json({ error: 'that email already owns this atlas' });
  if ((inst.collaborators || []).length >= MAX_COLLABORATORS) {
    return res.status(400).json({ error: `collaborator limit reached (${MAX_COLLABORATORS})` });
  }
  const c = reg.addCollaborator(inst.slug, email);
  const invitedBy = inst.ownerAccount || inst.email || 'the atlas owner';
  const result = await sendMail({
    to: email,
    subject: `You're invited to contribute to “${inst.title}” — LOKA Atlas`,
    text:
      `${invitedBy} invited you to contribute to “${inst.title}”` +
      (inst.regionLabel ? ` (${inst.regionLabel})` : '') + ` on LOKA Atlas.\n\n` +
      `As a collaborator you can edit the atlas and add your organisation's data layers.\n\n` +
      `To get started:\n` +
      `1. Open ${siteBase(req)}/apps/atlas/setup/\n` +
      `2. Sign in with this email address — we'll send you a 6-digit code.\n` +
      `3. “${inst.title}” will appear under Your atlases.\n\n` +
      `If you weren't expecting this, you can ignore this email.\n`,
  });
  res.json({ ok: true, collaborator: { email: c.email, invitedAt: c.invitedAt, acceptedAt: c.acceptedAt || null }, sent: !!result.sent, collaborators: collabList(inst) });
});

router.delete('/instances/:slug/collaborators', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can remove collaborators' });
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  reg.removeCollaborator(inst.slug, email);
  res.json({ ok: true, collaborators: collabList(inst) });
});

/* ================= auth (magic links) ================= */

const linkRate = new Map(); // ip -> [timestamps]
router.post('/auth/request-link', async (req, res) => {
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (linkRate.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'too many link requests — try later' });
  hits.push(now);
  linkRate.set(ip, hits);

  reg.upsertAccount(email);
  const otp = auth.makeOtp(email);
  const result = await sendMail({
    to: email,
    subject: `${otp} is your LOKA Atlas sign-in code`,
    text: `Your sign-in code is:\n\n    ${otp}\n\nType it into the LOKA Atlas sign-in box. It works once and expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
  });
  res.json({ ok: true, sent: !!result.sent, via: result.via || 'log' });
});

// The 6-digit code from the email, typed straight into the wizard — no link,
// no tab-switching. Sets the session cookie on this same tab.
router.post('/auth/verify-code', (req, res) => {
  const email = reg.normEmail(req.body && req.body.email);
  const code = String((req.body && req.body.code) || '').trim();
  if (!reg.validEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'email and the 6-digit code are required' });
  }
  if (!auth.verifyOtp(email, code)) {
    return res.status(401).json({ error: 'that code isn’t right or has expired — request a fresh one' });
  }
  reg.markVerified(email);
  reg.acceptInvites(email); // pending collaborator invites become active on first sign-in
  res.setHeader('Set-Cookie', auth.sessionCookie(email));
  res.json({ ok: true, email });
});

router.get('/auth/verify', (req, res) => {
  const p = auth.readLoginToken(String(req.query.t || req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This sign-in link is invalid or has already been used. Request a fresh one from the wizard.'));
  reg.markVerified(p.email);
  reg.acceptInvites(p.email);
  res.setHeader('Set-Cookie', auth.sessionCookie(p.email));
  // No redirect: the wizard tab you came from is polling and will continue on its
  // own with your work intact. Redirecting here would open a second, empty wizard.
  res.send(page('Signed in',
    `You're signed in as <b>${p.email}</b>.<br><br>` +
    `Return to the <b>LOKA Atlas</b> tab you were using — your atlas is still there and will continue automatically. You can close this tab.`));
});

router.get('/auth/me', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const acc = reg.getAccount(session.email);
  const instances = (acc ? acc.instances : [])
    .map((slug) => reg.getInstance(slug))
    .filter(Boolean)
    .map((i) => ({
      slug: i.slug, title: i.title, regionLabel: i.regionLabel || '', status: i.status, visibility: i.visibility,
      role: i.ownerAccount === session.email ? 'owner' : 'editor',
    }));
  res.json({
    email: session.email,
    verifiedAt: acc ? acc.verifiedAt : null,
    name: (acc && acc.name) || '',
    org: (acc && acc.org) || '',
    instances,
    drafts: reg.listDrafts(session.email).map((d) => ({ id: d.id, title: d.title || '', updatedAt: d.updatedAt })),
  });
});

// Captured once after the first sign-in: who the person is and which org they
// belong to. Used to credit contributed layers ("Added by <org>").
router.post('/auth/profile', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const name = String((req.body && req.body.name) || '').trim();
  const org = String((req.body && req.body.org) || '').trim();
  if (!name || !org) return res.status(400).json({ error: 'your full name and organisation are both needed' });
  const acc = reg.setProfile(session.email, { name, org });
  res.json({ ok: true, name: acc.name, org: acc.org });
});

router.post('/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  res.json({ ok: true });
});

/* ================= drafts ================= */


/* ================= private dataset serving ================= */

const MIME = {
  '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};
router.get('/datasets/:slug/:file', (req, res) => {
  const folder = String(req.params.slug);
  const file = String(req.params.file);
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(folder)) return res.status(400).json({ error: 'bad path' });
  // A draft preview folder (<slug>--draft-<import>) is read under its PARENT's
  // permission: it has no registry entry of its own, and it exists precisely so
  // the owner can see a proposed layer before committing it.
  const slug = folder.split('--draft-')[0];
  const inst = reg.getInstance(slug);
  if (!inst || inst.visibility !== 'private') return res.status(404).json({ error: 'not found' });

  const key = String(req.query.key || req.headers['x-atlas-key'] || '');
  const keyOk = key && reg.hashToken(key) === inst.viewKeyHash;
  if (!keyOk && !callerCanEdit(req, inst)) return res.status(403).json({ error: 'view key required' });

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file) || file.includes('..')) {
    return res.status(400).json({ error: 'bad path' });
  }
  const full = path.join(PRIVATE_ROOT, folder, file);
  if (!full.startsWith(path.join(PRIVATE_ROOT, folder) + path.sep)) return res.status(400).json({ error: 'bad path' });
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });

  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type(MIME[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

/* ==================================================================
   DATA-TO-LAYER MODULE (the Gemini-assisted import workbench)
   Pipeline: client-parsed table → column profiling (code) → schema
   inference (Gemini, structured output) → transform (code: coordinates
   or admin-name join, Gemini only adjudicates ambiguous matches) →
   whitelist fragment builder (code) → draft dataset preview → commit
   to the manifest.local.json overlay. Gemini never writes manifest JSON.
================================================================== */
import { GoogleGenAI, Type } from '@google/genai';
import { getFlashModel, getFlashLiteModel, getEmbedModel } from '../lib/models.js';
import { profileColumns, bestNameColumn } from '../lib/tabular.js';
import { norm, dice, joinByName, AUTO_ACCEPT } from '../lib/matching.js';
import { PALETTES, PALETTE_ALIASES, MARKER_COLORS, buildFragment, sanitizeFeatures } from '../lib/fragment.js';
import * as imports from '../lib/atlas/imports.js';
import * as enrich from '../lib/atlas/enrich.js';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
imports.sweepImports();
setInterval(imports.sweepImports, 3600 * 1000).unref();

// Admin-hierarchy columns (district/block/…) make poor category colourings even
// when low-cardinality — the map already shows those boundaries.
const ADMINISH_RE = /^(country|state|district|division|block|tehsil|taluk|taluka|mandal|subdistrict|village|gram|panchayat|ward|region)s?([ _-]?name)?$/i;
function pickCategoryColumn(profiles, placeNameCol) {
  return profiles.find((p) => p.categorical && p.name !== placeNameCol && !ADMINISH_RE.test(p.name.trim()));
}

const NAMEISH_RE = /^(name|title|label|place|description|desc|site|spot)s?$/i;
// A human-readable title beats an id/coordinate. Prefer an explicit name/desc
// column, then any short-text name-like column, else the first column.
function pickTitleColumn(profiles, columns) {
  const byName = profiles.find((p) => NAMEISH_RE.test(p.name.trim()) && p.type === 'string');
  if (byName) return byName.name;
  const nameish = profiles.find((p) => p.looksLikeName && !p.looksLikeImage);
  return (nameish && nameish.name) || columns[0];
}
// Popup fields worth showing: skip id-like, coordinates, and the image/title
// columns (handled separately); lead with category + tag-set + descriptive cols.
function pickPopupColumns(profiles, { title, image }) {
  const ok = profiles.filter((p) => {
    if (p.name === title || p.name === image) return false;
    if (p.looksLikeLat || p.looksLikeLng || p.maybeLatIndia || p.maybeLngIndia) return false;
    if (p.looksLikeImage) return false;
    if (p.type === 'string' && p.distinct === p.filled && p.filled > 20 && !p.multiValue) return false; // id-like
    return true;
  });
  const rank = (p) => (p.categorical ? 0 : p.tagList ? 1 : p.type !== 'string' ? 2 : 3);
  return ok.sort((a, b) => rank(a) - rank(b)).slice(0, 5).map((p) => p.name);
}

// Every import route mutates disk (sessions, draft folders) — owner/editor only.
// Datasets without a registry entry (hand-built ones like deoria) are admin-only.
function requireDatasetEditor(req, res, datasetId) {
  const inst = reg.getInstance(datasetId);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) {
    res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
    return null;
  }
  return role;
}

const MAX_ROWS = 5000, MAX_COLS = 40;
const geminiRate = new Map();
/* One request used to buy a single token at the door and then spend it as often
   as it liked. The reading's filing step calls the model once per 40 rows, so a
   5,000-row reading was 126 calls charged as one — about 3,780 calls an hour
   from one address, and an address can be changed by moving networks.

   Two things fix it. The budget is spent per CALL, inside the loop, so 126 calls
   costs 126. And it is charged to the signed-in account where there is one,
   because an account cannot be rotated the way an address can. An address is
   still the fallback, and a stricter one, since it may stand for a whole office. */
const AI_CALLS_PER_HOUR = 150;      // per signed-in account
const AI_CALLS_PER_HOUR_IP = 40;    // per address, when nobody is signed in
const AI_CALLS_PER_READING = 24;    // one reading may not exceed this

function aiWho(req) {
  const session = auth.sessionFromReq(req);
  if (session && session.email) return { key: 'acct:' + session.email, cap: AI_CALLS_PER_HOUR };
  return { key: 'ip:' + clientIp(req), cap: AI_CALLS_PER_HOUR_IP };
}

// take one call from this hour's budget; false when there is none left
function aiTake(req) {
  const who = aiWho(req);
  const now = Date.now();
  const hits = (geminiRate.get(who.key) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= who.cap) return false;
  hits.push(now);
  geminiRate.set(who.key, hits);
  return true;
}

/* A caller that pays its own way. Refusing by throwing is deliberate: every
   place that uses it already treats a failed call as "no model for this batch"
   and falls back to deterministic filing, so running out of budget degrades a
   reading instead of breaking it, and never invents anything to fill the gap. */
function aiCaller(req, perReading) {
  const cap = perReading || AI_CALLS_PER_READING;
  let spent = 0;
  return function (model, prompt, schema, o) {
    if (spent >= cap) throw new Error('this reading has used its share of the model');
    if (!aiTake(req)) throw new Error('too many readings in the last hour — try again shortly');
    spent += 1;
    if (o && o.think) return geminiJSONDeep(model, prompt, schema);
    if (o && o.file) return geminiJSONFile(model, prompt, schema);
    return geminiJSON(model, prompt, schema);
  };
}

// a single call, budgeted: for the one-shot uses that are not a whole reading
function geminiAllowed(req) { return aiTake(req); }

/* ---------- boundary discovery: joinable polygon layers in the dataset ---------- */

function boundaryOptions(datasetId) {
  const m = imports.readManifest(datasetId);
  if (!m) return { options: [], manifest: null };
  const options = [];
  for (const L of imports.mergedLayers(m)) {
    if (L.type !== 'fill' && L.type !== 'categories') continue;
    if (!L.source || !/\.geojson$/.test(L.source) || L.userLayer) continue;
    try {
      const gj = JSON.parse(fs.readFileSync(path.join(m.dir, L.source), 'utf8'));
      const feats = gj.features || [];
      if (!feats.length) continue;
      const props = feats[0].properties || {};
      const nameProp = 'name' in props ? 'name' : null;
      if (!nameProp) continue;
      const parentProp = 'district' in props ? 'district' : ('state' in props ? 'state' : null);
      const geomOk = /Polygon/.test(feats[0].geometry && feats[0].geometry.type);
      if (!geomOk) continue;
      options.push({
        id: L.id, label: L.label || L.id, source: L.source, group: L.group || '',
        count: feats.length, nameProp, parentProp,
        exampleNames: feats.slice(0, 10).map((f) => String(f.properties[nameProp])),
      });
    } catch {}
  }
  // Plain boundary layers (base group) join better than thematic layers that
  // happen to share the same geometry — offer and default to them first.
  options.sort((a, b) => (a.group === 'base' ? 0 : 1) - (b.group === 'base' ? 0 : 1));
  return { options, manifest: m };
}

// Resolve a boundary option id to its {code,name,parent,geometry} match targets.
// `session` may be a session object (needed for geoBoundaries ids, whose targets
// were materialised to the import side-file at ingest) or a bare dataset id.
function boundaryTargets(session, optionId) {
  const datasetId = typeof session === 'string' ? session : session.dataset;
  if (typeof optionId === 'string' && optionId.startsWith('geo:') && typeof session === 'object') {
    const byOpt = imports.readGeoTargets(session.id) || {};
    const entry = byOpt[optionId];
    if (entry && entry.targets) {
      return { opt: { id: optionId, label: entry.label, group: 'geo', count: entry.targets.length }, targets: entry.targets };
    }
    // side file expired — fall through to the dataset's own layers
  }
  if (!datasetId) {
    // pre-build: the only targets are the geoBoundaries units for the region
    const byOpt = imports.readGeoTargets(session.id) || {};
    const first = Object.keys(byOpt)[0];
    if (!first) return null;
    return {
      opt: { id: first, label: byOpt[first].label, group: 'geo', count: byOpt[first].targets.length },
      targets: byOpt[first].targets,
    };
  }
  const { options, manifest } = boundaryOptions(datasetId);
  const opt = options.find((o) => o.id === optionId) || options[0];
  if (!opt || !manifest) return null;
  const gj = JSON.parse(fs.readFileSync(path.join(manifest.dir, opt.source), 'utf8'));
  const targets = (gj.features || []).map((f, i) => ({
    code: String(i),
    name: String(f.properties[opt.nameProp] ?? ''),
    parent: opt.parentProp ? String(f.properties[opt.parentProp] ?? '') : '',
    geometry: f.geometry,
  }));
  return { opt, targets };
}

const LEVEL_NOUN = { 1: 'states / provinces', 2: 'districts', 3: 'sub-districts', 4: 'localities' };
const MAX_GEO_TARGETS = 4000;
function bboxOverlap(a, b) { // [w,s,e,n]
  return !!(a && b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]);
}

// Match targets from geoBoundaries for the atlas's own region, at levels FINER
// than the atlas was built at — so village / locality names the atlas's own
// boundary layers don't carry can still be placed. Fetched once (cached) and
// materialised into the import side-file; returns option metadata + targets.
async function geoBoundaryOptions(region) {
  if (!region || !region.iso3) return [];
  const iso3 = String(region.iso3).toUpperCase();
  const baseLevel = Number(region.level) || 1;
  const rbb = Array.isArray(region.bbox) && region.bbox.length === 4 ? region.bbox : null;
  let avail = null;
  try { avail = JSON.parse(fs.readFileSync(path.join(GEOCACHE_DIR, `${iso3}-levels.json`), 'utf8')).levels; } catch {}
  let parents = null;   // atlas's own level, clipped to the region — for parent disambiguation
  const out = [];
  for (const L of [baseLevel + 1, baseLevel + 2]) {
    if (L > MAX_LEVEL) break;
    if (avail && !avail.includes(L)) continue;
    let doc;
    try { doc = await loadAdmin(iso3, L); } catch { continue; }
    let feats = doc.features || [];
    if (rbb) feats = feats.filter((f) => bboxOverlap(f.bbox, rbb));
    if (feats.length < 2 || feats.length > MAX_GEO_TARGETS) continue;
    if (parents == null) {
      try {
        let pf = (await loadAdmin(iso3, baseLevel)).features;
        parents = rbb ? pf.filter((p) => bboxOverlap(p.bbox, rbb)) : pf;
      } catch { parents = []; }
    }
    const targets = feats.map((f, i) => {
      let parent = '';
      if (parents.length > 1) {   // only worth disambiguating when >1 parent overlaps
        const c = centroidOf(f.geometry);
        const hit = parents.find((p) => bboxOverlap(p.bbox, f.bbox) && pointInGeom(c[0], c[1], p.geometry));
        if (hit) parent = hit.properties.name || '';
      }
      return { code: String(i), name: String(f.properties.name || ''), parent, geometry: f.geometry };
    });
    out.push({
      id: `geo:ADM${L}`, level: L, group: 'geo', count: targets.length,
      label: (LEVEL_NOUN[L] || ('level ' + L)) + ' · geoBoundaries',
      exampleNames: targets.slice(0, 10).map((t) => t.name), targets,
    });
  }
  return out;
}

function centroidOf(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  })(geom.coordinates);
  return [(w + e) / 2, (s + n) / 2];
}

/* ---------- Gemini schemas ---------- */

const LAYER_SPEC_SCHEMA = {
  type: Type.OBJECT,
  required: ['kind', 'label', 'group'],
  properties: {
    kind: { type: Type.STRING, enum: ['markers', 'choropleth', 'line', 'polygon', 'category', 'bubble'] },
    categoryColumn: { type: Type.STRING },
    imageColumn: { type: Type.STRING },
    label: { type: Type.STRING },
    group: { type: Type.STRING, enum: ['base', 'agri', 'eco', 'userdata'] },
    subgroup: { type: Type.STRING },
    valueColumn: { type: Type.STRING },
    unit: { type: Type.STRING },
    palette: { type: Type.STRING, enum: Object.keys(PALETTES) },
    reverse: { type: Type.BOOLEAN },
    classCount: { type: Type.INTEGER },
    markerColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    lineColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    lineWidth: { type: Type.NUMBER },
    lineDash: { type: Type.BOOLEAN },
    fillColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    fillOpacity: { type: Type.NUMBER },
    outline: { type: Type.BOOLEAN },
    popupTitleColumn: { type: Type.STRING },
    popupColumns: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const INFER_SCHEMA = {
  type: Type.OBJECT,
  required: ['rowSubject', 'strategy', 'columns', 'layer'],
  properties: {
    rowSubject: { type: Type.STRING },
    strategy: { type: Type.STRING, enum: ['coordinates', 'adminJoin'] },
    joinLayer: { type: Type.STRING },
    columns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['name', 'role'],
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING, enum: ['placeName', 'adminParent', 'latitude', 'longitude', 'value', 'category', 'id', 'text', 'ignore'] },
        },
      },
    },
    layer: LAYER_SPEC_SCHEMA,
    notes: { type: Type.STRING },
  },
};

const ADJUDICATE_SCHEMA = {
  type: Type.OBJECT,
  required: ['matches'],
  properties: {
    matches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['sourceName', 'chosenCode'],
        properties: {
          sourceName: { type: Type.STRING },
          chosenCode: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const REFINE_SCHEMA = {
  type: Type.OBJECT,
  required: ['layer', 'reply'],
  properties: { layer: LAYER_SPEC_SCHEMA, reply: { type: Type.STRING } },
};

/* The everyday call: reading a spreadsheet's columns to work out where its rows
   belong, and matching transliterated place names against the boundaries on
   offer. Both need a little reasoning, and on 2.5 models the thinking is spent
   out of the same allowance as the answer.

   It had 2,048 tokens for both. Seen live on 3 September 2026: an infer call
   came back cut off after 302 characters, JSON.parse threw, and the wizard
   quietly fell back to its own placement rules without telling anyone. The join
   adjudicator sat on the same ceiling while being asked for up to forty answers
   at once. It is the same fault that made filing fall back to counting, on the
   two paths that fix never reached.

   Room to answer in, and a cut-off answer that says it was cut off. The pinned
   SDK (0.3.1) cannot turn thinking down, but it does report how the answer
   ended, and an answer that stopped early must never again read as a model that
   simply failed. */
async function geminiJSON(model, prompt, schema) {
  const response = await ai.models.generateContent({
    model, contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192 },
  });
  const why = response && response.candidates && response.candidates[0] &&
    response.candidates[0].finishReason;
  if (why && why !== 'STOP') throw new Error('the answer stopped early (' + why + ')');
  return JSON.parse(response.text ?? '');
}

/* Filing places into kinds is not reasoning, and must not be charged as if it
   were. Measured on a real filing call: with thinking left at its default the
   model spent 7,863 tokens thinking and had 314 left to answer in, so the answer
   came back cut in half and unparseable — and every batch fell through to the
   deterministic filing that exists for a failed call. The places were being
   filed WITHOUT being read, and nothing anywhere said so.

   Thinking off, and room to answer in. A batch of 40 places across several
   questions, each with the words that justify it, runs about 3,000 tokens. */
async function geminiJSONFile(model, prompt, schema) {
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens: 24000,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const j = await r.json();
  const cand = j && j.candidates && j.candidates[0];
  if (!cand) throw new Error('no answer from the model');
  // name the truncation, so it can never again look like a model that just failed
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error('the answer stopped early (' + cand.finishReason + ')');
  }
  const text = cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text;
  if (!text) throw new Error('the model answered with nothing');
  return JSON.parse(text);
}

/* Theme-finding's induce call only: the one call that must REASON over the
   whole set of places, so thinking is turned on with an explicit budget. The
   pinned SDK (0.3.1) predates thinking budgets and silently drops the field,
   so this call speaks to the REST API directly. maxOutputTokens rises in
   step because on 2.5 models thought tokens count against it — without the
   headroom the JSON answer would truncate mid-object. */
const INDUCE_THINK_BUDGET = 2048;
async function geminiJSONDeep(model, prompt, schema) {
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: INDUCE_THINK_BUDGET },
        },
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!r.ok) throw new Error('gemini ' + r.status);
  const data = await r.json();
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) throw new Error('no answer from the model');
  // the same guard the filing call carries: thinking and answering share one
  // allowance, so this call can run out of room mid-object too
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new Error('the answer stopped early (' + cand.finishReason + ')');
  }
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  return JSON.parse(text);
}

/* ---------- transform: rows + spec → features ---------- */

function rolesMap(columns) {
  const map = {};
  for (const c of columns || []) map[c.role] = map[c.role] || c.name;
  return map;
}

// The map's bounds: from the built manifest when there is one, otherwise from
// the region the wizard chose (as [[w,s],[e,n]], the manifest's shape).
function sessionBounds(session) {
  if (session.dataset) {
    try {
      const m = imports.readManifest(session.dataset);
      if (m && m.manifest && m.manifest.bounds) return m.manifest.bounds;
    } catch { /* not built yet */ }
  }
  const bb = session.region && session.region.bbox;
  return (bb && bb.length === 4) ? [[bb[0], bb[1]], [bb[2], bb[3]]] : null;
}

function transform(session) {
  const { rows, strategy } = session;
  const roles = rolesMap(session.columns);
  const report = { strategy, matched: 0, unmatched: [], ambiguous: [], outside: 0, total: rows.length };
  let feats = [];

  if (strategy === 'geometry') {
    // spatial track: shapes came with the upload, side-file holds them
    const geoms = imports.readGeoms(session.id);
    if (!geoms) throw new Error('the uploaded geometry expired — start the upload again');
    rows.forEach((r, i) => {
      const gi = session.geomIdx ? session.geomIdx[i] : i;
      const g = gi != null && gi >= 0 ? geoms[gi] : null;
      if (!g) {
        report.unmatched.push({ row: i, name: String(r[roles.placeName] || 'row ' + (i + 1)), reason: 'no geometry' });
        return;
      }
      feats.push({ type: 'Feature', properties: { ...r }, geometry: g });
      report.matched++;
    });
  } else if (strategy === 'coordinates') {
    let latCol = roles.latitude, lngCol = roles.longitude;
    if (!latCol || !lngCol) throw new Error('latitude/longitude columns not set');
    // auto-detect swapped columns
    const lats = rows.map((r) => Number(r[latCol])).filter(Number.isFinite);
    const lngs = rows.map((r) => Number(r[lngCol])).filter(Number.isFinite);
    if (lats.length && lngs.length && Math.max(...lats.map(Math.abs)) > 90 && Math.max(...lngs.map(Math.abs)) <= 90) {
      const t = latCol; latCol = lngCol; lngCol = t;
      report.note = 'latitude/longitude looked swapped — corrected';
    }
    rows.forEach((r, i) => {
      const lat = Number(r[latCol]), lng = Number(r[lngCol]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        report.unmatched.push({ row: i, name: String(r[roles.placeName] || r[latCol] || i), reason: 'bad coordinates' });
        return;
      }
      feats.push({ type: 'Feature', properties: { ...r }, geometry: { type: 'Point', coordinates: [lng, lat] } });
      report.matched++;
    });
  } else {
    const bt = boundaryTargets(session, session.joinLayer);
    if (!bt) throw new Error('no joinable boundary layer in this dataset');
    session.joinLayer = bt.opt.id;
    report.joinLayer = bt.opt.id;
    report.joinLabel = bt.opt.label;
    const nameCol = roles.placeName;
    if (!nameCol) throw new Error('place-name column not set');
    const results = joinByName(rows, nameCol, roles.adminParent || null, bt.targets);
    session.matchState = session.matchState || {};   // row -> code | 'skip' (manual fixes)
    // area kinds keep the joined polygon; point kinds (markers / category /
    // bubble) collapse it to its centroid — one symbol per admin unit
    const joinKind = session.spec && session.spec.kind;
    const wantAreas = joinKind === 'choropleth' || joinKind === 'polygon';
    results.forEach((res) => {
      const manual = session.matchState[res.row];
      const code = manual === 'skip' ? null : (manual || res.match);
      if (manual === 'skip') return;
      if (!code) {
        (res.candidates.length ? report.ambiguous : report.unmatched).push({
          row: res.row, name: res.name, candidates: res.candidates,
        });
        return;
      }
      const target = bt.targets[Number(code)];
      if (!target) return;
      const r = rows[res.row];
      const props = { ...r, name: target.name };
      feats.push({
        type: 'Feature', properties: props,
        geometry: wantAreas ? target.geometry : { type: 'Point', coordinates: centroidOf(target.geometry) },
      });
      report.matched++;
    });
  }

  // build the fragment + sanitize
  const m = session.dataset ? imports.readManifest(session.dataset) : null;
  const existingIds = m ? imports.mergedLayers(m).map((l) => l.id) : [];
  // EVERY column the person kept survives. A role says what a column is FOR —
  // which one is the place name, which is latitude — and must never decide what
  // gets thrown away. This used to drop role 'ignore', and a model is allowed to
  // assign that while profiling an upload (see the enum in the profiling call).
  // So a column of image links was quietly deleted, while the popup went on
  // promising a photo from it. The add-data flow hid this, because its style step
  // overwrites the model's roles with plain ones before anything is built; the
  // setup flow has no style step, so the model's opinion stood.
  //
  // Unticking a column in the table still removes it — that is the person's call,
  // and it never reaches this list.
  const keep = new Set(['name']);
  for (const c of (session.columns || [])) keep.add(c.name);
  const spec = session.spec || {};
  // a retired ramp name (the red↔green diverging pair) becomes its safe
  // successor here, not just at paint time, so the workbench's ramp picker shows
  // what the layer actually uses instead of falling blank on an unknown option
  if (spec.palette && PALETTE_ALIASES[spec.palette]) spec.palette = PALETTE_ALIASES[spec.palette];
  // one layer = one geometry class; the kind must be renderable for that class.
  // Coordinates ALWAYS produce points (adminJoin is exempt: it can hand back
  // areas or centroids, whichever the kind needs) — so a choropleth asked of a
  // lat/lng table becomes sized circles, not invisible shading.
  const cls = strategy === 'coordinates' ? 'point'
    : session.meta && session.meta.geometry && session.meta.geometry.class;
  if (strategy !== 'adminJoin' && cls) {
    const allowed = cls === 'line' ? ['line', 'category']
      : cls === 'polygon' ? ['polygon', 'choropleth', 'category', 'bubble']
      : ['markers', 'category', 'bubble'];
    if (!allowed.includes(spec.kind)) {
      spec.kind = (spec.kind === 'choropleth' && spec.valueColumn && cls === 'point') ? 'bubble' : allowed[0];
    }
  }
  // bubbles are point symbols — any shapes that reached here collapse to centroids
  if (spec.kind === 'bubble') {
    feats = feats.map((f) => (f.geometry && !/Point/.test(f.geometry.type)
      ? { ...f, geometry: { type: 'Point', coordinates: centroidOf(f.geometry) } } : f));
  }
  const frag = buildFragment(spec, feats, existingIds);
  // derived properties (e.g. the primary-tag category key) must survive the whitelist
  (frag.derivedKeys || []).forEach((k) => keep.add(k));
  const clean = sanitizeFeatures(feats, [...keep], sessionBounds(session), spec.outsideAction);
  report.outside = clean.outside;
  if (spec.outsideAction === 'drop' && clean.outside) report.outsideDropped = true;

  // A column that was kept and STILL vanished is a fault, not a preference, and
  // the last one cost a day of the owner's time while a popup went on promising a
  // photo from data that no longer had it. So check, and say so out loud. Only
  // columns that actually carried something count — a column empty in every row
  // is legitimately absent from the features and must not raise a false alarm.
  const present = new Set();
  for (const f of clean.features.slice(0, 200)) {
    for (const k in (f.properties || {})) present.add(k);
  }
  const lost = [...keep].filter((k) => k !== 'name' && !present.has(k)
    && rows.some((r) => r && r[k] !== undefined && r[k] !== null && r[k] !== ''));
  if (lost.length) {
    report.droppedColumns = lost;
    console.warn('[atlas] columns had values but did not survive the build:', lost.join(', '));
  }

  return { frag, features: clean.features, report };
}

// withDraft=false recomputes the match report without touching disk — the
// Check / Place-on-map steps iterate cheaply; entering Preview writes the draft.
/* A layer coloured by a multi-value column stores markerBy:"_category" — the
   hidden primary-token column the map actually reads — and nothing anywhere
   records which real column produced it. So reopening such a layer used to
   hand back categoryColumn:undefined, and re-saving silently demoted a
   categorised map to plain markers.

   The answer is in the data. _category IS the primary token, so the column it
   came from is the one whose value starts with it on essentially every row.
   Measured on a real 66-place layer: the true column scores 100% and every
   other column scores 0% — the separation is not close. */
/* The other way a layer records what classes it: a MapLibre match expression
   in its paint, with no markerBy beside it. The column is named inside the
   expression — ["match", ["to-string", ["get", "status"]], ...] — so pull it
   back out rather than reading the layer as a flat one-colour map and
   flattening it for real on the next save. */
function columnFromMatch(expr, columns) {
  if (!Array.isArray(expr) || expr[0] !== 'match') return undefined;
  let found;
  (function walk(node) {
    if (found || !Array.isArray(node)) return;
    if (node[0] === 'get' && typeof node[1] === 'string') { found = node[1]; return; }
    node.forEach(walk);
  })(expr[1]);
  return found && columns.includes(found) ? found : undefined;
}

function recoverCategoryColumn(rows, columns) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  let best = null;
  for (const name of columns) {
    if (name === '_category') continue;
    let hit = 0, seen = 0;
    for (const r of rows) {
      const cat = norm(r._category);
      if (!cat) continue;
      seen++;
      if (norm(r[name]).indexOf(cat) === 0) hit++;
    }
    const rate = seen ? hit / seen : 0;
    if (rate > 0.8 && (!best || rate > best.rate)) best = { name, rate };
  }
  return best ? best.name : undefined;
}

function applyResult(session, withDraft) {
  const { frag, features, report } = transform(session);
  let draftId = null;
  if (withDraft) {
    draftId = imports.writeDraft(session.dataset, session.id, frag.stanza,
      frag.sourceFile, { type: 'FeatureCollection', features }, session.replacingLayerId);
  }
  session.fragment = frag.stanza;
  session.sourceFile = frag.sourceFile;
  session.featureCount = features.length;
  imports.saveImport(session);
  return {
    importId: session.id,
    inference: session.inference || null,
    spec: session.spec,
    strategy: session.strategy,
    // What each column could be used for, so a client can offer colour rules
    // by name and class-count instead of making someone guess. Derived, never
    // stored: the rows are the truth and they are already in hand here.
    profiles: profileColumns(session.columnsRaw || [], session.rows || []).map((p) => ({
      name: p.name, type: p.type, kinds: p.kinds || p.distinct, filled: p.filled,
      categorical: !!p.categorical, multiValue: !!p.multiValue,
      tagList: !!p.tagList, looksLikeName: !!p.looksLikeName, looksLikeImage: !!p.looksLikeImage,
    })),
    joinLayer: session.joinLayer || null,
    boundaries: session.boundaryOptions || null,
    columns: session.columns,
    matchReport: report,
    fragment: frag.stanza,
    draftDataset: draftId,
    stats: { features: features.length, kind: frag.kindUsed },
    duplicateOf: (function () {
      const hit = findLayerByContent(session.dataset, hashRows(session.rows),
        frag.stanza && frag.stanza.label, null);
      return hit ? { layerId: hit.layer.id, label: hit.layer.label || hit.layer.id, exact: hit.exact } : null;
    })(),
  };
}

/* ---------- routes ---------- */

router.get('/layers/options', (req, res) => {
  const dataset = String(req.query.dataset || '');
  if (dataset) {
    if (!requireDatasetEditor(req, res, dataset)) return;
  } else if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
    return res.status(401).json({ error: 'sign in to set up your data', needsAuth: true });
  }
  const { options } = dataset ? boundaryOptions(dataset) : { options: [] };
  res.json({
    boundaries: options.map(({ id, label, group, count, exampleNames }) => ({ id, label, group, count, exampleNames: exampleNames.slice(0, 5) })),
    palettes: Object.keys(PALETTES),
    markerColors: Object.keys(MARKER_COLORS),
    geminiAvailable: !!ai,
  });
});

// Canonical-table ingest: the client sends typed rows + a column schema
// (produced by atlas/ingest.js). Inference pre-fills roles/spec; NO draft is
// written — the Place-on-map step iterates report-only, Preview writes drafts.
router.post('/layers/ingest', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  // Two callers: the workbench working on a built atlas, and the setup wizard
  // setting data up BEFORE the atlas exists. The second has no dataset to read,
  // so it sends the region it just chose instead; the session stays "pending"
  // until the build finishes and the layer is committed against the new slug.
  const pendingRegion = (!dataset && b.region && b.region.iso3) ? {
    iso3: String(b.region.iso3).toUpperCase(),
    level: Number(b.region.level) || 1,
    shapeIDs: (Array.isArray(b.region.shapeIDs) ? b.region.shapeIDs : []).map(String).slice(0, 100),
    bbox: Array.isArray(b.region.bbox) && b.region.bbox.length === 4 ? b.region.bbox.map(Number) : null,
  } : null;
  if (pendingRegion) {
    // no instance to authorise against yet — building requires a session, so
    // that (or the admin token) is the gate
    if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
      return res.status(401).json({ error: 'sign in to set up your data', needsAuth: true });
    }
    if (!/^[A-Z]{3}$/.test(pendingRegion.iso3) || !pendingRegion.shapeIDs.length) {
      return res.status(400).json({ error: 'region iso3 and shapeIDs are required before the atlas exists' });
    }
  } else {
    if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
    if (!requireDatasetEditor(req, res, dataset)) return;
  }
  const schema = Array.isArray(b.schema) ? b.schema : null;
  if (!schema || !Array.isArray(b.rows) || !b.rows.length) {
    return res.status(400).json({ error: 'schema and rows required' });
  }
  const columns = schema.map((c) => String((c && c.name) || '')).filter(Boolean).slice(0, MAX_COLS);
  if (!columns.length) return res.status(400).json({ error: 'no usable columns' });
  const rows = b.rows.slice(0, MAX_ROWS).map((r) => {
    const o = {};
    for (const c of columns) {
      const v = r ? r[c] : undefined;
      o[c] = (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
        ? v : (v == null ? '' : String(v).slice(0, 500));
    }
    return o;
  });
  const meta = b.meta && typeof b.meta === 'object' ? {
    sourceType: String(b.meta.sourceType || '').slice(0, 20),
    encoding: String(b.meta.encoding || '').slice(0, 20),
    sheet: String(b.meta.sheet || '').slice(0, 60),
    truncated: b.meta.truncated || null,
    notices: (Array.isArray(b.meta.notices) ? b.meta.notices : []).slice(0, 10).map((n) => String(n).slice(0, 200)),
    geometry: b.meta.geometry && typeof b.meta.geometry === 'object' ? {
      class: ['point', 'line', 'polygon'].includes(b.meta.geometry.class) ? b.meta.geometry.class : null,
      count: Number(b.meta.geometry.count) || 0,
      vertices: Number(b.meta.geometry.vertices) || 0,
    } : null,
  } : null;

  // the spatial track: geometry rides alongside the rows, index-aligned
  const geoms = Array.isArray(b.geoms) && b.geoms.length ? b.geoms.slice(0, MAX_ROWS) : null;
  const geomIdx = geoms && Array.isArray(b.geomIdx)
    ? b.geomIdx.slice(0, MAX_ROWS).map((v) => (Number.isInteger(v) && v >= 0 && v < geoms.length ? v : null))
    : null;

  const profiles = profileColumns(columns, rows);
  const { options } = dataset ? boundaryOptions(dataset) : { options: [] };
  const m = dataset ? imports.readManifest(dataset) : null;

  /* A table may arrive as a REPLACEMENT for a layer already on the atlas.
     Adding a themes column to a layer is exactly that — the same places, one
     column more — and without this mark the commit would add a second copy
     beside the original instead of putting it back in place. It is the same
     mark /layers/reopen sets, so the layer keeps its id and its authorship
     through the code that already handles a reopened layer. */
  let replacing = null;
  if (b.replaceLayerId && dataset) {
    const id = String(b.replaceLayerId);
    const prior = imports.mergedLayers(imports.readManifest(dataset)).find((L) => L.id === id);
    if (!prior) return res.status(404).json({ error: 'there is no layer here called ' + id });
    replacing = { id, addedBy: prior.addedBy || null, addedAt: prior.addedAt || null };
  }

  const session = imports.newImport({
    dataset, region: pendingRegion || undefined,
    filename: String(b.filename || '').slice(0, 120), meta,
    columnsRaw: columns, rows, profilesSummary: profiles.map((p) => ({ name: p.name, type: p.type })),
    geomIdx: geomIdx || undefined,
    // What the owner wants each key called. Kept beside the rows so it survives
    // to commit — a key otherwise wears its raw column name, and "themes" says
    // how it was made rather than what it holds.
    /* The reading looked and found nothing. Recorded on the layer so it is not
       asked again on every visit by every editor: a layer that genuinely answers
       no question would otherwise pay for that discovery for ever. */
    patternsNone: b.patternsNone ? true : undefined,
    keyLabels: (b.keyLabels && typeof b.keyLabels === 'object')
      ? Object.fromEntries(Object.entries(b.keyLabels)
          .filter(([k, v]) => k && typeof v === 'string' && v.trim())
          .map(([k, v]) => [String(k).slice(0, 60), v.trim().slice(0, 40)]))
      : undefined,
    replacingLayerId: replacing ? replacing.id : undefined,
    replacingAddedBy: replacing ? replacing.addedBy : undefined,
    replacingAddedAt: replacing ? replacing.addedAt : undefined,
  });
  if (geoms) imports.writeGeoms(session.id, geoms);

  // Spatial uploads know where they live — no inference or joins needed, just
  // a sensible spec by geometry class. Chat refine remains available later.
  if (geoms) {
    const cls = (meta && meta.geometry && meta.geometry.class) || 'point';
    const numeric = profiles.find((p) => p.type === 'number');
    const nameCol = profiles.find((p) => p.type === 'string' && p.looksLikeName);
    const catCol = pickCategoryColumn(profiles, nameCol && nameCol.name);
    const imgCol = profiles.find((p) => p.looksLikeImage);
    session.strategy = 'geometry';
    session.columns = columns.map((c) => ({
      name: c,
      role: nameCol && c === nameCol.name ? 'placeName' : numeric && c === numeric.name ? 'value' : 'text',
    }));
    session.spec = {
      // a low-cardinality column classes the map better than any default colour
      kind: catCol ? 'category'
        : cls === 'line' ? 'line'
        : cls === 'polygon' ? (numeric ? 'choropleth' : 'polygon')
        : 'markers',
      label: (session.filename || 'My data').replace(/\.[a-z]+$/i, '') || 'My data',
      group: 'userdata',
      valueColumn: numeric ? numeric.name : undefined,
      categoryColumn: catCol ? catCol.name : undefined,
      imageColumn: imgCol ? imgCol.name : undefined,
      categoryDelimiter: catCol && catCol.multiValue ? catCol.multiValue.delimiter : undefined,
      palette: 'greens',
      markerColor: 'rust',
      lineColor: 'slate',
      fillColor: 'moss',
      popupTitleColumn: pickTitleColumn(profiles, columns),
      popupColumns: pickPopupColumns(profiles, { title: pickTitleColumn(profiles, columns), image: imgCol && imgCol.name }),
    };
    try {
      return res.json(applyResult(session, false));
    } catch (e) {
      return res.status(400).json({ error: e.message, importId: session.id, columns: session.columns, strategy: session.strategy });
    }
  }

  // Robust name→admin matching: besides the atlas's own boundary layers, offer
  // geoBoundaries admin units for the atlas region at finer levels, so place
  // names the atlas doesn't carry (villages / localities) still match. Targets
  // are materialised to the import side-file so the sync placement path can read
  // them without a refetch.
  const inst = dataset ? reg.getInstance(dataset) : null;
  let geoOpts = [];
  try { geoOpts = await geoBoundaryOptions(pendingRegion || (inst && inst.region)); }
  catch (e) { console.warn('[atlas] geo boundary options failed:', e.message); }
  if (geoOpts.length) {
    const byOpt = {};
    geoOpts.forEach((o) => { byOpt[o.id] = { label: o.label, level: o.level, targets: o.targets }; });
    imports.writeGeoTargets(session.id, byOpt);
  }
  const allOptions = options.concat(geoOpts.map((o) => ({ id: o.id, label: o.label, group: 'geo', count: o.count, exampleNames: o.exampleNames })));
  session.boundaryOptions = allOptions.map((o) => ({ id: o.id, label: o.label, group: o.group || '', count: o.count, exampleNames: (o.exampleNames || []).slice(0, 5) }));

  let inference = null;
  if (ai && !b.manual && geminiAllowed(req)) {
    try {
      const prompt = [
        'You are helping map a tabular dataset onto an interactive atlas. Infer its schema.',
        'Column profiles (from code, trustworthy):', JSON.stringify(profiles),
        'First rows (sample):', JSON.stringify(rows.slice(0, 30)),
        'Atlas context: groups are userdata (default for contributed data), base, agri, eco. Use "userdata" unless the layer clearly belongs to one of the others. Map bounds ' + JSON.stringify(sessionBounds(session)) + '.',
        'Joinable boundary layers (choose joinLayer from these ids when rows are admin units; "geo:" ids are geoBoundaries admin levels for the atlas region — prefer them for village/locality names):',
        JSON.stringify(allOptions.map((o) => ({ id: o.id, label: o.label, count: o.count, exampleNames: o.exampleNames }))),
        'Rules: strategy "coordinates" only when usable lat/lng columns exist; otherwise "adminJoin"',
        'with the boundary layer whose names match the place-name column. kind "choropleth" needs a',
        'numeric valueColumn; otherwise "markers". Pick popupTitleColumn = the place/name column.',
        'notes: 1-2 sentences for the user about your reading of the data and any caveats.',
      ].join('\n');
      inference = await geminiJSON(getFlashModel(), prompt, INFER_SCHEMA);
    } catch (e) {
      console.warn('[atlas] infer failed:', e.message);
    }
  }

  if (inference) {
    session.inference = { rowSubject: inference.rowSubject, notes: inference.notes || '' };
    session.strategy = inference.strategy;
    session.joinLayer = inference.joinLayer || (allOptions[0] && allOptions[0].id);
    // the model's read of each column is kept for placement, but 'ignore' is
    // downgraded on the way in: nothing it says should be able to delete data
    /* The model's read of the columns is a HINT about roles, never the list of
       columns. It used to be both: the list was rebuilt from whatever the model
       named, filtered to columns that really exist. When the model answered with
       names that did not match — a renamed column, a spelling, an empty answer —
       the filter left NOTHING, and a session with no columns strips every column
       from the built layer, because the keep-list downstream is built from it.

       Found in a real session on the server: a re-send at 21:22 stored
       `columns: []` while the same file's earlier send stored all ten. This is
       also why it never showed up in local testing — without an AI key this
       branch does not run at all.

       So: start from the columns the data actually has, and let the model only
       colour in the roles. A model that says nothing now costs nothing. */
    const inferred = new Map(
      (inference.columns || [])
        .filter((c) => c && columns.includes(c.name))
        .map((c) => [c.name, c.role === 'ignore' ? 'text' : c.role]),
    );
    session.columns = columns.map((name) => ({ name, role: inferred.get(name) || 'text' }));
    session.spec = inference.layer;
  } else {
    // heuristic pre-fill (also the no-Gemini path)
    const lat = profiles.find((p) => p.looksLikeLat || p.maybeLatIndia);
    const lng = profiles.find((p) => p.looksLikeLng || p.maybeLngIndia);
    // best (name column, boundary layer) pair by join hit-rate across all options
    // (the atlas's own layers + geoBoundaries levels for the region)
    let nameGuess = null, joinGuess = allOptions[0] && allOptions[0].id;
    for (const opt of allOptions.slice(0, 8)) {
      try {
        const bt = boundaryTargets(session, opt.id);
        const g = bestNameColumn(profiles, rows, bt.targets.map((t) => t.name), norm);
        if (g.column && (!nameGuess || g.rate > nameGuess.rate)) { nameGuess = g; joinGuess = opt.id; }
      } catch {}
    }
    const numeric = profiles.find((p) => p.type === 'number' && !p.looksLikeLat && !p.looksLikeLng);
    const catCol = pickCategoryColumn(profiles, nameGuess && nameGuess.column);
    const imgCol = profiles.find((p) => p.looksLikeImage);
    session.strategy = lat && lng ? 'coordinates' : 'adminJoin';
    session.joinLayer = joinGuess;
    session.columns = columns.map((c) => ({
      name: c,
      role: lat && c === lat.name ? 'latitude'
        : lng && c === lng.name ? 'longitude'
        : nameGuess && c === nameGuess.column ? 'placeName'
        : numeric && c === numeric.name ? 'value' : 'text',
    }));
    session.spec = {
      // joined polygons: numbers → choropleth; points have no numeric rendering,
      // so a categorical column beats plain markers there
      kind: session.strategy === 'coordinates' ? (catCol ? 'category' : 'markers')
        : numeric ? 'choropleth' : catCol ? 'category' : 'markers',
      label: (session.filename || 'My data').replace(/\.[a-z]+$/i, '') || 'My data',
      group: 'userdata',
      valueColumn: numeric ? numeric.name : undefined,
      categoryColumn: catCol ? catCol.name : undefined,
      imageColumn: imgCol ? imgCol.name : undefined,
      categoryDelimiter: catCol && catCol.multiValue ? catCol.multiValue.delimiter : undefined,
      palette: 'greens',
      markerColor: 'rust',
      popupTitleColumn: nameGuess ? nameGuess.column : pickTitleColumn(profiles, columns),
      popupColumns: pickPopupColumns(profiles, { title: nameGuess ? nameGuess.column : pickTitleColumn(profiles, columns), image: imgCol && imgCol.name }),
    };
  }

  try {
    let result = applyResult(session, false);

    // Gemini adjudication for ambiguous joins (constrained: only offered candidates)
    if (ai && result.matchReport.ambiguous.length && result.matchReport.ambiguous.length <= 40 && !b.manual) {
      try {
        const adj = await geminiJSON(getFlashLiteModel(), [
          'Pick the right boundary for each source place name (Indian transliterations vary).',
          'Only use chosenCode values from the candidates; use "" when none fits.',
          JSON.stringify(result.matchReport.ambiguous.map((a) => ({
            sourceName: a.name,
            candidates: a.candidates.map((c) => ({ code: c.code, name: c.name, parent: c.parent })),
          }))),
        ].join('\n'), ADJUDICATE_SCHEMA);
        let applied = 0;
        for (const mt of adj.matches || []) {
          const amb = result.matchReport.ambiguous.find((a) => a.name === mt.sourceName);
          if (!amb || !mt.chosenCode) continue;
          if (amb.candidates.some((c) => c.code === mt.chosenCode)) {
            session.matchState = session.matchState || {};
            session.matchState[amb.row] = mt.chosenCode;
            applied++;
          }
        }
        if (applied) result = applyResult(session, false);
      } catch (e) {
        console.warn('[atlas] adjudication failed:', e.message);
      }
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message, importId: session.id, columns: session.columns, strategy: session.strategy });
  }
});

router.post('/layers/apply', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (session.dataset) {
    if (!requireDatasetEditor(req, res, session.dataset)) return;
  } else if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
    // pre-build session: no instance to authorise against, so sign-in is the gate
    return res.status(401).json({ error: 'sign in to set up your data', needsAuth: true });
  }
  if (b.spec && typeof b.spec === 'object') session.spec = b.spec;
  if (b.strategy && ['coordinates', 'adminJoin'].includes(b.strategy)) session.strategy = b.strategy;
  if (b.joinLayer) session.joinLayer = String(b.joinLayer);
  if (Array.isArray(b.columns)) {
    session.columns = b.columns
      .filter((c) => c && session.columnsRaw.includes(c.name))
      .map((c) => ({ name: c.name, role: String(c.role) }));
  }
  try {
    // no dataset folder before the build, so no draft to write — the styled
    // layer is previewed on the real map once it's committed
    res.json(applyResult(session, session.dataset ? b.draft !== false : false));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/resolve', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (session.dataset) {
    if (!requireDatasetEditor(req, res, session.dataset)) return;
  } else if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
    // pre-build session: no instance to authorise against, so sign-in is the gate
    return res.status(401).json({ error: 'sign in to set up your data', needsAuth: true });
  }
  session.matchState = session.matchState || {};
  for (const f of (Array.isArray(b.fixes) ? b.fixes : [])) {
    if (!Number.isInteger(f.row)) continue;
    if (f.skip) session.matchState[f.row] = 'skip';
    else if (typeof f.code === 'string') session.matchState[f.row] = f.code;
  }
  try {
    // no dataset folder before the build, so no draft to write — the styled
    // layer is previewed on the real map once it's committed
    res.json(applyResult(session, session.dataset ? b.draft !== false : false));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});


/* ---------- search: a lexical vocabulary per contributed layer, built on -------
   ---------- demand (and refreshed at commit), plus row-level embeddings -------
   ---------- for semantic retrieval when the model is available ----------------
   Two artefacts per layer, derived from the same geojson and invalidated by
   the same sig:
     search.local.json    lexical vocabulary (terms, no vectors) — always
                          built, synchronously, so keyword search needs no key
     search-<layerId>.vec one embedding per FEATURE, int8-quantised — written
                          in the background whenever the model answers
   Terms used to carry their own vectors and a query was expanded to nearby
   terms before the substring scan. That was query expansion, not retrieval: a
   feature could only match if its text literally contained an expanded term,
   so "quiet places to sit and read" could never reach a row described as
   "sofa made out of recycled materials". Rows are now scored directly against
   the query embedding, and the lexical pass survives unchanged underneath. */
const SEARCH_MAX_TERMS = 300;
/* Floor for a semantic row hit. The old TERM floor was 0.62, tuned for
   short-text vs short-text. A row vector averages a whole feature —
   description, address, category, whatever enrichment added — so the query's
   subject is diluted and true matches land visibly lower than term-vs-term
   ones do; on this model a short query against a long blob typically sits
   0.1–0.15 below the equivalent symmetric pair. 0.62 − ~0.12 → 0.50: low
   enough to catch paraphrases, high enough that a vague query doesn't light
   half the map. Chosen by reasoning, not measurement (no key on this machine)
   — revisit once a keyed instance has real traffic to log. */
const ROW_MIN_COSINE = 0.50;
// gemini-embedding-001 defaults to 3072 dims; 768 (a supported MRL size) keeps
// the side-file small. Query + rows share this, so cosine stays comparable.
const EMBED_DIM = 768;
// embedContent accepts a batch; ~100 keeps one request comfortably inside the
// API's payload limits even with 4,000-char row blobs.
// Google's own message reads "at most 100 requests can be in one batch", so 100
// looked safe and was not: the live log shows every batch of exactly 100 rejected
// with that 400. Whatever the boundary counts, 100 is over it, so sit clearly
// under. This is why search-by-meaning has never built for a contributed layer —
// and why I was wrong to call this fixed from a log that turned out to be stale.
const EMBED_BATCH = 64;

async function embedTexts(texts) {
  if (!ai || !texts.length) return null;
  try {
    const r = await ai.models.embedContent({ model: getEmbedModel(), contents: texts, config: { outputDimensionality: EMBED_DIM } });
    const embs = r && (r.embeddings || r.embedding);
    if (!embs) return null;
    const arr = Array.isArray(embs) ? embs : [embs];
    return arr.map((e) => (e && (e.values || e))).filter((v) => Array.isArray(v));
  } catch (e) { console.warn('[atlas] embed failed:', e.message); return null; }
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
/* What counts as searchable text. Enrichment writes its output (category,
   labels) into the row as ordinary properties before the layer is committed, so
   "user-submitted" and "enriched" are the same thing by the time we get here:
   index EVERY text-bearing property rather than a curated tag column. Ids,
   urls, coordinates and timestamps are excluded — they would make a stray digit
   or date match on every feature. */
function searchSkipProp(name) {
  const n = String(name == null ? '' : name).toLowerCase();
  if (/(^|[^a-z])(id|ids|uuid|guid|url|uri|link|href|image|images|img|photo|photos|thumb|thumbnail|icon|lat|latitude|lon|lng|long|longitude|x|y|geom|geometry|wkt|color|colour)([^a-z]|$)/.test(n)) return true;
  return /(created|updated|modified|timestamp)/.test(n);
}
function searchCellText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x))).join('; ');
  if (typeof v === 'object') return '';
  return String(v);
}
function searchSkipValue(v) {
  const s = searchCellText(v).trim();
  if (s.length < 2) return true;
  if (!/[a-z]/i.test(s)) return true;                        // numbers, codes, coordinates
  if (/^(https?:|www\.|data:|\/\/)/i.test(s)) return true;   // urls
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s)) return true;  // uuids
  if (/^\d{4}-\d{2}-\d{2}[t ]/i.test(s)) return true;        // timestamps
  return false;
}
// One searchable blob per feature: what the viewer matches a raw query against.
function featureSearchText(props) {
  const parts = [];
  for (const k in (props || {})) {
    if (searchSkipProp(k)) continue;
    const v = props[k];
    if (searchSkipValue(v)) continue;
    parts.push(searchCellText(v));
  }
  return parts.join(' · ').toLowerCase().slice(0, 4000);
}

const SEARCH_STOP = new Set(('the a an and or of in on at to for with from by is are was were this that these those it its as be' +
  ' been near not no you your our their they he she we i but if then than so such very more most other some any all each' +
  ' one two three new near around about into over under out up down off can will just also').split(' '));
// A cell becomes either one term (a tag / short phrase) or its significant words
// (free text), so "bamboo-wall" survives whole while a sentence contributes
// "recycled", "library".
function termsFromValue(v, out) {
  const s = searchCellText(v);
  if (!s) return;
  for (const cell of s.split(/\s*[;|\n]\s*|\s*,\s+/)) {
    const c = cell.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/[a-z]/.test(c)) continue;
    const words = c.split(' ');
    if (c.length <= 40 && words.length <= 4) { out.push(c); continue; }
    for (const w of words) {
      const t = w.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
      if (t.length >= 4 && t.length <= 40 && !SEARCH_STOP.has(t)) out.push(t);
    }
  }
}
// The layer's vocabulary. Declared tag columns and everything else are gathered
// separately, then merged under a quota: a layer with a rich tag column must not
// spend the whole cap (and the whole embedding budget) before its descriptions
// and addresses get a look in.
const SEARCH_TAG_QUOTA = 0.6;
function layerVocabTerms(stanza, features) {
  const tagFields = [];
  if (stanza.markerBy) tagFields.push(stanza.markerBy);
  ((stanza.popup && stanza.popup.fields) || []).forEach((f) => { if (f.type === 'tags' && f.property) tagFields.push(f.property); });

  const seen = new Set();
  const gather = (pick) => {
    const list = [];
    for (const f of features) {
      if (list.length >= SEARCH_MAX_TERMS) break;
      const out = [];
      pick(f.properties || {}, out);
      for (const t of out) {
        if (seen.has(t) || list.length >= SEARCH_MAX_TERMS) continue;
        seen.add(t); list.push(t);
      }
    }
    return list;
  };
  const tagged = gather((p, out) => { for (const fld of tagFields) termsFromValue(p[fld], out); });
  const free = gather((p, out) => {
    for (const k in p) {
      if (tagFields.indexOf(k) >= 0 || searchSkipProp(k) || searchSkipValue(p[k])) continue;
      termsFromValue(p[k], out);
    }
  });
  const quota = Math.round(SEARCH_MAX_TERMS * SEARCH_TAG_QUOTA);
  const merged = tagged.slice(0, quota).concat(free.slice(0, SEARCH_MAX_TERMS - Math.min(tagged.length, quota)));
  // room left over (few free-text terms) goes back to the tag column
  return merged.concat(tagged.slice(quota)).slice(0, SEARCH_MAX_TERMS);
}

/* ---- the index: which layers, when to rebuild, and reading their text ---- */

// Only contributed layers: their geojson lives next to the manifest overlay and
// is small enough to scan, and they are what the viewer's search lights up.
function searchLayers(m) {
  return imports.mergedLayers(m).filter((L) => L && L.id && L.source &&
    (L.userLayer || /^user-[a-z0-9-]+\.geojson$/.test(String(L.source))));
}
// Cheap staleness check — an enrich or a re-commit rewrites the geojson.
function layerSig(dir, stanza) {
  try {
    const st = fs.statSync(path.join(dir, String(stanza.source)));
    return st.size + ':' + Math.round(st.mtimeMs);
  } catch { return ''; }
}
const layerTextCache = new Map();   // dir|source|sig -> [{ i, title, text }]
function layerSearchRows(dir, stanza, sig) {
  const key = dir + '|' + stanza.source + '|' + sig;
  const hit = layerTextCache.get(key);
  if (hit) return hit;
  let gj = null;
  try { gj = JSON.parse(fs.readFileSync(path.join(dir, String(stanza.source)), 'utf8')); } catch { return []; }
  const titleProp = (stanza.popup && stanza.popup.title) || '';
  const rows = ((gj && gj.features) || []).map((f, i) => {
    const p = (f && f.properties) || {};
    const text = featureSearchText(p);
    // the stanza's title property can be missing from the data (older layers) —
    // fall back to the head of the searchable text so a hit is still legible
    const title = (searchCellText(p[titleProp]).trim() || text).slice(0, 120);
    return { i, title, text };
  });
  if (layerTextCache.size >= 8) layerTextCache.delete(layerTextCache.keys().next().value);
  layerTextCache.set(key, rows);
  return rows;
}

/* ---- row vectors: an int8 side-file per layer, next to its geojson ---- */

/* 768 float32 per row is ~34MB of JSON at the 5,000-row ingest cap, so the
   vectors skip search.local.json entirely and live in search-<layerId>.vec:
     line 1              JSON header + "\n": { v, sig, model, dim, count }
     count × 4 bytes     float32 LE per-row scale (scale = maxAbs(row) / 127)
     count × dim bytes   int8 components, row-major, in feature order
   Quantising each row against ITS OWN max keeps the whole int8 range in use
   whatever the vector's magnitude — that per-row scale is what holds the
   cosine error near 1e-3 instead of letting quiet vectors collapse to zeros.
   Cosine itself is invariant under a positive per-row scale, so scoring reads
   the int8 rows directly; the stored scale is what makes the floats
   reconstructible (q[i] × scale) for anything that isn't scale-invariant. */
function quantiseVec(v) {
  let max = 0;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > max) max = a; }
  const q = new Int8Array(v.length);
  if (!max) return { q, scale: 0 };
  const scale = max / 127;
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}
function rowVecFile(dir, layerId) {
  // the layer id lands in a filename — ids are wizard-minted slugs, but a
  // hand-edited manifest must not be able to point this outside the dataset dir
  return /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(layerId)) ? path.join(dir, 'search-' + layerId + '.vec') : null;
}
function writeRowVectors(dir, layerId, sig, vecs) {
  const file = rowVecFile(dir, layerId);
  if (!file) return;
  const count = vecs.length;
  const scales = Buffer.alloc(count * 4);
  const body = Buffer.alloc(count * EMBED_DIM);
  for (let i = 0; i < count; i++) {
    const v = vecs[i];
    // a row with no searchable text has no vector: zero components, scale 0 —
    // cosine treats it as 0, so it can never become a semantic hit
    if (!Array.isArray(v) || v.length !== EMBED_DIM) continue;
    const { q, scale } = quantiseVec(v);
    scales.writeFloatLE(scale, i * 4);
    body.set(q, i * EMBED_DIM);   // Int8Array → Buffer keeps two's complement
  }
  const header = Buffer.from(JSON.stringify({ v: 1, sig, model: getEmbedModel(), dim: EMBED_DIM, count }) + '\n');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, Buffer.concat([header, scales, body]));
  fs.renameSync(tmp, file);
}
const rowVecCache = new Map();   // dir|layerId|sig -> { dim, count, scales, q }
function readRowVectors(dir, layerId, sig) {
  const file = rowVecFile(dir, layerId);
  if (!file) return null;
  const key = dir + '|' + layerId + '|' + sig;
  const hit = rowVecCache.get(key);
  if (hit) return hit;
  let buf = null;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const nl = buf.indexOf(10);
  if (nl < 0) return null;
  let h = null;
  try { h = JSON.parse(buf.subarray(0, nl).toString('utf8')); } catch { return null; }
  // stale or foreign vectors are worse than none: the query embedding they
  // would be compared against comes from today's model, dim and geojson
  if (!h || h.v !== 1 || h.sig !== sig || h.model !== getEmbedModel() || h.dim !== EMBED_DIM) return null;
  const count = h.count | 0;
  const scalesEnd = nl + 1 + count * 4;
  if (count < 0 || buf.length !== scalesEnd + count * EMBED_DIM) return null;
  // scales are copied out (a Float32Array view needs 4-byte alignment the
  // header line doesn't guarantee); the int8 body is a zero-copy view
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) scales[i] = buf.readFloatLE(nl + 1 + i * 4);
  const out = { dim: EMBED_DIM, count, scales, q: new Int8Array(buf.buffer, buf.byteOffset + scalesEnd, count * EMBED_DIM) };
  // only successful reads are cached, so a background write shows up on the
  // very next search; 4 layers ≈ 15MB worst case at the ingest cap
  if (rowVecCache.size >= 4) rowVecCache.delete(rowVecCache.keys().next().value);
  rowVecCache.set(key, out);
  return out;
}
// Embed every row of a layer and write the side-file. All-or-nothing: a
// partial file would silently mis-align feature indices, so any failed batch
// abandons the whole layer (a later search queues it again).
async function embedRowsForLayer(dir, layerId, sig, texts) {
  if (!ai) return false;
  const vecs = new Array(texts.length).fill(null);
  const idxs = [];
  for (let i = 0; i < texts.length; i++) if (texts[i]) idxs.push(i);
  for (let at = 0; at < idxs.length; at += EMBED_BATCH) {
    const slice = idxs.slice(at, at + EMBED_BATCH);
    const got = await embedTexts(slice.map((i) => texts[i]));
    if (!got || got.length !== slice.length) return false;   // no key / model error → stay lexical
    slice.forEach((rowI, j) => { vecs[rowI] = got[j]; });
  }
  // written even when every row was empty, so the layer stops re-queueing
  writeRowVectors(dir, layerId, sig, vecs);
  return true;
}

// Build (or refresh) the lexical index for every contributed layer that needs
// it. Synchronous and embedding-free, so a search request can always call it.
function ensureSearchIndex(dataset) {
  const out = { dir: null, layers: [], idx: {}, built: [] };
  let m = null;
  try { m = imports.readManifest(dataset); } catch { return out; }
  if (!m) return out;
  out.dir = m.dir;
  out.layers = searchLayers(m);
  out.idx = imports.readSearchIndex(dataset) || {};
  for (const L of out.layers) {
    const sig = layerSig(m.dir, L);
    const cur = out.idx[L.id];
    if (cur && cur.terms && cur.terms.length && cur.sig === sig) continue;
    let features = null;
    try { features = JSON.parse(fs.readFileSync(path.join(m.dir, String(L.source)), 'utf8')).features || []; } catch { continue; }
    if (!features.length) continue;
    const terms = layerVocabTerms(L, features);
    if (!terms.length) continue;
    // Terms are written bare: their vectors moved to the row side-file, so a
    // rebuild is also the moment an old vector-carrying entry slims down.
    const entry = { v: 2, sig, terms: terms.map((t) => ({ t })) };
    out.idx[L.id] = entry;
    out.built.push(L.id);
    try { imports.writeSearchIndex(dataset, L.id, entry); } catch (e) { console.warn('[atlas] search index write failed:', e.message); }
  }
  return out;
}

// Row vectors, when the model is around: fire-and-forget, one pass per dataset
// at a time, so the search that triggered the build still answers immediately.
// A 5,000-row layer is ~50 sequential embed calls — a big atlas cannot
// stampede the API, it just takes a few searches' worth of background time.
const embedInFlight = new Set();
function queueRowEmbeddings(dataset, layerIds) {
  if (!ai || !layerIds.length || embedInFlight.has(dataset)) return;
  embedInFlight.add(dataset);
  (async () => {
    try {
      const m = imports.readManifest(dataset);
      if (!m) return;
      for (const L of searchLayers(m)) {
        if (layerIds.indexOf(L.id) < 0) continue;
        const sig = layerSig(m.dir, L);
        if (readRowVectors(m.dir, L.id, sig)) continue;   // another request already filled it
        const rows = layerSearchRows(m.dir, L, sig);
        if (!rows.length) continue;
        await embedRowsForLayer(m.dir, L.id, sig, rows.map((r) => r.text));
      }
    } catch (e) { console.warn('[atlas] row embedding failed:', e.message); }
    finally { embedInFlight.delete(dataset); }
  })();
}

// After a commit: store the layer's vocabulary immediately (lexical, always)
// and embed its rows if the model answers. No embeddings → search still works.
// (Named for the vocabulary it has always written; row vectors ride along now.)
async function embedAndStoreVocab(dataset, layerId, stanza, features) {
  const dir = imports.datasetDir(dataset);
  const sig = dir ? layerSig(dir, stanza) : '';
  const terms = layerVocabTerms(stanza, features);
  if (terms.length) imports.writeSearchIndex(dataset, layerId, { v: 2, sig, terms: terms.map((t) => ({ t })) });
  if (!dir || !ai) return;
  await embedRowsForLayer(dir, layerId, sig, features.map((f) => featureSearchText((f && f.properties) || {})));
}

// Fingerprint the data the user UPLOADED, not the features we derived from it:
// the same file styled two ways must still be recognised as the same data.
function hashRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows || [])).digest('hex').slice(0, 16);
}

// Is this data already on the atlas? Exact for anything committed since we
// started storing the hash; for older layers all we can honestly compare is the
// name they were given (which came from the filename), so that warns rather
// than claims certainty.
function findLayerByContent(datasetId, contentHash, label, exceptId) {
  if (!datasetId) return null;
  let m = null;
  try { m = imports.readManifest(datasetId); } catch { return null; }
  const layers = (m && m.local && m.local.layers) || [];
  const norm = (x) => String(x || '').trim().toLowerCase();
  for (const l of layers) {
    if (exceptId && l.id === exceptId) continue;
    if (l.contentHash) { if (l.contentHash === contentHash) return { layer: l, exact: true }; continue; }
    if (label && norm(l.label) === norm(label)) return { layer: l, exact: false };
  }
  return null;
}

/* The viewer's search box asks two things of the server, and a feature is a
   hit if EITHER answers — the union, so semantic can only ever add:
     1. lexical  — the query (and vocabulary terms sharing text with it) as
                   substrings, exactly what the viewer matches client-side.
                   `tags` carries the expansion back for that; no AI involved.
     2. semantic — every row scored against the query embedding, where this
                   layer's vectors exist. No wording in common required.
   `hits` is diagnostic: which layer/features the server itself would match
   (with a cosine `score` wherever vectors answered), so a silent search box
   can be debugged with curl. The viewer lights markers from its own copy of
   the data — this endpoint never has to be reachable for plain keyword search
   to work. `total` counts the features the searched layers hold, the honest
   denominator for a "N of M places" line. */
const SEARCH_MAX_TAGS = 24;
router.post('/layers/search', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  const q = String(b.q || '').trim().slice(0, 200).toLowerCase();
  const empty = { tags: [], hits: [], matched: 0, semantic: false, layers: 0, total: 0 };
  if (!dataset || q.length < 2 || !imports.datasetDir(dataset)) return res.json(empty);

  // This route is open on purpose — the viewer's search box calls it with no
  // credentials. Until private atlases could hold data at all, the folder lookup
  // above failed for them and THAT was the protection. It resolves now, so the
  // gate has to be explicit: a private atlas answers only to its view key, or to
  // someone who may edit it. Same test as GET /datasets/:slug/:file.
  const searchInst = reg.getInstance(dataset);
  if (searchInst && searchInst.visibility === 'private') {
    const k = String(b.key || req.query.key || req.headers['x-atlas-key'] || '');
    const kOk = k && reg.hashToken(k) === searchInst.viewKeyHash;
    if (!kOk && !callerCanEdit(req, searchInst)) {
      return res.status(403).json({ error: 'this atlas is private — a view key is needed to search it' });
    }
  }

  let built = { dir: null, layers: [], idx: {}, built: [] };
  try { built = ensureSearchIndex(dataset); }
  catch (e) { console.warn('[atlas] search index build failed:', e.message); }
  if (!built.layers.length) return res.json(empty);

  // fresh row vectors per layer; anything missing or stale is queued for the
  // background pass (a no-op without a key)
  const rowVecs = {}, needVecs = [];
  for (const L of built.layers) {
    const sig = layerSig(built.dir, L);
    const rv = readRowVectors(built.dir, L.id, sig);
    // sig (size+mtime) tracks the geojson; the count check guards the residual
    // case of a same-second same-size rewrite that mtime rounding can hide
    if (rv && rv.count === layerSearchRows(built.dir, L, sig).length) rowVecs[L.id] = rv;
    else needVecs.push(L.id);
  }
  queueRowEmbeddings(dataset, needVecs);

  // whole query first, then its individual words — so "shadow puppet" can still
  // reach a "shadow-theatre" tag that no single feature spells out verbatim
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SEARCH_STOP.has(w) && w !== q);
  const seen = new Set(), tags = [], byWord = [];
  for (const L of built.layers) {
    for (const t of ((built.idx[L.id] || {}).terms || [])) {
      const term = String(t && t.t || '');
      if (!term || seen.has(term)) continue;
      if (term.indexOf(q) >= 0 || q.indexOf(term) >= 0) { seen.add(term); tags.push(term); }
      else if (words.some((w) => term.indexOf(w) >= 0)) { seen.add(term); byWord.push(term); }
    }
  }
  tags.push(...byWord.slice(0, SEARCH_MAX_TAGS));

  // one query embedding serves every layer. `semantic` reports whether row
  // scoring RAN, not whether it hit — the useful fact when a curl of a thin
  // result has to distinguish "no vectors yet" from "floor filtered it all".
  let qv = null;
  if (Object.keys(rowVecs).length && ai && geminiAllowed(req)) {
    const got = await embedTexts([q]);           // embedTexts swallows its own errors
    if (got && got[0]) qv = got[0];
  }
  const semantic = !!qv;

  const needles = [q].concat(tags);
  const hits = [];
  let matched = 0, total = 0;
  try {
    for (const L of built.layers) {
      const rows = layerSearchRows(built.dir, L, layerSig(built.dir, L));
      total += rows.length;
      const rv = qv ? rowVecs[L.id] : null;
      const found = [];
      for (const r of rows) {
        const lex = needles.some((n) => n && r.text.indexOf(n) >= 0);
        // cosine is scale-invariant, so the int8 row is scored as stored
        const score = rv ? cosine(qv, rv.q.subarray(r.i * rv.dim, (r.i + 1) * rv.dim)) : null;
        if (!lex && !(score != null && score >= ROW_MIN_COSINE)) continue;
        found.push({ i: r.i, title: r.title, lex, score });
      }
      if (!found.length) continue;
      matched += found.length;
      // literal matches outrank paraphrases (they are what the user typed);
      // within each band the cosine orders, and unscored rows keep data order
      found.sort((a, b) => (b.lex - a.lex) || ((b.score || 0) - (a.score || 0)) || (a.i - b.i));
      hits.push({
        layer: L.id, label: L.label || L.id, count: found.length,
        features: found.slice(0, 50).map((f) => (f.score == null
          ? { i: f.i, title: f.title }
          : { i: f.i, title: f.title, score: Math.round(f.score * 1000) / 1000 })),
      });
    }
  } catch (e) { console.warn('[atlas] search scan failed:', e.message); }

  res.json({ tags: tags.slice(0, SEARCH_MAX_TAGS), hits, matched, semantic, layers: built.layers.length, total });
});

router.post('/layers/commit', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });

  // A session set up before the atlas existed is bound to it here — the wizard
  // sends the slug it got back from the build.
  if (!session.dataset && b.dataset) {
    const slug = String(b.dataset);
    if (!imports.datasetDir(slug)) return res.status(404).json({ error: 'unknown dataset' });
    session.dataset = slug;
    imports.saveImport(session);
  }
  if (!session.dataset) return res.status(400).json({ error: 'which atlas should this layer go on?' });

  // auth: the atlas's signed-in owner, its edit token, or admin (e.g. the deoria dataset)
  const inst = reg.getInstance(session.dataset);
  const ok = (inst && callerCanEdit(req, inst)) || auth.isAdmin(req);
  if (!ok) return res.status(403).json({ error: 'sign in as this atlas’s owner to change it', needsAuth: true });

  try {
    const { frag, features } = (function () {
      const t = transform(session);
      return { frag: t.frag, features: t.features };
    })();
    // Same data twice is almost always a mistake (a re-upload, or the wizard's
    // auto-add racing a manual one). Fingerprint the resulting features and
    // refuse a second copy — the authoritative check, since every path (bench,
    // data-first auto-add) commits through here.
    const contentHash = hashRows(session.rows);
    const hit = findLayerByContent(session.dataset, contentHash, frag.stanza.label,
      session.replacingLayerId || frag.stanza.id);
    if (hit && hit.exact) {
      return res.status(409).json({
        error: 'this data is already on the atlas as “' + (hit.layer.label || hit.layer.id) +
          '” — remove that layer first if you want to add it again',
        duplicate: true, layerId: hit.layer.id,
      });
    }
    frag.stanza.contentHash = contentHash;
    frag.stanza.spec = session.spec || undefined;   // so "edit this layer" can start from it
    // credit the contributor: which org (and person) added this layer
    const who = auth.sessionFromReq(req);
    if (who) {
      const acc = reg.getAccount(who.email);
      frag.stanza.addedBy = { email: who.email, name: (acc && acc.name) || '', org: (acc && acc.org) || '' };
      frag.stanza.addedAt = Date.now();
    }
    // Editing a committed layer replaces it in place: same id (so the atlas's
    // manifest identity and any links to it survive a restyle), same source
    // file, and the original contributor keeps the credit.
    if (session.replacingLayerId) {
      frag.stanza.id = session.replacingLayerId;
      frag.sourceFile = 'user-' + session.replacingLayerId + '.geojson';
      frag.stanza.source = frag.sourceFile;   // the stanza must name the file we write
      // Restyling is not contributing. The credit above is unconditional, so a
      // layer that carried NO addedBy used to acquire the editor's — and since
      // canRemove keys off addedBy, that quietly handed out removal rights to
      // whoever last changed a colour. An edit leaves authorship exactly as it
      // found it, including absent.
      frag.stanza.addedBy = session.replacingAddedBy || undefined;
      frag.stanza.addedAt = session.replacingAddedBy
        ? (session.replacingAddedAt || Date.now()) : undefined;
    }
    if (session.patternsNone) frag.stanza.patternsNone = true;
    if (session.keyLabels && Object.keys(session.keyLabels).length) {
      // merge, never replace: a layer may already carry a name for another key
      frag.stanza.keyLabels = Object.assign({}, frag.stanza.keyLabels || {}, session.keyLabels);
    }
    const out = imports.commitLayer(session.dataset, frag.stanza, frag.sourceFile,
      { type: 'FeatureCollection', features });
    imports.discardImport(session.id);
    res.json({ ok: true, layerId: out.layerId, dataset: session.dataset });
    // embed this layer's tag vocabulary for semantic search (non-blocking)
    embedAndStoreVocab(session.dataset, out.layerId, frag.stanza, features).catch(() => {});
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* Editing a layer that is already on the atlas. Its geometry and properties are
   settled — what the user wants to change is how it looks — so this rebuilds an
   import session straight from the committed geojson (strategy 'geometry', so
   transform passes the shapes through) and hands back the same shape as ingest.
   The style step then works unchanged, and commit replaces the layer in place.
   Permission is the same rule as removal: the owner may edit any layer, an
   invited editor only the ones they added. */
router.post('/layers/reopen', (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  const layerId = String(b.layerId || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });

  let m = null;
  try { m = imports.readManifest(dataset); } catch { /* handled below */ }
  const layer = ((m && m.local && m.local.layers) || []).find((l) => l.id === layerId);
  if (!layer) return res.status(404).json({ error: 'no such layer on this atlas' });
  const who = auth.sessionFromReq(req);
  const mine = !!(who && layer.addedBy && layer.addedBy.email === who.email);
  if (role !== 'owner' && !mine && !auth.isAdmin(req)) {
    return res.status(403).json({ error: 'only the person who added this layer, or the atlas owner, can edit it' });
  }

  let feats;
  try {
    feats = JSON.parse(fs.readFileSync(path.join(m.dir, layer.source), 'utf8')).features || [];
  } catch (e) { return res.status(400).json({ error: 'this layer’s data file is missing — remove it and add it again' }); }
  if (!feats.length) return res.status(400).json({ error: 'this layer has no features to edit' });

  const rows = feats.map((f) => Object.assign({}, f.properties));
  const geoms = feats.map((f) => f.geometry);
  const columns = Object.keys(rows[0] || {}).slice(0, MAX_COLS);
  const cls = /Polygon/.test(geoms[0] && geoms[0].type) ? 'polygon'
    : /LineString/.test(geoms[0] && geoms[0].type) ? 'line' : 'point';

  // the spec it was built with when we have it; otherwise read it back off the
  // stanza as faithfully as the stanza allows
  const matchCol = columnFromMatch(layer.paint && layer.paint.color, columns);
  const catCol = layer.markerBy === '_category'
    ? recoverCategoryColumn(rows, columns)
    : (layer.markerBy || matchCol || undefined);
  const spec = layer.spec || {
    kind: layer.type === 'marker' || layer.type === 'circle'
      ? (catCol ? 'category'
        : layer.paint && Array.isArray(layer.paint.radius) ? 'bubble'   // data-driven radius = proportional symbols
        : 'markers')
      : layer.type === 'fill' ? (layer.paint && layer.paint.fillColor && Array.isArray(layer.paint.fillColor) ? 'choropleth' : 'polygon')
      : layer.type === 'line' ? 'line' : 'markers',
    label: layer.label || layerId,
    group: layer.group || 'userdata',
    categoryColumn: catCol,
    popupTitleColumn: layer.popup && layer.popup.title,
    popupColumns: ((layer.popup && layer.popup.fields) || []).map((f) => f.property),
    imageColumn: (((layer.popup && layer.popup.fields) || []).find((f) => f.type === 'image') || {}).property,
    palette: 'greens', markerColor: 'rust', lineColor: 'slate', fillColor: 'moss',
  };

  const session = imports.newImport({
    dataset, filename: (layer.label || layerId) + ' (existing layer)',
    meta: { notices: [], geometry: { class: cls, count: feats.length, vertices: 0 } },
    columnsRaw: columns, rows,
    geomIdx: feats.map((_, i) => i),
    replacingLayerId: layerId,
    replacingAddedBy: layer.addedBy || null,
    replacingAddedAt: layer.addedAt || null,
  });
  imports.writeGeoms(session.id, geoms);
  session.strategy = 'geometry';
  session.columns = columns.map((c) => ({ name: c, role: c === spec.popupTitleColumn ? 'placeName' : 'text' }));
  session.spec = spec;
  try {
    res.json(applyResult(session, true));   // draft written: the preview works immediately
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// The atlas's contributed (overlay) layers — for the bench's manage list.
router.get('/layers/list', (req, res) => {
  const dataset = String(req.query.dataset || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
  let m = null;
  try { m = imports.readManifest(dataset); } catch { /* dataset dir missing */ }
  const who = auth.sessionFromReq(req);
  const layers = ((m && m.local && m.local.layers) || []).map((l) => ({
    id: l.id, label: l.label || l.id,
    addedBy: l.addedBy ? { email: l.addedBy.email, name: l.addedBy.name || '', org: l.addedBy.org || '' } : null,
    addedAt: l.addedAt || null,
    // owner removes any layer; an editor only the ones they added themselves
    canRemove: role === 'owner' || !!(who && l.addedBy && l.addedBy.email === who.email),
  }));
  res.json({ layers, role });
});

// Remove a contributed layer — owner: any; editor: only their own.
router.post('/layers/remove', (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  const layerId = String(b.layerId || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
  let m = null;
  try { m = imports.readManifest(dataset); } catch { /* dataset dir missing */ }
  const layer = ((m && m.local && m.local.layers) || []).find((l) => l.id === layerId);
  if (!layer) return res.status(404).json({ error: 'layer not found' });
  if (role !== 'owner') {
    const who = auth.sessionFromReq(req);
    if (!who || !layer.addedBy || layer.addedBy.email !== who.email) {
      return res.status(403).json({ error: 'you can only remove layers your organisation added' });
    }
  }
  const gone = imports.removeLayer(dataset, layerId);
  res.json({ ok: gone });
});

router.post('/layers/discard', (req, res) => {
  const session = imports.getImport(String((req.body || {}).importId || ''));
  if (session) imports.discardImport(session.id);
  res.json({ ok: true });
});

router.get('/layers/imports', (req, res) => {
  const dataset = String(req.query.dataset || '');
  if (!requireDatasetEditor(req, res, dataset)) return;
  res.json({ imports: imports.listImports(dataset) });
});

/* Theme-finding: suggest ONE new "themes" column from the columns the owner
   chose to read. Nothing is persisted here — the suggestion (or the refusal)
   goes back for review, and only the /keep route below writes anything. When
   the atlas already has a KEPT theme set, rows are filed into it instead of
   inventing a new one, so later contributions colour coherently. Old
   category files that the retired auto-persisting flow wrote are ignored as
   seeds: only a set an owner explicitly kept counts. */

// the persisted set, only if a person kept it (the retired flow's files
// carry no "kept" mark and are treated as absent)
function keptCatSet(dataset) {
  const dir = imports.datasetDir(dataset);
  if (!dir) return [];
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'categories.local.json'), 'utf8'));
    return (s && s.kept && Array.isArray(s.categories)) ? s.categories : [];
  } catch { return []; }
}
function writeKeptCatSet(dataset, categories, who) {
  const dir = imports.datasetDir(dataset);
  if (!dir) return;
  const p = path.join(dir, 'categories.local.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    categories,
    kept: categories.length ? { at: Date.now(), by: (who && who.email) || '' } : undefined,
  }, null, 1));
  fs.renameSync(tmp, p);
}

router.post('/layers/enrich', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  if (dataset) {
    if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
    if (!requireDatasetEditor(req, res, dataset)) return;
  } else if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
    return res.status(401).json({ error: 'sign in to find themes in your data', needsAuth: true });
  }
  const fields = (Array.isArray(b.fields) && b.fields.length ? b.fields : [b.descriptionColumn])
    .map((f) => String(f || '')).filter(Boolean);
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, MAX_ROWS) : null;
  if (!fields.length || !rows || !rows.length) return res.status(400).json({ error: 'nothing to read yet' });

  // the atlas title is evidence for the gate (its words are true of every
  // place, so they cannot be themes); pre-build sessions may send one
  const inst = dataset ? reg.getInstance(dataset) : null;
  const title = (inst && inst.title) || String(b.title || '');

  // AI-only by decision: the keyword fallback that used to invent themes here
  // shipped junk and could never say "no clear themes", so it was removed.
  // Without AI nothing is invented — except filing into an owner-KEPT set,
  // which assignBySeed handles inside enrichRows.
  const callJSON = ai ? aiCaller(req) : null;
  try {
    const out = await enrich.enrichRows({
      rows, fields, title,
      // questions mode asks what these places can be asked, rather than assuming
      // the one question the old reading always asked
      mode: b.mode === 'questions' ? 'questions' : undefined,
      seedSet: dataset ? keptCatSet(dataset) : [],
      callJSON,
      models: { flash: getFlashModel(), flashLite: getFlashLiteModel() },
    });
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: 'theme-finding failed: ' + e.message });
  }
});

/* Families of meaning: the labels on a layer, shelved so they can be browsed.

   This reads a BUILT layer rather than a table being uploaded, because it is a
   reader's feature, not an author's — a way into "what did people notice here"
   once the atlas exists. It reads the layer's own file, counts the vocabulary
   and asks for shelves; the answer is cached beside the dataset, because the
   labels only change when the layer does and nobody should pay for this twice.
*/
/* The shelves endpoint stood here. It grouped a layer's label words into
   families with a model call of its own, to be browsed. The reading now answers
   that question properly and colours the map with the answer, so nothing called
   this any more — and an endpoint that spends model calls with no caller is a
   door left open onto the bill. Removed with its caller. */


// The owner KEPT the suggestion: only now does the theme set persist, so a
// later contribution files into the same set. Pre-build sessions have no
// dataset directory yet — nothing to persist against, which is fine.
router.post('/layers/enrich/keep', (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  if (!dataset) return res.json({ ok: true });
  if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
  if (!requireDatasetEditor(req, res, dataset)) return;
  const categories = (Array.isArray(b.categorySet) ? b.categorySet : [])
    .map((c) => ({ name: String(c && c.name || '').trim().slice(0, 40), definition: String(c && c.definition || '').slice(0, 160) }))
    .filter((c) => c.name).slice(0, 8);
  if (!categories.length) return res.status(400).json({ error: 'no themes to keep' });
  writeKeptCatSet(dataset, categories, auth.sessionFromReq(req));
  res.json({ ok: true });
});

// The owner DISCARDED the suggestion: clear whatever theme set is remembered
// for this atlas, so the next run starts clean instead of inheriting it.
router.post('/layers/enrich/discard', (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  if (!dataset) return res.json({ ok: true });
  if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
  if (!requireDatasetEditor(req, res, dataset)) return;
  writeKeptCatSet(dataset, [], null);
  res.json({ ok: true });
});
