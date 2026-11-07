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
import { createRequire } from 'node:module';
import * as reg from '../lib/atlas/registry.js';
import * as auth from '../lib/atlas/auth.js';
import { sendMail } from '../lib/mailer.js';
import { noteTrouble, noteOk, setTroubleNotifier, openTroubles } from '../lib/atlas/trouble.js';
import * as owed from '../lib/atlas/owed.js';
import { queue as QUESTIONS, createQueue, fileSignatureOf, sameFile, NEVER_READ, payerOf } from '../lib/atlas/questions-queue.js';
import * as shortLabels from '../lib/atlas/short-labels.js';
import * as keyNouns from '../lib/atlas/key-nouns.js';
import * as buttonNames from '../lib/atlas/button-names.js';
import * as insightSummary from '../lib/atlas/insight-summary.js';
import * as placeNames from '../lib/atlas/place-names.js';
import * as searchText from '../lib/atlas/search-text.js';
import { makeSmallPhotos } from '../../deploy/make-small-photos.mjs';
import * as lookRead from '../lib/atlas/look-read.js';
import * as lokaSync from '../lib/atlas/loka-sync.js';
import {
  enqueueBuild, getJob, setJobDoneHook, setStrandedBuildHook, DATASETS_ROOT, PRIVATE_ROOT,
} from '../lib/atlas/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

/* The rules a reading obeys, shared with the browser. It lives under atlas/
   because that is where the browser can fetch it with a plain tag and no build
   step; there is no package.json above atlas/, so Node reads it as an ordinary
   script and createRequire is how an ES module asks for one.

   It is one file on purpose. These rules were written twice, and the two copies
   drifted: the browser's learned to clear the previous answers before writing
   new ones and this side did not, so a re-read that found three questions left
   the fourth one's column on every place and the map called a key "Pattern 4". */
const requireScript = createRequire(import.meta.url);
const RULES = requireScript(path.join(REPO_ROOT, 'atlas', 'reading-rules.js'));
// an atlas's look (theme.js) and the rule that makes one from a website's
// colours (look-map.js): the files the browser runs too, so one rule
const THEME = requireScript(path.join(REPO_ROOT, 'atlas', 'theme.js'));
const LOOK_MAP = requireScript(path.join(REPO_ROOT, 'atlas', 'look-map.js'));
// what waits for the LOKA team's yes: the one rule the wizard runs too (approval-rules.js)
const APPROVAL = requireScript(path.join(REPO_ROOT, 'atlas', 'approval-rules.js'));
// ATLAS_CATALOG_FILE: a check's own catalogue (test/approval-waits-test.mjs) — the
// builder keeps dispatching recipes by id from the repo's, so the ids must match
const CATALOG_FILE = process.env.ATLAS_CATALOG_FILE || path.join(REPO_ROOT, 'atlas', 'setup', 'catalog.json');
const GEOCACHE_DIR = path.join(reg.DATA_DIR, 'geocache');
// where the builder keeps the sources it has downloaded (jobs.js srcCache)
const SRC_CACHE_DIR = path.join(reg.DATA_DIR, 'srccache');

/* Two area thresholds used to decide everything: approval past 6 square
   degrees, outright refusal past 40. Both are gone. An area cannot tell you
   what a build will cost — an atlas of India holding boundaries and pins is
   seconds of work, and one district of terrain and forest is minutes — so the
   question is now asked of the layers, in feasibleLayers below. */
const MAX_INSTANCES = Number(process.env.ATLAS_MAX_INSTANCES) || 50;
const PER_IP_PER_DAY = Number(process.env.ATLAS_PER_IP_PER_DAY) || 3;
const ADMIN_EMAIL = process.env.ATLAS_ADMIN_EMAIL || 'mithun@socratus.org';

/* The trouble log knows when to write and what the fault is. It deliberately
   knows nothing about models or waiting readings, so the two facts an operator
   wants next — what is actually serving, and how much work is stacked up
   behind this — are added here, where they are known. */
setTroubleNotifier(({ subject, text }) => {
  const m = getResolverStatus();
  const waiting = owed.all().length;
  const footer = [
    '',
    '--',
    'Right now: reading on ' + m.reading + (m.readingIsFirstChoice ? '' : ' (fallback)') +
      ', answering on ' + m.answering + (m.answeringIsFirstChoice ? '' : ' (fallback)') + '.',
    waiting
      ? waiting + ' reading' + (waiting === 1 ? '' : 's') + ' waiting to be finished; ' +
        (waiting === 1 ? 'it' : 'they') + ' will be tried again on their own.'
      : 'No readings are waiting.',
  ].join('\n');
  return sendMail({ to: ADMIN_EMAIL, subject, text: text + footer + '\n' });
});

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
  /* Told how wide the region is, the catalogue says which layers can be built
     across it. Asked without a width it answers as it always did, so a caller
     that does not know yet is not lied to. */
  const areaDeg2 = Number(req.query.areaDeg2);
  /* estSecondsHere is the same figure the build gate adds up (layerSeconds,
     cache-aware), so "about N minutes to build" and "what waits for a yes"
     in the wizard are the server's own arithmetic; approvalAboveSeconds is
     the cap it adds them up against. */
  const ctx = { tier, iso3 };
  const layers = layersForTier(tier).map((l) => (Number.isFinite(areaDeg2) && areaDeg2 > 0
    ? { ...l, feasible: feasibleAt(l, areaDeg2), estSecondsHere: layerSeconds(l, areaDeg2, ctx), sourceCached: sourceCached(l, ctx) }
    : l));
  res.json({ tier, layers, areaDeg2: Number.isFinite(areaDeg2) ? areaDeg2 : undefined,
             budgetSeconds: BUILD_BUDGET_S, approvalAboveSeconds: BUILD_BUDGET_S });
});

/* What can actually be built across a region this wide.

   The rule this replaces refused the ATLAS. First on area alone, then — after
   it turned out that an atlas of India carrying only boundaries and somebody's
   own pins costs almost nothing — on area plus whether any chosen layer grows
   with it. Both versions answered a person who wanted a map of sightings across
   a continent by saying no.

   That is the wrong thing to refuse. Markers cost the same wherever they are:
   the same rows, the same pins, the same popups. What does not survive a
   continent is terrain read from imagery over every square degree, or rivers
   downloaded by bounding box. So the atlas is always buildable, and the LAYERS
   that cannot be built at this width are simply not on offer.

   Feasible means: it fits in the time a build is given. Every catalogue entry
   carries estSeconds, quoted for a region about two square degrees — a district
   or two, which is every atlas built so far. A layer whose work grows with the
   area is scaled by how much bigger this region is; the four that do not grow
   (boundaries, labels, buildings, roads — tiles and one national file) are not.
   The budget is the build timeout less a minute for everything around it.

   The arithmetic falls where you would want it: terrain, 90 seconds at two
   square degrees, is feasible up to about thirteen — a large cluster of
   districts — and not across ten states. Boundaries are feasible anywhere. */
const BUILD_BUDGET_S = 9 * 60;   // JOB_TIMEOUT_MS is ten minutes
const EST_AT_DEG2 = 2;           // the size estSeconds is quoted for

/* Whether a layer's source is already saved on this server.

   Most national sources are downloaded once (fetch_cached in
   api/atlas-builders/common.py) and read from srccache ever after, so the
   second atlas of rivers costs a fraction of the first — the nine-layer atlas
   of North Goa that the catalogue priced at 621 seconds was built in 54
   (5 Nov 2026). The catalogue names the files each recipe keeps (cacheFiles:
   one list, or one per tier, with {iso3} filled in — the names fetch_cached
   writes), and a file counts as kept by fetch_cached's own rule: present and
   not empty. A layer that names no file (terrain, rainfall, imagery read by
   the box) is never "cached" and keeps its full estimate. */
function cacheFilesOf(l, ctx) {
  const cf = l && l.cacheFiles;
  const list = Array.isArray(cf) ? cf : (cf && typeof cf === 'object' && ctx && ctx.tier ? cf[ctx.tier] : null);
  if (!Array.isArray(list)) return [];
  const iso3 = String((ctx && ctx.iso3) || '').toLowerCase();
  // a plain file name only: never a path, never a placeholder left unfilled
  return list.map((f) => String(f).replace(/\{iso3\}/g, iso3)).filter((f) => f && !/[{}/\\]/.test(f));
}
function sourceCached(l, ctx) {
  const files = cacheFilesOf(l, ctx);
  if (!files.length) return false;
  return files.every((f) => { try { return fs.statSync(path.join(SRC_CACHE_DIR, f)).size > 0; } catch { return false; } });
}
/* ctx = { tier, iso3 }: which files to look for. Left out, the estimate is the
   catalogue's, as if nothing were saved. What a saved source spares is the
   one-off download (the catalogue's downloadSeconds); the clip that follows
   is the same work as ever and still grows with the area, so the saving is
   taken off before the scaling, and never below a few seconds. */
function layerSeconds(l, areaDeg2, ctx) {
  const full = Number(l && l.estSeconds) || 30;
  const saved = l && ctx && sourceCached(l, ctx) ? Number(l.downloadSeconds) || 0 : 0;
  const base = Math.max(5, full - saved);
  if (!l || l.fixedCost) return base;
  return Math.round(base * Math.max(1, (Number(areaDeg2) || 0) / EST_AT_DEG2));
}
/* Feasible is judged on the FULL estimate, saved source or not: a cache can
   be cleared between the wizard and the build, and a layer offered on the
   strength of one would then be dropped mid-build. Only the approval gate
   (approvalFor) is told what is saved. */
function feasibleAt(l, areaDeg2) {
  return layerSeconds(l, areaDeg2) <= BUILD_BUDGET_S;
}

/* Split what was asked for into what will be built and what cannot be, at this
   width. Nothing is refused; the second list is what the answer has to name. */
function feasibleLayers(layerIds, allowed, areaDeg2) {
  const keep = [], dropped = [];
  for (const id of layerIds) {
    const l = allowed.get(id);
    if (!l) continue;
    (feasibleAt(l, areaDeg2) ? keep : dropped).push(id);
  }
  return { keep, dropped, droppedLabels: dropped.map((id) => (allowed.get(id) || {}).label || id) };
}

/* The one rule for what waits for the LOKA team — a first build and a rebuild
   both ask it. Two things wait: a layer the catalogue marks cost 'approval'
   (a heavy source), and a build that would take longer than the builder is
   given, BUILD_BUDGET_S — the same cap feasibility uses. Until 5 Nov 2026 the
   gate stood at half that, so an atlas priced at 621 seconds was parked for a
   person's yes and then built in 54. ctx.regionLabel, when given, names the
   region in the reason. */
function approvalFor(layerIds, allowed, areaDeg2, ctx) {
  const seconds = (id) => layerSeconds(allowed.get(id), areaDeg2, ctx);
  const heavyIds = layerIds.filter((id) => (allowed.get(id) || {}).cost === 'approval');
  const buildSeconds = layerIds.reduce((t, id) => t + seconds(id), 0);
  const longBuild = buildSeconds > BUILD_BUDGET_S;
  const reasons = [];
  if (heavyIds.length) reasons.push(`heavy layers: ${heavyIds.join(', ')}`);
  if (longBuild) {
    reasons.push(`a long build: ${ctx && ctx.regionLabel ? ctx.regionLabel + ', ' : ''}about ${Math.round(buildSeconds / 60)} minutes`);
  }
  return { needsApproval: reasons.length > 0, heavyIds, buildSeconds, longBuild, reasons };
}

/* A first build is split: what can be built now (everything that needs no
   yes and fits under the cap) and what waits. Over the cap, the dearest
   optional layer waits, then the next, until the rest fits; the boundaries
   never wait. Each waiting layer carries its label and its reason ('heavy':
   a layer the team checks first; 'long': the build would run too long), in
   the shape the mail, the owner's page and the wizard all read. The wizard's
   sentence beside Build (catalog-rows.js, plan) follows this same order from
   the server's own figures. */
function splitForApproval(layerIds, allowed, areaDeg2, ctx) {
  const items = layerIds.map((id) => {
    const l = allowed.get(id) || {};
    return { id, label: l.label || id, seconds: layerSeconds(allowed.get(id), areaDeg2, ctx), heavy: l.cost === 'approval', required: !!l.required };
  });
  return APPROVAL.split(items, BUILD_BUDGET_S);
}

/* A build the LOKA team said yes to is given the time its estimate asks for
   — the ordinary ten minutes is for builds that fit the budget, and an
   approved one is over it by definition. Half as much again plus a minute,
   never less than the usual ten minutes, never more than thirty. */
function approvedTimeoutMs(estSeconds) {
  const want = Math.round((Number(estSeconds) || 0) * 1.5) + 60;
  return Math.min(30 * 60, Math.max(10 * 60, want)) * 1000;
}

// "Floodplain is waiting for a yes from the LOKA team" — the one sentence for
// layers that wait, said by the publish refusal and the owner's page alike
function waitingLine(inst) {
  const pending = Array.isArray(inst && inst.pendingLayers) ? inst.pendingLayers : [];
  if (!pending.length) return '';
  const labels = pending.map((p) => APPROVAL.shortLabel(p.label || p.id));
  return APPROVAL.list(labels) + (labels.length > 1 ? ' are' : ' is') + ' waiting for a yes from the LOKA team';
}
// …and what happens next, for the owner's page (GET /instances/:slug): the wizard's sentence
function pendingNote(inst) {
  return waitingLine(inst) ? APPROVAL.waitSentence(inst.pendingLayers).replace(/ Everything else.*$/, '') : undefined;
}

router.get('/config', (_req, res) => {
  res.json({ budgetSeconds: BUILD_BUDGET_S, estAtDeg2: EST_AT_DEG2, approvalAboveSeconds: BUILD_BUDGET_S });
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
/* The bounds of an atlas with no region. Stops short of the poles, where the
   map's projection runs to infinity — the builder (common.py) uses the same. */
const WORLD_BBOX = [-180, -85, 180, 85];

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

/* Every name this country has, at any level, normalised.

   The cheap sieve for choosing WHICH column holds the places. It comes off the
   search index, which is already kept for the life of the process and carries
   no geometry — all of India is about 2 MB — so screening three columns costs
   lookups, not another parse of a 34 MB boundary file. */
const knownNamesCache = new Map();               // iso3 -> Set of normalised names
async function knownNames(iso3, avail) {
  const hit = knownNamesCache.get(iso3);
  if (hit) return hit;
  const set = new Set();
  for (const L of avail) {
    const idx = await searchLevelIndex(iso3, L);
    if (idx) for (const e of idx.entries) set.add(e.n);
  }
  knownNamesCache.set(iso3, set);
  return set;
}

/* How many units one atlas may cover, and why saying so matters.

   The cap is real work rather than a whim: every unit is a polygon fetched,
   clipped, simplified and written, and the whole build is killed at ten
   minutes. But it used to be applied with `.slice(0, 100)` in three places,
   which silently built a DIFFERENT atlas from the one somebody asked for —
   a file naming a hundred and fifty districts produced a hundred, and nothing
   anywhere said which fifty were gone. Dropping somebody's own choices
   without a word is worse than refusing.

   So it refuses, and says the number, because the person can act on that:
   take some out, or pick a coarser level where fewer units cover the same
   ground. */
const MAX_REGION_UNITS = 100;
function tooManyUnits(ids) {
  return ids.length > MAX_REGION_UNITS
    ? 'That is ' + ids.length + ' places, and an atlas can cover ' + MAX_REGION_UNITS + '. ' +
      'Take some out, or pick a coarser level \u2014 one state covers the ground of thirty districts.'
    : '';
}

const MAX_NAME_COLUMNS = 4;      // more than this and we are guessing, not choosing
const SCREEN_ROWS = 400;         // a sample is enough to tell two columns apart
const ONE_PLACE = [true];        // stands in for "yes, something is named here"

// How much of a column reads like places — the whole cell being a name, or a
// name sitting inside the sentence.
function columnHitRate(names, known) {
  const seen = names.slice(0, SCREEN_ROWS);
  if (!seen.length) return 0;
  const lookup = (k) => (known.has(k) ? ONE_PLACE : null);
  let hit = 0;
  for (const raw of seen) {
    const nm = String(raw == null ? '' : raw).trim();
    if (!nm) continue;
    let ok = false;
    for (const sp of aliasSpellings(nm)) if (known.has(sp)) { ok = true; break; }
    if (!ok && /\s/.test(nm)) ok = namesInside(nm, lookup).length > 0;
    if (ok) hit++;
  }
  return hit / seen.length;
}

/* Which of several candidate columns is the one holding places.

   The page ranks them by what their headings say, which is a guess: a form
   export's first column called "Name" is the person who filled the form, and
   asking a boundary file about Gijs Spoor and Sutanu Satpathy finds nothing.
   So the headings only decide the ORDER; what decides the answer is which
   column actually names places this country has. Ties keep the earlier one,
   which is the one whose heading read best. */
async function pickNameColumn(iso3, columns, avail) {
  if (columns.length < 2) return { col: columns[0].col, names: columns[0].names, rate: null };
  const known = await knownNames(iso3, avail);
  let best = null;
  for (const c of columns) {
    const rate = columnHitRate(c.names, known);
    if (!best || rate > best.rate) best = { col: c.col, names: c.names, rate };
  }
  return best;
}

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
  /* One column, or several to choose between. A page that knows which column
     holds the places sends that one; a page looking at a form export sends its
     best few and lets the boundary data settle it. `names` stays for anything
     still sending one unnamed column. */
  const cleanNames = (a) => (Array.isArray(a)
    ? a.map((n) => String(n == null ? '' : n).trim()).filter(Boolean).slice(0, MAX_ROWS) : []);
  const columns = (Array.isArray(b.columns) ? b.columns : [])
    .map((c) => ({ col: String((c && c.col) || ''), names: cleanNames(c && c.names) }))
    .filter((c) => c.names.length)
    .slice(0, MAX_NAME_COLUMNS);
  const names = cleanNames(b.names);
  if (names.length && !columns.length) columns.push({ col: '', names });
  if (!points.length && !columns.length) return res.status(400).json({ error: 'points or names required' });
  try {
    const r = await inferRegion({ iso3, points, columns });
    res.status(r.status).json(r.body);
  } catch (e) {
    console.warn('[atlas] geo/infer failed:', e.message);
    res.status(502).json({ error: 'inference failed: ' + e.message });
  }
});

/* The answer itself, for the route above and for a LOKA space's places
   (/auth/loka/region): { status, body }. */
async function inferRegion({ iso3, points, columns }) {
  // no country given: coordinates can resolve it; bare place names cannot
  if (!/^[A-Z]{3}$/.test(iso3)) {
    if (!points.length) {
      return { status: 400, body: { error: 'couldn’t tell the country from place names alone — choose it', needsCountry: true } };
    }
    iso3 = await resolveCountryFromPoints(points);
    if (!iso3) {
      return { status: 400, body: { error: 'couldn’t tell the country from this data — choose it', needsCountry: true } };
    }
  }
  let avail;
  try { avail = JSON.parse(fs.readFileSync(path.join(GEOCACHE_DIR, `${iso3}-levels.json`), 'utf8')).levels; }
  catch { avail = [1, 2, 3, 4]; }
  /* Does this data belong to the country it was filed under at all?

     Answered here, from the data, because nobody should have to be asked. A
     set of sightings across four countries is not a person failing to pick
     the right one — it is an atlas with no country, and the wizard can be
     told that rather than made to ask. */
  if (points.length) {
    const inside = await shareInsideCountry(iso3, points);
    if (inside < 0.5) {
      return { status: 200, body: { iso3, mode: 'points', worldwide: true,
                        shareInside: Number(inside.toFixed(2)),
                        rows: points.length, matchedRows: 0, units: [], level: null,
                        bbox: null, coverage: 0, parents: [], ancestors: [] } };
    }
  }
  let r = null, mode = null, chosen = null;
  if (points.length) { r = await inferRegionFromPoints(iso3, points, avail); mode = 'points'; }
  else {
    chosen = await pickNameColumn(iso3, columns, avail);
    r = await inferRegionFromNames(iso3, chosen.names, avail);
    mode = 'names';
  }
  // which column was read is part of the answer: when nothing is found, it is
  // the one thing that explains why
  const column = chosen ? chosen.col : '';
  if (!r || !r.units.length) {
    return { status: 200, body: { iso3, mode, column, level: null, units: [], bbox: null, coverage: 0,
                      rows: (r && r.rows) || points.length || (chosen && chosen.names.length) || 0,
                      matchedRows: 0,
                      unreadRows: (r && r.unreadRows) || 0,
                      countryRows: (r && r.countryRows) || 0,
                      outsideRows: (r && r.outsideRows) || 0,
                      outsideNames: (r && r.outsideNames) || [],
                      parents: [], ancestors: [] } };
  }
  /* The same question asked of names. More rows naming somewhere else than
     places inside here means the data is not of this country either. */
  if (mode === 'names' && (r.outsideRows || 0) > (r.matchedRows || 0)) {
    return { status: 200, body: { iso3, mode, column, worldwide: true,
                      outsideNames: r.outsideNames || [],
                      rows: r.rows, matchedRows: 0, units: [], level: null,
                      bbox: null, coverage: 0, parents: [], ancestors: [] } };
  }
  const parents = await parentUnitsOf(iso3, r.level, r.units);
  const ancestors = await ancestorChainOf(iso3, r.level, r.units);
  // geometry rides along for the confirmation map, but a huge covering set
  // (data spread across dozens of units) would bloat the response — drop it then
  const units = r.units.length <= 60 ? r.units : r.units.map(({ geometry, ...u }) => u);
  return { status: 200, body: { iso3, mode, column, level: r.level, units, bbox: r.bbox,
             coverage: Number(r.coverage.toFixed(3)),
             rows: r.rows, matchedRows: r.matchedRows, unreadRows: r.unreadRows,
             sharedRows: r.sharedRows || 0,
             countryRows: r.countryRows || 0,
             outsideRows: r.outsideRows || 0, outsideNames: r.outsideNames || [],
             parents, ancestors } };
}

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
/* A country's name is not a place inside that country.

   Measured live before this existed: a row reading "India" was placed in
   **Indi**, a taluk in Vijayapura district five hundred kilometres from
   Bengaluru, and "Bhutan" in **Bhuta**, a village in Uttar Pradesh. Nothing was
   broken — dice("india","indi") is 0.86 and dice("bhutan","bhuta") is 0.89,
   both over the 0.85 the fuzzy fallback accepts. The fallback is there for
   typos and spelling drift, and a country's name sits a hair above its
   threshold against a real unit inside that country.

   A file where every row said India put every row in Indi. A file with a few
   real states in it escaped, because those rows outvoted the guess at the
   level that won.

   So the guesser is gated, and only the guesser: this runs AFTER the exact
   lookup and the sentence scan have both failed. A village genuinely called
   Nepal still matches as that village, because its exact match happens first
   and never reaches here. */
const COUNTRY_BY_NAME = (() => {
  const m = {};
  for (const [iso3, name] of Object.entries(COUNTRY_NAMES)) m[norm(name)] = iso3;
  return m;
})();
// names people write that the official list does not carry
const COUNTRY_ALSO_CALLED = { bharat: 'IND', hindustan: 'IND', uk: 'GBR', usa: 'USA', uae: 'ARE' };
// and the ways of saying "the whole of it" without naming it
const WHOLE_COUNTRY = new Set(['nationwide', 'countrywide', 'national', 'wholecountry',
  'entirecountry', 'acrossthecountry', 'allthecountry', 'everywhere', 'allover']);

/* Which country a cell names, if it names one: "India", "Bharat", "Pan India",
   "all over India", "nationwide". Returns an iso3, or ''.

   The leading words are stripped only to see whether what remains is a country,
   so Panama keeps its pan and Allahabad keeps its all. */
function countryNamed(nm, iso3) {
  const k = norm(nm);
  if (!k) return '';
  if (WHOLE_COUNTRY.has(k)) return iso3;         // "nationwide" means the one we are in
  const named = (x) => COUNTRY_BY_NAME[x] || COUNTRY_ALSO_CALLED[x] || '';
  const self = named(k);
  if (self) return self;
  const bare = k.replace(/^(?:panacross|allover|pan|all|across|throughout|within|whole|entire|the)+/, '');
  return (bare && bare !== k) ? named(bare) : '';
}

/* Words that name a real place SOMEWHERE in the country and are almost never
   the place somebody means when they write one inside a sentence.

   Measured on a survey export: "East vidarbha maharashtra" put a respondent in
   East district, Delhi; "I work with industrial clients" found an ADM3 called
   Industrial; "Jeevan Bhima Nagar" found an ADM3 called Nagar. Each is a real
   entry in the boundary data and each was the wrong answer.

   The list only ever silences a word standing ALONE. "East Godavari", "New
   Delhi" and "Nagar Haveli" are two words and match as they always did, and a
   column whose every row simply says "East" still matches whole, because that
   is somebody answering the question rather than talking. */
const LOOSE_IN_A_SENTENCE = new Set([
  'east', 'west', 'north', 'south', 'central', 'new', 'old', 'upper', 'lower',
  'greater', 'district', 'districts', 'division', 'subdivision', 'block',
  'taluk', 'taluka', 'tehsil', 'mandal', 'circle', 'ward', 'zone', 'region',
  'state', 'city', 'town', 'village', 'villages', 'rural', 'urban', 'colony',
  'sector', 'phase', 'extension', 'layout', 'nagar', 'pura', 'puram', 'gaon',
  'industrial', 'port', 'station', 'market', 'hill', 'hills', 'valley',
  'island', 'islands', 'forest', 'park', 'reserve', 'sanctuary', 'national',
  'india', 'bharat', 'country', 'area', 'areas', 'place', 'places',
]);

// A sentence longer than this is somebody's life story, not an answer to
// "where do you work?" — and every extra word is another lookup on every level.
const SCAN_MAX_WORDS = 80;
// One answer naming more places than this has stopped being an answer.
const SCAN_MAX_HITS = 12;
// "Goa" is a state; three letters is the floor, below it is noise.
const SCAN_MIN_CHARS = 3;

/* The places a sentence NAMES, when the sentence is not itself a name.

   A survey asks "which geographic areas do you work in?" and gets back
   "BRT Tiger Reserve, Chamarajanagar district, Karnataka, India" — a district
   and a state, wrapped in words. Reading only whole cells finds neither.

   Three rules keep this from inventing places. Only OUTRIGHT matches count:
   the phrase is a name this country has, or a former spelling of one, and
   nothing is guessed at — a loose run of the same scan put the Western Ghats
   in West Delhi and Pan India in Panna. The longest phrase wins and takes its
   words with it, so "Arunachal Pradesh" is never also read as "Pradesh". And a
   single word that is loose in a sentence is skipped (see above).

   lookup(normalisedName) returns the places with that name, or nothing. */
function namesInside(text, lookup) {
  const out = [];
  const runs = String(text == null ? '' : text)
    .split(/[,.;:()[\]{}\n\/|"']+|\s+[-\u2013\u2014]\s+|\s{2,}/);
  let seen = 0;
  for (const run of runs) {
    const w = run.trim().split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    seen += w.length;
    if (seen > SCAN_MAX_WORDS) break;
    const taken = new Array(w.length).fill(false);
    for (let n = 3; n >= 1; n--) {
      for (let i = 0; i + n <= w.length; i++) {
        if (out.length >= SCAN_MAX_HITS) return out;
        let free = true;
        for (let j = i; j < i + n; j++) if (taken[j]) { free = false; break; }
        if (!free) continue;
        const phrase = w.slice(i, i + n).join(' ');
        const k = norm(phrase);
        if (k.length < SCAN_MIN_CHARS) continue;
        if (n === 1 && LOOSE_IN_A_SENTENCE.has(k)) continue;
        let cands = null;
        for (const sp of aliasSpellings(phrase)) { cands = lookup(sp); if (cands) break; }
        if (!cands) continue;
        for (let j = i; j < i + n; j++) taken[j] = true;
        out.push({ phrase, cands });
      }
    }
  }
  return out;
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
    // rows that name a whole country rather than a place inside one
    let countryRows = 0, outsideRows = 0;
    const outsideNames = new Set();
    const deferred = [];                         // [spelling, rows, candidates]
    const unknown = [];                          // [spelling, rows]

    // 1) the names that can only mean one place — these anchor everything else
    const lookup = (k) => byName.get(k) || null;
    let ax = 0, ay = 0, aw = 0;
    const keep = (f, n) => {
      hitU.set(f.properties.id, (hitU.get(f.properties.id) || 0) + n);
      const c = bboxCentre(f.bbox);
      if (c) { ax += c[0] * n; ay += c[1] * n; aw += n; }
    };
    for (const [nm, n] of tally) {
      // the cell as written, and under any name this place used to go by —
      // an atlas of Bengaluru should not miss boundary data that says Bangalore
      let cands = null;
      for (const sp of aliasSpellings(nm)) { cands = byName.get(sp); if (cands) break; }
      if (!cands) {
        /* Not a name. It may still CONTAIN one: people answering a question
           write sentences, and the place is inside the sentence. A single word
           has already been looked up as itself, so only sentences come here. */
        const inside = /\s/.test(String(nm).trim()) ? namesInside(nm, lookup) : [];
        if (!inside.length) {
          /* Nothing exact, nothing inside it. Before guessing at the spelling,
             ask whether this is a country — because that is the one answer the
             guesser gets confidently wrong. */
          const c = countryNamed(nm, iso3);
          if (c === iso3) { countryRows += n; continue; }        // the whole of this one
          if (c) { outsideRows += n; outsideNames.add(String(nm).trim()); continue; }
          unknown.push([nm, n]);
          continue;
        }
        matchedRows += n;                       // the ROW is answered, once
        // and counted as sharing a name once, however many it names
        if (inside.some((h) => h.cands.length > 1)) sharedRows += n;
        for (const h of inside) {
          // 'true': this row is already counted, so settling the shared name
          // later must not count it again
          if (h.cands.length > 1) { deferred.push([h.phrase, n, h.cands, true]); continue; }
          keep(h.cands[0], n);
        }
        continue;
      }
      if (cands.length > 1) { deferred.push([nm, n, cands, false]); continue; }
      matchedRows += n;
      keep(cands[0], n);
    }

    // 2) AT THE END: every shared name goes to its candidate nearest the anchor
    const anchor = aw ? [ax / aw, ay / aw] : anchorFromSpread(deferred);
    for (const [, n, cands, counted] of deferred) {
      let pick = cands[0], bestD = Infinity;
      for (const f of cands) {
        const d = farness(bboxCentre(f.bbox), anchor);
        if (d < bestD) { bestD = d; pick = f; }
      }
      // a name found inside a sentence already answered and counted its row
      if (!counted) { matchedRows += n; sharedRows += n; }
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
                   rows, matchedRows, unreadRows, sharedRows,
                   countryRows, outsideRows, outsideNames: [...outsideNames].slice(0, 6) };
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

/* How much of this data actually sits inside the country it was filed under.

   The wizard always sends a country, because one is always picked — India by
   default — so nothing ever asked whether the data agreed. A record of where
   something was sighted does not agree: half its points are somewhere else,
   and the honest answer is that this atlas has no country, not that the person
   should choose a better one.

   Sampled rather than exhaustive: fifty points settle this, and the question is
   "most of them or not", never a precise fraction. */
async function shareInsideCountry(iso3, points) {
  const sample = points.slice(0, 50);
  if (!sample.length) return 1;
  let doc; try { doc = await loadAdmin(iso3, 1); } catch { return 1; }
  const feats = doc.features || [];
  let inside = 0;
  for (const [x, y] of sample) {
    if (feats.some((f) => f.bbox && x >= f.bbox[0] && x <= f.bbox[2] &&
        y >= f.bbox[1] && y <= f.bbox[3] && pointInGeom(x, y, f.geometry))) inside++;
  }
  return inside / sample.length;
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
  /* A new atlas starts private (owner decision, 2026-10-09): its files sit
     outside the web root until its owner opens it from the Owner menu. Only a
     request that asks for 'public' in so many words gets a public one. The
     wizard sends nothing, so every atlas it builds is private — one rule here,
     not a choice per screen. Existing atlases keep whatever they have. */
  const visibility = b.visibility === 'public' ? 'public' : 'private';
  if (!title) return res.status(400).json({ error: 'give your atlas a title' });
  if (!org) return res.status(400).json({ error: 'add the organisation or project this atlas belongs to' });

  const branding = {
    orgName: cap(b.branding && b.branding.orgName, 60) || org,
    orgUrl: /^https:\/\/[^\s]+$/.test((b.branding && b.branding.orgUrl) || '') ? b.branding.orgUrl.slice(0, 200) : '',
    footerLine: cap(b.branding && b.branding.footerLine, 160),
    logoData: validLogo(b.branding && b.branding.logoData),
  };
  /* A logo chosen in the wizard (Mithun, 4 Nov 2026: the logo yes, styling
     only after the build). One the browser made badly is refused in words,
     not dropped, so nobody gets an atlas without the logo they chose. */
  if (b.branding && b.branding.logoData && !branding.logoData) {
    return res.status(400).json({ error: 'The logo could not be used. Choose it again, or leave it out and add it later under Owner ▾ → Settings.' });
  }

  // region
  const r = b.region || {};
  const iso3 = String(r.iso3 || '').toUpperCase();
  const level = Number(r.level) || 1;
  const shapeIDs = Array.isArray(r.shapeIDs) ? r.shapeIDs.map(String) : [];
  /* An atlas with no region at all.

     Every atlas until now was a country and some units inside it, because
     every atlas until now was of one landscape. A record of where something
     was sighted is not: it belongs to wherever it was seen, which may be four
     countries, and "which country is this atlas in" has no answer. Asking it
     anyway is what made such a map unbuildable.

     So: no units, no country, bounds the world, and the viewer frames the data
     itself when the map opens — it already does that for an owner's own layers.
     Boundaries are not forced on, because there is no region to outline. */
  const worldwide = !!r.worldwide;
  if (!worldwide && (!/^[A-Z]{3}$/.test(iso3) || !shapeIDs.length)) {
    return res.status(400).json({ error: 'region (iso3 + shapeIDs) is required' });
  }
  const tooMany = worldwide ? '' : tooManyUnits(shapeIDs);
  if (tooMany) return res.status(400).json({ error: tooMany, tooManyUnits: shapeIDs.length });
  let regionDoc = null, picked = [];
  if (!worldwide) {
    try {
      regionDoc = await loadAdmin(iso3, level);
    } catch (e) {
      return res.status(502).json({ error: 'boundary source unavailable: ' + e.message });
    }
    picked = regionDoc.features.filter((f) => shapeIDs.includes(f.properties.id));
    if (!picked.length) return res.status(400).json({ error: 'no matching boundary units' });
  }
  let w = 180, s = 90, e = -180, n = -90;
  if (worldwide) { w = -180; s = -85; e = 180; n = 85; }
  for (const f of picked) {
    w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]);
    e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]);
  }
  const areaDeg2 = (e - w) * (n - s);
  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = worldwide ? 'Worldwide'
    : shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  // tier + layers — resolved BEFORE the size gate, because the gate depends on them
  const tier = tierOf(iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : []).filter((id) => allowed.has(id));
  /* Boundaries are compulsory because an atlas of a region should show that
     region. An atlas with no region has nothing to outline, and forcing the
     layer on would ask the builder to draw a selection that does not exist. */
  if (!worldwide) {
    for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  } else {
    /* The wizard ticks the compulsory boundary layer for every atlas, and a
       worldwide one has no region document to draw it from — the builder then
       stopped with "Invalid URL 'None'" (seen, 2026-10-09). Taken out here, in
       the one place that already knows the rule, rather than in each screen. */
    layerIds = layerIds.filter((id) => !allowed.get(id).required);
  }
  if (!layerIds.length && !worldwide) return res.status(400).json({ error: 'no valid layers chosen' });

  /* Nothing is refused for being wide. What cannot be built across a region
     this size is dropped from the build and named in the answer, so an atlas
     of markers can be as wide as the markers are. */
  const estCtx = { tier, iso3, regionLabel };
  const fit = feasibleLayers(layerIds, allowed, areaDeg2);
  layerIds = fit.keep;
  if (!layerIds.length && !worldwide) {
    return res.status(400).json({
      error: 'Nothing can be built across a region this wide except boundaries, and they were not asked for.',
      droppedLayers: fit.droppedLabels });
  }

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

  /* The gate: approval follows the WORK, not the width (approvalFor — the one
     rule rebuilds use too). A wide atlas of outlines and pins is a few seconds
     of building and goes straight through. What needs a yes — a heavy layer,
     or more than the builder is given in one go — no longer holds the rest
     up: the atlas is built now without it (splitForApproval), the LOKA team
     is mailed, and the layers that wait are added by themselves once they say
     yes (actOnPendingLayers). Only when nothing could be built now does the
     whole atlas wait, as it always did (Mithun, 5 Nov 2026). The reference
     atlas is never split. */
  const verdict = approvalFor(layerIds, allowed, areaDeg2, estCtx);
  const plan = splitForApproval(layerIds, allowed, areaDeg2, estCtx);
  const splitBuild = verdict.needsApproval && plan.now.length > 0 && plan.later.length > 0 && !searchText.isNeverTouched(slug);
  const needsApproval = verdict.needsApproval && !splitBuild;
  const approvalReasons = verdict.reasons;
  const nowLayers = splitBuild ? plan.now : layerIds;
  const pendingLayers = splitBuild ? plan.later : undefined;
  // only its maker sees an atlas while layers wait — the same rule as Settings' "who can open it"
  if (splitBuild && visibility === 'public') {
    return res.status(400).json({ error: 'While ' + APPROVAL.list(pendingLayers.map((p) => APPROVAL.shortLabel(p.label))) +
      (pendingLayers.length > 1 ? ' wait' : ' waits') + ' for a yes from the LOKA team, the atlas starts private. Build it private, and open it to others once they have answered.' });
  }
  if (verdict.needsApproval && !reg.validEmail(email)) {
    return res.status(400).json({ error: 'this build needs a quick approval from the LOKA team — add a contact email so we can reach you', needsEmail: true });
  }

  /* "Bring places from a LOKA space", chosen in the wizard: checked here
     against the person's own LOKA link (the snapshot LOKA gave them; the
     operator may take any space), kept as wantLoka, and connected once the
     atlas is built (applyWantedLoka) — the same link as Settings makes. */
  let wantLoka;
  if (b.lokaSpace && typeof b.lokaSpace === 'object') {
    const spaceId = lokaSync.spaceIdFrom(b.lokaSpace.spaceId);
    if (!spaceId) return res.status(400).json({ error: 'That doesn’t look like a LOKA space.' });
    if (!lokaSync.isSetUp()) return res.status(503).json({ error: 'LOKA hasn’t been set up on this server yet.' });
    const sup = lokaSuper(req);
    const link = session ? reg.lokaLinkOf(session.email) : null;
    // the wizard's list is the snapshot: a space not on it was never offered, and is not taken (the operator may take any)
    const known = link ? (link.spaces || []).find((s) => s.id === spaceId) || null : null;
    if (!sup) {
      if (!link) return res.status(403).json({ error: LOKA_LINK_FIRST });
      if (!known) return res.status(403).json({ error: LOKA_NOT_LISTED });
    }
    if (known && !known.tagsCount) return res.status(400).json({ error: 'That space has no places yet.' });
    // the name is LOKA's, never the browser's: the snapshot's, else (the operator, unlinked) asked of LOKA
    let spaceName = known ? known.name : '';
    if (!spaceName) {
      try { const info = await lokaSync.spaceInfo(spaceId); spaceName = (info && info.name) || ''; }
      catch { /* LOKA away: a plain name, and the first update says what it says */ }
    }
    wantLoka = { spaceId, spaceName: spaceName || 'LOKA space', by: session ? session.email : '', sup };
  }

  const editToken = reg.newToken();
  const viewKey = visibility === 'private' ? reg.newToken() : null;

  const spec = {
    slug, visibility, tier, title, subtitle, about, branding,
    region: {
      iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n], worldwide,
      simplifiedFile: worldwide ? null : path.join(GEOCACHE_DIR, `${iso3}-ADM${level}.json`),
      fullResUrl: regionDoc ? regionDoc.fullResUrl : null,
    },
    layers: nowLayers,
    // what the build is priced at, for the time an approved build is given (approvedTimeoutMs)
    estSeconds: splitBuild ? plan.nowSeconds : verdict.buildSeconds,
  };

  reg.createInstance({
    slug, title, subtitle, about, org, email: email || null, branding: { ...branding, logoData: undefined, hasLogo: !!branding.logoData },
    ownerAccount: session ? session.email : null,
    tier, region: { iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n], areaDeg2, worldwide }, regionLabel,
    layers: nowLayers, visibility,
    tokenHash: reg.hashToken(editToken),
    viewKeyHash: viewKey ? reg.hashToken(viewKey) : null,
    viewKey: viewKey || null,
    status: needsApproval ? 'pending-approval' : 'building',
    createdAt: Date.now(), publishedAt: null, sizeBytes: 0, createdByIp: ip,
    jobId: null, spec,
    // "How should visitors explore it?" — applied once the atlas can take it (applyWantedMode)
    wantMode: b.mode === 'explore' || b.mode === 'insight' ? b.mode : undefined,
    wantLoka,
    // the layers that wait for the LOKA team's yes while the rest is built ([{id, label, why}])
    pendingLayers,
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
    if (splitBuild) {
      /* The rest is building; these links add the waiting layers (through the
         rebuild path, once the atlas is built) or leave them out. The whole
         atlas is never held. */
      const base = siteBase(req);
      const approve = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'approve-layers')}`;
      const deny = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'deny-layers')}`;
      const whyOf = (p) => (p.why === 'heavy' ? 'a heavy source' : 'the build would run too long with it');
      await sendMail({
        to: ADMIN_EMAIL,
        subject: `[LOKA Atlas] layers waiting: ${title} (${slug})`,
        text: `“${title}” is being built now without ${pendingLayers.map((p) => p.label).join(', ')} (${approvalReasons.join('; ')}).\n\n` +
          pendingLayers.map((p) => `  ${p.label} (${p.id}) — ${whyOf(p)}`).join('\n') + '\n\n' +
          `Org: ${org || '—'}\nContact: ${email}\nRegion: ${regionLabel} (${iso3}, ${areaDeg2.toFixed(1)} deg²)\n` +
          `Built now: ${nowLayers.join(', ')}\nWaiting: ${pendingLayers.map((p) => p.id).join(', ')}\nVisibility: ${visibility}\n\n` +
          `Add them:       ${approve}\nLeave them out: ${deny}\n`,
      });
    }
  }

  res.json({
    slug, jobId, status: needsApproval ? 'pending-approval' : 'building',
    // what the region was too wide to build — never a refusal, always said
    droppedLayers: fit.droppedLabels.length ? fit.droppedLabels : undefined,
    // what waits for a yes while the rest is built — by name, for the wizard's sentence
    pendingLayers: pendingLayers ? pendingLayers.map((p) => p.label) : undefined,
    editToken, viewKey: viewKey || undefined,
  });
});

/* ================= approval ================= */

router.get('/admin/action', async (req, res) => {
  const p = auth.readActionToken(String(req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This approval link is invalid or has expired.'));
  const inst = reg.getInstance(p.slug);
  if (!inst) return res.status(404).send(page('Not found', 'That atlas no longer exists.'));
  // layers that wait while the rest of the atlas is built (or already is)
  if (p.action === 'approve-layers' || p.action === 'deny-layers') {
    return actOnPendingLayers(req, res, inst, p.action === 'approve-layers');
  }
  if (inst.status !== 'pending-approval') {
    return res.send(page('Already handled', `“${inst.title}” is already ${inst.status}.`));
  }
  if (p.action === 'approve') {
    const jobId = enqueueBuild({ ...inst.spec, timeoutMs: approvedTimeoutMs(inst.spec && inst.spec.estSeconds) });
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
      // a change of layers is not a widening, and the mail should not call it one
      const ch = prior.change || {};
      const layersOnly = !ch.region && ((ch.added || []).length || (ch.removed || []).length);
      const asked = layersOnly
        ? ((ch.added || []).length ? 'adding ' + ch.added.join(', ') : 'that change of layers')
        : 'covering more ground';
      await sendMail({
        to: inst.email,
        subject: `[LOKA Atlas] ${layersOnly ? 'layers not changed' : 'not widened'}: ${inst.title}`,
        text: `"${inst.title}" stays as it is for now — ${asked} wasn't approved this time.\nYour atlas and its data are untouched. Reply to this email if you'd like to talk it through.`,
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

/* The yes or no for layers that waited while the rest of the atlas was built
   (pendingLayers, set by POST /instances). Yes: the layers are added through
   the rebuild path — now, if the atlas is built; otherwise the yes is kept
   (pendingApproved) and the job-done hook adds them the moment the build is
   done. No: the atlas keeps what it has, and the owner is told in plain words.
   Either way the links are good once; a second visit finds nothing waiting. */
async function actOnPendingLayers(req, res, inst, yes) {
  const pending = Array.isArray(inst.pendingLayers) ? inst.pendingLayers : [];
  if (!pending.length) {
    // a basic build that stopped let its waiting layers go (rebuildFailedPatch): say so, and the way on
    if (inst.status === 'failed') {
      return res.send(page('Not built', `The build of “${inst.title}” stopped, so nothing was added. Once it is built again, ` +
        `its owner can ask for these layers from Owner ▾ → Open data layers.`));
    }
    return res.send(page('Already handled', `“${inst.title}” has no layers waiting.`));
  }
  const labels = pending.map((p) => p.label || p.id).join(', ');
  /* Claimed before anything waits: a second press, a double click or a mail
     scanner's prefetch finds nothing left to do, so one yes starts one
     rebuild and rebuildPrior describes the right atlas. */
  if (!yes) {
    reg.updateInstance(inst.slug, { pendingLayers: undefined, pendingApproved: undefined });
    if (inst.email) {
      await sendMail({
        to: inst.email,
        subject: `[LOKA Atlas] built without ${labels}: ${inst.title}`,
        text: `Your atlas “${inst.title}” was built without ${labels} — ${pending.length > 1 ? 'they were' : 'it was'} not approved this time.\n` +
          `Everything else on it stays as it is. Reply to this email if you'd like to talk it through.`,
      });
    }
    return res.send(page('Left out', `“${inst.title}” keeps its map without ${labels}.`));
  }
  if (inst.status !== 'built' && inst.status !== 'published') {
    // still building (or waiting whole): the yes is kept, and the job-done hook adds them once
    if (inst.pendingApproved) return res.send(page('Already handled', `${labels} will be added to “${inst.title}” as soon as its build is done.`));
    reg.updateInstance(inst.slug, { pendingApproved: true });
    return res.send(page('Approved', `“${inst.title}” is not built yet — ${labels} will be added by itself as soon as its build is done.`));
  }
  reg.updateInstance(inst.slug, { pendingLayers: undefined, pendingApproved: undefined });
  const r = await addPendingLayers(inst, pending);
  if (r.error) return res.status(409).send(page('Could not add', `${labels} could not be added to “${inst.title}”: ${r.error}`));
  return res.send(page('Approved', `${labels} being added to “${inst.title}” now.`));
}

/* Add layers the team said yes to, to a built atlas: the rebuild path, with
   the gate already passed (approved). The caller has taken them off the
   record first (the claim above); a rebuild that could not start puts them
   back. The owner's own layers, logo and words ride across as on any
   rebuild, and a published atlas stays published. */
async function addPendingLayers(inst, pending) {
  const have = Array.isArray(inst.layers) ? inst.layers : [];
  const layers = have.concat(pending.map((p) => p.id).filter((id) => !have.includes(id)));
  const plan = await planRebuild(inst, { layers });
  const fresh = reg.getInstance(inst.slug);
  if (plan.error || !fresh) {
    reg.updateInstance(inst.slug, { pendingLayers: pending });
    return plan.error ? plan : { error: 'the atlas is gone' };
  }
  // a build started meanwhile (the owner's own rebuild): the yes is kept, the hook adds them after
  if (fresh.status === 'building' || fresh.status === 'pending-approval') {
    reg.updateInstance(inst.slug, { pendingLayers: pending, pendingApproved: true });
    return { ok: true, later: true };
  }
  const out = await startRebuild(fresh, plan, { approved: true });
  if (inst.email) {
    const labels = pending.map((p) => p.label || p.id).join(', ');
    await sendMail({
      to: inst.email,
      subject: `[LOKA Atlas] adding ${labels}: ${inst.title}`,
      text: `${labels} ${pending.length > 1 ? 'were' : 'was'} approved and ${pending.length > 1 ? 'are' : 'is'} being added to your atlas “${inst.title}” now.\n` +
        `The atlas stays as it is until the new map is ready, and your data stays where it is.`,
    });
  }
  return out;
}

/* The job-done hook: a yes that arrived while the atlas was still building.
   Not while LOKA is bringing its places in (applyWantedLoka starts that
   first update a moment before this runs): a rebuild swaps the folder the
   update is writing to. Asked again every second until the update is done,
   once per atlas. */
const LAYERS_AFTER_LOKA = new Set();
function addApprovedLayers(slug) {
  const inst = reg.getInstance(slug);
  if (!inst || !inst.pendingApproved || !(Array.isArray(inst.pendingLayers) && inst.pendingLayers.length)) return;
  if (inst.status !== 'built' && inst.status !== 'published') return;
  if (LOKA_RUNNING.has(slug)) {
    if (LAYERS_AFTER_LOKA.has(slug)) return;
    LAYERS_AFTER_LOKA.add(slug);
    const again = () => {
      if (LOKA_RUNNING.has(slug)) { setTimeout(again, 1000); return; }
      LAYERS_AFTER_LOKA.delete(slug);
      addApprovedLayers(slug);
    };
    setTimeout(again, 1000);
    return;
  }
  const pending = inst.pendingLayers;
  reg.updateInstance(slug, { pendingLayers: undefined, pendingApproved: undefined });
  addPendingLayers(inst, pending).then((r) => {
    if (r && r.error) console.warn(`[atlas] ${slug} — the approved layers could not be added: ${r.error}`);
  }).catch((e) => console.warn(`[atlas] ${slug} — the approved layers could not be added: ${e && e.message}`));
}

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
/* What the model is doing, for the operator. Read-only, and it names the two
   things that were invisible during the outage: which model each job is
   actually running on — first choice or fallen back — and any trouble still
   open against one. */
router.get('/admin/models', (req, res) => {
  if (!auth.isAdmin(req) && !auth.isAdminSession(req)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ models: getResolverStatus(), trouble: openTroubles(), owed: owed.all(), meaningIndex: meaningQueue.all() });
});

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
/* A rebuild that did not happen leaves the atlas exactly as it was. The rebuild
   route records the NEW region and layers before the build runs (so an approval
   needs no extra bookkeeping) and keeps the old ones in rebuildPrior; a build
   that fails or is stranded puts them back, so the record never describes
   layers the built files do not have — the Owner menu's "Open data layers"
   sheet pre-ticks from this record, and would otherwise offer a layer that was
   never built as though it were there. */
function rebuildFailedPatch(inst, message) {
  const prior = inst.rebuildPrior;
  const keepPublished = !!inst.rebuildKeepPublished;
  if (!prior) {
    // a LOKA space chosen while building goes with the build that failed (wantLoka)
    // and so do the layers that waited for a yes: there is no atlas to add them to (actOnPendingLayers says so)
    return keepPublished
      ? { status: 'published', failReason: message, rebuildKeepPublished: undefined, wantLoka: undefined }
      : { status: 'failed', failReason: message, wantLoka: undefined, pendingLayers: undefined, pendingApproved: undefined };
  }
  return {
    // the files on disk are the old build, which was built (or live) — say so
    status: keepPublished ? 'published' : (prior.status === 'published' ? 'published' : (prior.status || 'built')),
    failReason: message, rebuildKeepPublished: undefined, rebuildPrior: undefined, wantLoka: undefined,
    region: prior.region, regionLabel: prior.regionLabel, layers: prior.layers,
    ...(prior.tier ? { tier: prior.tier } : {}),
  };
}

setStrandedBuildHook((job) => {
  const inst = reg.getInstance(job.slug);
  if (!inst || inst.status !== 'building') return;
  const patch = rebuildFailedPatch(inst, job.message);
  reg.updateInstance(job.slug, patch);
  console.warn(`[atlas] ${job.slug} was left mid-build by a restart — put back to ` +
    patch.status + ' so it can be opened or removed');
});

setJobDoneHook((job) => {
  const inst = reg.getInstance(job.slug);
  if (!inst) return;
  const keepPublished = inst.rebuildKeepPublished; // set when rebuilding an already-published atlas
  const firstBuild = !inst.builtAt;   // a LOKA space chosen while building is for a new atlas, never a rebuild
  if (job.status === 'done') {
    reg.updateInstance(job.slug, {
      status: keepPublished ? 'published' : 'built',
      sizeBytes: job.sizeBytes || 0, builtAt: Date.now(),
      rebuildKeepPublished: undefined, rebuildPrior: undefined, failReason: undefined,
    });
    // the freshly built atlas gets its list photos made in the background
    setImmediate(() => { const fresh = reg.getInstance(job.slug); if (fresh) queueSmallPhotos(fresh); });
    // a LOKA space chosen while building: connected now, its places on their way
    setImmediate(() => { applyWantedLoka(job.slug, firstBuild); });
    // a mode chosen while building, if the atlas can already take it
    setImmediate(() => { applyWantedMode(job.slug); });
    // a tab icon set in Settings or from a look: the fresh manifest is told of it again
    setImmediate(() => { try { iconAfterBuild(job); } catch (e) { console.warn('[atlas] ' + job.slug + ' — the tab icon after a build: ' + (e && e.message)); } });
    // layers the LOKA team said yes to while this build ran: added now, after
    // the space and the mode above have had their turn (same order as queued)
    setImmediate(() => { addApprovedLayers(job.slug); });
  } else {
    // a rebuild failed — the build only swaps on success, so the old dataset
    // is untouched (and still live if it was); the record goes back with it
    reg.updateInstance(job.slug, rebuildFailedPatch(inst, job.message));
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
    /* An atlas can have more than one owner. Some are invited to one atlas and
       wear the owner role there; some own every atlas on this installation,
       which is how the operator reaches their own tools from a browser instead
       of from a token. See standingOwners in auth.js for what that costs. */
    if (auth.isStandingOwner(session.email)) return 'owner';
    const asked = reg.collaboratorRole(inst, session.email);
    if (asked) return asked;
  }
  return null;
}
function callerCanEdit(req, inst) { return callerRole(req, inst) !== null; }

router.get('/instances', (_req, res) => {
  res.json({ instances: reg.listPublic() });
});

router.get('/instances/:slug', (req, res) => {
  const slug = String(req.params.slug);
  const inst = reg.getInstance(slug);
  /* A dataset can exist on disk and have no registry entry. The reference
     atlas is one — it was built before the registry existed — and so is any
     folder put there by hand.

     The viewer asks this route one question on every load: may the person
     looking at this edit it? For those datasets the answer is plainly "no",
     and "no" is not the same as "there is no such thing". Answering 404 made
     every visit to the reference atlas log a failed request in the console,
     which JavaScript cannot suppress and which buries the errors that matter.

     Only the PUBLIC datasets folder is consulted, so this says nothing about
     whether a private atlas exists — the 404 below still guards that. */
  if (!inst) {
    /* A plain slug and nothing else, so it cannot walk out of the folder.

       Deliberately NOT validSlug: that answers "may somebody claim this
       address", and the reference atlas's address is on the reserved list
       precisely because it is already taken — so the one dataset this was
       written for was the one it turned away. */
    const plain = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug);
    if (plain && fs.existsSync(path.join(DATASETS_ROOT, slug, 'manifest.json'))) {
      return res.json({ slug, canEdit: false, registered: false });
    }
    return res.status(404).json({ error: 'not found' });
  }
  const role = callerRole(req, inst);
  if (role) {
    /* The private link's key (viewKey) stays in: it is how the owner's Share
       panel shows the link again. Only people who may already read every file
       of the atlas get here, so the key tells them nothing they could not do. */
    const { tokenHash, viewKeyHash, spec, ...rest } = inst;
    return res.json({ ...rest, canEdit: true, role, pendingNote: pendingNote(inst) });
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
  // only its maker sees an atlas while layers wait for the LOKA team (Mithun, 5 Nov 2026)
  if (waitingLine(inst)) return res.status(409).json({ error: waitingLine(inst) + ' — it can be listed once they have answered.', pendingLayers: inst.pendingLayers.map((p) => p.label || p.id) });
  // Listing is for atlases anyone may open. A private one is reachable only
  // with its private link, so putting it on the public page would be a lie.
  if (inst.visibility === 'private') {
    return res.status(409).json({ error: 'a private atlas cannot be listed — open it to anyone with the link first' });
  }
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

  // the same address for both kinds: this email goes to someone who may edit
  // the atlas, and a private one opens for them once they sign in
  const link = `${siteBase(req)}/apps/atlas/a/${inst.slug}` + (inst.visibility === 'private'
    ? `  (private — it opens for you once you sign in; the private link for other people is under Share, in the Owner menu)`
    : '');
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

/* Small photos for an atlas's lists (deploy/make-small-photos.mjs), kept up to
   date on their own: queued after a build finishes and after every committed
   layer, public or private, with no request ever waiting on it. One run per
   atlas at a time — a second request to run while one is already going just
   marks "run again when it's done", because the places may have changed again
   meanwhile. Never blocks, never fails a request; trouble goes to console.warn
   only. SMALL_PHOTOS holds the one status line the Owner menu polls. */
const SMALL_PHOTOS = new Map(); // slug -> { running, done, total, made, failed, finishedAt, again }
function queueSmallPhotos(inst) {
  if (!inst || searchText.isNeverTouched(inst.slug)) return;
  // a build swaps the whole folder; the build-done hook queues the photos afterwards
  if (inst.status === 'building') return;
  const slug = inst.slug;
  const st = SMALL_PHOTOS.get(slug);
  if (st && st.running) { st.again = true; return; }
  SMALL_PHOTOS.set(slug, { running: true, done: 0, total: 0, made: 0, failed: 0, finishedAt: null });
  setImmediate(() => runSmallPhotos(slug));
}
async function runSmallPhotos(slug) {
  const rec = SMALL_PHOTOS.get(slug) || { running: true, done: 0, total: 0, made: 0, failed: 0, finishedAt: null };
  rec.running = true;
  SMALL_PHOTOS.set(slug, rec);
  try {
    const inst = reg.getInstance(slug);
    if (!inst) return;
    const dir = datasetDirFor(inst);
    const r = await makeSmallPhotos({
      dir, slug, apply: true,
      log: () => {}, // the CLI's own narration; the server keeps only the numbers
      onProgress: ({ done, total }) => { rec.done = done; rec.total = total; },
      // a rebuild started while the photos were fetched: write nothing into a folder being swapped
      beforeWrite: () => { const now = reg.getInstance(slug); return !!now && now.status !== 'building'; },
    });
    rec.made = (r && r.made) || 0;
    rec.failed = ((r && r.failed) || []).length;
  } catch (e) {
    console.warn('[small-photos] ' + slug + ' — ' + (e && e.message));
  } finally {
    rec.running = false;
    rec.finishedAt = Date.now();
    const again = rec.again;
    rec.again = false;
    SMALL_PHOTOS.set(slug, rec);
    if (again) setImmediate(() => runSmallPhotos(slug));
  }
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
  if (b.hasIcon) bset.icon = 'branding-icon.png';   // the page's tab icon (atlas.js sets <link rel="icon">)
  if (Object.keys(bset).length) m.branding = bset; else delete m.branding;
  try {
    const tmp = mf + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m, null, 1));
    fs.renameSync(tmp, mf);
    return true;
  } catch { return false; }
}

/* The owner's name for the place, onto the atlas's own overlay
   (manifest.local.json, top level, beside its layers) — the file the viewer
   reads fresh on every visit, which a rebuild of the base map and an update
   of the code both leave alone. Empty takes it off. */
function writePlaceName(inst) {
  const file = path.join(datasetDirFor(inst), 'manifest.local.json');
  let local = { layers: [] };
  try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet: start one */ }
  const name = shortLabels.LABELS.cleanPlaceName(inst.placeName);
  if ((local.placeName || '') === name) return true;
  if (name) local.placeName = name; else delete local.placeName;
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify(local, null, 1));
    fs.renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}

/* ---------- how visitors explore: Standard, Event, Explore or Insight ----------
   An atlas's mode lives in its overlay (manifest.local.json) as `mode`;
   Standard is no `mode` at all. The settings of a mode not in use wait under
   `modeKept[<name>]`, so switching back brings them back as they were left.
   One rule for every atlas, public or private (datasetDirFor). Only the
   owner switches, and only the owner edits Explore's buttons. */
const EXPLORE = requireScript(path.join(REPO_ROOT, 'atlas', 'explore-mode.js'));
const INSIGHT = insightSummary.IM;   // atlas/insight-mode.js: the rules the page runs too
const MODE_NAMES = ['standard', 'event', 'explore', 'insight'];
const EVENT_NOT_SET_UP = 'An event guide needs its venues and programme set up first. LOKA sets this up for you — write to us.';
const SAFE_LAYER_FILE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function readOverlay(inst) {
  const file = path.join(datasetDirFor(inst), 'manifest.local.json');
  let local = null;
  try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { local = null; }
  return { file, local: local && typeof local === 'object' && !Array.isArray(local) ? local : null };
}
function writeOverlay(file, local) {
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify(local, null, 1));
    fs.renameSync(file + '.tmp', file);
    return true;
  } catch { return false; }
}
// the mode in use: 'explore', 'event' or 'insight' when the overlay says so, else 'standard'
function modeNow(local) {
  const m = local && local.mode;
  return m && typeof m === 'object' && (m.name === 'explore' || m.name === 'event' || m.name === 'insight') ? m.name : 'standard';
}
function keptOf(local) {
  const k = local && local.modeKept;
  return k && typeof k === 'object' && !Array.isArray(k) ? k : {};
}
function modeAnswer(local) {
  const name = modeNow(local), kept = keptOf(local);
  const out = { name, kept: Object.keys(kept).filter((k) => kept[k] && typeof kept[k] === 'object'), canEvent: name === 'event' || !!(kept.event && typeof kept.event === 'object') };
  if (name === 'explore' || name === 'insight') out.mode = local.mode;
  return out;
}
/* The atlas's own layers whose file the private data route would serve (a
   file name only, never a path out of the folder), and one layer's places. */
function ownLayers(local) {
  return ((local && local.layers) || []).filter((L) => L && (L.group || 'userdata') === 'userdata' &&
    SAFE_LAYER_FILE.test(String(L.source || '')) && !String(L.source).includes('..'));
}
function placesOf(inst, L) {
  try { return JSON.parse(fs.readFileSync(path.join(datasetDirFor(inst), L.source), 'utf8')).features || []; } catch { return null; }
}
/* The model caller for naming Explore buttons: one call, the server's own
   allowance (as the nouns job), null with no model. The stand-in
   (FAKE_READING) answers with the plain names, worked out from the prompt. */
function buttonNamesCaller(payer) {
  if (!ai && !FAKE_READING) return null;
  const stub = FAKE_READING ? async (model, prompt) => {
    let j = null;
    try { j = JSON.parse(String(prompt).split('\n').pop()); } catch { j = null; }
    const groups = ((j && j.buttons) || []).map((b) => ({ names: (b.answers || []).map((a) => a.answer) }));
    return buttonNames.standInAnswer(groups);
  } : null;
  // the owner's own allowance when they asked (their request); the server's for a rebuild
  return aiCaller(payer || 'server', 1, stub);
}
/* Buttons from the atlas's own analysis, named (button-names.js): the layer
   asked for first, then the atlas's other layers. null when no question of
   any layer qualifies. Never throws. */
async function smartExplore(inst, local, prev, preferLayer, payer) {
  const layers = ownLayers(local);
  layers.sort((a, b) => (b.id === preferLayer) - (a.id === preferLayer));
  for (const L of layers) {
    if (!L.keyLabels) continue;
    const feats = placesOf(inst, L);
    if (!feats || !feats.length) continue;
    let r = null;
    try {
      r = await buttonNames.nameSmartButtons({ layer: L, features: feats, prev, call: buttonNamesCaller(payer),
        model: getFlashLiteModel(), Type, title: inst.title || '' });
    } catch (e) {
      console.warn('[buttons] ' + inst.slug + ' — ' + (e && e.message));
      r = null;
    }
    if (r) {
      console.log('[buttons] ' + inst.slug + ' — names: ' + r.by);
      return { layer: L, feats, ...r };
    }
  }
  return null;
}
// LOKA's categories: a button for each of the four words most places use, and Odds & ends
function categoryButtons(feats) {
  const col = { tagColumn: 'categories' };
  return EXPLORE.withRest(EXPLORE.defaultButtons(feats, col), feats, col);
}
/* A new Explore, with nothing kept: buttons from the atlas's own analysis
   when one of its questions sorts most places into a few groups
   (explore-mode.js pickQuestion); otherwise the atlas's own places (the first
   of its layers whose places have categories, else its first layer of its
   own), and a button for each of the four words most of them use. Either way
   "Odds & ends" holds the places under no other button. */
async function defaultExplore(inst, local, req) {
  if (!NEVER_READ.has(inst.slug)) {
    // names LOKA gave before, if an Explore was ever set up here and put aside
    const was = keptOf(local).explore;
    const smart = await smartExplore(inst, local, was && typeof was === 'object' ? { analysisNames: was.analysisNames } : null, null, req);
    if (smart) {
      return { name: 'explore', layer: smart.layer.id, tagColumn: smart.tagColumn, frameShare: 0.8,
        buttons: smart.buttons, buttonsFrom: 'analysis', buttonsSig: smart.buttonsSig, ...(smart.analysisNames ? { analysisNames: smart.analysisNames } : {}) };
    }
  }
  const col = 'categories';
  let layer = null, feats = null;
  for (const L of ownLayers(local)) {
    const f = placesOf(inst, L);
    if (!f) continue;
    if (!layer) { layer = L; feats = f; }
    if (f.some((x) => x && x.properties && x.properties[col] != null && String(x.properties[col]).trim())) { layer = L; feats = f; break; }
  }
  if (!layer) return null;
  return { name: 'explore', layer: layer.id, tagColumn: col, frameShare: 0.8,
    buttons: categoryButtons(feats), buttonsFrom: 'categories' };
}
// the places of the layer an Explore draws (its own layer, else the first of the atlas's)
function exploreLayerOf(inst, local) {
  const layers = ownLayers(local);
  const L = layers.find((x) => x.id === (local.mode && local.mode.layer)) || layers[0];
  if (!L) return null;
  const feats = placesOf(inst, L);
  return feats ? { layer: L, feats } : null;
}

/* After an atlas's reading is written (commitLayer, fromReading), its
   Explore buttons are worked out again — only when it is in Explore, its
   buttons came from the analysis and the owner has not edited them
   (button-names.js shouldRework); never the operator's own atlas. The names
   are kept when the answers make the same buttons; otherwise named afresh.
   If no question qualifies any more, the buttons go back to LOKA's
   categories. Written only if nothing changed while the names were asked
   for. Never throws. */
async function reworkSmartButtons(dataset, layerId) {
  const inst = reg.getInstance(dataset);
  if (!inst) return 'no atlas';
  const first = readOverlay(inst);
  const why = buttonNames.shouldRework(dataset, first.local, layerId, NEVER_READ);
  if (why !== true) return why;
  const prev = first.local.mode;
  const smart = await smartExplore(inst, first.local, prev, prev.layer || layerId, 'server');
  const { file, local } = readOverlay(inst);
  if (buttonNames.shouldRework(dataset, local, layerId, NEVER_READ) !== true) return 'changed meanwhile';
  if (smart) {
    local.mode = { ...local.mode, layer: smart.layer.id, tagColumn: smart.tagColumn, buttons: smart.buttons,
      buttonsFrom: 'analysis', buttonsSig: smart.buttonsSig, ...(smart.analysisNames ? { analysisNames: smart.analysisNames } : {}) };
  } else {
    const got = exploreLayerOf(inst, local);
    if (!got) return 'no places';
    local.mode = { ...local.mode, tagColumn: 'categories', buttons: categoryButtons(got.feats), buttonsFrom: 'categories' };
    delete local.mode.buttonsSig;
  }
  if (!writeOverlay(file, local)) return 'not written';
  console.log('[buttons] ' + dataset + ' — Explore buttons worked out again from ' +
    (smart ? '"' + smart.question + '" (names: ' + smart.by + ')' : 'LOKA categories (no question sorts the places now)'));
  return 'reworked';
}

/* ---------- Insight: the questions, with the story of the place on top ----------
   The layer whose questions Insight reads: the mode's own, else the first of
   the atlas's layers with a question some place answers that is not about
   people (insight-mode.js canInsight). null when there is none — then
   Insight cannot be chosen yet. */
function insightSource(inst, local, layerId) {
  const layers = ownLayers(local).filter((L) => L.keyLabels && typeof L.keyLabels === 'object');
  layers.sort((a, b) => (b.id === layerId) - (a.id === layerId));
  for (const L of layers) {
    const feats = placesOf(inst, L);
    if (feats && feats.length && INSIGHT.canInsight(L, feats)) return { layer: L, feats };
  }
  return null;
}
/* The model caller for the story. The stand-in (FAKE_READING) writes one
   sentence a group from the digest and vouches for everything at the
   proofread (the call marked proofread: true), so a test can predict it. */
function insightCaller(payer, digest) {
  if (!ai && !FAKE_READING) return null;
  const stub = FAKE_READING ? async (model, prompt, schema, o) => {
    if (o && o.proofread) return insightSummary.standInStoryProofread(prompt);
    return insightSummary.standInStory(digest);
  } : null;
  // 4: the write and its proofread, then one re-write of what was dropped and its proofread
  return aiCaller(payer || 'server', 4, stub);
}
/* One story job per atlas at a time; a pending flag carries when it was set
   (summaryPendingAt), and one older than seven minutes (insight-mode.js
   PENDING_STALE_MS, the room four Pro calls need) is stuck, not pending. */
const INSIGHT_RUNNING = new Set();
function markPending(mode) { mode.summaryPending = true; mode.summaryPendingAt = Date.now(); return mode; }
function clearPendingOf(mode) { delete mode.summaryPending; delete mode.summaryPendingAt; return mode; }
/* What the story is written from: the places and their own words, read
   against every question LOKA asked of them but the people ones (storyDigest
   holds that). Which questions the owner shows is deliberately NOT in it
   (Mithun, 5 Nov 2026): switching one off is not worth four calls to a Pro
   model. The card drops the quotes that came from a hidden question's column
   instead (insight-mode.js storyToShow), and the story is written afresh on
   the next update or "Write it again". */
function storyDigestOf(src) {
  return INSIGHT.storyDigest(src.layer, src.feats);
}
/* Does the mode need its story written: on, and none kept for these same
   places and words. STORY_VERSION is in the fingerprint, so every Insight
   atlas writes its story once after a change of version — on its next update
   or "Write it again", never all at once at deploy. */
function insightNeedsSummary(mode, src) {
  if (!mode || mode.summaryOn === false || !src) return false;
  const sig = insightSummary.storySig(storyDigestOf(src));
  return !(mode.story && mode.story.sig === sig);
}
/* Write (or keep) the story of an atlas in Insight — "the story of the place" —
   and store it in the mode as `story`. `payer`: the owner's request when they
   asked, 'server' after a reading. Written only if the atlas is still in
   Insight; summaryPending is cleared whatever happens. Never throws.

   What is kept always carries the fingerprint, even when the story says
   nothing, so a run that found nothing is not repeated on every update. The
   older `summary` is dropped the moment a story stands in its place; until
   then the card goes on showing it. */
async function runInsightSummary(slug, payer, opts) {
  if (INSIGHT_RUNNING.has(slug)) return 'already writing';
  INSIGHT_RUNNING.add(slug);
  try {
    const inst = reg.getInstance(slug);
    if (!inst) return 'no atlas';
    const o = opts || {};
    const first = readOverlay(inst);
    const why = insightSummary.shouldRewrite(slug, first.local, NEVER_READ);
    const clearPending = () => {
      const f = readOverlay(inst);
      if (f.local && modeNow(f.local) === 'insight' && f.local.mode.summaryPending) {
        f.local.mode = clearPendingOf({ ...f.local.mode });
        writeOverlay(f.file, f.local);
      }
    };
    if (why !== true) { clearPending(); return why; }
    const m = first.local.mode;
    const src = insightSource(inst, first.local, m.layer);
    if (!src) { clearPending(); return 'no questions'; }
    if (o.markPending && !o.force && insightNeedsSummary(m, src) && !INSIGHT.isPending(m)) {
      first.local.mode = markPending({ ...m });
      writeOverlay(first.file, first.local);
    }
    const digest = storyDigestOf(src);
    const sig = insightSummary.storySig(digest);
    if (!o.force && m.story && m.story.sig === sig) { clearPending(); return 'kept'; }
    const r = await insightSummary.writeStory({ layer: src.layer, features: src.feats, digest, call: insightCaller(payer, digest),
      model: getStoryModel(), proofreadModel: getStoryProofreadModel(), Type });
    const { file, local } = readOverlay(inst);
    if (!local || modeNow(local) !== 'insight') return 'changed meanwhile';
    const mode = { ...local.mode };
    /* The model could not be had at all (Mithun, 5 Nov 2026). Nothing is
       written over what stands — the story, or the older summary on an atlas
       whose story is not written yet — and the fingerprint is NOT stamped, so
       the next update tries again. The owner is told, in plain words: the
       overlay is public, so the model's own error never goes in it.
       A run the checks threw out is no failure: their own words are kept. */
    if (r.failed) {
      mode.storyFailed = { why: /proofread/.test(r.failed) ? 'the proofread could not be had' : 'the writer could not be reached', at: Date.now() };
    } else {
      const kept = insightSummary.storyKept(r);
      // a run that honestly found nothing does not take an older summary away
      if (kept.sentences.length || kept.quotes.length) delete mode.summary;
      mode.story = kept;
      delete mode.storyFailed;
    }
    clearPendingOf(mode);
    local.mode = mode;
    if (!writeOverlay(file, local)) return 'not written';
    /* The log says what happened and which places were left out, by id and
       reason — never a word anybody wrote, and never a name. */
    const out = (r.dropped || []).filter((d) => d.what === 'sentence').length;
    const now = mode.story || { sentences: [], quotes: [] };
    console.log('[insight] ' + slug + ' — story: ' + r.by + ' (' + now.sentences.length + ' sentence(s), ' +
      now.quotes.length + ' quote(s)' + (out ? ', ' + out + ' dropped' : '') + (now.ownWords ? ', their own words' : '') +
      (mode.storyFailed ? '; what stood before stands, and it is written again on the next update' : '') + ')');
    (r.calls || []).forEach((c) => console.log('[insight] ' + slug + ' — ' + c.what + ' on ' + c.model + ', ' + c.seconds + 's' + (c.failed ? ': ' + c.failed : '')));
    return r.by;
  } catch (e) {
    console.warn('[insight] ' + slug + ' — ' + (e && e.message));
    return 'failed';
  } finally {
    INSIGHT_RUNNING.delete(slug);
  }
}

router.get('/instances/:slug/mode', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const { local } = readOverlay(inst);
  const ans = modeAnswer(local || {});
  // Insight can be chosen once the atlas has been read: a question, not about people, that places answer
  ans.canInsight = ans.name === 'insight' || !!(local && insightSource(inst, local, null));
  res.json({ ...ans, canChange: callerRole(req, inst) === 'owner' });
});

router.post('/instances/:slug/mode', async (req, res) => {
  try { await postMode(req, res); } catch (e) {
    console.warn('[atlas] mode — ' + (e && e.message));
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Nothing changed — try again.' });
  }
});
async function postMode(req, res) {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const role = callerRole(req, inst);
  if (!role) return res.status(403).json({ error: 'not allowed' });
  if (role !== 'owner') return res.status(403).json({ error: 'Only the owner can change how visitors explore this atlas.' });
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    return res.status(409).json({ error: 'Wait for the atlas to finish building, then try again.' });
  }
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  let { file, local } = readOverlay(inst);
  if (!local) return res.status(409).json({ error: 'This atlas has no places of its own yet. Add your data first.' });
  const now = modeNow(local);

  // Explore's buttons, edited and saved: from now on a rebuild leaves them as they are
  if (b.name === undefined && b.groupBy === undefined && b.buttons !== undefined) {
    if (now !== 'explore') return res.status(409).json({ error: 'Buttons are for Explore. Switch the atlas to Explore first.' });
    const clean = EXPLORE.cleanButtons(b.buttons);
    if (clean.error) return res.status(400).json({ error: clean.error });
    // "Odds & ends" comes and goes by itself, as the places under no other button do
    const got = exploreLayerOf(inst, local);
    const buttons = got ? EXPLORE.withRest(clean.buttons, got.feats, local.mode) : clean.buttons;
    local.mode = { ...local.mode, buttons, buttonsEdited: true };
    if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save the buttons. Nothing changed — try again.' });
    return res.json({ ok: true, ...modeAnswer(local) });
  }

  /* Insight's settings: the summary on or off, which questions show and their
     order (insight-mode.js cleanSettings: a people question can never be
     shown). Turning it on writes the story, if none is kept for these places. */
  if (b.name === undefined && b.insight !== undefined) {
    if (now !== 'insight') return res.status(409).json({ error: 'These settings are for Insight. Switch the atlas to Insight first.' });
    const src = insightSource(inst, local, local.mode.layer);
    if (!src) return res.status(409).json({ error: INSIGHT.NO_QUESTIONS });
    const clean = INSIGHT.cleanSettings(src.layer, b.insight, local.mode);
    if (clean.error) return res.status(400).json({ error: clean.error });
    const mode = { ...local.mode, layer: src.layer.id, ...clean.settings };
    const write = !NEVER_READ.has(inst.slug) && insightNeedsSummary(mode, src) && !INSIGHT.isPending(mode) && !INSIGHT_RUNNING.has(inst.slug);
    if (write) markPending(mode);
    local.mode = mode;
    if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
    res.json({ ok: true, ...modeAnswer(local) });
    if (write) setImmediate(() => { runInsightSummary(inst.slug, req); });
    return;
  }
  // "Write it again": the owner's allowance; visitors see the questions meanwhile
  if (b.name === undefined && b.rewriteSummary !== undefined) {
    if (now !== 'insight') return res.status(409).json({ error: 'The story of the place is for Insight. Switch the atlas to Insight first.' });
    if (local.mode.summaryOn === false) return res.status(409).json({ error: 'Turn the story of the place on first.' });
    if (NEVER_READ.has(inst.slug)) return res.status(409).json({ error: 'LOKA does not write the story of the place for this atlas.' });
    if (INSIGHT_RUNNING.has(inst.slug)) return res.json({ ok: true, by: 'already writing', ...modeAnswer(local) });
    local.mode = markPending({ ...local.mode });
    writeOverlay(file, local);
    const by = await runInsightSummary(inst.slug, req, { force: true });
    const fresh = readOverlay(inst);
    return res.json({ ok: true, by, ...modeAnswer(fresh.local || {}) });
  }

  // Explore's "Group by": the atlas's own analysis, or LOKA's categories — buttons made afresh, written at once
  if (b.name === undefined && b.groupBy !== undefined) {
    if (now !== 'explore') return res.status(409).json({ error: 'Buttons are for Explore. Switch the atlas to Explore first.' });
    if (b.groupBy !== 'analysis' && b.groupBy !== 'categories') return res.status(400).json({ error: 'Group the buttons by the atlas\u2019s own analysis or by LOKA categories.' });
    let next;
    if (b.groupBy === 'analysis') {
      /* LOKA's names, not the ones the owner typed: the last ones LOKA gave
         these same answers (analysisNames) are used again with no call */
      const prev = local.mode.buttonsEdited ? { analysisNames: local.mode.analysisNames } : local.mode;
      const smart = NEVER_READ.has(inst.slug) ? null : await smartExplore(inst, local, prev, local.mode.layer, req);
      if (!smart) {
        return res.status(409).json({ error: 'None of the questions LOKA found about these places sorts most of them into a few groups, so the buttons stay with LOKA categories.' });
      }
      next = { layer: smart.layer.id, tagColumn: smart.tagColumn, buttons: smart.buttons, buttonsFrom: 'analysis', buttonsSig: smart.buttonsSig };
      if (smart.analysisNames) next.analysisNames = smart.analysisNames;
    } else {
      const got = exploreLayerOf(inst, local);
      if (!got) return res.status(409).json({ error: 'Explore needs places of your own on the atlas. Add your data first.' });
      next = { layer: got.layer.id, tagColumn: 'categories', buttons: categoryButtons(got.feats), buttonsFrom: 'categories' };
    }
    // the newest copy: the names may have taken a few seconds
    const fresh = readOverlay(inst);
    if (!fresh.local || modeNow(fresh.local) !== 'explore') return res.status(409).json({ error: 'The atlas changed while the buttons were being chosen. Try again.' });
    const mode = { ...fresh.local.mode, ...next };
    delete mode.buttonsEdited;
    if (next.buttonsFrom !== 'analysis') delete mode.buttonsSig;
    fresh.local.mode = mode;
    if (!writeOverlay(fresh.file, fresh.local)) return res.status(500).json({ error: 'Could not save the buttons. Nothing changed — try again.' });
    return res.json({ ok: true, ...modeAnswer(fresh.local) });
  }

  const want = typeof b.name === 'string' ? b.name : '';
  const r = await switchMode(inst, want, req, { file, local, now });
  // the owner has chosen here: a choice made while building is no longer waited on
  if (r.status === 200 && inst.wantMode) reg.updateInstance(inst.slug, { wantMode: undefined });
  res.status(r.status).json(r.body);
  if (r.after) setImmediate(r.after);
}

/* Switching how visitors explore an atlas, for the Owner menu (postMode) and
   for a choice made while building (applyWantedMode). `payer` is the owner's
   request, or { payer: <account> } when the server acts on their behalf.
   Answers { status, body, after }: `after` is work to start once answered. */
async function switchMode(inst, want, payer, { file, local, now }) {
  if (!MODE_NAMES.includes(want)) return { status: 400, body: { error: 'Choose Standard, Event, Explore or Insight.' } };
  if (want === now) return { status: 200, body: { ok: true, already: true, ...modeAnswer(local) } };
  const kept = { ...keptOf(local) };
  if (want === 'event' && !(kept.event && typeof kept.event === 'object')) {
    return { status: 409, body: { error: EVENT_NOT_SET_UP, needsSetUp: true } };
  }
  let next = null;
  if (want === 'explore') {
    if (kept.explore && typeof kept.explore === 'object') next = kept.explore;
    else {
      next = await defaultExplore(inst, local, payer);
      /* the names may have taken a few seconds: the newest copy is the one
         written, and only if the mode in use and the kept ones are as they were */
      const fresh = readOverlay(inst);
      if (!fresh.local || modeNow(fresh.local) !== now || JSON.stringify(keptOf(fresh.local)) !== JSON.stringify(keptOf(local))) {
        return { status: 409, body: { error: 'The atlas changed while Explore was being set up. Try again.' } };
      }
      file = fresh.file; local = fresh.local;
    }
    if (!next) return { status: 409, body: { error: 'Explore needs places of your own on the atlas. Add your data first.' } };
  } else if (want === 'event') next = kept.event;
  /* Insight: the settings kept from last time, else every question shown
     but those about people; never without a question to show */
  let insightSrc = null;
  if (want === 'insight') {
    const was = kept.insight && typeof kept.insight === 'object' ? kept.insight : null;
    insightSrc = insightSource(inst, local, was && was.layer);
    if (!insightSrc) return { status: 409, body: { error: INSIGHT.NO_QUESTIONS, needsQuestions: true } };
    next = was ? { ...was, layer: insightSrc.layer.id } : INSIGHT.defaultInsight(insightSrc.layer);
    clearPendingOf(next);
    if (!NEVER_READ.has(inst.slug) && insightNeedsSummary(next, insightSrc)) markPending(next);
  }
  // what is in use now is put aside, never thrown away — an unknown mode too,
  // and one with no proper name under "_unnamed" (then "_unnamed-2", …)
  const cur = local.mode;
  if (cur !== undefined && cur !== null) {
    let key = cur && typeof cur === 'object' && typeof cur.name === 'string' && /^[a-z]{1,20}$/.test(cur.name) ? cur.name : '_unnamed';
    if (key === '_unnamed') for (let n = 2; kept[key] !== undefined; n++) key = '_unnamed-' + n;
    kept[key] = cur;
  }
  if (want !== 'standard') delete kept[want];
  if (next) local.mode = { ...next, name: want }; else delete local.mode;
  if (Object.keys(kept).length) local.modeKept = kept; else delete local.modeKept;
    if (!writeOverlay(file, local)) return { status: 500, body: { error: 'Could not save your choice. Nothing changed — try again.' } };
  // the story is written after the answer: the page shows "being written" and the questions meanwhile
  const after = want === 'insight' && local.mode && local.mode.summaryPending ? () => { runInsightSummary(inst.slug, payer); } : null;
  return { status: 200, body: { ok: true, from: now, ...modeAnswer(local) }, after };
}

/* "Made for" — whose atlas this is, set by the LOKA team (the super admin) when
   it is built for another organisation. Lives on the overlay, top level, beside
   `mode` and `placeName`, for the same reason: a rebuild of the base map must
   leave it alone. An empty string clears it, and the viewer treats an overlay
   value of "" as "no 'Made for'" even when manifest.json carries one from the
   server (atlas.js mergeLocalOverlay). Never for the deoria-bioregion atlas. */
/* A mode chosen while building (the wizard's "How should visitors explore it?",
   kept as inst.wantMode) is applied as soon as the atlas can take it: Explore
   once its own places are in, Insight once LOKA has read them. Tried after a
   build and after every change of places; a "not yet" (409) waits for the next
   one, anything else gives up quietly. The owner choosing under Owner ▾ ends
   the wait (postMode). */
const WANT_RUNNING = new Set();
async function applyWantedMode(slug) {
  const inst = reg.getInstance(slug);
  if (!inst || !inst.wantMode || WANT_RUNNING.has(slug)) return;
  if (inst.status === 'building' || inst.status === 'pending-approval') return;
  if (searchText.isNeverTouched(slug)) return;
  WANT_RUNNING.add(slug);
  try {
    const { file, local } = readOverlay(inst);
    if (!local) return;   // no places of its own yet
    const now = modeNow(local);
    const r = await switchMode(inst, inst.wantMode, { payer: inst.ownerAccount || undefined }, { file, local, now });
    if (r.status === 409) return;   // not yet: places, or the questions, still to come
    if (r.status !== 200) console.warn('[atlas] ' + slug + ' — the mode chosen while building could not be applied: ' + (r.body && r.body.error));
    reg.updateInstance(slug, { wantMode: undefined });
    if (r.after) setImmediate(r.after);
  } catch (e) {
    console.warn('[atlas] ' + slug + ' — applying the mode chosen while building: ' + (e && e.message));
  } finally {
    WANT_RUNNING.delete(slug);
  }
}

router.post('/instances/:slug/made-for', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!(auth.isAdmin(req) || auth.isAdminSession(req))) {
    return res.status(403).json({ error: 'Only LOKA can set who an atlas is made for.' });
  }
  if (searchText.isNeverTouched(inst.slug)) return res.status(403).json({ error: 'not allowed' });
  if (inst.status === 'building') {
    return res.status(409).json({ error: 'Wait for the atlas to finish building, then try again.' });
  }
  // eslint-disable-next-line no-control-regex
  const madeFor = String((req.body && req.body.madeFor) || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
  const { file, local: existing } = readOverlay(inst);
  const local = existing || { layers: [] };
  local.madeFor = madeFor;   // "" is kept: it must win over a madeFor written into manifest.json
  if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
  res.json({ ok: true, madeFor });
});

// How the background small-photos run for this atlas is getting on, for the
// Owner menu's quiet progress line. Owner or editor only — it says nothing a
// reader needs, and nothing a stranger should see about how it is running.
router.get('/instances/:slug/small-photos', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const st = SMALL_PHOTOS.get(inst.slug) || { running: false, done: 0, total: 0, made: 0, failed: 0, finishedAt: null };
  res.json({ running: !!st.running, done: st.done || 0, total: st.total || 0, made: st.made || 0, failed: st.failed || 0, finishedAt: st.finishedAt || null });
});

/* The one way a logo or a tab icon reaches the disk: a PNG under 200 KB
   (validLogo), as branding-logo.png or branding-icon.png in the atlas's own
   folder. Settings' Save, the wizard's build and a look read from a website
   all come through here, so there is one rule. A rebuild carries both files
   (jobs.js CONTRIBUTED). */
const BRAND_FILES = { logo: 'branding-logo', icon: 'branding-icon' };
const BRAND_WORDS = { logo: 'logo', icon: 'tab icon' };
function brandPath(inst, kind, previous) { return path.join(datasetDirFor(inst), BRAND_FILES[kind] + (previous ? '.previous' : '') + '.png'); }
function logoPath(inst, previous) { return brandPath(inst, 'logo', previous); }
function saveBrandFile(inst, kind, dataUrl) {
  const valid = validLogo(dataUrl);
  if (!valid) return { error: BRAND_WORDS[kind] + ' must be a PNG under 200 KB', status: 400 };
  try { fs.writeFileSync(brandPath(inst, kind), Buffer.from(valid.split(',')[1], 'base64')); }
  catch { return { error: 'could not save the ' + BRAND_WORDS[kind], status: 500 }; }
  return { ok: true };
}
function saveLogoFile(inst, dataUrl) { return saveBrandFile(inst, 'logo', dataUrl); }
function removeBrandFile(inst, kind) {
  try { fs.rmSync(brandPath(inst, kind), { force: true }); } catch { /* ignore */ }
}
/* A logo (or tab icon) changed by hand in Identity after a look brought one:
   the look's Undo must then leave that file alone (it would put back a file
   the owner has since replaced), so the kept copy goes and Undo is told it
   touches the theme only. */
function forgetLookFile(inst, kind) {
  try { fs.rmSync(brandPath(inst, kind, true), { force: true }); } catch { /* ignore */ }
  const { file, local } = readOverlay(inst);
  const key = kind + 'Changed';
  let changed = false;
  if (local && local.themePrevious && typeof local.themePrevious === 'object' && local.themePrevious[key]) {
    local.themePrevious[key] = false;
    changed = true;
  }
  // the logo is the owner's own now, so the credit stops naming it
  if (kind === 'logo' && local && local.theme && local.theme.source && local.theme.source.logo) {
    local.theme.source.logo = false;
    changed = true;
  }
  if (changed) writeOverlay(file, local);
}
/* After a build: the tab icon is set after the atlas exists (Settings, or a
   look), never in the wizard (Mithun, 4 Nov 2026). A rebuild carries the
   file (jobs.js CONTRIBUTED) but the built manifest knows nothing of it, so
   it is rewritten from the record; a record whose file has gone is told so. */
function iconAfterBuild(job) {
  const inst = reg.getInstance(job.slug);
  if (!inst) return;
  const hasIcon = !!(inst.branding && inst.branding.hasIcon) && fs.existsSync(brandPath(inst, 'icon'));
  const fresh = hasIcon !== !!(inst.branding && inst.branding.hasIcon)
    ? reg.updateInstance(inst.slug, { branding: { ...(inst.branding || {}), hasIcon } }) : inst;
  if (hasIcon) rewriteManifest(fresh);
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
    hasIcon: !!curB.hasIcon,
  };

  const patch = {
    title,
    subtitle: has('subtitle') ? cap(b.subtitle, 160) : (inst.subtitle || ''),
    about: has('about') ? cap(b.about, 500) : (inst.about || ''),
    email: has('email') && b.email ? cap(b.email, 120) : inst.email,
    org, branding,
    /* "Call this place": the owner's own name for where the atlas is, for the
       headings "Explore <place> by …". Empty means none: "Explore by …". */
    placeName: has('placeName') ? shortLabels.LABELS.cleanPlaceName(b.placeName) : (inst.placeName || ''),
  };

  // logo add / replace / remove (written straight into the current dataset dir)
  if (bb.removeLogo) {
    removeBrandFile(inst, 'logo');
    branding.hasLogo = false;
  } else if (bb.logoData) {
    const saved = saveLogoFile(inst, bb.logoData);
    if (saved.error) return res.status(saved.status).json({ error: saved.error });
    branding.hasLogo = true;
  }
  if (bb.removeLogo || bb.logoData) forgetLookFile(inst, 'logo');
  // the tab icon, the same way (§14.2: changeable later under Settings)
  if (bb.removeIcon) {
    removeBrandFile(inst, 'icon');
    branding.hasIcon = false;
  } else if (bb.iconData) {
    const saved = saveBrandFile(inst, 'icon', bb.iconData);
    if (saved.error) return res.status(saved.status).json({ error: saved.error });
    branding.hasIcon = true;
  }
  if (bb.removeIcon || bb.iconData) forgetLookFile(inst, 'icon');

  /* Who can see it. 'private' moves the whole dataset folder out of the web
     root into PRIVATE_ROOT, where only GET /datasets/:slug/:file can reach it
     (owner, editors, or the private link's key); 'public' moves it back. This
     is the ONLY thing that makes an atlas private — publish/unpublish is the
     gallery listing and leaves the files where they are. The decision is the
     owner's, like taking an atlas off the public page, and it also unlists
     the atlas: a private atlas on the public page would be a dead row. */
  let viewKey;
  const newVis = b.visibility === 'private' ? 'private' : b.visibility === 'public' ? 'public' : inst.visibility;
  if (newVis !== inst.visibility) {
    if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can change who may see this atlas' });
    if (newVis === 'private' && !session && !auth.isAdmin(req)) return res.status(401).json({ error: 'making an atlas private needs a verified email', needsAuth: true });
    if (inst.status === 'building' || inst.status === 'pending-approval') {
      return res.status(409).json({ error: 'wait for the build to finish before changing who can see this atlas' });
    }
    // the same rule as listing: only its maker sees an atlas while layers wait
    if (newVis === 'public' && waitingLine(inst)) {
      return res.status(409).json({ error: waitingLine(inst) + ' — it can be opened to others once they have answered.', pendingLayers: inst.pendingLayers.map((p) => p.label || p.id) });
    }
    const fromDir = datasetDirFor(inst);
    const toRoot = newVis === 'private' ? PRIVATE_ROOT : DATASETS_ROOT;
    const toDir = path.join(toRoot, inst.slug);
    try {
      fs.mkdirSync(toRoot, { recursive: true });
      if (fs.existsSync(fromDir)) fs.renameSync(fromDir, toDir);
      // a draft preview (<slug>--draft-<import>) sits beside its parent and must follow it
      for (const d of fs.readdirSync(path.dirname(fromDir))) {
        if (d.startsWith(inst.slug + '--draft-')) {
          try { fs.renameSync(path.join(path.dirname(fromDir), d), path.join(toRoot, d)); } catch { /* best effort */ }
        }
      }
    } catch { return res.status(500).json({ error: 'could not change who can see this atlas' }); }
    patch.visibility = newVis;
    if (newVis === 'private') {
      viewKey = reg.newToken();
      patch.viewKeyHash = reg.hashToken(viewKey);
      patch.viewKey = viewKey;
      if (inst.status === 'published') { patch.status = 'built'; patch.publishedAt = null; }
    } else {
      patch.viewKeyHash = null;
      patch.viewKey = null;
    }
  }

  const updated = reg.updateInstance(inst.slug, patch);
  rewriteManifest(updated);
  if (has('placeName')) writePlaceName(updated);
  res.json({ ok: true, visibility: updated.visibility, status: updated.status, viewKey: viewKey || undefined });
});

/* ================= a look read from a website =================
   docs/design-style-from-website.md. The owner or an editor (D2: the same
   people who may change the title and logo) gives a website address; the
   server reads the site (look-read.js), maps its colours onto the atlas's
   slots (look-map.js) and answers with a proposal. Nothing is written until
   Save, which re-checks the block (never the browser's word for it), keeps
   the look that was there as themePrevious for one step of Undo (D9), and
   saves the logo through the same function Settings uses. The theme lives in
   manifest.local.json, the file a rebuild leaves alone. */
function lookGate(req, res, write) {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) { res.status(404).json({ error: 'not found' }); return null; }
  if (!callerCanEdit(req, inst)) { res.status(403).json({ error: 'not allowed' }); return null; }
  if (write && searchText.isNeverTouched(inst.slug)) { res.status(403).json({ error: 'not allowed' }); return null; }
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    res.status(409).json({ error: 'Wait for the atlas to finish building, then try again.' }); return null;
  }
  return inst;
}
/* The theme block as the server will keep it: known keys only, colours that
   are colours, a light page (the guard's word, THEME.resolve, is final), and
   what the guard darkens written back so the saved look needs no change at
   run time. Returns { theme } or { error }. */
function cleanLookTheme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'No look was given.' };
  const t = { version: 1, colors: {} };
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const colors = raw.colors && typeof raw.colors === 'object' ? raw.colors : {};
  for (const k of LOOK_MAP.SLOTS) if (typeof colors[k] === 'string' && HEX.test(colors[k])) t.colors[k] = colors[k].toUpperCase();
  if (!Object.keys(t.colors).length) return { error: 'The look has no colours in it.' };
  if (raw.corners === 'square' || raw.corners === 'soft') t.corners = raw.corners;
  const lw = Number(raw.logoMaxWidth);
  if (lw >= 60 && lw <= 220) t.logoMaxWidth = Math.round(lw);
  if (raw.source && typeof raw.source === 'object') {
    const src = {};
    for (const k of ['url', 'host', 'readAt']) if (typeof raw.source[k] === 'string') src[k] = raw.source[k].slice(0, 300);
    if (src.host && !/^[a-z0-9.-]+$/i.test(src.host)) delete src.host;
    if (src.url && !/^https?:\/\//i.test(src.url)) delete src.url;
    if (src.host) t.source = src;
  }
  if (raw.chosen && typeof raw.chosen === 'object') {
    const ch = {};
    for (const k of LOOK_MAP.SLOTS) if (typeof raw.chosen[k] === 'string' && HEX.test(raw.chosen[k])) ch[k] = raw.chosen[k].toUpperCase();
    if (Object.keys(ch).length) t.chosen = ch;
  }
  t.credit = raw.credit !== false;   // D3: the credit line is on unless switched off
  // the site's font (§14.1): a family in LOKA's Google Fonts list, its address
  // built here from the name — never the browser's word for where a font is
  if (raw.fonts && typeof raw.fonts === 'object' && typeof raw.fonts.text === 'string') {
    const f = lookRead.fontFor(raw.fonts.text);
    if (f) t.fonts = f.theme;
  }
  const r = THEME.resolve(t);
  if (r.notes.some((n) => /too dark for a page/.test(n))) return { error: 'That page colour is too dark. LOKA has no dark mode, so a look needs a light page.' };
  for (const k of LOOK_MAP.SLOTS) { const v = r.vars[THEME.VARS[k]]; if (t.colors[k] && v) t.colors[k] = v; }
  return { theme: t };
}
function lookAnswer(inst, local) {
  const b = inst.branding || {};
  return {
    theme: local && local.theme && typeof local.theme === 'object' ? local.theme : null,
    canUndo: !!(local && local.themePrevious && typeof local.themePrevious === 'object'),
    hasLogo: !!b.hasLogo,
    hasIcon: !!b.hasIcon,
    site: b.orgUrl || '',
  };
}

router.get('/instances/:slug/look', (req, res) => {
  const inst = lookGate(req, res, false);
  if (!inst) return;
  res.json(lookAnswer(inst, readOverlay(inst).local));
});

// Read a website: answers a proposal, writes nothing.
router.post('/instances/:slug/look/read', async (req, res) => {
  const inst = lookGate(req, res, true);
  if (!inst) return;
  const typed = String((req.body && req.body.url) || '').trim();
  if (!typed) return res.status(400).json({ error: lookRead.WORDS.unreachable });
  const session = auth.sessionFromReq(req);
  // a second press while one read is running gets the running one's answer
  const running = lookRead.runningRead(inst.slug);
  if (running) { const r = await running; return res.status(r.error ? 422 : 200).json(r.error ? { error: lookRead.WORDS[r.error] } : r); }
  const allowed = lookRead.readAllowed(inst.slug, session && session.email);
  if (!allowed.ok) return res.status(429).json({ error: lookRead.WORDS[allowed.error] });
  const t0 = Date.now();
  const p = await lookRead.markRunning(inst.slug, lookRead.readSite(typed).catch((e) => ({ error: 'unreachable', reason: 'threw:' + (e && e.message) })));
  // logged with the host and the outcome, never with page content
  let host = ''; try { host = new URL(/^[a-z]+:/i.test(typed) ? typed : 'https://' + typed).hostname; } catch { host = '?'; }
  console.info('[look] ' + inst.slug + ' ' + host + ' ' + (Date.now() - t0) + 'ms ' + (p.error ? 'failed: ' + (p.reason || p.error) : 'ok ' + (p.stats ? p.stats.bytes + 'B ' + p.stats.sheets + ' sheets ' + p.stats.images + ' pictures' : '')));
  if (p.error) return res.status(422).json({ error: lookRead.WORDS[p.error] || lookRead.WORDS.unreachable, reason: p.error });
  res.json(p);
});

// Save a look: the theme block, and the logo when asked (D4: logos only).
router.post('/instances/:slug/look', (req, res) => {
  const inst = lookGate(req, res, true);
  if (!inst) return;
  const b = req.body || {};
  const cleaned = cleanLookTheme(b.theme);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error });
  const { file, local: existing } = readOverlay(inst);
  const local = existing || { layers: [] };
  const curB = inst.branding || {};
  const useLogo = !!b.useLogo && typeof b.logoData === 'string';
  const useIcon = !!b.useIcon && typeof b.iconData === 'string';   // the site's icon as the tab icon (§14.2), ticked by the owner
  if (useLogo && !validLogo(b.logoData)) return res.status(400).json({ error: 'The logo must be a PNG under 200 KB.' });
  if (useIcon && !validLogo(b.iconData)) return res.status(400).json({ error: 'The tab icon must be a PNG under 200 KB.' });
  const previous = { theme: local.theme && typeof local.theme === 'object' ? local.theme : null, themePrevious: local.themePrevious };
  local.themePrevious = { theme: previous.theme, logoWas: !!curB.hasLogo, logoChanged: useLogo, iconWas: !!curB.hasIcon, iconChanged: useIcon, savedAt: new Date().toISOString() };
  // the credit in About names the logo only when it came from this site
  if (cleaned.theme.source) cleaned.theme.source.logo = useLogo;
  local.theme = cleaned.theme;
  // the overlay first: if it cannot be written, "nothing changed" is true
  if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
  /* The files, logo then icon: the one that was there goes aside for one
     step of Undo, then the new one is written. If a write fails, everything
     is put back as it was, so the answer is true. */
  const put = [];
  const undoPut = (saved) => {
    for (const p of put.reverse()) {
      try { fs.rmSync(brandPath(inst, p.kind), { force: true }); if (p.hadFile) fs.renameSync(brandPath(inst, p.kind, true), brandPath(inst, p.kind)); } catch { /* best effort */ }
    }
    local.theme = previous.theme || undefined; if (local.theme === undefined) delete local.theme;
    local.themePrevious = previous.themePrevious;
    writeOverlay(file, local);
    return res.status(saved.status).json({ error: saved.error + ' Nothing changed — try again.' });
  };
  if (useLogo) {
    const hadFile = curB.hasLogo && fs.existsSync(logoPath(inst));
    try { if (hadFile) fs.renameSync(logoPath(inst), logoPath(inst, true)); } catch { /* best effort */ }
    put.push({ kind: 'logo', hadFile });
    const saved = saveLogoFile(inst, b.logoData);
    if (saved.error) return undoPut(saved);
  }
  if (useIcon) {
    const hadFile = curB.hasIcon && fs.existsSync(brandPath(inst, 'icon'));
    try { if (hadFile) fs.renameSync(brandPath(inst, 'icon'), brandPath(inst, 'icon', true)); } catch { /* best effort */ }
    put.push({ kind: 'icon', hadFile });
    const saved = saveBrandFile(inst, 'icon', b.iconData);
    if (saved.error) return undoPut(saved);
  }
  if (useLogo || useIcon) {
    const session = auth.sessionFromReq(req);
    const branding = { ...curB,
      ...(useLogo ? { hasLogo: true, logoRights: { by: (session && session.email) || 'token', at: new Date().toISOString(), from: cleaned.theme.source ? cleaned.theme.source.host : '' } } : {}),
      ...(useIcon ? { hasIcon: true } : {}) };
    rewriteManifest(reg.updateInstance(inst.slug, { branding }));
  }
  res.json({ ok: true, ...lookAnswer(reg.getInstance(inst.slug), local) });
});

/* One step back for a logo or tab icon the look brought (Undo): the file and
   its kept copy change places; where there was none before, the look's goes
   aside, leaving none. Returns whether the atlas has one afterwards. Throws
   when a rename fails, so the caller can say nothing changed. */
function swapBrandFileBack(inst, kind, was) {
  const cur = brandPath(inst, kind), old = brandPath(inst, kind, true), tmp = cur + '.swap';
  const haveCur = fs.existsSync(cur), haveOld = fs.existsSync(old);
  if (was) {
    if (haveCur && haveOld) { fs.renameSync(cur, tmp); fs.renameSync(old, cur); fs.renameSync(tmp, old); }
    else if (haveOld) fs.renameSync(old, cur);
    return true;
  }
  if (haveCur) { fs.rmSync(old, { force: true }); fs.renameSync(cur, old); }
  return false;
}

// One step back (D9): the theme and themePrevious change places, and the
// logo files with them when the look brought a logo. Pressing it again is redo.
router.post('/instances/:slug/look/undo', (req, res) => {
  const inst = lookGate(req, res, true);
  if (!inst) return;
  const { file, local } = readOverlay(inst);
  const prev = local && local.themePrevious;
  if (!prev || typeof prev !== 'object') return res.status(409).json({ error: 'There is nothing to undo.' });
  const curB = inst.branding || {};
  const now = local.theme && typeof local.theme === 'object' ? local.theme : null;
  let hasLogo = !!curB.hasLogo, hasIcon = !!curB.hasIcon;
  try {
    if (prev.logoChanged) hasLogo = swapBrandFileBack(inst, 'logo', !!prev.logoWas);
    if (prev.iconChanged) hasIcon = swapBrandFileBack(inst, 'icon', !!prev.iconWas);
  } catch { return res.status(500).json({ error: 'Could not put the logo back. Nothing changed — try again.' }); }
  local.theme = prev.theme || undefined;
  if (local.theme === undefined) delete local.theme;
  local.themePrevious = { theme: now, logoWas: !!curB.hasLogo, logoChanged: !!prev.logoChanged, iconWas: !!curB.hasIcon, iconChanged: !!prev.iconChanged, savedAt: new Date().toISOString() };
  if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
  let fresh = inst;
  if (hasLogo !== !!curB.hasLogo || hasIcon !== !!curB.hasIcon) { fresh = reg.updateInstance(inst.slug, { branding: { ...curB, hasLogo, hasIcon } }); rewriteManifest(fresh); }
  res.json({ ok: true, ...lookAnswer(fresh, local) });
});

// Back to LOKA's look: the theme goes (one step of Undo brings it back); the
// logo stays — it is the owner's logo field, removed in Identity if they want.
router.delete('/instances/:slug/look', (req, res) => {
  const inst = lookGate(req, res, true);
  if (!inst) return;
  const { file, local } = readOverlay(inst);
  if (!local || !local.theme) return res.json({ ok: true, ...lookAnswer(inst, local) });
  local.themePrevious = { theme: local.theme, logoWas: !!(inst.branding && inst.branding.hasLogo), logoChanged: false, iconWas: !!(inst.branding && inst.branding.hasIcon), iconChanged: false, savedAt: new Date().toISOString() };
  delete local.theme;
  if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
  res.json({ ok: true, ...lookAnswer(inst, local) });
});

// D3: "say where the look comes from" in About this atlas — on unless switched off
router.post('/instances/:slug/look/credit', (req, res) => {
  const inst = lookGate(req, res, true);
  if (!inst) return;
  const { file, local } = readOverlay(inst);
  if (!local || !local.theme || typeof local.theme !== 'object') return res.status(409).json({ error: 'This atlas has no look from a website.' });
  local.theme.credit = !(req.body && req.body.on === false);
  if (!writeOverlay(file, local)) return res.status(500).json({ error: 'Could not save. Nothing changed — try again.' });
  res.json({ ok: true, ...lookAnswer(inst, local) });
});

/* A new private link. The old one stops working the moment this answers —
   that is the point: a link that reached the wrong hands, or one made before
   the key was kept on record (an atlas made private by hand has a hash and no
   key), is replaced rather than recovered. Owner only, private atlases only. */
router.post('/instances/:slug/view-key', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can make a new private link' });
  if (inst.visibility !== 'private') return res.status(409).json({ error: 'this atlas is not private, so it has no private link' });
  const viewKey = reg.newToken();
  reg.updateInstance(inst.slug, { viewKey, viewKeyHash: reg.hashToken(viewKey) });
  res.json({ ok: true, viewKey });
});

// Rebuild — change layers and/or region, then rebuild into the same slug. The
// build swaps the dataset atomically on success, so a published atlas has no
// downtime; a published atlas stays published (see the job-done hook).
//
// Two halves, so the layers that waited for the LOKA team's yes
// (addPendingLayers) go down the very same path as a change made from the
// Owner menu: planRebuild works out the region and the layers and says what
// cannot be, startRebuild records, gates and starts the build.
router.post('/instances/:slug/rebuild', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    return res.status(409).json({ error: 'a build is already running for this atlas' });
  }
  const plan = await planRebuild(inst, req.body || {});
  if (plan.error) return res.status(plan.status).json({ error: plan.error, ...(plan.extra || {}) });
  res.json(await startRebuild(inst, plan, { base: siteBase(req) }));
});

/* What a rebuild would be: the region (sent, or the atlas's own), the layers
   (sent, or the atlas's own) and what the region is too wide for. Answers
   { error, status } in the words the route sends, or the facts startRebuild
   needs. */
async function planRebuild(inst, b) {
  const r = b.region;
  const cur = inst.region || {};
  const regionSent = !!(r && r.iso3 && Array.isArray(r.shapeIDs) && r.shapeIDs.length);
  /* An atlas with no region at all (see POST /instances) keeps having none:
     asked only to change its open-data layers, it would otherwise be refused
     for lacking the region it was built without. */
  const worldwide = !regionSent && !!cur.worldwide;
  const useR = regionSent
    ? { iso3: String(r.iso3).toUpperCase(), level: Number(r.level) || 1, shapeIDs: r.shapeIDs.map(String) }
    : { iso3: cur.iso3 || '', level: cur.level, shapeIDs: cur.shapeIDs || [] };
  if (!worldwide && (!/^[A-Z]{3}$/.test(useR.iso3) || !useR.shapeIDs.length)) return { error: 'region is required', status: 400 };
  const tooManyNow = worldwide ? '' : tooManyUnits(useR.shapeIDs);
  if (tooManyNow) return { error: tooManyNow, status: 400, extra: { tooManyUnits: useR.shapeIDs.length } };

  let regionDoc = null, picked = [];
  if (!worldwide) {
    try { regionDoc = await loadAdmin(useR.iso3, useR.level); } catch (e) { return { error: 'boundary source unavailable: ' + e.message, status: 502 }; }
    picked = regionDoc.features.filter((f) => useR.shapeIDs.includes(f.properties.id));
    if (!picked.length) return { error: 'no matching boundary units', status: 400 };
  }
  let w = 180, s = 90, e = -180, n = -90;
  if (worldwide) { w = -180; s = -85; e = 180; n = 85; }
  for (const f of picked) { w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]); e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]); }
  const bbox = [w, s, e, n];
  const areaDeg2 = (e - w) * (n - s);
  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = worldwide ? 'Worldwide'
    : shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  const tier = tierOf(useR.iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  const priorLayers = Array.isArray(inst.layers) ? inst.layers : [];
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : priorLayers).filter((id) => allowed.has(id));
  if (!worldwide) {
    for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  }
  if (!layerIds.length && !worldwide) return { error: 'pick at least one layer', status: 400 };
  // the same rule as a first build, and for the same reason
  const estCtx = { tier, iso3: useR.iso3, regionLabel };
  const fit = feasibleLayers(layerIds, allowed, areaDeg2);
  layerIds = fit.keep;
  if (!layerIds.length && !worldwide) {
    return {
      error: 'Nothing can be built across a region this wide except boundaries, and they were not asked for.',
      status: 400, extra: { droppedLayers: fit.droppedLabels } };
  }
  return { regionSent, worldwide, useR, regionDoc, picked, bbox, areaDeg2, shapeNames, regionLabel,
    tier, allowed, estCtx, priorLayers, layerIds, fit };
}

/* Record the change, ask the gate, and either start the build or mail the
   LOKA team. `approved` is for layers they have already said yes to: the
   gate is not asked again. Answers the body the route sends. */
async function startRebuild(inst, plan, { base, approved } = {}) {
  const { regionSent, worldwide, useR, regionDoc, bbox, areaDeg2, shapeNames, regionLabel, tier, allowed, estCtx, priorLayers, layerIds, fit } = plan;
  const cur = inst.region || {};

  /* What this rebuild actually changes, in words a person and the approval
     mail can both use. The Owner menu's "Open data layers" sheet sends only
     layers; Settings sends only a region; the mail used to call every rebuild
     a "widen request", which is wrong for the first. */
  const labelOf = (id) => (allowed.get(id) || {}).label || id;
  const added = layerIds.filter((id) => !priorLayers.includes(id));
  const removed = priorLayers.filter((id) => !layerIds.includes(id));
  const regionChanged = regionSent && (useR.iso3 !== cur.iso3 || useR.level !== cur.level
    || JSON.stringify([...useR.shapeIDs].sort()) !== JSON.stringify([...(cur.shapeIDs || [])].sort()));
  const change = {
    region: regionChanged,
    added: added.map(labelOf), removed: removed.map(labelOf),
  };
  const changeWords = [];
  if (regionChanged) changeWords.push('cover more ground');
  if (added.length) changeWords.push('add ' + change.added.join(', '));
  if (removed.length) changeWords.push('take off ' + change.removed.join(', '));
  const changeLine = changeWords.length ? changeWords.join('; ') : 'rebuild as it is';

  // A rebuild that crosses into approval territory used to be refused outright
  // with "email us" — a dead end for the case that most needs it: widening an
  // atlas to cover data that turned out to sit outside it. It now enters the same
  // queue a first build uses (approvalFor: the one rule). The live atlas keeps
  // serving its existing files throughout, because a build only swaps them on
  // success.
  const verdict = approvalFor(layerIds, allowed, areaDeg2, estCtx);
  const needsApproval = !approved && verdict.needsApproval;

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
      iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox, worldwide,
      simplifiedFile: worldwide ? null : path.join(GEOCACHE_DIR, `${useR.iso3}-ADM${useR.level}.json`),
      fullResUrl: regionDoc ? regionDoc.fullResUrl : null,
    },
    layers: layerIds,
    estSeconds: verdict.buildSeconds,
  };

  const wasPublished = inst.status === 'published';
  reg.updateInstance(inst.slug, {
    tier, region: { iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox, areaDeg2, worldwide },
    regionLabel, layers: layerIds, spec,
    rebuildKeepPublished: wasPublished || undefined,
    // The new region and layers are recorded now so an approval needs no extra
    // bookkeeping — but that makes the record describe an atlas the built files
    // are not yet, so the whole prior state is kept: a denial puts every bit of
    // it back, and so does a build that fails (the job-done hook). `change`
    // says what was asked for, so the owner's page and the denial mail can
    // name it while it waits.
    rebuildPrior: { status: inst.status, tier: inst.tier, region: inst.region,
      regionLabel: inst.regionLabel, layers: priorLayers, change },
    status: needsApproval ? 'pending-approval' : (wasPublished ? 'published' : 'building'),
  });

  if (needsApproval) {
    const approve = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(inst.slug, 'approve')}`;
    const deny = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(inst.slug, 'deny')}`;
    const layersOnly = !regionChanged;
    await sendMail({
      to: ADMIN_EMAIL,
      subject: `[LOKA Atlas] ${layersOnly ? 'layer change' : 'widen request'}: ${inst.title}`,
      text: `"${inst.title}" (${inst.slug}) asks to ${changeLine}.\n\n`
        + `Reason: ${verdict.reasons.join('; ')}\nCovers: ${regionLabel}\nLayers: ${layerIds.join(', ')}\n\n`
        + `Approve: ${approve}\nDeny:    ${deny}\n\n`
        + `The atlas keeps serving its current map until this is approved.`,
    });
    return {
      droppedLayers: fit.droppedLabels.length ? fit.droppedLabels : undefined,
      ok: true, pendingApproval: true, slug: inst.slug, regionLabel, layers: layerIds, change,
      message: (layersOnly
        ? 'Some of that is heavy to build, so the LOKA team takes a quick look first — '
        : 'That covers a lot of ground, so the LOKA team takes a quick look first — ')
        + 'usually within a day. Your atlas carries on exactly as it is until then, and '
        + 'your data stays where it is.',
    };
  }

  // a yes already given is a build the gate would have held: it gets the time its estimate asks for
  const jobId = enqueueBuild(approved ? { ...spec, timeoutMs: approvedTimeoutMs(spec.estSeconds) } : spec);
  reg.updateInstance(inst.slug, { jobId });
  return { ok: true, jobId, slug: inst.slug, wasPublished, layers: layerIds, change,
    droppedLayers: fit.droppedLabels.length ? fit.droppedLabels : undefined };
}

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
    // what they were invited AS, so a list of people says what each may do
    role: c.role === 'owner' ? 'owner' : 'editor',
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
  const want = req.body && req.body.role === 'owner' ? 'owner' : 'editor';
  const c = reg.addCollaborator(inst.slug, email, want);
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

/* Who is looking. Every page asks this once as it loads.

   "Nobody is signed in" used to answer 401, so a signed-out visitor — which
   is most of them — logged a failed request on every page, and a console with
   a permanent error in it is a console nobody reads. Not being signed in is
   an ANSWER to this question, and the commonest one. It is 200 now, and says
   so in a word the callers can read. */
router.get('/auth/me', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.json({ signedIn: false });
  const acc = reg.getAccount(session.email);
  const instances = (acc ? acc.instances : [])
    .map((slug) => reg.getInstance(slug))
    .filter(Boolean)
    .map((i) => ({
      slug: i.slug, title: i.title, regionLabel: i.regionLabel || '', status: i.status, visibility: i.visibility,
      role: i.ownerAccount === session.email ? 'owner' : 'editor',
    }));
  res.json({
    signedIn: true,
    email: session.email,
    verifiedAt: acc ? acc.verifiedAt : null,
    name: (acc && acc.name) || '',
    org: (acc && acc.org) || '',
    superAdmin: auth.isAdminSession(req),
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

  /* Kept by the browser only as a copy it must ASK about before using, which
     is what the public folder's files get too (deploy/lokaApps.conf sends
     no-cache, must-revalidate, and Apache answers an unchanged file with a
     304). Here the asking comes through this route, so the owner, editor or
     key check above runs BEFORE anything is answered: a signed-out, keyless
     person on the same device gets the 403, never the copy — the fault that
     max-age had (seen in a hand check) and that no-store was the blunt fix
     for. no-store made every visit re-download every layer in full; a
     private atlas was slower to open than a public one for no reason of
     privacy. `private` keeps the proxy in front from storing it. */
  let st = null;
  try { st = fs.statSync(full); } catch { return res.status(404).json({ error: 'not found' }); }
  const etag = '"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + '"';
  res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Length', String(st.size));
  res.type(MIME[path.extname(full)] || 'application/octet-stream');
  const stream = fs.createReadStream(full);
  // a rebuild can take the file away between the stat and the read; a stream
  // error must end THIS answer, not the whole server
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'not found' }); else res.destroy(); });
  stream.pipe(res);
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
import { getFlashModel, getFlashLiteModel, getEmbedModel, getResolverStatus, getStoryModel, getStoryProofreadModel } from '../lib/models.js';
import { profileColumns, bestNameColumn } from '../lib/tabular.js';
import { norm, dice, joinByName, AUTO_ACCEPT, spellings, fallbackRequest, applyFallback, splitPointRows } from '../lib/matching.js';
import { hasDevanagari, skeleton } from '../lib/devanagari.js';
import { PALETTES, PALETTE_ALIASES, MARKER_COLORS, buildFragment, sanitizeFeatures, justTheLinks } from '../lib/fragment.js';
import * as imports from '../lib/atlas/imports.js';
import * as enrich from '../lib/atlas/enrich.js';
import { geocodeOne, markCollisions } from '../lib/atlas/geocode.js';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

/* A stand-in for the model, for checking the whole road on a machine with no
   key: ATLAS_FAKE_READING=1 makes a reading return the same plain questions
   every time, worked out by counting words rather than asking anybody.

   It must never be on where real people read their places, so it needs all four
   at once: the flag itself, the local-only static mode (LOKA_DEV_STATIC, which
   the live server never sets), no model key at all, and not production. Any one
   missing and it is off — which is also how it starts. */
const FAKE_READING = process.env.ATLAS_FAKE_READING === '1' &&
  !!process.env.LOKA_DEV_STATIC && !process.env.GEMINI_API_KEY &&
  process.env.NODE_ENV !== 'production';
if (FAKE_READING) console.warn('[atlas] ATLAS_FAKE_READING is on — readings are made up locally, not asked of a model');
imports.sweepImports();
setInterval(imports.sweepImports, 3600 * 1000).unref();

// Admin-hierarchy columns (district/block/…) make poor category colourings even
// when low-cardinality — the map already shows those boundaries.
const ADMINISH_RE = /^(country|state|district|division|block|tehsil|taluk|taluka|mandal|subdistrict|village|gram|panchayat|ward|region)s?([ _-]?name)?$/i;
function pickCategoryColumn(profiles, placeNameCol) {
  return profiles.find((p) => p.categorical && p.name !== placeNameCol && !ADMINISH_RE.test(p.name.trim()));
}

// row numbers (from 0) with nothing in each column that holds words anywhere
function emptyRowsByColumn(columns, rows) {
  const out = {};
  for (const c of columns) {
    if (String(c).charAt(0) === '_') continue;
    const blank = [];
    let words = false;
    rows.forEach((r, i) => {
      const v = r ? r[c] : undefined;
      if (v === null || v === undefined || String(v).trim() === '') blank.push(i);
      else if (typeof v === 'string' && Number.isNaN(Number(v))) words = true;
    });
    if (words && blank.length) out[c] = blank;
  }
  return out;
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
    // a question a reading answered is shown by its key, not as a popup line
    if (/^pattern_/.test(String(p.name))) return false;
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
/* Who may change this atlas. 'server' is the server finishing work an owner
   already asked for — a retried reading — and is not a way in from outside:
   nothing arriving over HTTP can present it. */
function datasetRole(who, datasetId) {
  if (who === 'server') return 'owner';
  const inst = reg.getInstance(datasetId);
  return inst ? callerRole(who, inst) : (auth.isAdmin(who) ? 'owner' : null);
}

function requireDatasetEditor(req, res, datasetId) {
  const role = datasetRole(req, datasetId);
  if (!role) {
    res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
    return null;
  }
  return role;
}

const MAX_ROWS = 5000, MAX_COLS = 40;
/* How long a question may be. Read where one is asked and where one is stored,
   because those two disagreeing is how a question came to be sawn in half. */
const MAX_QUESTION_CHARS = 120;
// the viewer shows at most eight marks per key, so more kinds than that is noise
const MAX_CATS_KEPT = 8;
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
const AI_CALLS_PER_READING = 24;    // one ATTEMPT at a reading may not exceed this; its one retry has its own
/* Room on top of that for the careful check on answers (enrich.js
   checkAnswers), which runs after answering and spends what the attempt has
   left. Kept apart from AI_CALLS_PER_READING because that number also decides
   how many columns get a look of their own (planColumns), and the check must
   not change which columns are read. The check reads only the questions that
   judge a place: Bengaluru's saved answers (134 places) hold about 115 such,
   three calls at 40 a call, mostly from room the columns left unspent. When
   room is short the check hands each call more answers instead (up to 160),
   and past that leaves the rest as first answered. */
const ANSWER_CHECK_CALLS = 4;

function aiWho(req) {
  // work the server is finishing on an owner's behalf keeps its own allowance,
  // so a retry neither eats their share nor runs without a limit
  if (req === 'server') return { key: 'server', cap: AI_CALLS_PER_HOUR };
  /* A reading the server starts on an owner's behalf the moment their layer is
     added. Nobody is holding a page open, but it is theirs, so it comes out of
     their account's hour exactly as it did when their browser started it. */
  if (req && typeof req === 'object' && req.payer) {
    return { key: 'acct:' + req.payer, cap: AI_CALLS_PER_HOUR };
  }
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

/* A caller that pays its own way. Refusing by throwing is deliberate: a reading
   that runs out of budget is a reading that could not be finished, and since
   questions mode stopped guessing at the places it could not read, that now
   means the reading is simply not saved. Nothing is invented to fill the gap
   and nothing half-done is kept. */
function aiCaller(req, perReading, stub) {
  const cap = perReading || (AI_CALLS_PER_READING + ANSWER_CHECK_CALLS);
  let spent = 0;
  const call = function (model, prompt, schema, o) {
    if (spent >= cap) throw new Error('this reading has used its share of the model');
    if (!aiTake(req)) throw new Error('too many readings in the last hour — try again shortly');
    spent += 1;
    // the stand-in reading (FAKE_READING) pays the same way and asks nobody
    if (stub) return stub(model, prompt, schema, o);
    if (o && o.think) return geminiJSONDeep(model, prompt, schema);
    if (o && o.file) return geminiJSONFile(model, prompt, schema);
    return geminiJSON(model, prompt, schema);
  };
  call.spent = () => spent;
  call.cap = cap;
  return call;
}

// a single call, budgeted: for the one-shot uses that are not a whole reading
function geminiAllowed(req) { return aiTake(req); }

/* ---------- boundary discovery: joinable polygon layers in the dataset ---------- */

// The box round a shape, for "which of these is the smaller thing".
function bboxOfGeom(g) {
  let w = 180, so = 90, e = -180, n = -90, any = false;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      any = true;
      w = Math.min(w, c[0]); e = Math.max(e, c[0]);
      so = Math.min(so, c[1]); n = Math.max(n, c[1]);
      return;
    }
    for (const x of c) walk(x);
  };
  try { if (g && g.coordinates) walk(g.coordinates); } catch { return null; }
  return any ? [w, so, e, n] : null;
}

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
    /* Other names the same shape goes by, carried on the feature itself.

       A boundary file of districts needs none: a district has one name. A file
       of ranges and reserves needs them badly — the reserve whose official name
       is "Biligiri Ranganatha Swamy Temple Wildlife Sanctuary" is written
       "BRT Tiger Reserve" by everybody, and a row saying so had nothing to join
       to. The aliases come from the source at build time, never invented at
       match time, which is what keeps this from becoming fuzzy matching. */
    aliases: Array.isArray(f.properties.aliases) ? f.properties.aliases.map(String) : [],
    /* Who published this shape, and on what terms. A row that borrows the
       Western Ghats outline is drawing somebody else's work, and the layer it
       lands in has to be able to say whose. Boundary files built from one
       source carry nothing here and need nothing: the atlas already credits
       that source once. It is the mixed file — ranges from one register,
       reserves from another, a ward from a third — where the shape is the only
       thing that knows. */
    credit: f.properties.credit ? String(f.properties.credit) : '',
    licence: f.properties.licence ? String(f.properties.licence) : '',
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
async function geoBoundaryOptions(region, before) {
  if (!region || !region.iso3) return [];
  const iso3 = String(region.iso3).toUpperCase();
  const baseLevel = Number(region.level) || 1;
  const rbb = Array.isArray(region.bbox) && region.bbox.length === 4 ? region.bbox : null;
  let avail = null;
  try { avail = JSON.parse(fs.readFileSync(path.join(GEOCACHE_DIR, `${iso3}-levels.json`), 'utf8')).levels; } catch {}
  let parents = null;   // atlas's own level, clipped to the region — for parent disambiguation
  const out = [];
  /* Before the atlas exists it has no outlines of its own, and a file whose
     rows name the very places the atlas is built from — a list of blocks
     that became a region of blocks — had nothing to be checked against at
     all ("no joinable boundary layer"). So before a build the region's own
     level is offered too, after the finer ones; once the atlas is built its
     own boundary layer is that level. */
  const levels = [baseLevel + 1, baseLevel + 2].concat(before ? [baseLevel] : []);
  for (const L of levels) {
    if (L > MAX_LEVEL) continue;
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
    /* The district a block or locality sits in, whatever level the atlas is
       at. Two places called Raghopur in one state are told apart by their
       districts — on the question screen, and by a district column in the
       sheet — and `parent` only names the atlas's own level, which for a
       state atlas is the state both of them are in. */
    let districts = null;
    if (L >= 3 && baseLevel !== 2) {
      try {
        const df = (await loadAdmin(iso3, 2)).features;
        districts = rbb ? df.filter((p) => bboxOverlap(p.bbox, rbb)) : df;
      } catch { districts = null; }
    } else if (L >= 3) districts = parents;
    const targets = feats.map((f, i) => {
      let parent = '', area = '';
      const c = centroidOf(f.geometry);
      // (a unit of the region's own level is its own parent: nothing to say)
      if (parents.length > 1 && L !== baseLevel) {   // only worth disambiguating when >1 parent overlaps
        const hit = parents.find((p) => bboxOverlap(p.bbox, f.bbox) && pointInGeom(c[0], c[1], p.geometry));
        if (hit) parent = hit.properties.name || '';
      }
      if (districts && districts.length) {
        const d = districts.find((p) => bboxOverlap(p.bbox, f.bbox) && pointInGeom(c[0], c[1], p.geometry));
        if (d && (d.properties.name || '') !== parent) area = d.properties.name || '';
      }
      return { code: String(i), name: String(f.properties.name || ''), parent, ...(area ? { area } : {}), geometry: f.geometry };
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
    popupTitleAlso: { type: Type.STRING },
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
/* Every call to the model passes through here, so that no failure is private.

   The point is not the log line — that already exists. It is that a failure has
   to reach a person. One retired model produced 404s for days and the only
   trace was a caught exception, so the atlas went on filing places by
   coincidence and nobody knew to look. The trouble log decides who hears and
   how often; this only makes sure it is told. */
async function watched(model, run) {
  try {
    const out = await run();
    noteOk(model);
    return out;
  } catch (e) {
    noteTrouble(model, e);
    throw e;
  }
}

function geminiJSON(model, prompt, schema) {
  return watched(model, () => geminiJSONImpl(model, prompt, schema));
}
function geminiJSONFile(model, prompt, schema) {
  return watched(model, () => geminiJSONFileImpl(model, prompt, schema));
}
function geminiJSONDeep(model, prompt, schema) {
  return watched(model, () => geminiJSONDeepImpl(model, prompt, schema));
}

async function geminiJSONImpl(model, prompt, schema) {
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
/* Filing is not a reading. The questions and their kinds are already settled
   by the time this runs; every place is being put into one of a fixed set of
   boxes, using words from its own line. There is no judgement to range over,
   so there is nothing for warmth to buy.

   Measured before setting it: the same three questions, answered four times
   over the same sixty-six places, reached 64/60/62/59, then 65/64/51/50, then
   56/58/59/59. The middle one moved by fifteen places between two runs that
   differed in nothing at all. A reader watching a key lose a fifth of its
   places overnight has no way to know nothing changed. */
const FILE_TEMPERATURE = 0;
async function fileOnce(model, prompt, schema, quiet) {
  const cfg = {
    responseMimeType: 'application/json',
    responseSchema: schema,
    maxOutputTokens: 24000,
    temperature: FILE_TEMPERATURE,
  };
  // asking for no thinking, in the dialect the model speaks
  if (quiet) cfg.thinkingConfig = quiet;
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: cfg }),
      signal: AbortSignal.timeout(120000),
    },
  );
  /* The HTTP status was never looked at. A model id that Google had retired
     answered 404 with a body carrying no candidates, so this threw "no answer
     from the model" — true, and useless. It cost days: the real message, right
     there in the body, said the model no longer existed. */
  if (!r.ok) {
    let why = '';
    try { const b = await r.json(); why = (b && b.error && b.error.message) || ''; } catch { /* body was not json */ }
    const e = new Error('the model refused (' + r.status + ')' + (why ? ': ' + why.replace(/\s+/g, ' ').slice(0, 160) : ''));
    e.status = r.status;
    e.body = why;
    throw e;
  }
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

/* Filing places into kinds is not reasoning, so the model is asked not to spend
   its allowance thinking. But HOW you ask changed between model generations:
   the 2.5 family takes a budget of zero, and the 3 family refuses that field
   outright and takes a named level instead. Measured on 3.5-flash-lite:
   thinkingBudget:0 is a flat 400, while omitting the field altogether already
   costs zero thinking tokens on this task.

   Rather than keep a list of which model speaks which dialect — the kind of
   list that goes stale exactly when a model is retired and nobody notices —
   the ask is dropped when it is refused, and the call is made again without
   it. One wasted round trip on a model generation we have not met before, and
   never a filing call lost to a field name. */
/* Two dialects for the same request, and dropping the ask was not good enough.

   Measured against gemini-3.5-flash-lite, which is what filing runs on:

     thinkingBudget: 0        400, invalid argument
     thinkingLevel: "low"     200
     temperature: 0           200

   So every filing call was spending a refused round trip and then asking again
   with NO thinking control at all — which left thinking on, at the model's own
   default, on the one call that has no thinking to do. That is why setting the
   temperature did not steady the answers: temperature was arriving, and thinking
   was doing the wandering. Two readings of the same settled questions, minutes
   apart and after temperature was set: 60/62/57, then 63/63/48.

   So the fallback asks in the other dialect rather than giving up, and what
   worked is remembered per model, because the refusal was being paid on every
   batch of every reading rather than once. */
const thinkDialect = new Map();     // model -> the thinkingConfig it accepts
const QUIET_DIALECTS = [{ thinkingBudget: 0 }, { thinkingLevel: 'low' }, null];

async function geminiJSONFileImpl(model, prompt, schema) {
  const known = thinkDialect.get(model);
  const tries = known !== undefined ? [known] : QUIET_DIALECTS;
  let last = null;
  for (const quiet of tries) {
    try {
      const out = await fileOnce(model, prompt, schema, quiet);
      if (known === undefined) {
        thinkDialect.set(model, quiet);
        console.log('[atlas] ' + model + ' takes ' +
          (quiet ? JSON.stringify(quiet) : 'no thinking setting at all') + ' — remembered');
      }
      return out;
    } catch (e) {
      last = e;
      const refusedTheField = e && e.status === 400 &&
        /thinking|invalid argument/i.test(e.body || e.message || '');
      if (!refusedTheField) throw e;
      // a dialect we already trusted has stopped working; find one again
      if (known !== undefined) { thinkDialect.delete(model); return geminiJSONFileImpl(model, prompt, schema); }
    }
  }
  throw last;
}

/* Theme-finding's induce call only: the one call that must REASON over the
   whole set of places, so thinking is turned on with an explicit budget. The
   pinned SDK (0.3.1) predates thinking budgets and silently drops the field,
   so this call speaks to the REST API directly. maxOutputTokens rises in
   step because on 2.5 models thought tokens count against it — without the
   headroom the JSON answer would truncate mid-object. */
const INDUCE_THINK_BUDGET = 2048;
/* Room for the answer as well as the thinking. The finder now lists every
   place that belongs to each kind (up to 12) and goes through an eight-line
   checklist first, and at 8,192 one Bengaluru reading of 25 Oct 2026 stopped
   early (MAX_TOKENS) and came back with nothing. */
const INDUCE_MAX_TOKENS = 16384;
/* Left unset, this call ran at the default of 1.0 — and 1.0 is what produced
   four different sets of questions from the same sixty-six places in one day,
   same model, same data. The territory was stable (what a place is, what it is
   made of, what you can do there kept reappearing) but the wording, the cut and
   the number of questions moved every time, and the keys on a map somebody has
   linked to should not move under them.

   Low, not zero. Finding what a set of places can honestly be asked is a
   reading, and it does need to range over the possibilities; what it does not
   need is to reach a different answer each time it is asked. It does not make
   the reading correct — a set that came back missing a whole kind was missing
   an input, not short of certainty — it only stops the wording wandering. */
const INDUCE_TEMPERATURE = 0.2;
async function geminiJSONDeepImpl(model, prompt, schema) {
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
          maxOutputTokens: INDUCE_MAX_TOKENS,
          temperature: INDUCE_TEMPERATURE,
          thinkingConfig: { thinkingBudget: INDUCE_THINK_BUDGET },
        },
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!r.ok) {
    let why = '';
    try { why = (((await r.json()) || {}).error || {}).message || ''; } catch { /* body was not json */ }
    const e = new Error('the model refused (' + r.status + ')' + (why ? ': ' + why.replace(/\s+/g, ' ').slice(0, 160) : ''));
    e.status = r.status;
    e.body = why;
    throw e;
  }
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

/* Short names written by LOKA, on the way onto the map.

   Decides, for the layer being built, whether its places are named by the
   written column (place-names.js NAME_FIELD) and writes that column onto the
   features: the owner chose it (spec.popupTitleColumn is the written
   column), or — on by default, Mithun's decision — the naming column is
   longer than 32 characters for more than half the places and the owner has
   not switched it off. The names come from what the list already kept for
   this layer (a re-upload keeps every unchanged place's name) and the first
   words stand in for the rest until the model's names land (placeNamesJob).
   Answers the counts for the stanza, or null when the layer is left alone. */
/* The column that plays the place's name when rows are placed: the naming
   column, or — when the names are LOKA's written ones, which the rows do
   not carry yet — the column they are written from. */
function placeRoleColumn(spec) {
  if (!spec) return undefined;
  return spec.popupTitleColumn === placeNames.NAME_FIELD ? (spec.placeNamesFrom || undefined) : spec.popupTitleColumn;
}

function preparePlaceNames(session, spec, feats, keep) {
  if (!session.dataset || NEVER_READ.has(session.dataset) || !feats.length) return null;
  const rows = feats.map((f) => (f && f.properties) || {});
  const had = session.replacingLayerId ? placeNames.queue.get(session.dataset, session.replacingLayerId) : null;
  const chosen = spec.popupTitleColumn === placeNames.NAME_FIELD;
  let from = spec.placeNamesFrom || (had && had.from) || '';
  if (!from && spec.popupTitleColumn && spec.popupTitleColumn !== placeNames.NAME_FIELD) from = spec.popupTitleColumn;
  const aboard = (c) => !!c && rows.some((r) => r[c] !== undefined && r[c] !== null && r[c] !== '');
  if (!chosen) {
    if (had && had.off) return null;                                    // the owner switched it off
    if (spec.titleChosen) return null;                                  // the owner picked a plain column by hand (the bench)
    if (!aboard(from) || !placeNames.wantsNames(rows, from)) return null;   // on by default only when most are long
  } else if (!aboard(from)) {
    // chosen, but the column it came from is gone: the first column that qualifies, else back to plain naming
    from = Object.keys(rows[0] || {}).find((c) => placeNames.wantsNames(rows, c)) || '';
    if (!from) { delete spec.placeNamesFrom; delete spec.popupTitleColumn; return null; }
  }
  const got = placeNames.applyNames(feats, from, (had && had.names) || {});
  spec.popupTitleColumn = placeNames.NAME_FIELD;
  spec.placeNamesFrom = from;
  if (spec.popupTitleAlso === from || spec.popupTitleAlso === placeNames.NAME_FIELD) delete spec.popupTitleAlso;
  keep.add(placeNames.NAME_FIELD);
  return Object.assign(got, { from, by: got.fromModel ? ((had && had.by) || 'model') : 'first words' });
}

function transform(session) {
  const { rows, strategy } = session;
  const roles = rolesMap(session.columns);
  const report = { strategy, matched: 0, unmatched: [], ambiguous: [], outside: 0, total: rows.length };
  let feats = [];
  // Sources whose shapes ended up in this layer, in the order they were first
  // used. Only the ones actually drawn: a register that was searched and had
  // nothing to offer is not owed a line on the page.
  const borrowedFrom = new Map();

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
  } else if (!boundaryTargets(session, session.joinLayer)) {
    /* Names, and no outlines at all to match them against — a worldwide
       atlas has none, before or after its build. That used to be refused
       outright ("no joinable boundary layer"), so the file could not be
       checked and never reached the atlas. Now every row is simply a row
       without a place, which is the state the rest of the path already
       handles: the wizard offers to look them up by name on OpenStreetMap
       and put them on as points (layers/locate), and the finished atlas
       lists the rest under "rows that need a place". */
    const nameCol = roles.placeName;
    if (!nameCol) throw new Error('place-name column not set');
    report.noOutlines = true;
    rows.forEach((r, i) => {
      const name = String(r[nameCol] == null ? '' : r[nameCol]).trim();
      report.unmatched.push({ row: i, name: name || ('row ' + (i + 1)), candidates: [], reason: 'no outlines' });
    });
  } else {
    /* Every boundary layer this atlas has, the most specific first.

       A layer used to join against ONE of them, and a survey answered at mixed
       depths cannot be placed that way: "BRT Tiger Reserve, Chamarajanagar
       district, Karnataka" wants the reserve, "Karnataka" wants the state, and
       whichever single layer you pick loses one of them. Measured on one
       survey: ten state outlines placed 8 of 12, two hundred named places
       placed 5 of 12, and they were not the same rows.

       So each layer is tried in turn and the first hit wins, ordered by how
       small its shapes are. Smallest means most specific: BRT is 540 square
       kilometres and Karnataka is 191,791, so a row naming both gets the
       reserve. A row naming only a state falls through to the state. */
    const bt = boundaryTargets(session, session.joinLayer);
    if (!bt) throw new Error('no joinable boundary layer in this dataset');
    const nameCol = roles.placeName;
    if (!nameCol) throw new Error('place-name column not set');
    /* Ordered by how small its shapes typically are. Smallest is most
       specific, and most specific should win: a row naming both a reserve and
       the state it sits in means the reserve.

       Unless somebody chose a layer by hand, in which case theirs leads — a
       person who picks "match against districts" has said what they want, and
       a default pick is not the same thing. */
    const spread = (t) => {
      const b = t && t.geometry && bboxOfGeom(t.geometry);
      return b ? (b[2] - b[0]) * (b[3] - b[1]) : Infinity;
    };
    /* The finer levels fetched for this import (geo:ADM3, geo:ADM4 — blocks
       and localities the atlas does not draw) are rungs too. They used to be
       reachable only before the atlas existed, and then only the first of
       them: a sheet of village names was checked against sub-districts, and
       once the atlas was built it was joined again against the atlas's own
       district outlines alone — so rows the check had placed came out on no
       layer at all, and a layer file with nothing in it was committed. */
    const ladder = [];
    for (const opt of (boundaryOptions(session.dataset).options || [])) {
      const o = (opt.id === bt.opt.id) ? bt : boundaryTargets(session, opt.id);
      if (!o || !o.targets.length) continue;
      const sample = o.targets.slice(0, 40).map(spread).filter(Number.isFinite).sort((a, b) => a - b);
      o._size = sample.length ? sample[Math.floor(sample.length / 2)] : Infinity;
      ladder.push(o);
    }
    ladder.sort((a, b) => a._size - b._size);
    // the atlas's own outlines first, as before; the finer levels after them
    // (the level the guess chose, when it chose one of these, first among them)
    const geoIds = Object.keys(imports.readGeoTargets(session.id) || {})
      .sort((a, b) => (b === bt.opt.id) - (a === bt.opt.id));
    for (const id of geoIds) {
      const o = (id === bt.opt.id) ? bt : boundaryTargets(session, id);
      if (o && o.targets.length && o.opt.id === id && !ladder.includes(o)) ladder.push(o);
    }
    if (!ladder.length) ladder.push(bt);
    /* The layer a row's fix points into must not change under it. A fix is
       remembered as a place's number on the leading layer, and a file checked
       before its atlas existed was checked against a finer level — building
       the atlas adds outlines of its own, and one of them leading at commit
       would read "row 4 → place 17" off the wrong list. So a lead chosen
       before the build is kept for the life of the import. */
    const pin = session.joinLayerExplicit ? bt.opt.id : session.leadLayer;
    if (pin) {
      const i = ladder.findIndex((x) => x.opt.id === pin);
      if (i > 0) ladder.unshift(ladder.splice(i, 1)[0]);
    }
    const lead = ladder[0];
    if (!session.dataset) session.leadLayer = lead.opt.id;
    session.joinLayer = lead.opt.id;
    report.joinLayer = lead.opt.id;
    report.joinLabel = lead.opt.label;
    report.joinLadder = ladder.map((x) => x.opt.label);

    const results = joinByName(rows, nameCol, roles.adminParent || null, lead.targets);
    if (results.home) report.home = results.home;
    session.matchState = session.matchState || {};   // row -> code | 'skip' (manual fixes)
    // area kinds keep the joined polygon; point kinds (markers / category /
    // bubble) collapse it to its centroid — one symbol per admin unit
    const joinKind = session.spec && session.spec.kind;
    const wantAreas = joinKind === 'choropleth' || joinKind === 'polygon';

    /* A cell that is not a place name may still CONTAIN one.

       Choosing an atlas's REGION has read sentences for a while: somebody
       answering "which geographic areas do you work in?" writes "BRT Tiger
       Reserve, Chamarajanagar district, Karnataka, India", and the district is
       in there. Placing a LAYER'S ROWS did not, and the two paths reading the
       same column differently is how a survey placed its region across ten
       states and then put four pins on the map.

       Same scanner, same rules: outright matches only, longest phrase first, a
       single word that is loose in a sentence skipped. Runs are read left to
       right, so the first name found is the most specific one mentioned —
       which is the order people write in. */
    // one name index per layer on the ladder, so a miss can fall to the next
    const indexOf = (targets) => {
      const m = new Map();
      // the lossy form a Devanagari cell is compared on (matching.js, stage 1c)
      m.skel = new Map();
      for (const t of targets) {
        for (const nm of [t.name, ...(t.aliases || [])]) {
          const k = norm(nm);
          if (!k) continue;
          if (!m.has(k)) m.set(k, []);
          if (!m.get(k).includes(t)) m.get(k).push(t);
          const s = skeleton(k);
          if (!s) continue;
          if (!m.skel.has(s)) m.skel.set(s, []);
          if (!m.skel.get(s).includes(t)) m.skel.get(s).push(t);
        }
      }
      return m;
    };
    const rungs = ladder.map((x) => ({ opt: x.opt, targets: x.targets, index: indexOf(x.targets) }));
    const byTargetName = rungs[0].index;
    const insideTargets = (k) => byTargetName.get(k) || null;

    /* The same row, asked of every other layer, most specific first. Returns
       the single shape that layer is sure of, or nothing — a name that means
       several places on a rung is not an answer, it is the question the fix
       list already asks, and it is left for the rung that can answer it. */
    function elsewhere(cell) {
      const text = String(cell == null ? '' : cell);
      for (let i = 1; i < rungs.length; i++) {
        const look = (k) => rungs[i].index.get(k) || null;
        let hit = null;
        for (const sp of aliasSpellings(text)) {
          const c = rungs[i].index.get(sp);
          if (c && c.length === 1) { hit = c[0]; break; }
        }
        /* A Devanagari cell gets the two further steps joinByName gives it on
           the leading layer: each English spelling its letters are known to
           take, then the lossy form both scripts reduce to — one target only,
           as above; several is the fix list's question. */
        if (!hit && hasDevanagari(text)) {
          const keys = spellings(text);
          for (const sp of keys) {
            const c = rungs[i].index.get(sp);
            if (c && c.length === 1) { hit = c[0]; break; }
          }
          if (!hit) {
            const found = [];
            for (const sp of keys) for (const t of (rungs[i].index.skel.get(skeleton(sp)) || [])) if (!found.includes(t)) found.push(t);
            if (found.length === 1) hit = found[0];
          }
        }
        if (!hit && /\s/.test(text.trim())) {
          const found = namesInside(text, look);
          const one = found.find((f) => f.cands.length === 1);
          if (one) hit = one.cands[0];
        }
        if (hit) return { target: hit, opt: rungs[i].opt };
      }
      return null;
    }
    const placeOn = (target, rowIdx) => {
      const props = { ...rows[rowIdx], name: target.name };
      if (target.credit && !borrowedFrom.has(target.credit)) {
        borrowedFrom.set(target.credit, target.licence || '');
      }
      feats.push({
        type: 'Feature', properties: props,
        geometry: wantAreas ? target.geometry : { type: 'Point', coordinates: centroidOf(target.geometry) },
      });
      report.matched++;
    };

    results.forEach((res) => {
      const manual = session.matchState[res.row];
      const code = manual === 'skip' ? null : (manual || res.match);
      if (manual === 'skip') {
        // left for later ("Skip for now"): off the map, but still on the list
        // of rows that need a place, with what it could have been
        (report.skipped = report.skipped || []).push({ row: res.row, name: res.name, candidates: res.candidates || [],
          ...(res.sameName ? { sameName: true } : {}) });
        return;
      }
      if (!code) {
        // a single word has already been looked up as itself; only sentences here
        const inside = /\s/.test(String(res.name == null ? '' : res.name).trim())
          ? namesInside(res.name, insideTargets) : [];
        const first = inside[0];
        if (first && first.cands.length === 1) {
          placeOn(first.cands[0], res.row);
          report.inSentence = (report.inSentence || 0) + 1;
          return;
        }
        if (first) {
          // the name it mentions is several places — the same question the
          // fix list already asks, asked about the name rather than the cell
          report.ambiguous.push({
            row: res.row, name: res.name,
            candidates: first.cands.map((t) => ({ code: t.code, name: t.name, parent: t.parent, score: 1 })),
          });
          return;
        }
        /* Nothing on the layer we started from. Before giving up, ask the
           other layers this atlas has — a row naming a reserve has no answer
           among states, and a row naming a state has none among reserves. */
        const other = elsewhere(res.name);
        if (other) {
          placeOn(other.target, res.row);
          report.fromOtherLayer = (report.fromOtherLayer || 0) + 1;
          (report.alsoJoined = report.alsoJoined || {})[other.opt.label] =
            ((report.alsoJoined || {})[other.opt.label] || 0) + 1;
          return;
        }
        (res.candidates.length ? report.ambiguous : report.unmatched).push({
          row: res.row, name: res.name, candidates: res.candidates,
          // one spelling, several places: the question screen asks which
          ...(res.sameName ? { sameName: true } : {}),
          // the look-alikes below the candidate floor, for the model to pick from
          ...(res.loose && res.loose.length ? { loose: res.loose } : {}),
        });
        return;
      }
      const target = lead.targets[Number(code)];
      if (!target) return;
      placeOn(target, res.row);
      /* Placed by the model rather than by the rules: on the map, and listed
         here for the owner to confirm or fix. A manual fix through
         /layers/resolve takes the row off this list. */
      if (session.suggested && session.suggested[res.row] === code) {
        (report.suggested = report.suggested || []).push({ row: res.row, name: res.name, code, place: target.name,
          parent: target.parent || '', area: target.area || '',
          // what the model chose among — the owner changes it to one of these
          candidates: (res.candidates && res.candidates.length ? res.candidates : res.loose) || [] });
      } else if (res.byNeighbours && !manual) {
        /* Put by its neighbours (matching.js, settleByNeighbours): the one
           place of that name inside the area the other rows cover. Placed,
           and listed so the owner can check it — the other places of the
           same name ride along, so changing it is one tap. */
        (report.byNeighbours = report.byNeighbours || []).push({ row: res.row, name: res.name, code, place: target.name,
          parent: target.parent || '', area: target.area || '', candidates: res.candidates || [] });
      }
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
  /* Short names written by LOKA (place-names.js): a layer whose naming
     column is a sentence for most of its places gets the written column on
     every feature here, before the stanza is built, so the stanza names it
     and the preview, the draft and the commit all show a name at once. */
  const named = preparePlaceNames(session, spec, feats, keep);
  const frag = buildFragment(spec, feats, existingIds);
  if (named) {
    placeNames.markStanza(frag.stanza, { from: named.from, by: named.by, waiting: named.waiting,
      long: named.long, total: named.total, anyNamed: named.values.some(Boolean) });
  }
  /* Pass the credit on to the layer itself.

     A layer built by joining rows to borrowed shapes IS a use of those shapes,
     and the page that shows it has to say so. Nothing did: the outline of the
     Western Ghats was drawn from a mountain inventory and the inventory was
     named nowhere a reader could see it. Worse for the OpenStreetMap case,
     where the licence asks for more than a thank-you — the notice about it is
     raised by finding OpenStreetMap among the credits, so a layer that kept
     quiet about where its shapes came from suppressed the notice as well. */
  if (borrowedFrom.size) {
    frag.stanza.credits = [...borrowedFrom].map(([name, license]) => (
      license ? { name, note: 'Shapes joined to this layer', license }
              : { name, note: 'Shapes joined to this layer' }));
    frag.stanza.attribution = [...borrowedFrom.keys()].join('; ');
  }
  // derived properties (e.g. the primary-tag category key) must survive the whitelist
  (frag.derivedKeys || []).forEach((k) => keep.add(k));
  /* The picture column, kept as plain addresses before anything is cut.

     Every value is trimmed to five hundred characters on its way onto a map.
     A place whose photographs arrive wrapped — a list of little records, each
     with an id beside the address it carries — spends most of that length on
     the wrapping, so the trim fell through the middle of an address and the
     map was left holding a fragment that loads nothing. A Cubbon Park place
     had four photographs and showed three, the fourth cut in half.

     Keeping the addresses alone, before the trim, means the trim falls between
     whole addresses if it falls at all. A column that holds no addresses is
     left exactly as it was. */
  var pictureCol = String((spec && spec.imageColumn) || '');
  if (pictureCol) {
    feats = feats.map((f) => {
      const had = f && f.properties ? f.properties[pictureCol] : undefined;
      if (had === undefined || had === null || had === '') return f;
      const links = justTheLinks(had);
      if (!links || links === String(had)) return f;
      return { ...f, properties: { ...f.properties, [pictureCol]: links } };
    });
  }
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

/* ---------- points alongside the outlines ----------

   Rows naming places no outline holds — villages, on an atlas whose finest
   outlines are blocks — can be looked up by name on OpenStreetMap and put on
   as points (/layers/locate, then /layers/locate/keep with `alongside`). They
   go on BESIDE the outlines, never instead of them: a layer here is one kind
   of shape (the viewer draws a layer as areas or as pins, not both), so one
   upload becomes two layers — "<name>" with its outlines and "<name> · as
   points" — sharing the file's columns, card and keys. splitPointRows (in
   lib/matching.js) says which rows are points: the chosen ones the outlines
   did not place. Every reading of an import goes through here, so the
   wizard's numbers, the commit and the fix list can never disagree. */
const OSM_POINTS_CREDIT = { name: '© OpenStreetMap contributors', note: 'Places found by name', license: 'ODbL' };
function pointsLabel(label) {
  return String(label || 'Your data').slice(0, 46).trim() + ' · as points';
}
function pointsSession(session, rowIdx) {
  const taken = new Set(session.columnsRaw || []);
  const free = (base) => { let c = base, k = 2; while (taken.has(c)) c = base + ' ' + (k++); taken.add(c); return c; };
  const lat = free('latitude'), lng = free('longitude');
  const rows = rowIdx.map((i) => ({ ...session.rows[i],
    [lat]: Number(session.pointRows[i].lat), [lng]: Number(session.pointRows[i].lng) }));
  return {
    ...session,
    rows,
    strategy: 'coordinates',
    columnsRaw: (session.columnsRaw || []).concat([lat, lng]),
    columns: (session.columns || []).filter((c) => c.role !== 'latitude' && c.role !== 'longitude')
      .concat([{ name: lat, role: 'latitude' }, { name: lng, role: 'longitude' }]),
    /* Pins, or pins coloured by the same column when the outlines are
       coloured by kind. Not sized circles: the viewer searches pins and
       areas, not circles, and a village that cannot be found by its name in
       the search box is half on the map. */
    spec: { ...(session.spec || {}), label: pointsLabel(session.spec && session.spec.label),
      kind: (session.spec && session.spec.kind === 'category' && session.spec.categoryColumn) ? 'category' : 'markers' },
    replacingLayerId: session.pointsLayerId || null,
    replacingCredits: null, replacingAttribution: null,
  };
}
function placeAll(session) {
  const outline = transform(session);
  if (!session.pointRows || session.strategy !== 'adminJoin') {
    return { outline, points: null, pointsSession: null, report: outline.report };
  }
  const split = splitPointRows(outline.report, session.pointRows);
  if (!split.rows.length) return { outline, points: null, pointsSession: null, report: split.report };
  const ps = pointsSession(session, split.rows);
  const points = transform(ps);
  // the places were found on OpenStreetMap, and the page says so — once: the
  // viewer folds credits of the same name together
  points.frag.stanza.credits = [OSM_POINTS_CREDIT];
  points.frag.stanza.attribution = OSM_POINTS_CREDIT.name;
  return { outline, points, pointsSession: ps, report: split.report };
}

function applyResult(session, withDraft) {
  const parts = placeAll(session);
  const { frag } = parts.outline;
  const report = parts.report;   // with the rows put on as points taken off its lists
  const features = parts.outline.features;
  const pointCount = parts.points ? parts.points.features.length : 0;
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
      // how many places this column is a sentence for: "Short names written
      // by LOKA" is offered when that is more than half of them (place-names.js)
      longValues: placeNames.countLong(session.rows || [], p.name).long,
    })),
    rowCount: (session.rows || []).length,
    /* Which rows have nothing in each column of words, so the naming choice
       can say "9 places have nothing in Labels — they will be called Place 10,
       Place 14…" for one column or for two together, without the rows. */
    emptyRows: emptyRowsByColumn(session.columnsRaw || [], session.rows || []),
    /* Four real rows, so "Identify each place by" can show what a choice
       does before it is made — the same four whichever column is picked. The
       owner's own data, back to the owner; cut so a long note stays short. */
    peekRows: (session.rows || []).slice(0, 4).map((r) => {
      const o = {};
      for (const k of Object.keys(r || {})) {
        if (k.charAt(0) === '_') continue;
        const v = r[k];
        if (v === null || v === undefined || typeof v === 'object') continue;
        o[k] = String(v).slice(0, 120);
      }
      return o;
    }),
    joinLayer: session.joinLayer || null,
    boundaries: session.boundaryOptions || null,
    columns: session.columns,
    matchReport: report,
    fragment: frag.stanza,
    draftDataset: draftId,
    // the outlines and the points beside them, both: every row on the map
    stats: { features: features.length + pointCount, outlines: features.length, points: pointCount, kind: frag.kindUsed },
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
/* Preparing a layer, like committing it, was only ever the body of a handler.
   A retry needs it with no browser present, so it takes plain input and a
   `who`, and refuses by throwing rather than by writing a response. */
/* How far a check has got, for the page that is waiting on it.

   Checking a file is one request, and on a real file it can take half a
   minute: the outlines of the chosen places are fetched, the model reads what
   the columns hold, the rows are matched, and the names the rules could not
   place are sent back to the model to choose between. The setup page used to
   show a moving stripe for all of it, which says "something is happening" and
   nothing else.

   So the page sends a token with the rows and asks after it while it waits.
   What comes back is only the name of the step running and two counts — no
   rows, no names — and it is forgotten a minute after the check ends. A step
   is reported when it starts; the matching itself is one synchronous pass
   over the rows, so there is no honest "80 of 134" to give mid-way, and none
   is invented. */
const PROGRESS = new Map();
const PROGRESS_KEEP = 60 * 1000;
function progressFor(token, rows) {
  const id = typeof token === 'string' && /^[A-Za-z0-9_-]{8,48}$/.test(token) ? token : '';
  if (!id) return Object.assign(() => {}, { end() {} });
  const tell = (step, extra) => {
    PROGRESS.set(id, Object.assign({ step, rows, at: Date.now() }, extra || {}));
  };
  tell('sending');
  tell.end = (failed) => {
    PROGRESS.set(id, { step: failed ? 'failed' : 'done', rows, at: Date.now() });
    setTimeout(() => PROGRESS.delete(id), PROGRESS_KEEP).unref();
  };
  return tell;
}

router.get('/layers/progress', (req, res) => {
  const id = String(req.query.id || '');
  res.json(PROGRESS.get(id) || { step: '' });
});

async function ingestLayer(b, who) {
  const tell = progressFor(b && b.progress, Array.isArray(b && b.rows) ? b.rows.length : 0);
  try {
    const out = await ingestLayerSteps(b, who, tell);
    tell.end(false);
    return out;
  } catch (e) {
    tell.end(true);
    throw e;
  }
}

async function ingestLayerSteps(b, who, tell) {
  const dataset = String(b.dataset || '');
  // Two callers: the workbench working on a built atlas, and the setup wizard
  // setting data up BEFORE the atlas exists. The second has no dataset to read,
  // so it sends the region it just chose instead; the session stays "pending"
  // until the build finishes and the layer is committed against the new slug.
  /* A worldwide atlas has no country and no units, and its file is still
     checked here before the build: the rows are placed by their own
     coordinates, or looked up by name (layers/locate), and the bounds are
     the world. Refusing it for want of a region is what left a worldwide
     atlas built from a spreadsheet with no data on it. */
  const worldwidePending = !dataset && !!(b.region && b.region.worldwide);
  const pendingRegion = (!dataset && b.region && (b.region.iso3 || worldwidePending)) ? {
    iso3: worldwidePending ? '' : String(b.region.iso3).toUpperCase(),
    level: worldwidePending ? 0 : (Number(b.region.level) || 1),
    shapeIDs: worldwidePending ? [] : (Array.isArray(b.region.shapeIDs) ? b.region.shapeIDs : []).map(String),
    bbox: worldwidePending ? WORLD_BBOX.slice()
      : (Array.isArray(b.region.bbox) && b.region.bbox.length === 4 ? b.region.bbox.map(Number) : null),
    worldwide: worldwidePending || undefined,
  } : null;
  if (pendingRegion) {
    const tooManyHere = pendingRegion.worldwide ? '' : tooManyUnits(pendingRegion.shapeIDs);
    if (tooManyHere) throw refuse(400, tooManyHere, { tooManyUnits: pendingRegion.shapeIDs.length });
    // no instance to authorise against yet — building requires a session, so
    // that (or the admin token) is the gate
    if (who !== 'server' && !auth.sessionFromReq(who) && !auth.isAdmin(who)) {
      throw refuse(401, 'sign in to set up your data', { needsAuth: true });
    }
    if (!pendingRegion.worldwide && (!/^[A-Z]{3}$/.test(pendingRegion.iso3) || !pendingRegion.shapeIDs.length)) {
      throw refuse(400, 'region iso3 and shapeIDs are required before the atlas exists');
    }
  } else {
    if (!imports.datasetDir(dataset)) throw refuse(404, 'unknown dataset');
    if (!datasetRole(who, dataset)) {
      throw refuse(403, 'sign in as this atlas’s owner or a collaborator', { needsAuth: true });
    }
  }
  const schema = Array.isArray(b.schema) ? b.schema : null;
  if (!schema || !Array.isArray(b.rows) || !b.rows.length) {
    throw refuse(400, 'schema and rows required');
  }
  const columns = schema.map((c) => String((c && c.name) || '')).filter(Boolean).slice(0, MAX_COLS);
  if (!columns.length) throw refuse(400, 'no usable columns');
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
    if (!prior) throw refuse(404, 'there is no layer here called ' + id);
    replacing = { id, prior, addedBy: prior.addedBy || null, addedAt: prior.addedAt || null,
      label: prior.label || '', uploadedAs: prior.uploadedAs || '',
      spec: (prior.spec && typeof prior.spec === 'object') ? prior.spec : null,
      /* Written only when questions are freshly FOUND, and a layer is read many
         times after that answering the ones it settled on. Each of those builds
         a new stanza, so without carrying it the account would be written once
         and lost on the very next reading. Same for the questions an owner has
         taken off the map. */
      reading: prior.reading || '', facts: prior.facts || null,
      hiddenKeys: prior.hiddenKeys || null,
      /* The nouns its questions' headings read "Explore by …" with, and the
         wording they belong to: a re-commit that hands no nouns keeps the old
         one wherever the question at that place is word for word the same. */
      keyNouns: prior.keyNouns || null, keyLabels: prior.keyLabels || null,
      /* Whose outlines these are. Worked out when rows are joined to borrowed
         shapes, and nowhere else — a reading handing an area layer's own
         shapes back has nothing to join, so without this the credit the
         licence asks for would go with the first question found. commitPart
         keeps them only where the new stanza has none of its own. */
      credits: Array.isArray(prior.credits) && prior.credits.length ? prior.credits : null,
      attribution: prior.attribution || '' };
  }

  const session = imports.newImport({
    dataset, region: pendingRegion || undefined,
    /* Who is adding this, recorded now while we still know. Commit used to ask
       the request, which works only while somebody is holding the page open;
       a reading retried an hour later still belongs to whoever asked for it. */
    addedBy: (who !== 'server' && auth.sessionFromReq(who)) || undefined,
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
    /* The reading's own account of the set: one line on what these records are,
       and the sorts of fact it found. Travels the same road as the key names. */
    reading: typeof b.reading === 'string' && b.reading.trim()
      ? b.reading.trim().slice(0, 200) : undefined,
    facts: Array.isArray(b.facts) && b.facts.length
      ? b.facts.slice(0, 12).map((f) => String(f).slice(0, 80)) : undefined,
    /* A question's own wording, kept whole.

       It was cut to forty characters here, which is a fair length for a name
       and far too short for a sentence — and asking one allows a hundred and
       twenty. So a question longer than forty was accepted, answered, and then
       stored with its end sawn off: "what locations are human-friendly and wh"
       is what a real one came out as, and the map wore that as its key.

       One number now says how long a question may be, and both ends read it,
       so they cannot drift apart again. */
    keyLabels: (b.keyLabels && typeof b.keyLabels === 'object')
      ? Object.fromEntries(Object.entries(b.keyLabels)
          .filter(([k, v]) => k && typeof v === 'string' && v.trim())
          .map(([k, v]) => [String(k).slice(0, 60), v.trim().slice(0, MAX_QUESTION_CHARS)]))
      : undefined,
    /* The kinds each question offers, kept beside its wording. The wording
       alone is not enough to ask the question again: without the kinds, a
       later reading would have to invent them, and inventing them is exactly
       what settling the questions is meant to stop. */
    keyKinds: (b.keyKinds && typeof b.keyKinds === 'object')
      ? Object.fromEntries(Object.entries(b.keyKinds)
          .filter(([k, v]) => k && Array.isArray(v) && v.length)
          .map(([k, v]) => [String(k).slice(0, 60), v.slice(0, MAX_CATS_KEPT)
            .map((x) => ({
              name: String((x && x.name) || '').trim().slice(0, 40),
              definition: String((x && x.definition) || '').trim().slice(0, 160),
            }))
            .filter((x) => x.name)])
          .filter(([, v]) => v.length))
      : undefined,
    /* The column each question was found in (enrich.js planColumns), kept
       beside its kinds so a later reading answers it from that column and
       checks its words there. Absent for a question found in the whole
       record. Column names only, as many as one group held. */
    keyColumns: (b.keyColumns && typeof b.keyColumns === 'object')
      ? Object.fromEntries(Object.entries(b.keyColumns)
          .filter(([k, v]) => k && Array.isArray(v) && v.length)
          .map(([k, v]) => [String(k).slice(0, 60), v.slice(0, MAX_COLS).map((c) => String(c).slice(0, 200)).filter(Boolean)])
          .filter(([, v]) => v.length))
      : undefined,
    /* The noun each question's heading reads "Explore by …" with (version D).
       Kept only when every word of it is a word of that question, the same
       check the page makes before it shows one (atlas/label-rules.js). */
    keyNouns: (b.keyNouns && typeof b.keyNouns === 'object' && b.keyLabels && typeof b.keyLabels === 'object')
      ? Object.fromEntries(Object.entries(b.keyNouns)
          .filter(([k]) => RULES.isQuestionColumn(String(k)))
          .map(([k, v]) => [String(k), shortLabels.LABELS.nounFromQuestion(v, b.keyLabels[k])])
          .filter(([, v]) => v))
      : undefined,
    replacingLayerId: replacing ? replacing.id : undefined,
    replacingKeyNouns: replacing ? replacing.keyNouns : undefined,
    replacingKeyLabels: replacing ? replacing.keyLabels : undefined,
    replacingLabel: replacing ? replacing.label : undefined,
    replacingUploadedAs: replacing ? replacing.uploadedAs : undefined,
    replacingSpec: replacing ? replacing.spec : undefined,
    replacingReading: replacing ? replacing.reading : undefined,
    replacingFacts: replacing ? replacing.facts : undefined,
    replacingHidden: replacing ? replacing.hiddenKeys : undefined,
    replacingAddedBy: replacing ? replacing.addedBy : undefined,
    replacingAddedAt: replacing ? replacing.addedAt : undefined,
    replacingCredits: replacing ? replacing.credits : undefined,
    replacingAttribution: replacing ? replacing.attribution : undefined,
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
    const fresh = {
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
      palette: 'marigold',
      markerColor: 'rust',
      lineColor: 'slate',
      fillColor: 'moss',
      popupTitleColumn: pickTitleColumn(profiles, columns),
      popupColumns: pickPopupColumns(profiles, { title: pickTitleColumn(profiles, columns), image: imgCol && imgCol.name }),
    };
    /* On a replace the layer's own choices win, as they do on the joined path
       below: a reading handing an area layer's shapes back with its answers is
       not a new upload, and must not come back with a new colour, a new card
       or a new name. Only what the layer never settled is filled in fresh. */
    const kept = session.replacingSpec ||
      (replacing ? specOfLayer(replacing.prior, replacing.id, rows, columns) : null);
    session.spec = kept ? Object.assign({}, fresh, kept) : fresh;
    if (session.replacingLabel) session.spec.label = session.replacingLabel;
    if (kept && session.spec.popupTitleColumn) {
      session.columns.forEach((c) => {
        c.role = c.name === placeRoleColumn(session.spec) ? 'placeName' : (c.role === 'placeName' ? 'text' : c.role);
      });
    }
    tell('placing');
    try {
      return applyResult(session, false);
    } catch (e) {
      throw refuse(400, e.message, { importId: session.id, columns: session.columns, strategy: session.strategy });
    }
  }

  // Robust name→admin matching: besides the atlas's own boundary layers, offer
  // geoBoundaries admin units for the atlas region at finer levels, so place
  // names the atlas doesn't carry (villages / localities) still match. Targets
  // are materialised to the import side-file so the sync placement path can read
  // them without a refetch.
  const inst = dataset ? reg.getInstance(dataset) : null;
  let geoOpts = [];
  tell('outlines');
  try { geoOpts = await geoBoundaryOptions(pendingRegion || (inst && inst.region), !!pendingRegion); }
  catch (e) { console.warn('[atlas] geo boundary options failed:', e.message); }
  if (geoOpts.length) {
    const byOpt = {};
    geoOpts.forEach((o) => { byOpt[o.id] = { label: o.label, level: o.level, targets: o.targets }; });
    imports.writeGeoTargets(session.id, byOpt);
  }
  const allOptions = options.concat(geoOpts.map((o) => ({ id: o.id, label: o.label, group: 'geo', count: o.count, exampleNames: o.exampleNames })));
  session.boundaryOptions = allOptions.map((o) => ({ id: o.id, label: o.label, group: o.group || '', count: o.count, exampleNames: (o.exampleNames || []).slice(0, 5) }));

  let inference = null;
  if (ai && !b.manual && geminiAllowed(who)) {
    tell('reading');
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
      /* Choosing columns is not reasoning. With thinking left on, the model
         spent its 8,192-token allowance thinking on a 134-row, 20-column file
         (Bengaluru, Oct 2026) and the answer stopped early, so the setup fell
         back to plain code without saying so. The filing call's settings —
         thinking off, room to answer, temperature 0 — measured on the live
         server: same answer, 1.4 s against 4.9 s. */
      inference = await geminiJSONFile(getFlashModel(), prompt, INFER_SCHEMA);
    } catch (e) {
      console.warn('[atlas] infer failed:', e.message);
    }
  }

  if (inference) {
    session.inference = { rowSubject: inference.rowSubject, notes: inference.notes || '' };
    session.strategy = inference.strategy;
    // only a layer that was actually offered; a stray id from the model would
    // send the rows to a join that does not exist
    const offered = inference.joinLayer && allOptions.some((o) => o.id === inference.joinLayer);
    session.joinLayer = offered ? inference.joinLayer : (allOptions[0] && allOptions[0].id);
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
    /* The model may propose how a NEW layer is drawn. It may not re-decide one
       that already exists.

       This line took the model's whole answer, and reading a layer comes
       through here, so every reading handed the model the layer again and let
       it choose afresh. Watched on the live atlas: three readings, three names
       — "LOKA Finds", then "LOKA Finds Locations", then "Local Discoveries".
       Fixing only the name was too narrow; the next reading kept the name and
       changed the card instead, dropping the categories line and putting up
       "Tag id", which is a UUID, in its place. It was never a naming bug. It
       was the model being asked to re-decide a settled layer, and answering
       differently each time because that is what a fresh reading of the same
       rows does.

       So on a replace the layer's own choices win, key by key, and the model
       only fills what the layer has no answer for — a column that did not exist
       before this upload, say. A first upload has nothing to keep and there the
       model's whole answer stands, which is where it earns its place. An owner
       changing something deliberately sends a spec of their own, and that is
       applied after this and still wins. */
    session.spec = session.replacingSpec
      ? Object.assign({}, inference.layer, session.replacingSpec)
      : inference.layer;
    if (session.replacingLabel) session.spec.label = session.replacingLabel;
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
    /* The column that matches best is not always the place. A sheet of
       villages with a district column matches perfectly on the district —
       every row says "Deoria" — and all eleven rows went onto one outline.
       When the best match says the same thing on nearly every row and another
       column is headed like a place and names a different one on most, that
       column is the place and the first is where it sits. */
    let parentGuess = null;
    if (nameGuess && nameGuess.column && rows.length >= 5) {
      const distinct = (c) => new Set(rows.map((r) => norm(String(r[c] == null ? '' : r[c]))).filter(Boolean)).size;
      if (distinct(nameGuess.column) <= Math.max(2, rows.length * 0.2)) {
        const alt = profiles.find((p) => p.type === 'string' && p.name !== nameGuess.column &&
          /village|gram|gaon|place|location|locality|settlement|habitation|town|site/i.test(p.name) &&
          distinct(p.name) >= rows.length * 0.5);
        if (alt) {
          parentGuess = nameGuess.column;
          nameGuess = { column: alt.name, rate: 0 };
          // and the outlines to try first are the ones THIS column matches best
          let best = -1;
          for (const opt of allOptions.slice(0, 8)) {
            try {
              const g = bestNameColumn([alt], rows, boundaryTargets(session, opt.id).targets.map((t) => t.name), norm);
              if (g.rate > best) { best = g.rate; joinGuess = opt.id; }
            } catch {}
          }
        }
      }
    }
    /* No outlines were offered at all (a worldwide atlas has none), so no
       column could be scored against them. The column that looks like a
       name is still the place column: the rows are looked up by it. */
    if (!nameGuess && !allOptions.length) {
      const nameish = profiles.find((p) => p.type === 'string' && p.looksLikeName && !p.looksLikeImage);
      if (nameish) nameGuess = { column: nameish.name, rate: 0 };
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
        : parentGuess && c === parentGuess ? 'adminParent'
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
      palette: 'marigold',
      markerColor: 'rust',
      popupTitleColumn: nameGuess ? nameGuess.column : pickTitleColumn(profiles, columns),
      popupColumns: pickPopupColumns(profiles, { title: nameGuess ? nameGuess.column : pickTitleColumn(profiles, columns), image: imgCol && imgCol.name }),
    };
    /* On a replace the layer's own choices win here too — the rule the model
       path and the shapes path already keep. Without it a reading on a server
       with no model (or a layer handed back for any other reason) came back
       with a guessed name column, a guessed colour and a fresh card, undoing
       what the owner had chosen under "Identify each place by". */
    if (session.replacingSpec) {
      session.spec = Object.assign({}, session.spec, session.replacingSpec);
      if (session.spec.popupTitleColumn) {
        session.columns.forEach((c) => {
          c.role = c.name === placeRoleColumn(session.spec) ? 'placeName' : (c.role === 'placeName' ? 'text' : c.role);
        });
      }
    }
    if (session.replacingLabel) session.spec.label = session.replacingLabel;
  }

  tell('matching');
  try {
    let result = applyResult(session, false);

    /* The model, only for what the rules could not place, and only to choose.
       matching.js decides what it is asked (names and their candidates — never
       a row) and what of its answer counts (a code that was offered for that
       name — never one it made up). Each pick is placed as a SUGGESTION the
       owner confirms or fixes; /layers/resolve clears it. One budgeted call,
       charged to the account or address like any other; an install with no
       key never reaches here, since `ai` is null. */
    if (ai && !b.manual) {
      const ask = fallbackRequest(result.matchReport);
      if (ask.length && geminiAllowed(who)) {
        tell('spelling', { names: ask.length });
        try {
          const adj = await geminiJSON(getFlashLiteModel(), [
            'Pick the right boundary for each source place name. Names may be spelt in Devanagari',
            'or in an English transliteration; Indian transliterations vary (Deoria / देवरिया / Devriya).',
            'Only use chosenCode values from that name\'s candidates; use "" when none fits.',
            JSON.stringify(ask),
          ].join('\n'), ADJUDICATE_SCHEMA);
          const chosen = applyFallback(result.matchReport, adj);
          const rows = Object.keys(chosen);
          if (rows.length) {
            session.matchState = session.matchState || {};
            session.suggested = session.suggested || {};
            for (const row of rows) { session.matchState[row] = chosen[row]; session.suggested[row] = chosen[row]; }
            result = applyResult(session, false);
          }
        } catch (e) {
          console.warn('[atlas] adjudication failed:', e.message);
        }
      }
    }
    return result;
  } catch (e) {
    if (e && e.status) throw e;
    throw refuse(400, e.message, { importId: session.id, columns: session.columns, strategy: session.strategy });
  }
}

/* Which of a layer's columns hold words worth reading. The same rules the
   browser applies before it asks: never our own answers back in — a question's
   column is an answer, not evidence — never coordinates, never links, and never
   a column whose every entry differs and none has a space in it, which is an
   identifier wearing a name. */
/* Which columns hold words worth reading — reading-rules.js has the rule and
   the reasons for it. */
const wordColumnsOf = (rows) => RULES.wordColumns(rows);

/* What a layer has already settled on, and — for one read before the kinds were
   kept — the kinds recovered from the answers a reader can already see. Both are
   in reading-rules.js, with the reasoning. */
const questionsOn = (layer, rows) => RULES.settledQuestions(layer, rows);

/* A whole reading, start to finish, with no browser involved: find the layer,
   read its places, work out what they can be asked, answer it, and write the
   result. Returns what happened rather than throwing on a reading that simply
   had nothing to find — only a fault throws. */
async function runReading(dataset, layerId, afresh, opts = {}) {
  if (!ai && !FAKE_READING) throw refuse(503, 'there is no model configured');
  // readManifest hands back the base, the org's overlay and the directory
  const m = imports.readManifest(dataset);
  if (!m) throw refuse(404, 'unknown atlas');
  const layer = imports.mergedLayers(m).find((L) => L.id === layerId);
  if (!layer) throw refuse(404, 'there is no layer here called ' + layerId);
  if (!layer.source) throw refuse(400, 'that layer has no places of its own');

  // one file that went on as two layers is read as one file — see fileHalves
  const halves = fileHalves(m, layer);
  if (!halves) throw refuse(404, 'the layer\'s places are missing');
  const rows = rowsOf(halves);
  if (!rows.length) throw refuse(400, 'that layer has no places');
  const fields = wordColumnsOf(rows);
  if (!fields.length) throw refuse(400, 'none of those columns hold words to read');

  /* The questions this layer already carries. Handed back so a second reading
     answers them rather than inventing a new set — an atlas somebody has linked
     to should not change its keys under them.

     `afresh` is the deliberate way to ask for new ones, and it is offered in
     two places: the owner's own "Ask again" button, which asks them to confirm
     first because it throws the settled questions away, and the operator's
     /admin/reread. Everything else reads with the questions already settled. */
  /* A layer put back from rows that never carried its answers has lost them
     from its own record; the server's copy of what it was last asked
     (opts.keep) stands in, so the keys on the map do not change under it. */
  /* Settled on whichever half carries them. A file read before both halves
     were read together has its questions on the pins alone, and a reading
     started from the outlines must answer those, not invent a new set. */
  const settled = halves.map((h) => questionsOn(h.layer, rows)).find((s) => s.length) || [];
  const asked = afresh ? [] : (settled.length ? settled : (opts.keep || []));
  /* Places a sync brought in or changed carry pattern_unread (loka-sync); the
     reading's own write clears it. When some places are marked and the rest
     already have their answers, only the marked ones are read, on the questions
     already settled, and the old answers are carried across. A layer with no
     marked place, or only marked places, is read whole, as it always was. */
  const todo = !afresh && settled.length ? rows.map((r, i) => (r && r.pattern_unread ? i : -1)).filter((i) => i >= 0) : [];
  const onlyNew = todo.length > 0 && todo.length < rows.length;
  const readRows = onlyNew ? todo.map((i) => rows[i]) : rows;
  if (onlyNew) console.log('[questions] ' + dataset + '/' + layerId + ' — reading only the ' + todo.length + ' new or changed places; the other ' + (rows.length - todo.length) + ' keep their answers');
  const inst = reg.getInstance(dataset);
  // the version of the FILE this reading is about — both halves of a split
  // file — so it can tell if either half moves under it
  const sigAtStart = fileSignatureOf(halves, RULES.isAnswerColumn);
  // charged to the owner when the server reads on their behalf (questions-queue.js)
  const payer = opts.payer ? { payer: opts.payer } : 'server';
  const callers = [];
  const caller = () => {
    const c = aiCaller(payer, null, FAKE_READING ? async () => ({}) : null);
    callers.push(c);
    return c;
  };
  // the stand-in's planned outcome for this reading, if a check planned one
  const planned = FAKE_READING ? fakePlanFor(dataset, layerId) : '';
  /* Every column with words of its own is read on its own (enrich.js
     planColumns), within what one attempt may spend (AI_CALLS_PER_READING —
     each attempt, the retry included, has a caller of its own); the place's name
     column is named so it is not read as evidence; and a re-read that adds
     questions from columns the first reading never drew on says which
     (opts.addColumns, from deploy/queue-question-rereads.mjs). */
  const nameCol = (layer.popup && layer.popup.title) || 'name';
  let firstFound = null;   // the first attempt's questions per column, reused by the second
  /* What the record said of each column last time, so a column this reading
     does not look at keeps the line it was given when it was looked at. */
  const previousColumns = ((QUESTIONS.get(dataset, layerId) || {}).columns) || [];
  const ask = (missed) => FAKE_READING ? fakeReading(readRows, fields, asked, caller(), planned, nameCol, previousColumns) : enrich.enrichRows({
    rows: readRows, fields, title: (inst && inst.title) || dataset,
    mode: 'questions',
    keepQuestions: asked,
    seedSet: keptCatSet(dataset),
    callJSON: caller(),
    models: { flash: getFlashModel(), flashLite: getFlashLiteModel() },
    missed,
    nameCol, callBudget: AI_CALLS_PER_READING,
    addColumns: Array.isArray(opts.addColumns) && opts.addColumns.length ? opts.addColumns : null,
    reuseFound: firstFound,
    previousColumns,
  });
  let out = await ask([]);
  firstFound = out.found || null;

  /* One more attempt, and only one, and only for the fault that counting can
     see: a word a good part of the map says whose places found nowhere to go.
     That is the failure this whole line of work started from — twenty of
     sixty-six places said "nature", the kinds on offer had no home for any of
     them, and all twenty were filed somewhere wrong.

     Not best-of-two. That would answer every place twice on every atlas to
     catch a fault most readings do not have, and would then need something to
     judge between the two sets. This costs a second reading only when the
     first one demonstrably left part of the map unspoken for, and the second
     is told exactly which part.

     Only where the questions were freshly found. When a layer is answering
     questions it settled on earlier, the questions are not this reading's to
     change, so a miss is not something asking again could fix. */
  /* A second attempt, told what the first one left blank.

     The miss is now named in places rather than in words: which question left
     which places with no answer, and what those places have in common. A word
     can be well served across the map and still name exactly the places one
     question cannot speak for, which is how the old test — a word's overall
     coverage against a floor — missed a hole that four of eight blank places
     were sitting in.

     Both kinds of miss are worth a retry: a question missing a kind, and a
     group of places no question asked about at all. */
  let triedAgain = false, missedFirst = [];
  const holesIn = (r) => [
    ...((r.gaps || []).flatMap((g) => g.missing.map((m) =>
      ({ word: m.word, places: m.places, under: g.question })))),
    ...((r.nobodyAsked || []).map((m) => ({ word: m.word, places: m.places, under: '' }))),
  ];
  if (!asked.length && out.verdict === 'questions' && holesIn(out).length) {
    missedFirst = holesIn(out).slice(0, 4);
    console.log('[atlas] ' + dataset + '/' + layerId + ' — asking again: ' +
      missedFirst.map((m) => m.word + ' on ' + m.places + ' places' +
        (m.under ? ' left blank by "' + m.under + '"' : ' asked about by nothing')).join('; '));
    const second = await ask(missedFirst);
    triedAgain = true;
    /* Kept only if it is actually better — judged on the reading itself, not on
       how many holes were named.

       The old test counted holes: keep the second set if it leaves fewer than
       the number we asked about. That is not the same question as "is this a
       better reading", and measured over 90 readings on three maps it got the
       answer wrong about a third of the time — in both directions. It threw
       away a second set that answered all but nine of sixty-six places in
       favour of one that left twenty-six unanswered, because both still had
       four holes to name. And it kept a second set that had dropped from three
       broad questions to one, because the hole count happened to fall.

       So the test is now the two things a reader would notice: how many
       questions speak for most of the map, and how many places are left with
       no answer at all from anything. More strong questions wins; on a tie,
       fewer places left out wins; on a tie there, the first set stands, having
       cost nothing extra to arrive at. */
    const strongIn = (r) => (r.questions || []).filter((q) => q.coverage >= 0.6).length;
    const unspokenIn = (r) => rows.filter((_, i) =>
      !(r.questions || []).some((q) => q.categories[i] && q.categories[i] !== 'other')).length;
    const many = (n, one, more) => n + ' ' + (n === 1 ? one : more);
    const describe = (r) => many(strongIn(r), 'question', 'questions') +
      ' speaking for most of the map, ' +
      many(unspokenIn(r), 'place', 'places') + ' with no answer';
    let better = false;
    if (second.verdict === 'questions' && (second.questions || []).length) {
      better = strongIn(second) !== strongIn(out)
        ? strongIn(second) > strongIn(out)
        : unspokenIn(second) < unspokenIn(out);
    }
    if (better) {
      console.log('[atlas] the second set is better — ' + describe(second) +
        ', against ' + describe(out) + ' — keeping it');
      out = second;
    } else {
      console.log('[atlas] the second set was no better — keeping the first (' +
        describe(out) + ')');
    }
  }

  /* What became of each column, in the log as well as the record: an owner
     reads it on their page, an operator in pm2's log, and both see the same
     lines. */
  for (const c of (out.columns || [])) console.log('[atlas] ' + dataset + '/' + layerId + ' — ' + c.line);
  if (out.verdict !== 'questions' || !(out.questions || []).length) {
    return { wrote: false, verdict: out.verdict, unread: out.unread || 0,
             read: out.read, batches: out.batches, trouble: out.trouble || '',
             note: out.note || '', reason: out.reason || '', withText: out.withText,
             sig: sigAtStart, calls: spentBy(callers), columns: out.columns || [] };
  }
  if (onlyNew) {
    const labels = (halves.find((h) => questionsOn(h.layer, rows).length) || halves[0]).layer.keyLabels || {};
    const merged = lokaSync.mergeNewReading(rows, todo, labels, asked, out);
    if (!merged) return { wrote: false, verdict: 'unmatched', calls: spentBy(callers) };
    out = merged;
  }
  /* Somebody put new places on this layer — or on the other half of its file —
     while it was being read. Writing now would lay these answers over the old
     places and throw their change away, so nothing is written; the newer
     version is read in its own turn (the list re-offers it: questions-queue
     `again`, then considerReading on what is on disk now). */
  if (opts.guard) {
    let now = null;
    try {
      const again = fileHalves(imports.readManifest(dataset), layer);
      now = again ? fileSignatureOf(again, RULES.isAnswerColumn) : null;
    } catch { /* gone: refused below as changed */ }
    if (now !== sigAtStart) return { wrote: false, verdict: 'changed', sig: sigAtStart, calls: spentBy(callers) };
  }
  await writeReadingToHalves({
    dataset, halves, questions: out.questions,
    /* What the model made of this set before it asked anything — one line on
       what these records are, and the sorts of fact it found in them. It was
       produced on every reading and thrown away every time, which left nobody
       able to see WHY a particular set of questions was asked. */
    reading: out.reading || '', facts: out.facts || [],
  });
  return {
    wrote: true, verdict: 'questions', places: rows.length, rowsRead: readRows.length, sig: sigAtStart, calls: spentBy(callers),
    columns: out.columns || [],
    questions: out.questions.map((q) => ({
      question: q.question,
      column: q.column || '',
      answered: (q.categories || []).filter((c) => c && c !== 'other').length,
      withWords: (q.why || []).filter((w) => w && w.length).length,
    })),
  };
}

/* The stand-in reading (see FAKE_READING). Same shape as enrich.enrichRows
   gives back, so everything after it — the shaping, the write, the keys on the
   map — is the real thing. Two questions: how much was written about each
   place, and whether it mentions water. A layer that already settled on
   questions gets those back, answered the same simple way. */
/* A check can plan what the stand-in says, layer by layer and reading by
   reading: ATLAS_FAKE_READING_PLAN is {"atlas|layer": ["unreachable",
   "refused"]}, one word used up per reading, and once a layer's words run out
   its readings go as usual. It is how a check plays out "the AI could not be
   reached, then came back and kept nothing" without a model. Only ever read
   when the stand-in itself is on (FAKE_READING). */
let fakePlan = null;
function fakePlanFor(dataset, layerId) {
  if (!fakePlan) {
    try { fakePlan = JSON.parse(process.env.ATLAS_FAKE_READING_PLAN || '{}') || {}; } catch { fakePlan = {}; }
  }
  const list = fakePlan[dataset + '|' + layerId];
  return Array.isArray(list) && list.length ? String(list.shift()) : '';
}

async function fakeReading(rows, fields, asked, pay, planned, nameCol, previous) {
  // long enough to watch the owner's note come and go; ATLAS_FAKE_READING_MS changes it
  const wait = Number(process.env.ATLAS_FAKE_READING_MS || 15000);
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 120000)));
  // a planned "could not be reached": nothing is asked and nothing is paid
  if (planned === 'unreachable') return { verdict: 'unavailable', trouble: '503 the stand-in is pretending to be busy' };
  /* One call for finding questions in each column read on its own, one for
     answering them — the same shape as a real reading, paid for out of the
     same allowance, so a check sees the calls a reading now costs. The
     report says what became of every column, as the real reading does. */
  const plan = enrich.planColumns(rows, fields, { nameCol: nameCol || '', budget: AI_CALLS_PER_READING,
    batches: Math.ceil(rows.length / 40) });
  for (const g of plan.groups) await pay('fake', 'find ' + g.label, null, {});
  await pay('fake', 'answer', null, {});
  const textOf = (r) => fields.map((f) => String((r && r[f]) || '')).join(' ').trim();
  const firstWords = (t) => t.split(/\s+/).filter(Boolean).slice(0, 2);
  const LONG = 'A few lines', SHORT = 'A short note', WATER = 'Mentions water';
  const wet = /\b(water|river|lake|pond|well|stream|tank)s?\b/i;
  /* Each names a checklist item of its own (about, as the real finder does),
     so nothing that counts items folds the two into one. */
  const q1 = {
    about: 7,
    question: (asked[0] && asked[0].question) || 'How much is written about this place?',
    noun: (asked[0] && asked[0].noun) || '',
    counts: [{ name: LONG, definition: 'forty letters or more' }, { name: SHORT, definition: 'fewer than forty letters' }],
    categories: rows.map((r) => textOf(r).length >= 40 ? LONG : SHORT),
    why: rows.map((r) => firstWords(textOf(r))),
  };
  const q2 = {
    about: 8,
    question: (asked[1] && asked[1].question) || 'Does it mention water?',
    noun: (asked[1] && asked[1].noun) || '',
    counts: [{ name: WATER, definition: 'names a river, lake, pond, well or the like' }],
    categories: rows.map((r) => wet.test(textOf(r)) ? WATER : 'other'),
    why: rows.map((r) => { const m = textOf(r).match(wet); return m ? [m[0]] : []; }),
  };
  const questions = [q1, q2].map((q) => {
    const answered = q.categories.filter((c) => c && c !== 'other').length;
    q.counts = q.counts.map((c) => Object.assign({}, c, { count: q.categories.filter((x) => x === c.name).length }));
    q.coverage = rows.length ? answered / rows.length : 0;
    return q;
  }).filter((q) => q.categories.some((c) => c && c !== 'other'));
  // the stand-in's questions are asked of the first column read; the rest are reported as yielding nothing
  const outcomes = {};
  plan.groups.forEach((g, i) => { outcomes[g.label] = i ? { state: 'none', note: 'the stand-in only counts the first column' } : { state: 'asked', proposed: 2, dropped: 0, twice: 0 }; });
  questions.forEach((q) => { q.column = plan.groups.length ? plan.groups[0].label : ''; });
  const columns = enrich.columnReport(plan, outcomes, questions, [], rows.length, { previous: previous || [] });
  if (!questions.length) return { verdict: 'no_clear_questions', note: 'nothing written to count', columns };
  // a planned "LOKA's own check turned them down", as the gate would say it
  if (planned === 'refused') return { verdict: 'refused', reason: "most places didn't fit any theme", columns };
  return { verdict: 'questions', questions, reading: 'Made up locally for checking, not by a model.', facts: [], columns };
}

/* "Asked, and nothing found", written onto the layer so it is not asked again.
   What the owner's browser used to do (rememberNothingHere), done here now. */
async function writeNothingHere(dataset, layer, rows) {
  const out = RULES.withoutAnswers(rows);
  const shapes = shapesFor(layer, dataset);
  const ing = await ingestLayer({
    dataset, replaceLayerId: layer.id, filename: layer.label || layer.id,
    patternsNone: true,
    schema: RULES.schemaFor(out),
    rows: out,
    geoms: shapes.geoms, geomIdx: shapes.geomIdx,
    meta: { sourceName: layer.source, rowCount: out.length, geometry: shapes.geometry },
  }, 'server');
  if (!ing || !ing.importId) throw refuse(500, 'the layer could not be prepared');
  return commitLayer({ importId: ing.importId, dataset }, 'server', { fromReading: true });
}

const spentBy = (callers) => callers.reduce((n, c) => n + c.spent(), 0);

/* A contributed layer's places, as the reading would see them. */
function layerAndRows(dataset, layerId) {
  const m = imports.readManifest(dataset);
  if (!m) return null;
  const layer = ((m.local && m.local.layers) || []).find((L) => L.id === layerId);
  if (!layer || !layer.source) return null;
  const file = path.join(m.dir, layer.source);
  if (!fs.existsSync(file)) return null;
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { layer, layers: m.local.layers, rows: ((gj && gj.features) || []).map((f) => f.properties || {}) };
}

/* ONE FILE, ONE FINGERPRINT. The version of a layer the list, the kept
   answers and the retry all compare against is the fingerprint of its whole
   file — both halves of a split file, in a fixed order (fileSignatureOf) — so
   a change to either half is a change to the file, and the same rows coming
   back on both halves is the same file. A layer with no twin is one half.
   Null when the layer or its places are gone. */
function fileSigOf(dataset, layerId) {
  const m = imports.readManifest(dataset);
  const layer = m && imports.mergedLayers(m).find((L) => L.id === layerId);
  const halves = layer ? fileHalves(m, layer) : null;
  return halves ? fileSignatureOf(halves, RULES.isAnswerColumn) : null;
}
// a kept fingerprint, in its present or its older form, against the layer's places now (sameFile)
function stillSameFile(dataset, layerId, kept) {
  const m = imports.readManifest(dataset);
  const layer = m && imports.mergedLayers(m).find((L) => L.id === layerId);
  return sameFile(kept, layer ? fileHalves(m, layer) : null, RULES.isAnswerColumn);
}

/* A layer's own shapes, for a reading's write to carry.

   A reading writes its answers by handing the layer's rows back to ingest, and
   ingest places rows afresh. A pin's row carries its coordinates, so it lands
   where it was. An area's row carries nothing of its shape — the shape was
   drawn in a file somebody uploaded, or borrowed from the outlines its name
   matched — so handed back as rows alone it would be re-joined by name, or
   lost. The reading did not move anything, and must not look as if it had:
   its write carries the shapes exactly as they are, row for row, the way
   /layers/reopen does when an owner edits an area layer. Pins keep the path
   they have always had. */
function shapesFor(layer, dataset) {
  if (!layer || layer.type === 'marker') return {};
  const m = imports.readManifest(dataset);
  let feats;
  try { feats = JSON.parse(fs.readFileSync(path.join(m.dir, layer.source), 'utf8')).features || []; } catch { return {}; }
  const geoms = feats.map((f) => f.geometry);
  const cls = /Polygon/.test(geoms[0] && geoms[0].type) ? 'polygon'
    : /LineString/.test(geoms[0] && geoms[0].type) ? 'line' : 'point';
  return { geoms, geomIdx: feats.map((_, i) => i), geometry: { class: cls, count: feats.length, vertices: 0 } };
}

/* The answers now on a layer, copied beside the list (questions-queue.js says
   why). Only the answer columns and the question wording travel. */
function keepAnswers(dataset, layer, rows, sig) {
  const cols = Object.keys(rows[0] || {}).filter((k) => RULES.isAnswerColumn(k));
  if (!cols.length) return;
  const only = (o) => {
    const out = {};
    for (const k of Object.keys(o || {})) if (RULES.isQuestionColumn(k)) out[k] = o[k];
    return out;
  };
  QUESTIONS.saveAnswers(dataset, layer.id, {
    sig, keyLabels: only(layer.keyLabels), keyKinds: only(layer.keyKinds), keyColumns: only(layer.keyColumns),
    keyNouns: only(layer.keyNouns),
    reading: layer.reading || '', facts: layer.facts || [],
    answers: rows.map((r) => { const a = {}; for (const c of cols) if (r[c] !== undefined) a[c] = r[c]; return a; }),
  });
}

/* The questions a layer was last asked, from that copy, for a layer that has
   lost its own. */
function keptQuestions(kept) {
  if (!kept) return [];
  return Object.keys(kept.keyLabels || {}).filter((c) => RULES.isQuestionColumn(c))
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))
    .map((c) => ({ question: kept.keyLabels[c], kinds: (kept.keyKinds || {})[c] || [],
                   columns: ((kept.keyColumns || {})[c] || []).slice(),
                   noun: String((kept.keyNouns || {})[c] || '') }))
    .filter((q) => q.question && q.kinds.length);
}

/* Put the kept answers back on the same places. No model, no cost. */
async function restoreAnswers(dataset, layerId) {
  const got = layerAndRows(dataset, layerId);
  const kept = QUESTIONS.loadAnswers(dataset, layerId);
  if (!got || !kept) return false;
  // the same file, both halves (fileSigOf): a split file whose other half
  // changed is read again, not patched up from one half's old answers
  const sig = fileSigOf(dataset, layerId);
  if (!sig || (kept.sig !== sig && !stillSameFile(dataset, layerId, kept.sig)) || (kept.answers || []).length !== got.rows.length) return false;
  const out = RULES.withoutAnswers(got.rows).map((r, i) => Object.assign(r, kept.answers[i]));
  const shapes = shapesFor(got.layer, dataset);
  const ing = await ingestLayer({
    dataset, replaceLayerId: layerId, filename: got.layer.label || layerId,
    schema: RULES.schemaFor(out),
    rows: out,
    geoms: shapes.geoms, geomIdx: shapes.geomIdx,
    keyLabels: kept.keyLabels, keyKinds: kept.keyKinds, keyColumns: kept.keyColumns, keyNouns: kept.keyNouns,
    reading: kept.reading || undefined,
    facts: (kept.facts || []).length ? kept.facts : undefined,
    meta: { sourceName: got.layer.source, rowCount: out.length, geometry: shapes.geometry },
  }, 'server');
  if (!ing || !ing.importId) throw refuse(500, 'the layer could not be prepared');
  commitLayer({ importId: ing.importId, dataset }, 'server', { fromReading: true });
  return true;
}

/* Should this layer be read, now that it has just been written? The same tests
   the owner's browser used to make before it started a reading (patternsDoor in
   owner.js), plus the one it could never make: has THIS version of the places
   been read already.

     - contributed, its places wearing a marker (pins, and areas since they
       wear the same one — RULES.wearsMarks), with places, with words of its
       own worth reading (RULES.worthReading: not just the names of the
       outlines it was joined to)
     - not the operator's own atlas (NEVER_READ)
     - no model key: nothing (as before — nothing is invented without one)
     - a layer that already carries questions, or was already found to have
       none, and that the list has never seen: it was read in a browser before
       this existed. Noted as read and left exactly as it is.
     - the reading's own write: the version it wrote is noted as read
     - ONE FILE, ONE RULE: a file that went on as two layers is read as one
       file through its pins (fileHalves), and its version is the fingerprint
       of both halves (fileSigOf). So a change to EITHER half — new rows on
       the outlines alone, say — is a change to the file, and the file is
       offered for reading through its pins exactly as if the pins had
       changed. Before this, the outlines half was only ever noted, never
       offered, and an outlines-only change was never read at all. */
function considerReading(dataset, layerId, opts) {
  if (NEVER_READ.has(dataset)) return 'never';
  const got = layerAndRows(dataset, layerId);
  if (!got) return 'no layer';
  const { layer, layers, rows } = got;
  if (!RULES.wearsMarks(layer)) return 'no marks';
  if (!rows.length || !RULES.worthReading(layer, rows)) return 'no words';
  const sig = fileSigOf(dataset, layerId);
  if (!sig) return 'no layer';
  const hasQuestions = questionsOn(layer, rows).length > 0 ||
    Object.keys(rows[0] || {}).some((k) => RULES.isQuestionColumn(k));
  /* Noted for either half of a split file: a reading started from the pins
     writes the outlines too (writeReadingToHalves), and their answers are
     kept here so a repair can put them back without reading again. */
  if (opts && opts.fromReading) {
    keepAnswers(dataset, layer, rows, sig);
    /* Not while the list is on this layer. A reading of a split file writes
       the pins first and the outlines after; noting the pins "done" between
       the two writes would let a change landing in that window be offered
       as a fresh version and then overwritten by the reading's own ending.
       The reading's ending (endReading) writes the record; a layer the list
       is not busy with — written by the owner's own question, the operator's
       re-read or a retry — is noted here as before. */
    if (!QUESTIONS.isBusy(dataset, layerId)) {
      QUESTIONS.remember(dataset, layerId, { sig, state: layer.patternsNone ? 'none' : 'done', reason: '' });
    }
    return 'written by a reading';
  }
  const had = QUESTIONS.get(dataset, layerId);
  if (had && (had.sig === sig || stillSameFile(dataset, layerId, had.sig))) {
    if (hasQuestions || layer.patternsNone) return 'already read';
    /* The same places, put back without their answers (a repair, the same file
       again). Their answers are copied back on; nothing is read. Only if that
       copy is missing — it is kept for every layer read since this list began,
       so that means lost — are they read again, because leaving a layer that
       had questions with none and no way back is worse than one reading. */
    if (had.state === 'done') {
      QUESTIONS.offer({ dataset, layerId, sig, restore: true });
      return 'answers put back';
    }
    return 'already read';
  }
  // (a place a sync marked as still unread is not "read before": it is offered, and read alone)
  if (!had && (hasQuestions || layer.patternsNone) && !rows.some((r) => r && r.pattern_unread)) {
    QUESTIONS.remember(dataset, layerId, { sig, state: layer.patternsNone ? 'none' : 'done', reason: '', adopted: true });
    keepAnswers(dataset, layer, rows, sig);
    return 'read before';
  }
  if (!ai && !FAKE_READING) return 'no model';
  const inst = reg.getInstance(dataset);
  const payer = payerOf(inst);
  /* The outlines half of a split file is never put on the list under its own
     name: its pins' reading covers both halves (fileHalves), and listing both
     would read one file twice and charge the owner twice. Its own answers are
     still noted and kept above, so a repair that puts the same places back
     gets them back without a reading. But a CHANGE to the outlines is a
     change to the file, so the file is offered through its pins, under the
     file's fingerprint. The list takes one version once: when both halves
     are committed together, whichever half asks first puts the file on and
     the other finds it there; while the file is being read, the list notes
     the newer version and looks again when the reading lands. */
  if (RULES.readByItsTwin(layer, layers)) {
    return QUESTIONS.offer({ dataset, layerId: layer.sameFileAs, sig, payer })
      ? 'queued through its pins' : 'read through its pins';
  }
  return QUESTIONS.offer({ dataset, layerId, sig, payer }) ? 'queued' : 'not queued';
}

/* ---------- short names for long column headings ---------- */

/* Should this layer be asked for short names? The rules are in
   api/lib/atlas/short-labels.js; this only finds the layer and its owner.
   Any contributed layer with rows — points or areas, both wear keys now. */
function considerShortLabels(dataset, layerId) {
  if (NEVER_READ.has(dataset)) return 'never';
  const got = layerAndRows(dataset, layerId);
  if (!got || !got.rows.length) return 'no layer';
  if (!shortLabels.headingsWanting(got.layer, got.rows).length) return 'none';
  if (!ai && !FAKE_READING) return 'no model';   // the viewer's own plain cut serves; nothing to store
  const inst = reg.getInstance(dataset);
  const m = imports.readManifest(dataset);
  return shortLabels.consider({ dataset, layerId, layer: got.layer, rows: got.rows,
    dir: m && m.dir, payer: payerOf(inst) });
}

/* One layer off the short-names list: one call to the model for all of its
   long headings, checked, written onto the stanza. Answers what to write on
   the list — the names too, so a re-commit gets them back for nothing. */
async function shortLabelsJob(job) {
  const { dataset, layerId } = job;
  const where = dataset + '/' + layerId;
  if (!ai && !FAKE_READING) return { state: 'skipped', reason: 'no model on this server' };
  const got = layerAndRows(dataset, layerId);
  if (!got) return { state: 'failed', reason: 'the layer is gone' };
  const headings = shortLabels.headingsWanting(got.layer, got.rows);
  if (!headings.length) return { state: 'none', reason: 'no long headings' };
  const inst = reg.getInstance(dataset);
  const m = imports.readManifest(dataset);
  console.log('[labels] naming ' + headings.length + ' heading' + (headings.length === 1 ? '' : 's') + ' on ' + where);
  /* One call, out of the owner's hourly allowance. The stand-in (FAKE_READING)
     answers with the plain cut, so the whole path — list, call, check, write
     — runs locally without a model. */
  const stub = FAKE_READING ? async () => ({ names: headings.map((h) => ({ heading: h, short: shortLabels.LABELS.shortHeading(h) })) }) : null;
  const call = aiCaller(job.payer ? { payer: job.payer } : 'server', 1, stub);
  let answer;
  try {
    // naming is not reasoning: thinking off, room to answer (the setup guess's lesson, 2efd115)
    answer = await call(getFlashLiteModel(), shortLabels.promptFor(headings, (inst && inst.title) || ''), shortLabels.schemaFor(Type), { file: true });
  } catch (e) {
    console.warn('[labels] ' + where + ' — ' + (e && e.message));
    return { state: 'failed', reason: String((e && e.message) || 'something went wrong').slice(0, 160) };
  }
  const { names, fromModel } = shortLabels.cleanNames(answer, headings);
  const by = FAKE_READING ? 'stand-in' : 'model';
  if (!m || !shortLabels.writeNames(m.dir, layerId, names, by)) {
    return { state: 'failed', reason: 'the names could not be written onto the layer' };
  }
  console.log('[labels] ' + where + ' — ' + fromModel + ' of ' + headings.length + ' named by the ' + by +
    (fromModel < headings.length ? ', the rest by the plain cut' : ''));
  return { state: 'done', reason: '', calls: 1, names, by, sig: shortLabels.headingSig(headings) };
}

/* ---------- the noun for "Explore by …", for questions found before it ---------- */

/* One layer off the list deploy/queue-key-nouns.mjs fills: one call for all
   of its questions that have no noun, each noun checked against its question,
   the ones that pass written onto the stanza. The rules are in
   api/lib/atlas/key-nouns.js. A question left without one keeps its own
   wording as its heading, which is what it shows today. */
async function keyNounsJob(job) {
  const { dataset, layerId } = job;
  const where = dataset + '/' + layerId;
  if (NEVER_READ.has(dataset)) return { state: 'skipped', reason: 'never touched' };
  if (!ai && !FAKE_READING) return { state: 'skipped', reason: 'no model on this server' };
  const m = imports.readManifest(dataset);
  const layer = m && ((m.local && m.local.layers) || []).find((L) => L.id === layerId);
  if (!layer) return { state: 'failed', reason: 'the layer is gone' };
  const wanting = keyNouns.questionsWanting(layer);
  if (!wanting.length) return { state: 'none', reason: 'every question has its noun' };
  const inst = reg.getInstance(dataset);
  console.log('[nouns] asking for ' + wanting.length + ' noun' + (wanting.length === 1 ? '' : 's') + ' on ' + where);
  // one call, out of the owner's hourly allowance; the stand-in answers without a model
  const stub = FAKE_READING ? async () => keyNouns.standInAnswer(wanting) : null;
  const call = aiCaller(job.payer ? { payer: job.payer } : 'server', 1, stub);
  let answer;
  try {
    answer = await call(getFlashLiteModel(), keyNouns.promptFor(wanting, (inst && inst.title) || ''), keyNouns.schemaFor(Type), { file: true });
  } catch (e) {
    console.warn('[nouns] ' + where + ' — ' + (e && e.message));
    return { state: 'failed', reason: String((e && e.message) || 'something went wrong').slice(0, 160) };
  }
  const nouns = keyNouns.cleanNouns(answer, wanting);
  const wrote = keyNouns.writeNouns(m.dir, layerId, nouns, wanting);
  console.log('[nouns] ' + where + ' — ' + wrote + ' of ' + wanting.length + ' given a noun' +
    (wrote < wanting.length ? '; the rest keep their wording as their heading' : ''));
  return { state: 'done', reason: '', calls: 1, nouns, sig: keyNouns.questionsSig(wanting) };
}

/* ---------- short names written by LOKA, for places named by a sentence ---------- */

/* Should this layer's places be given short names? The rules are in
   api/lib/atlas/place-names.js; this finds the layer, its owner and the
   column. The stand-in is written at once if the file does not carry the
   names yet; the model's names are asked for on the list. */
function considerPlaceNames(dataset, layerId, opts) {
  if (NEVER_READ.has(dataset)) return 'never';
  const got = layerAndRows(dataset, layerId);
  if (!got || !got.rows.length) return 'no layer';
  const inst = reg.getInstance(dataset);
  const m = imports.readManifest(dataset);
  /* The owner picked a plain column by hand in the bench (spec.titleChosen,
     not the guess): that is a "no" to short names, remembered on the list so
     a reading's write or a repair never switches them on by themselves. */
  const sp = got.layer.spec || null;
  if (!(opts && opts.from) && sp && sp.titleChosen && sp.popupTitleColumn !== placeNames.NAME_FIELD) {
    placeNames.queue.remember(dataset, layerId, { off: true });
    return 'switched off';
  }
  return placeNames.consider({ dataset, layerId, layer: got.layer, rows: got.rows, dir: m && m.dir,
    payer: payerOf(inst),
    spec: opts && opts.from ? { placeNamesFrom: opts.from } : sp });
}

/* The owner chose "Short names written by LOKA" in Settings: switched on
   (a "switched off" and an old version on the list are forgotten), the
   stand-in written at once, the model asked. Answers the list's word. */
function switchOnPlaceNames(dataset, layerId, from) {
  placeNames.queue.remember(dataset, layerId, { off: false, sig: '', from });
  return considerPlaceNames(dataset, layerId, { from });
}

/* The owner chose another column: the stanza stops saying the names are
   LOKA's, and the list remembers not to switch them back on by itself. */
function switchOffPlaceNames(dataset, layerId) {
  const m = imports.readManifest(dataset);
  const layer = m && m.local && (m.local.layers || []).find((L) => L.id === layerId);
  if (!layer || !layer.lokaNames) return false;
  placeNames.unmarkStanza(layer);
  fs.writeFileSync(path.join(m.dir, 'manifest.local.json'), JSON.stringify(m.local, null, 1));
  placeNames.queue.remember(dataset, layerId, { off: true });
  return true;
}

/* One layer off the place-names list: one call to the model for every 40
   long places that have no kept name, each answer checked, the names
   written onto the file and the stanza. At most CALLS_PER_HOUR calls in one
   go; what is left waits for the next hour on the same line of the list. */
/* Two knobs for the stand-in only, so the retry road can be watched on a
   throwaway server: ATLAS_FAKE_NAMES_FAIL ("3", or "slug:2,other:3") makes
   the stand-in unreachable that many times per atlas; ATLAS_QUEUE_PUMP_MS
   brings the names list's once-a-minute look closer. */
const fakeNamesFail = {};
if (FAKE_READING && process.env.ATLAS_FAKE_NAMES_FAIL) {
  for (const part of String(process.env.ATLAS_FAKE_NAMES_FAIL).split(',')) {
    const [slug, n] = part.includes(':') ? part.split(':') : ['*', part];
    fakeNamesFail[slug.trim()] = Number(n) || 0;
  }
}
const PUMP_EVERY = (FAKE_READING && Number(process.env.ATLAS_QUEUE_PUMP_MS)) || 60 * 1000;
async function placeNamesJob(job) {
  const { dataset, layerId } = job;
  const where = dataset + '/' + layerId;
  if (!ai && !FAKE_READING) return { state: 'skipped', reason: 'no model on this server' };
  const got = layerAndRows(dataset, layerId);
  if (!got) return { state: 'failed', reason: 'the layer is gone' };
  const m = imports.readManifest(dataset);
  const from = placeNames.sourceColumnOf(got.layer) || job.from || '';
  if (!from) return { state: 'none', reason: 'no column to name from' };
  const kept = Object.assign({}, job.names || {});
  const items = placeNames.wanting(got.rows, from, kept);
  const inst = reg.getInstance(dataset);
  /* A layer put on the list from outside (deploy/queue-place-names.mjs) is
     not switched on yet: the first words go beside every pin now, before
     the model is asked, so nobody waits on it to see a name. */
  const on = got.layer.popup && got.layer.popup.title === placeNames.NAME_FIELD && got.layer.lokaNames;
  if (m && (!on || !got.rows.every((r) => r[placeNames.NAME_FIELD] !== undefined))) {
    placeNames.writeNames(m.dir, layerId, { from, kept, by: job.by || 'model' });
  }
  console.log('[names] writing short names for ' + items.length + ' place' + (items.length === 1 ? '' : 's') + ' on ' + where);
  /* Out of the owner's hourly allowance, one call per PER_CALL places. The
     stand-in (FAKE_READING) answers with the first words that fit the rules,
     so the whole road — list, call, check, write — runs locally. */
  let batch = [];
  const stub = FAKE_READING ? async () => {
    // ATLAS_FAKE_NAMES_FAIL=n: the stand-in cannot be reached the first n times, to watch the retry
    const key = fakeNamesFail[dataset] > 0 ? dataset : (fakeNamesFail['*'] > 0 ? '*' : '');
    if (key) { fakeNamesFail[key] -= 1; throw new Error('the stand-in model could not be reached'); }
    return placeNames.standInAnswer(batch);
  } : null;
  const call = aiCaller(job.payer ? { payer: job.payer } : 'server', placeNames.CALLS_PER_HOUR, stub);
  let calls = 0, named = 0, declined = 0, stopped = '';
  for (let at = 0; at < items.length; at += placeNames.PER_CALL) {
    batch = items.slice(at, at + placeNames.PER_CALL);
    let answer;
    try {
      // naming is not reasoning: thinking off, room to answer (as the short-labels job)
      answer = await call(getFlashLiteModel(), placeNames.promptFor(batch, from, (inst && inst.title) || ''),
        placeNames.schemaFor(Type), { file: true });
    } catch (e) {
      stopped = String((e && e.message) || 'something went wrong');
      break;
    }
    calls += 1;
    const c = placeNames.cleanAnswer(answer, batch);
    Object.assign(kept, c.names);
    named += c.fromModel; declined += c.declined;
  }
  const by = FAKE_READING ? 'stand-in' : 'model';
  const wrote = m && placeNames.writeNames(m.dir, layerId, { from, kept, by });
  if (!wrote) return { state: 'failed', reason: 'the names could not be written onto the layer', names: kept, from, by, calls };
  const sig = placeNames.sigFor(got.rows, from);
  console.log('[names] ' + where + ' — ' + named + ' named by the ' + by + ', ' + declined + ' kept their first words' +
    (wrote.waiting ? ', ' + wrote.waiting + ' still waiting' : '') + (stopped ? ' — ' + stopped : ''));
  // done; or the rest wait for the next hour (share spent, or the model could
  // not be asked — tried again an hour later, up to three times, then failed)
  return Object.assign({ names: kept, from, by, calls, sig },
    placeNames.outcome({ waiting: wrote.waiting, stopped, tries: job.tries }));
}

/* One reading off the list. Answers what to write on the list about it. */
async function readingJob(job) {
  const { dataset, layerId } = job;
  const where = dataset + '/' + layerId;
  // no model key: nothing is invented without one, and nothing is said about it
  if (job.restore) {
    try {
      if (await restoreAnswers(dataset, layerId)) {
        console.log('[questions] ' + where + ' — the same places again: answers put back, nothing read');
        return { state: 'done', reason: '', calls: 0, restore: false,
          sig: fileSigOf(dataset, layerId) || job.sig };
      }
    } catch (e) {
      return { state: 'failed', restore: false, reason: ('the answers could not be put back — ' + (e && e.message)).slice(0, 160) };
    }
    // the copy no longer fits these places: read them instead, as below
  }
  if (!ai && !FAKE_READING) return { state: 'skipped', reason: 'no model on this server' };
  console.log('[questions] reading ' + where);
  let out;
  try {
    out = await runReading(dataset, layerId, false, { payer: job.payer || '', guard: true,
      keep: keptQuestions(QUESTIONS.loadAnswers(dataset, layerId)),
      // a re-read that keeps the questions it has and adds from the columns they never drew on
      addColumns: Array.isArray(job.addColumns) ? job.addColumns : null });
  } catch (e) {
    console.warn('[questions] ' + where + ' — ' + (e && e.message));
    return { state: 'failed', reason: String((e && e.message) || 'something went wrong').slice(0, 160) };
  }
  return endReading(dataset, layerId, out);
}

/* How a reading ends, whoever ran it: the list as a layer is added
   (readingJob), or the patient retry of one the AI could not be reached for
   (retryOne). One ending for both, so a reading finished an hour late is
   recorded exactly as one finished at once — questions, "looked and kept
   nothing" with the reason, or handed to the owed list again. Answers what to
   write on the list about it. */
async function endReading(dataset, layerId, out) {
  const where = dataset + '/' + layerId;
  if (out.wrote) {
    console.log('[questions] ' + where + ' — ' + out.questions.length + ' question' +
      (out.questions.length === 1 ? '' : 's') + ' written');
    // the version on disk now, answers and all (both halves of a split file);
    // its fingerprint is the one noted
    return { state: 'done', reason: '', calls: out.calls, sig: fileSigOf(dataset, layerId) || out.sig,
             columns: out.columns || [] };
  }
  if (out.verdict === 'nothing_new') {
    /* A re-read that only added from named columns, and kept nothing new:
       the questions on the map are exactly as they were, not answered again
       and not written again. The record says so, with what became of each
       column it asked. */
    console.log('[questions] ' + where + ' — the columns asked added no new question; the questions on the map are unchanged');
    return { state: 'done', reason: '', calls: out.calls, sig: fileSigOf(dataset, layerId) || out.sig,
             columns: out.columns || [] };
  }
  if (out.verdict === 'changed') {
    /* Not the end of the story: the list noted the newer version while this
       one was running (questions-queue `again`) and looks at it as soon as
       this record is written, so the changed file is offered once more. */
    console.log('[questions] ' + where + ' — the places changed while they were being read; the newer version is read next');
    return { state: 'failed', reason: 'the places changed while they were being read' };
  }
  if (cannotReach(out.verdict)) {
    /* The model could not be reached. That already has a patient list of its
       own — tried again on a backing-off timer, and the owner written to when it
       lands — so it is handed there rather than retried here. */
    const inst = reg.getInstance(dataset);
    owed.owe({ dataset, layerId, email: (inst && inst.email) || '', payer: payerOf(inst),
      kind: troubleKind(out.trouble), trouble: out.trouble || '' });
    return { state: 'failed', unreachable: true,
      reason: ('the AI could not be reached' + (out.trouble ? ' — ' + out.trouble : '')).slice(0, 160) };
  }
  /* "We looked and kept nothing" is one outcome, whoever said no: the model
     itself (no_clear_questions), or LOKA's own check turning down what the
     model suggested (refused), or too few places with words to read
     (too_thin). Each used to be its own thing — the last two ended as
     'failed', with the reason dropped, which told the owner "nothing could be
     found just now" as if it might come right by waiting. Nothing waits on a
     failed reading; the same places are not read again either way. So all
     three end the same way: noted on the layer as looked at, with the reason
     in plain words where the owner, the record and the log can all see it. */
  const nothingKept = enrich.whyNothingKept(out);
  if (out.verdict === 'no_clear_questions' || nothingKept) {
    const why = (nothingKept || out.note || 'no clear question').slice(0, 160);
    console.log('[questions] ' + where + ' — ' + why);
    const got = layerAndRows(dataset, layerId);
    // a layer answering questions it settled on keeps them; only an unasked one is marked
    if (got && !questionsOn(got.layer, got.rows).length) {
      try { await writeNothingHere(dataset, got.layer, got.rows); } catch (e) {
        return { state: 'failed', reason: 'nothing found, and that could not be noted — ' + (e && e.message) };
      }
      return { state: 'none', reason: why, sig: fileSigOf(dataset, layerId) || out.sig, columns: out.columns || [] };
    }
    return { state: 'none', reason: why, columns: out.columns || [] };
  }
  // a reading of only the new places whose answers did not line up with the questions: nothing was written
  if (out.verdict === 'unmatched') {
    console.warn('[questions] ' + where + ' — the new places’ answers did not match the questions, so nothing was written');
    return { state: 'failed', reason: 'the new places’ answers did not match the questions; nothing was written' };
  }
  console.warn('[questions] ' + where + ' — no questions could be found (' + out.verdict + ')');
  return { state: 'failed', reason: ('no questions could be found (' + out.verdict + ')').slice(0, 160) };
}

/* Coming back to a reading that could not be finished.

   Once a minute, the oldest outstanding reading that is due gets one more go.
   One at a time on purpose: a model that just came back from being overloaded
   is the last thing to throw a queue at, and a reading is three calls.

   Whoever asked hears once, at the end — when it lands, or when it is given up
   on. Not on each attempt: they asked for a map, not for a progress report on
   our weather. */
/* Two verdicts mean "we could not reach the model" and everything else means
   "we looked". The difference decides whether a reading is written down and
   come back to, or simply over. The drill that found this had the model wholly
   unreachable, so question-finding failed before answering ever began — and
   the debt was being dropped because only the second failure had a name. */
function cannotReach(verdict) { return verdict === 'unread' || verdict === 'unavailable'; }

// a refused key or a withdrawn model will not clear by waiting; busy will
function troubleKind(why) { return /\b(404|400|401|403)\b/.test(String(why || '')) ? 'gone' : 'busy'; }

// a check running the stand-in may come back sooner (never on the live server)
const RETRY_EVERY = (FAKE_READING && Number(process.env.ATLAS_FAKE_OWED_EVERY_MS)) || 60 * 1000;
let retrying = false;

async function tellTheOwner(o, subject, lines) {
  if (!o.email) return;
  try {
    await sendMail({ to: o.email, subject, text: lines.join('\n') + '\n' });
  } catch (e) {
    console.warn('[owed] could not write to ' + o.email + ' — ' + (e && e.message));
  }
}

/* The record the owner's page reads (question-readings.json), brought up to
   date by a retry — the same patch the list itself would have written after a
   first reading. Left alone while the list is reading a newer version of the
   same layer, or has already read one: that reading owns the record. */
function noteRetry(dataset, layerId, patch, sig) {
  if (QUESTIONS.isBusy(dataset, layerId)) return;
  const had = QUESTIONS.get(dataset, layerId);
  if (sig && had && had.sig && had.sig !== sig && !stillSameFile(dataset, layerId, had.sig)) return;
  QUESTIONS.remember(dataset, layerId, Object.assign({ unreachable: false }, patch, { endedAt: Date.now() }));
}

async function retryOne(o) {
  const where = o.dataset + '/' + o.layerId;
  /* The version this retry is of: the file's fingerprint as it stands before
     the reading (fileSigOf, both halves of a split file), which is the same
     fingerprint the record on the list was written with. Taken now rather
     than from the reading's own answer, so a file that changed while this
     retry ran is left to the list, which owns the newer version. */
  const fileSig = fileSigOf(o.dataset, o.layerId);
  let out;
  try {
    // read the way the list reads: the questions it last settled on, and not
    // over places that changed while it was being read
    /* Charged to whoever owns the atlas, like the reading it stands in for —
       the payer noted when it was owed, or the atlas's owner now. It used to
       run on the server's own allowance, so an owner's retries were paid by
       nobody's hour. */
    out = await runReading(o.dataset, o.layerId, false, { guard: true,
      payer: o.payer || payerOf(reg.getInstance(o.dataset)),
      keep: keptQuestions(QUESTIONS.loadAnswers(o.dataset, o.layerId)) });
  } catch (e) {
    // the layer or the atlas is gone: the debt goes with it
    if (e && (e.status === 404 || e.status === 400)) {
      owed.settle(o.dataset, o.layerId);
      console.log('[owed] dropped ' + where + ' — ' + e.message);
      return;
    }
    owed.owe({ dataset: o.dataset, layerId: o.layerId, kind: 'busy', trouble: (e && e.message) || '' });
    return;
  }

  /* The same ending a first reading gets. Still out of reach: endReading has
     put it back on the owed list, and the record keeps saying so. */
  const patch = await endReading(o.dataset, o.layerId, out);
  noteRetry(o.dataset, o.layerId, patch, fileSig || out.sig);
  if (patch.unreachable) return;
  owed.settle(o.dataset, o.layerId);

  if (out.wrote) {
    const waited = Math.max(1, Math.round((Date.now() - o.firstAt) / 60000));
    console.log('[owed] finished ' + where + ' after ' + o.attempts + ' tries');
    const inst = reg.getInstance(o.dataset);
    await tellTheOwner(o, 'Your atlas has been read',
      ['The AI could not be reached when you added this data, so nothing was written at the time.',
       'It has been read now.',
       '',
       (inst && inst.title) || o.dataset,
       ...out.questions.map((q) => '  ' + q.question + ' — answered for ' + q.answered + ' places'),
       '',
       'Each answer shows the words in your own data that led to it, so you can check any of them.',
       '',
       'Open your atlas: https://loka.place/apps/atlas/?dataset=' + encodeURIComponent(o.dataset),
       '',
       'It waited about ' + waited + ' minute' + (waited === 1 ? '' : 's') + '.']);
    return;
  }

  /* The reading ran and kept nothing. That is an answer, not a debt: the layer
     and its record say so, with the reason, exactly as a first reading would.
     The owner's page promised an email when it was done, so they get one
     (Mithun's yes, 2026-10-16). */
  console.log('[owed] ' + where + ' — ' + patch.state + ': ' + (patch.reason || out.verdict));
  if (patch.state === 'none') {
    const inst = reg.getInstance(o.dataset);
    const why = enrich.whyNothingKept(out);
    await tellTheOwner(o, 'Your atlas has been read',
      ['The AI could not be reached when you added this data, so nothing was written at the time.',
       'It has been read now, and no questions were kept for it.',
       '',
       (inst && inst.title) || o.dataset,
       ...(why ? ['', why] : []),
       '',
       'Your data is untouched.',
       '',
       'Open your atlas: https://loka.place/apps/atlas/?dataset=' + encodeURIComponent(o.dataset)]);
  }
}

async function sweepOwed() {
  if (retrying) return;
  retrying = true;
  try {
    for (const o of owed.expired()) {
      owed.settle(o.dataset, o.layerId);
      // the page stops saying it will be tried again; it no longer will be
      noteRetry(o.dataset, o.layerId, { state: 'failed', unreachable: false,
        reason: 'the AI could not be reached for a week, so this was stopped' });
      const days = Math.round(owed.GIVE_UP_MS / 86400000);
      console.warn('[owed] giving up on ' + o.dataset + '/' + o.layerId + ' after ' + days + ' days');
      await tellTheOwner(o, 'We could not read your atlas',
        ['The AI that reads your places has not been reachable for ' + days + ' days, so this has been stopped.',
         '',
         'Nothing was written and your data is untouched — no places were guessed at.',
         'Opening your atlas will start a fresh reading whenever you like:',
         'https://loka.place/apps/atlas/?dataset=' + encodeURIComponent(o.dataset),
         '',
         'If you write to us about this, the useful bit is: ' + (o.trouble || 'nothing was recorded')]);
      await sendMail({ to: ADMIN_EMAIL,
        subject: '[LOKA Atlas] gave up reading ' + o.dataset + '/' + o.layerId,
        text: 'Owed since ' + new Date(o.firstAt).toISOString() + ', ' + o.attempts +
          ' attempts, last trouble: ' + (o.trouble || 'none recorded') + '\n' +
          'The owner has been told. Nothing was written.\n' }).catch(() => {});
    }
    const list = owed.due();
    if (list.length) await retryOne(list[0]);
  } catch (e) {
    console.warn('[owed] the sweep stumbled — ' + (e && e.message));
  } finally {
    retrying = false;
  }
}

/* Called once, by the server, after this app is mounted. Two jobs: come back
   to readings that are owed, and notice when the model chosen for a job
   changes — a reading parked because a model was withdrawn is exactly the
   reading that a new model unblocks. */
export function startBackgroundWork() {
  let lastFiling = getFlashLiteModel();
  let lastReading = getFlashModel();
  setInterval(() => {
    const filing = getFlashLiteModel(), reading = getFlashModel();
    if (filing !== lastFiling || reading !== lastReading) {
      lastFiling = filing; lastReading = reading;
      owed.wake('now reading on ' + reading + ' and answering on ' + filing);
    }
  }, 5 * 60 * 1000).unref();
  setInterval(sweepOwed, RETRY_EVERY).unref();
  /* Finding the questions in layers as they are added. Whatever was waiting,
     or was being read when the server last stopped, starts moving again. */
  QUESTIONS.start(readingJob, { recheck: (d, l) => considerReading(d, l) });
  // and once a minute, so a reading put on the list from outside (the one-off
  // deploy/queue-question-readings.mjs) is picked up without a restart
  setInterval(() => QUESTIONS.pump(), 60 * 1000).unref();
  /* Short names for long column headings, the same way: its own list, one at
     a time, picked up within a minute when deploy/queue-short-labels.mjs adds
     to it from outside. */
  shortLabels.queue.start(shortLabelsJob, { recheck: (d, l) => considerShortLabels(d, l) });
  setInterval(() => shortLabels.queue.pump(), 60 * 1000).unref();
  /* Nouns for "Explore by …" on questions found before the reading picked
     them: put on only by deploy/queue-key-nouns.mjs, picked up within a minute. */
  keyNouns.queue.start(keyNounsJob);
  setInterval(() => keyNouns.queue.pump(), 60 * 1000).unref();
  /* Short names for places named by a sentence, the same way. The once-a-
     minute pump also brings back a job that stopped at its hour's share
     (notBefore), and one put on by deploy/queue-place-names.mjs. */
  placeNames.queue.start(placeNamesJob, { recheck: (d, l) => considerPlaceNames(d, l) });
  setInterval(() => placeNames.queue.pump(), PUMP_EVERY).unref();
  /* And the meaning index, for layers put on its list by
     deploy/queue-meaning-index.mjs — public and private atlases alike. */
  meaningQueue.start(meaningIndexJob);
  setInterval(() => meaningQueue.pump(), 60 * 1000).unref();
  const waiting = owed.all().length;
  if (waiting) console.log('[owed] ' + waiting + ' reading' + (waiting === 1 ? '' : 's') + ' still owed');
}

/* ---------- keeping a layer up to date from a LOKA space ---------- */

/* The link lives in the atlas's own overlay (manifest.local.json, which a
   rebuild leaves alone): lokaSync { spaceId, spaceName, layerId, connectedBy,
   connectedAt, lastUpdate }. The LOKA side and the row arithmetic are in
   api/lib/atlas/loka-sync.js; this is the routes and the write. Never on
   deoria-bioregion, never while an atlas is building, one update at a time. */
const LOKA_RUNNING = new Set();
const lokaStateOf = (inst) => {
  const s = readOverlay(inst).local;
  return s && s.lokaSync && typeof s.lokaSync === 'object' ? s.lokaSync : null;
};
// a fresh read each time, so nothing else's change to the overlay is lost
function lokaNote(inst, patch) {
  const { file, local } = readOverlay(inst);
  if (!local || !local.lokaSync) return;   // disconnected meanwhile
  Object.assign(local.lokaSync, patch);
  writeOverlay(file, local);
}
const lokaSuper = (req) => auth.isAdmin(req) || auth.isAdminSession(req);

async function applyLoka(slug, tags) {
  const inst = reg.getInstance(slug);
  const sync = lokaStateOf(inst);
  if (!sync) throw new lokaSync.LokaError('This atlas is no longer connected to LOKA.');
  const { rows, skipped } = lokaSync.toRows(tags, sync.spaceName);
  const m = imports.readManifest(slug);
  const layer = sync.layerId ? imports.mergedLayers(m).find((L) => L.id === sync.layerId) : null;
  if (sync.layerId && !layer) throw new lokaSync.LokaError('The layer kept up to date from LOKA is no longer on this atlas.');
  const got = layer ? layerAndRows(slug, layer.id) : null;
  const old = got ? got.rows : [];
  if (old.some((r) => !r.tag_id)) throw new lokaSync.LokaError('That layer’s places don’t all come from LOKA, so it can’t be kept up to date from there. Your atlas is unchanged.');
  /* A complete download (downloadSpace answers only for one) that lists no places
     at all empties the layer, as any other removal would. Places that arrived
     with no usable position are not "no places": that is refused. */
  if (!rows.length && tags.length) throw new lokaSync.LokaError('LOKA sent no places with a position, so nothing was changed.');
  if (!rows.length && !old.length) throw new lokaSync.LokaError('That space has no places yet.');
  if (!rows.length) {
    const dir = path.join(reg.DATA_DIR, 'backups', 'loka-sync-' + slug + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [layer.source, 'manifest.local.json']) fs.copyFileSync(path.join(m.dir, f), path.join(dir, f));
    imports.removeLayer(slug, layer.id);
    try { QUESTIONS.forget(slug, layer.id); } catch { /* nothing kept */ }
    lokaNote(reg.getInstance(slug), { layerId: '' });   // the next update makes the layer afresh
    return { at: new Date().toISOString(), added: 0, changed: 0, removed: old.length, skipped, emptied: true, error: '' };
  }
  const laid = lokaSync.lay(old, rows, { asking: !!layer && questionsOn(layer, old).length > 0 });
  const note = { at: new Date().toISOString(), added: laid.added, changed: laid.changed, removed: laid.removed, skipped, error: '' };
  if (layer && !laid.added && !laid.changed && !laid.removed) return note;
  if (layer) {
    const dir = path.join(reg.DATA_DIR, 'backups', 'loka-sync-' + slug + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    for (const f of [layer.source, 'manifest.local.json']) fs.copyFileSync(path.join(m.dir, f), path.join(dir, f));
  }
  const n = laid.rows.length;
  const ing = await ingestLayer({
    dataset: slug, replaceLayerId: layer ? layer.id : undefined, filename: layer ? (layer.label || layer.id) : sync.spaceName,
    schema: RULES.schemaFor(laid.rows), rows: laid.rows,
    geoms: laid.rows.map((r) => ({ type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] })),
    geomIdx: laid.rows.map((_, i) => i),
    keyLabels: layer ? layer.keyLabels : undefined, keyKinds: layer ? layer.keyKinds : undefined,
    keyColumns: layer ? layer.keyColumns : undefined, keyNouns: layer ? layer.keyNouns : undefined,
    reading: layer && layer.reading ? layer.reading : undefined,
    facts: layer && (layer.facts || []).length ? layer.facts : undefined,
    meta: { sourceName: layer ? layer.source : 'LOKA', rowCount: n, geometry: { class: 'point', count: n, vertices: n } },
  }, 'server');
  if (!ing || !ing.importId) throw new lokaSync.LokaError('The places could not be prepared. Your atlas is unchanged.');
  // an ordinary commit, not a reading's: the places changed, so the reading is offered for them
  /* Nothing to read: no place needs answers (a like moved, a place went, a photo
     changed). The new version is then noted as already read, the way a reading's
     own write is, instead of offering the whole layer. A layer with no questions
     yet, or with marked places, is offered as usual (the marked ones only). */
  const kept = !!layer && questionsOn(layer, old).length > 0 && !laid.rows.some((r) => r[lokaSync.UNREAD]);
  const done = commitLayer({ importId: ing.importId, dataset: slug }, 'server', kept ? { fromReading: true } : undefined);
  if (!layer) lokaNote(reg.getInstance(slug), { layerId: done.layerId });
  return note;
}

function startLokaUpdate(slug, tags) {
  LOKA_RUNNING.add(slug);
  setImmediate(async () => {
    let note;
    try {
      const inst = reg.getInstance(slug);
      const sync = inst && lokaStateOf(inst);
      if (!sync) return;
      const got = tags || (await lokaSync.downloadSpace(sync.spaceId)).tags;
      const now = reg.getInstance(slug);
      if (!now || now.status === 'building') throw new lokaSync.LokaError('The atlas is being rebuilt. Your atlas is unchanged.');
      note = await applyLoka(slug, got);
    } catch (e) {
      const plain = e instanceof lokaSync.LokaError;
      if (!plain) console.warn('[loka-sync] ' + slug + ' — ' + (e && e.message));
      note = { at: new Date().toISOString(), added: 0, changed: 0, removed: 0, skipped: 0,
        error: plain ? e.message : 'Something went wrong while bringing in places. Your atlas is unchanged.' };
    } finally {
      LOKA_RUNNING.delete(slug);
    }
    const inst = reg.getInstance(slug);
    if (inst && note) lokaNote(inst, { lastUpdate: note });
  });
}

// the atlas a LOKA route is about, or an answer already sent
function lokaGate(req, res, { write } = {}) {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) { res.status(404).json({ error: 'not found' }); return null; }
  if (write && searchText.isNeverTouched(inst.slug)) { res.status(403).json({ error: 'not allowed' }); return null; }
  return inst;
}
function lokaBusy(inst, res) {
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    res.status(409).json({ error: 'Wait for the atlas to finish building, then try again.' }); return true;
  }
  if (LOKA_RUNNING.has(inst.slug)) {
    res.status(409).json({ error: 'Places are already being brought in from LOKA.' }); return true;
  }
  return false;
}

/* Who may connect an atlas to a space. The operator: any space. An owner: a
   space their own LOKA account is in, or whose organisation they are in, once
   they have linked that account (the routes under /auth/loka, below) — or one
   the operator has approved for them on this atlas (Request access). Editors
   only press Update now. The rule itself is lokaSync.mayConnect. */
const LOKA_REFUSED = 'Your LOKA account isn’t listed as a member of this space or its organisation. If you made this space, ask for access and we’ll approve it.';
const LOKA_LINK_FIRST = 'Link your LOKA account first, then connect a space of yours.';
// the wizard offers only the spaces LOKA listed for the person (the snapshot on their link)
const LOKA_NOT_LISTED = 'That space isn’t on your LOKA list. Build the atlas without it, then ask for access under Owner ▾ → Settings.';
// how many spaces a link has: the list LOKA gave (the wizard's), else the older memberships
const lokaSpaceCount = (link) => (link.spaces && link.spaces.length ? link.spaces.length : (link.memberSpaces || []).length);
/* The signed-in account, when it is itself an owner of this atlas. Only the
   session counts here — not the edit token, not the operator's token — because
   what follows uses that account's own LOKA link, so the person whose link it
   is and the person whose right it is must be one and the same. */
function lokaOwnerSession(req, inst) {
  const who = auth.sessionFromReq(req);
  if (!who) return null;
  const owns = (inst.ownerAccount && who.email === inst.ownerAccount) || auth.isStandingOwner(who.email) || reg.collaboratorRole(inst, who.email) === 'owner';
  return owns ? who : null;
}
// what the Settings line needs to know about the person looking (owners and the operator; never a token caller)
function lokaMine(req, inst) {
  const who = auth.sessionFromReq(req);
  if (!who) return null;
  const link = reg.lokaLinkOf(who.email);
  const asked = reg.lokaRequests({ slug: inst.slug, by: who.email }).sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
  return { email: who.email, canLink: !searchText.isNeverTouched(inst.slug),
    link: link ? { lokaEmail: link.lokaEmail, linkedAt: link.linkedAt, spaces: lokaSpaceCount(link) } : null,
    request: asked ? { spaceId: asked.spaceId, spaceName: asked.spaceName, state: asked.state } : null,
    // why a space chosen while building was not connected (applyWantedLoka); cleared by a connect
    note: inst.lokaNote || '' };
}

/* Codes, tries and requests are counted per hour, per account and per email
   they are aimed at; a map forgets what is older than an hour as it is touched. */
const lokaCodeRate = new Map(), lokaTryRate = new Map(), lokaAskRate = new Map();   // key -> [timestamps]
function lokaOverRate(map, key, max) {
  const now = Date.now();
  for (const [k, ts] of map) { const live = ts.filter((t) => now - t < 3600 * 1000); if (live.length) map.set(k, live); else map.delete(k); }
  const hits = map.get(key) || [];
  if (hits.length >= max) return true;
  hits.push(now);
  map.set(key, hits);
  return false;
}

router.get('/instances/:slug/loka-sync', (req, res) => {
  const inst = lokaGate(req, res);
  if (!inst) return;
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const s = lokaStateOf(inst);
  const sup = lokaSuper(req), owner = callerRole(req, inst) === 'owner';
  const mine = lokaOwnerSession(req, inst) || sup ? lokaMine(req, inst) : null;
  res.json(Object.assign({ connected: !!s, spaceName: s ? s.spaceName : '', running: LOKA_RUNNING.has(inst.slug),
    lastUpdate: s ? s.lastUpdate || null : null, canStop: owner || sup,
    canConnect: (sup || !!(mine && mine.link)) && !searchText.isNeverTouched(inst.slug) }, mine || {}));
});

router.post('/instances/:slug/loka-sync', async (req, res) => {
  const inst = lokaGate(req, res, { write: true });
  if (!inst) return;
  const sup = lokaSuper(req), who = lokaOwnerSession(req, inst);
  if (!sup && !who) return res.status(403).json({ error: 'not allowed' });
  const link = sup ? null : reg.lokaLinkOf(who.email);
  if (!sup && !link) return res.status(403).json({ error: LOKA_LINK_FIRST });
  if (lokaBusy(inst, res)) return;
  if (!lokaSync.isSetUp()) return res.status(503).json({ error: 'LOKA hasn’t been set up on this server yet.' });
  const b = req.body || {};
  const spaceId = lokaSync.spaceIdFrom(b.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'That doesn’t look like a LOKA space id.' });
  let knownName = '';
  if (!sup) {
    const member = link.memberSpaces.find((s) => s.id === spaceId);
    const approved = reg.lokaRequests({ slug: inst.slug, spaceId, by: who.email, state: 'approved' }).length > 0;
    let space = null;
    // the space's organisation is asked of LOKA only when membership alone does not settle it
    if (!member && !approved) {
      try { space = await lokaSync.spaceInfo(spaceId); }
      catch (e) { return res.status(502).json({ error: e instanceof lokaSync.LokaError ? e.message : 'LOKA couldn’t be reached. Try again in a moment.' }); }
    }
    if (!approved && !lokaSync.mayConnect(link, spaceId, space)) return res.status(403).json({ error: LOKA_REFUSED, canRequest: true });
    knownName = (member && member.name) || (space && space.name) || '';
  }
  const layerId = b.layerId ? String(b.layerId) : '';
  if (layerId && !imports.mergedLayers(imports.readManifest(inst.slug)).some((L) => L.id === layerId)) {
    return res.status(404).json({ error: 'There is no layer here called ' + layerId + '.' });
  }
  if (layerId) {
    const mine = layerAndRows(inst.slug, layerId);
    if (!mine || !mine.rows.length || mine.rows.some((r) => !r.tag_id)) {
      return res.status(400).json({ error: 'That layer’s places don’t come from LOKA, so it can’t be kept up to date from there.' });
    }
    // one half of a file put on as outlines and points: replacing one half would strand the other
    if (mine.layer.sameFileAs || imports.mergedLayers(imports.readManifest(inst.slug)).some((L) => L.sameFileAs === layerId)) {
      return res.status(400).json({ error: 'That layer shares its file with another layer here, so it can’t be kept up to date from LOKA on its own.' });
    }
  }
  LOKA_RUNNING.add(inst.slug);
  let tags;
  // the space is downloaded before the link is made, so a space LOKA will not share leaves nothing linked
  try { tags = (await lokaSync.downloadSpace(spaceId)).tags; }
  catch (e) {
    LOKA_RUNNING.delete(inst.slug);
    return res.status(502).json({ error: e instanceof lokaSync.LokaError ? e.message : 'LOKA couldn’t be reached. Your atlas is unchanged.' });
  }
  if (!connectLoka(inst, { spaceId, spaceName: String(b.spaceName || '').trim().slice(0, 80) || knownName, layerId }, sup ? 'the operator' : 'its owner', tags)) {
    LOKA_RUNNING.delete(inst.slug);
    return res.status(500).json({ error: 'The link could not be saved.' });
  }
  res.json({ started: true });
});

/* The link itself, and the first update after it: for Settings (above, with
   the space already downloaded) and for a space chosen in the build wizard
   (applyWantedLoka, which downloads inside the update). False when the link
   could not be written. */
function connectLoka(inst, { spaceId, spaceName, layerId }, by, tags) {
  const { file, local } = readOverlay(inst);
  const next = local || {};
  // manifest.local.json reaches every visitor: only what is fine to show goes in it (no email of who connected)
  next.lokaSync = { spaceId, spaceName: String(spaceName || '').slice(0, 80) || 'LOKA space', layerId: layerId || '',
    connectedAt: new Date().toISOString(), lastUpdate: null };
  if (!writeOverlay(file, next)) return false;
  if (inst.lokaNote) reg.updateInstance(inst.slug, { lokaNote: undefined });   // connected after all
  console.log('[loka-sync] ' + inst.slug + ' connected to a LOKA space by ' + by);
  startLokaUpdate(inst.slug, tags);
  return true;
}

/* A space chosen in the wizard (POST /instances, kept as inst.wantLoka) is
   connected as soon as the atlas is first built, and its first update
   started. The atlas stands whether or not that works: a failed update is the
   plain sentence on the Settings line beside Update now; a space that could
   not be connected at all leaves its reason there too (inst.lokaNote, shown
   until a connect). The right to the space is checked again now, against the
   link as it is: unlinked meanwhile means not connected. Only the first
   build, never a rebuild; never on deoria-bioregion. */
function applyWantedLoka(slug, firstBuild) {
  const inst = reg.getInstance(slug);
  if (!inst || !inst.wantLoka || inst.status === 'building' || inst.status === 'pending-approval') return;
  const want = inst.wantLoka;
  reg.updateInstance(slug, { wantLoka: undefined });
  if (!firstBuild || lokaStateOf(inst) || LOKA_RUNNING.has(slug)) return;
  const note = (why) => { reg.updateInstance(slug, { lokaNote: why }); };
  if (searchText.isNeverTouched(slug)) return note('This atlas can’t be connected to LOKA.');
  if (!want.sup) {
    const link = want.by ? reg.lokaLinkOf(want.by) : null;
    if (!link) return note('The LOKA space chosen while building wasn’t connected: your LOKA account is no longer linked. Link it here, then connect the space.');
    if (!lokaSync.mayConnect(link, want.spaceId, null)) return note('The LOKA space chosen while building wasn’t connected: your LOKA account no longer lists it. Ask for access here.');
  }
  // LOKA not set up on the server any more: the link is made and the first update says so, beside Update now
  if (!connectLoka(inst, { spaceId: want.spaceId, spaceName: want.spaceName, layerId: '' }, 'its builder')) {
    note('The LOKA space chosen while building could not be linked. Connect it here.');
  }
}

router.delete('/instances/:slug/loka-sync', (req, res) => {
  const inst = lokaGate(req, res);
  if (!inst) return;
  if (callerRole(req, inst) !== 'owner' && !lokaSuper(req)) return res.status(403).json({ error: 'not allowed' });
  if (LOKA_RUNNING.has(inst.slug)) return res.status(409).json({ error: 'Places are being brought in from LOKA. Try again in a moment.' });
  const { file, local } = readOverlay(inst);
  if (local && local.lokaSync) { delete local.lokaSync; writeOverlay(file, local); }
  res.json({ ok: true });
});

router.post('/instances/:slug/loka-sync/update', (req, res) => {
  const inst = lokaGate(req, res, { write: true });
  if (!inst) return;
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  if (!lokaStateOf(inst)) return res.status(400).json({ error: 'This atlas is not connected to LOKA.' });
  if (lokaBusy(inst, res)) return;
  if (!lokaSync.isSetUp()) return res.status(503).json({ error: 'LOKA hasn’t been set up on this server yet.' });
  startLokaUpdate(inst.slug);
  res.json({ started: true });
});

/* An owner who may not connect a space asks the operator for it: one open
   request per atlas, space and person, answered on the operator's page. */
router.post('/instances/:slug/loka-sync/request', (req, res) => {
  const inst = lokaGate(req, res, { write: true });
  if (!inst) return;
  const who = lokaOwnerSession(req, inst);
  if (!who) return res.status(403).json({ error: 'not allowed' });
  if (lokaSuper(req)) return res.status(400).json({ error: 'You can connect any space yourself.' });
  if (!reg.lokaLinkOf(who.email)) return res.status(403).json({ error: LOKA_LINK_FIRST });
  const b = req.body || {};
  const spaceId = lokaSync.spaceIdFrom(b.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'That doesn’t look like a LOKA space id.' });
  // ten asks an hour, and twenty waiting at once: enough for anyone, not enough to flood the operator
  if (reg.lokaRequests({ by: who.email, state: 'pending' }).length >= 20) return res.status(429).json({ error: 'You already have 20 requests waiting. Wait for those to be answered first.' });
  if (lokaOverRate(lokaAskRate, who.email, 10)) return res.status(429).json({ error: 'That’s enough requests for now. Try again in an hour.' });
  const { request: r, created } = reg.askLokaAccess({ slug: inst.slug, spaceId, spaceName: String(b.spaceName || '').trim(), by: who.email });
  // one line to the operator for a new request, none for asking again; the request stands whether or not the mail goes
  if (created) sendMail({ to: ADMIN_EMAIL, subject: 'LOKA Atlas: a request to connect a LOKA space',
    text: who.email + ' asks to connect the atlas “' + (inst.title || inst.slug) + '” to the LOKA space ' + spaceId +
      (r.spaceName ? ' (' + r.spaceName + ')' : '') + '.\n\nApprove or decline it on the operator’s page: https://loka.place/apps/atlas/admin/\n' }).catch(() => {});
  res.json({ ok: true, state: r.state });
});

/* ---------- a person's own LOKA account ----------

   Linked by an emailed code: LOKA sends it (send-code), the person types it
   (confirm), and the server swaps it for who LOKA says they are — a token
   that lives only inside that one call and is never kept, logged or sent on.
   The bodies of these routes are never logged. Five codes and ten tries an
   hour, counted for the account asking and again for the email aimed at (so
   neither one account nor one address can be worked on from many sides);
   LOKA keeps its own limits too. Whether LOKA knows an email is never said. */
router.post('/auth/loka/send-code', async (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const email = reg.normEmail((req.body && req.body.email) || session.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  if (lokaOverRate(lokaCodeRate, 'account:' + session.email, 5) || lokaOverRate(lokaCodeRate, 'email:' + email, 5)) {
    return res.status(429).json({ error: 'That’s enough codes for now. Try again in an hour.' });
  }
  let said;
  try { said = await lokaSync.sendCode(email); }
  catch (e) { return res.status(502).json({ error: e instanceof lokaSync.LokaError ? e.message : 'LOKA couldn’t be reached. Try again in a moment.' }); }
  res.json({ ok: true, email, said });
});
router.post('/auth/loka/confirm', async (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const email = reg.normEmail((req.body && req.body.email) || session.email);
  const code = String((req.body && req.body.code) || '').trim();
  if (!reg.validEmail(email) || !/^\d{4,8}$/.test(code)) return res.status(400).json({ error: 'the email and the code from it are both needed' });
  if (lokaOverRate(lokaTryRate, 'account:' + session.email, 10) || lokaOverRate(lokaTryRate, 'email:' + email, 10)) {
    return res.status(429).json({ error: 'Too many tries. Send a new code in an hour.' });
  }
  let link;
  // who the person is comes from LOKA's answer alone; nothing in this body names them
  try { link = await lokaSync.linkByCode(email, code); }
  catch (e) { return res.status(e instanceof lokaSync.LokaError ? 400 : 502).json({ error: e instanceof lokaSync.LokaError ? e.message : 'LOKA couldn’t be reached. Try again in a moment.' }); }
  reg.setLokaLink(session.email, link);
  console.log('[loka-sync] an account linked its LOKA sign-in (' + link.memberSpaces.length + ' spaces)');
  res.json({ ok: true, lokaEmail: link.lokaEmail, spaces: lokaSpaceCount(link) });
});
router.delete('/auth/loka', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  reg.clearLokaLink(session.email);
  res.json({ ok: true });
});
/* What the build wizard shows under "Bring places from a LOKA space": whether
   the account is linked, and if so the spaces LOKA listed for it when it was
   (as old as the link; a new code brings the list up to date). */
router.get('/auth/loka', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const link = reg.lokaLinkOf(session.email);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ email: session.email, setUp: lokaSync.isSetUp(),
    link: link ? { lokaEmail: link.lokaEmail, linkedAt: link.linkedAt, spacesAt: link.spacesAt || link.linkedAt, spaces: (link.spaces || []).map(lokaSync.spaceCard) } : null });
});
/* Where a space's places are, for the wizard's Where step (Mithun, 4 Nov 2026:
   the area comes from the places, not the world): the space is downloaded
   with the server's own sign-in and its positions put to the same
   region-finding a dropped file's coordinates go through (inferRegion) —
   districts that hold nearly all of them, else the state, else the country;
   the world only when they span countries or have no position. Only a space
   on the person's own list (the operator: any). A space LOKA will not share
   with the server is the plain sentence, and the wizard asks "where" as usual. */
const lokaRegionRate = new Map();
router.post('/auth/loka/region', async (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const spaceId = lokaSync.spaceIdFrom(req.body && req.body.spaceId);
  if (!spaceId) return res.status(400).json({ error: 'That doesn’t look like a LOKA space.' });
  const link = reg.lokaLinkOf(session.email);
  const known = link ? (link.spaces || []).find((s) => s.id === spaceId) || null : null;
  if (!known && !lokaSuper(req)) return res.status(403).json({ error: LOKA_NOT_LISTED });
  if (!lokaSync.isSetUp()) return res.status(503).json({ error: 'LOKA hasn’t been set up on this server yet.' });
  // a whole space each time: twenty an hour is plenty of picking
  if (lokaOverRate(lokaRegionRate, session.email, 20)) return res.status(429).json({ error: 'That’s enough for now. Try again in an hour.' });
  let tags;
  try { tags = (await lokaSync.downloadSpace(spaceId)).tags; }
  catch (e) { return res.status(502).json({ error: e instanceof lokaSync.LokaError ? e.message : 'LOKA couldn’t be reached. Try again in a moment.' }); }
  const points = lokaSync.toRows(tags, '').rows.map((r) => [r.longitude, r.latitude]);
  const head = { spaceName: (known && known.name) || '', places: points.length };
  const world = () => res.json(Object.assign(head, { worldwide: true, units: [], level: null, rows: points.length, matchedRows: 0 }));
  if (!points.length) return world();
  try {
    // the country chosen on the wizard, when the places are in it; else told from the positions
    const hint = String((req.body && req.body.iso3) || '').toUpperCase();
    const iso3 = /^[A-Z]{3}$/.test(hint) && (await shareInsideCountry(hint, points)) >= 0.5 ? hint : '';
    const r = await inferRegion({ iso3, points, columns: [] });
    if (r.status !== 200) return world();   // no country could be told from the positions
    res.json(Object.assign(head, r.body));
  } catch (e) {
    console.warn('[loka-sync] the region of a space — ' + (e && e.message));
    res.status(502).json({ error: 'Where the space’s places are couldn’t be worked out just now. Search for the place instead.' });
  }
});

/* The operator's list of requests to connect a space, and the answer to one. */
function lokaRequestRow(r) {
  const inst = reg.getInstance(r.slug);
  return { id: r.id, slug: r.slug, title: (inst && inst.title) || r.slug, spaceId: r.spaceId, spaceName: r.spaceName, by: r.by, at: r.at, state: r.state, decidedAt: r.decidedAt };
}
router.get('/admin/loka-requests', (req, res) => {
  if (!auth.isAdmin(req) && !auth.isAdminSession(req)) {
    const signedIn = !!auth.sessionFromReq(req);
    return res.status(signedIn ? 403 : 401).json({ error: 'operator only', needsAuth: !signedIn });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ requests: reg.lokaRequests().filter((r) => reg.getInstance(r.slug)).sort((a, b) => (a.at < b.at ? 1 : -1)).map(lokaRequestRow) });
});
router.post('/admin/loka-requests/:id', async (req, res) => {
  if (!auth.isAdmin(req) && !auth.isAdminSession(req)) return res.status(404).json({ error: 'not found' });
  const state = String((req.body && req.body.state) || '');
  const r = reg.decideLokaAccess(String(req.params.id), state);
  if (!r) return res.status(400).json({ error: 'No such request, or the answer must be approved or declined.' });
  /* A private space is one the server's own sign-in cannot download until
     someone adds that account to the space in LOKA, as a Viewer. Said here,
     plainly, and never done by the server itself. */
  let note = '';
  if (state === 'approved' && lokaSync.isSetUp()) {
    try { if (!(await lokaSync.spaceInfo(r.spaceId))) note = 'This space is private, or LOKA doesn’t show it to this server. For the update to work, add the sync account to the space in LOKA as a Viewer.'; }
    catch { note = 'LOKA couldn’t be reached to check the space. If it is private, add the sync account to it in LOKA as a Viewer.'; }
  }
  res.json({ ok: true, request: lokaRequestRow(r), note });
});

/* The operator's way to start a reading by hand. The reading otherwise begins
   on its own when a layer is added (considerReading), once per version of its
   places; this is for one that needs reading again regardless — one that
   failed, or one that needs a fresh set (afresh). */
router.post('/admin/reread', async (req, res) => {
  if (!auth.isAdmin(req) && !auth.isAdminSession(req)) {
    return res.status(404).json({ error: 'not found' });
  }
  const b = req.body || {};
  const dataset = String(b.dataset || ''), layerId = String(b.layerId || '');
  try {
    const out = await runReading(dataset, layerId, b.afresh === true);
    /* What became of each column goes on the record here too, as the list's
       own readings put it there — otherwise the owner's page went on showing
       the lines from before the operator's re-read. Left alone while the list
       is reading this layer: that reading owns the record. */
    if ((out.columns || []).length && !QUESTIONS.isBusy(dataset, layerId)) {
      QUESTIONS.remember(dataset, layerId, { columns: out.columns });
    }
    if (cannotReach(out.verdict)) {
      const inst = reg.getInstance(dataset);
      owed.owe({ dataset, layerId, email: (inst && inst.email) || '', payer: payerOf(inst),
        kind: troubleKind(out.trouble), trouble: out.trouble || '' });
    } else if (out.wrote) {
      owed.settle(dataset, layerId);
    }
    res.json(out);
  } catch (e) {
    // an operator asked for this by hand; give them the whole fault, not a summary
    if (!e.status) console.error('[atlas] re-read failed:', e && e.stack);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/* Write a finished reading onto a layer, with nobody watching.

   This is what the browser has always done in keepQuestions: put each answer in
   a column beside the place, put the words that justify it in a column beside
   that, and hand the whole layer back to be written. It lives here now so that
   a reading finished an hour late, by the server, lands exactly the same way a
   reading finished in front of somebody does — one path, one result, rather
   than a second implementation quietly drifting from the first. */
async function writeReading({ dataset, layer, layerId, rows, questions, label, source, reading, facts }) {
  /* The shaping is the shared rule's — one column per question, its words
     beside it, every previous answer cleared first. What is left here is the
     saving, which is the one thing this side and the browser genuinely do
     differently: it calls ingest directly where the browser posts to it. */
  const shaped = RULES.shapeReading(rows, questions);
  const out = shaped.rows, labels = shaped.keyLabels, kinds = shaped.keyKinds, froms = shaped.keyColumns,
    nouns = shaped.keyNouns;
  // an area's shapes travel with its rows (shapesFor); a pin's coordinates already do
  const shapes = shapesFor(layer, dataset);
  const ing = await ingestLayer({
    dataset, replaceLayerId: layerId, filename: label || layerId,
    schema: shaped.schema,
    rows: out,
    geoms: shapes.geoms, geomIdx: shapes.geomIdx,
    keyLabels: labels, keyKinds: kinds, keyColumns: froms, keyNouns: nouns,
    reading: reading || undefined,
    facts: (facts || []).length ? facts : undefined,
    meta: { sourceName: source, rowCount: out.length, geometry: shapes.geometry },
  }, 'server');
  if (!ing || !ing.importId) throw refuse(500, 'the layer could not be prepared');
  // a reading's own write: it adds answers, it does not ask for another reading
  return commitLayer({ importId: ing.importId, dataset }, 'server', { fromReading: true });
}

/* ONE FILE, READ AS ONE FILE.

   A file whose rows mostly named outlines, with a few that only had a point,
   goes on as two layers — the outlines, and "<name> · as points" — each naming
   the other (sameFileAs). The two halves hold DIFFERENT rows: a row becomes a
   point only when no outline placed it (matching.js splitPointRows), so "6 as
   areas · 5 as points" is eleven rows, six in one file and five in the other.

   Until October 2026 the pair was read through its pins alone (reading-rules
   readByItsTwin keeps the outlines off the list, so the owner is not charged
   twice), and the comment beside that rule said both halves held the same
   rows. They do not — so the six outline rows were never read at all, their
   places wore no mark under any question, and nothing could be copied across
   to them because there was nothing to copy. In the Map Browser the two
   layers are one row with one set of keys (atlas.js, KEYS OVER BOTH HALVES),
   and a key that answers for five of eleven places is not a key.

   So a reading now gathers both halves' rows, the layer it was started from
   first, reads them as one set — one list of questions, one reach — and
   writes each half back its own share of the answers, with the same question
   names on both. Either half can start it: the list reaches the pins, the
   owner's own door the outlines. A layer with no twin is one half.

   And one file has one version: the fingerprint on the list, beside the kept
   answers and in the retry is the two halves' rows together (fileSigOf), so
   a change to the outlines alone — which used to go unread for ever, the
   outlines being only noted and never offered — is a change to the file,
   and the file is offered through its pins again (considerReading). */
function fileHalves(m, layer) {
  if (!m || !layer || !layer.source) return null;
  const partner = layer.sameFileAs
    ? imports.mergedLayers(m).find((l) => l.id === layer.sameFileAs && l.source) : null;
  const out = [];
  for (const L of partner ? [layer, partner] : [layer]) {
    let rows = null;
    try {
      const gj = JSON.parse(fs.readFileSync(path.join(m.dir, L.source), 'utf8'));
      rows = ((gj && gj.features) || []).map((f) => f.properties || {});
    } catch { /* missing or unreadable: the layer itself is refused below, a twin is left out */ }
    if (rows) out.push({ layer: L, rows });
    else if (L === layer) return null;
  }
  return out;
}
const rowsOf = (halves) => halves.flatMap((h) => h.rows);

/* The answers for the whole file, written to each half: a question's answers
   and words are one list over the halves' rows in order, so each half takes
   its own slice. Every half keeps the same wording, kinds and reading note. */
async function writeReadingToHalves({ dataset, halves, questions, reading, facts }) {
  let at = 0, last = null;
  for (const h of halves) {
    const n = h.rows.length;
    const mine = (questions || []).map((q) => Object.assign({}, q, {
      categories: (q.categories || []).slice(at, at + n),
      why: (q.why || []).slice(at, at + n),
    }));
    last = await writeReading({
      dataset, layer: h.layer, layerId: h.layer.id, rows: h.rows, questions: mine,
      label: h.layer.label || h.layer.id, source: h.layer.source, reading, facts,
    });
    at += n;
  }
  return last;
}

router.post('/layers/ingest', async (req, res) => {
  try {
    res.json(await ingestLayer(req.body || {}, req));
  } catch (e) {
    const extra = {};
    for (const k of ['importId', 'columns', 'strategy', 'needsAuth']) if (e[k] !== undefined) extra[k] = e[k];
    res.status(e.status || 400).json(Object.assign({ error: e.message }, extra));
  }
});

/* ================= finding a place by its address =================

   An atlas can place a row two ways: the row carries coordinates, or its name
   is a boundary the atlas holds. Neither reaches a neighbourhood or a reserve.
   "Jeevan Bhima Nagar, Bengaluru" is a real place and no administrative unit at
   any level — India's finest level here is 7,143 units for some six hundred
   thousand villages, and Bengaluru's whole urban area is four of them.

   So, a third way: ask a geocoder. This one has been sitting complete and
   uncalled in the repository since August; what follows is the caller, and it
   is deliberately narrow, because a geocoder answers confidently when it is
   wrong. Asked for "BRT Tiger Reserve, Chamarajanagar district, Karnataka" it
   returned a banknote printing press eighty kilometres away and graded the
   answer "approximate" — the same grade it gave the answer that was right.

   A grade cannot separate those. A person can. So nothing here places
   anything: it looks addresses up, says what it found in the provider's own
   words, and stops. Writing the coordinates onto the rows is a second request,
   naming the rows somebody has actually looked at. */

// Fresh lookups per request. The providers are asked one a second — their
// terms, not a tunable — so this is about twenty seconds of waiting, and the
// page asks again for the next twenty. Cached rows cost nothing and are not
// counted.
const LOCATE_BATCH = 20;
// A shared public service is not a bulk pipeline. Five hundred rows is already
// eight minutes of somebody else's machine.
const LOCATE_MAX_ROWS = 500;

// [west, south, east, north] — the shape resolveBias wants, from whichever of
// the two kinds of import session this is.
function locateBias(session) {
  const r = session.region || {};
  // an atlas of the whole world has no patch to prefer: the lookup is asked plainly
  if (r.worldwide) return {};
  if (r.iso3 || r.bbox) return { country: r.iso3 || undefined, bbox: r.bbox || undefined };
  if (!session.dataset) return {};
  /* readManifest answers { manifest, local, dir } — not the manifest. Reading
     m.bounds off the wrapper gave undefined every time, so every lookup on an
     existing atlas ran with NO bias at all. That is what asked the world for
     "Eastern and Western Ghats" and was told Hong Kong: boxed to India the
     same query is honestly not found. */
  let m; try { m = imports.readManifest(session.dataset); } catch { return {}; }
  const mf = (m && m.manifest) || null;
  if (mf && mf.region && mf.region.worldwide) return {};
  const bounds = mf && mf.bounds;
  const flat = Array.isArray(bounds) && bounds.length === 2 && Array.isArray(bounds[0])
    ? [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]] : null;
  return { country: (mf && mf.region && mf.region.iso3) || undefined, bbox: flat || undefined };
}

function locateGate(req, res, session) {
  if (session.dataset) return requireDatasetEditor(req, res, session.dataset);
  if (!auth.sessionFromReq(req) && !auth.isAdmin(req)) {
    res.status(401).json({ error: 'sign in to set up your data', needsAuth: true });
    return false;
  }
  return true;
}

/* Does what came back call itself what was asked for?

   This decides which rows arrive already ticked, and it exists because the
   provider's own grade will not do it. "Exact" is a statement about PRECISION,
   not about correctness: asked for "Pan India" the provider returned "24th Main
   Pan Indian Bistro, 12th Cross Road, JP Nagar" and graded it exact, because it
   knows that bistro's doorway to the metre. Pre-ticking on the grade would have
   put a restaurant on the map as a respondent's whole working region.

   So the test is the plainer one: the thing it found is named after the thing
   you asked for. Compare the first part of each — what somebody writes before
   the first comma is the place; what follows is the address around it. */
function locateAgrees(query, label) {
  const head = (v) => norm(String(v || '').split(',')[0]);
  const q = head(query), l = head(label);
  if (q.length < 4 || !l) return false;
  return l.startsWith(q) || q.startsWith(l);
}

// Every row looked at so far, in the shape the page renders.
function locateSoFar(session) {
  const held = (session.located && session.located.byRow) || {};
  const out = Object.keys(held).map((k) => ({ row: Number(k), ...held[k] }));
  out.sort((a, b) => a.row - b.row);
  for (const r of out) r.agrees = r.lat != null && locateAgrees(r.query, r.label);
  /* Different addresses landing on the SAME point is the give-away that the
     provider answered "somewhere in <area>" for all of them. One result can be
     graded wrongly; the pile-up cannot hide. */
  markCollisions(out);
  return out;
}

router.post('/layers/locate', async (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (!locateGate(req, res, session)) return;

  const col = String(b.column || '');
  if (!col || !(session.columnsRaw || []).includes(col)) {
    return res.status(400).json({ error: 'which column holds the address?' });
  }
  const rows = session.rows || [];
  if (rows.length > LOCATE_MAX_ROWS) {
    return res.status(400).json({ error: 'looking up ' + rows.length + ' addresses one at a time would take ' +
      Math.round(rows.length / 60) + ' minutes or more — the limit is ' + LOCATE_MAX_ROWS + ' rows. ' +
      'Split the file, or give it latitude and longitude columns.' });
  }
  /* Columns that say where the place is — a district, a state — added to
     each lookup after the name, the way an address is written. A village name
     alone is one of many Rampurs; "Rampur, Deoria" is one. */
  const context = (Array.isArray(b.context) ? b.context : [])
    .map(String).filter((c) => c !== col && (session.columnsRaw || []).includes(c)).slice(0, 2);
  const asked = [col].concat(context).join('|');
  // a different column means a different question: start the answers again
  if (!session.located || (session.located.asked || session.located.column) !== asked) {
    session.located = { column: col, asked, byRow: {} };
  }
  const held = session.located.byRow;

  /* Bias the lookup to the atlas's own patch of the world. An import made
     before the atlas exists carries its region; one added to a built atlas
     takes the atlas's own bounds.

     Measured, so as not to claim more for it than it does: a tight box helps
     and a loose one does not. "BRT Tiger Reserve, Chamarajanagar district,
     Karnataka" returned the same wrong printing press with no bias and with a
     Karnataka-sized box; boxed to Chamarajanagar it returned nothing, which is
     at least honest. The bias is worth having and it is not the safeguard —
     the safeguard is that a person reads the answers. */
  const opts = locateBias(session);
  /* Only some rows, when asked: the setup page looks up just the rows no
     outline holds — the blocks already have their place, and asking the map
     for them would cost time and could only offer a second place for a row
     that has one. */
  const only = Array.isArray(b.rows)
    ? new Set(b.rows.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < rows.length)) : null;
  const want = (i) => !only || only.has(i);
  let fresh = 0, looked = 0;
  try {
    for (let i = 0; i < rows.length && fresh < LOCATE_BATCH; i++) {
      if (held[i] || !want(i)) continue;
      const cell = (c) => String(rows[i][c] == null ? '' : rows[i][c]).trim();
      const name = cell(col);
      if (!name) { held[i] = { query: '', lat: null, lng: null, reason: 'empty' }; continue; }
      const query = [name].concat(context.map(cell).filter((v) => v && norm(v) !== norm(name))).join(', ');
      const r = await geocodeOne(query, opts);
      if (!r.cached) fresh++;
      looked++;
      held[i] = { query: query, lat: r.lat, lng: r.lng, label: r.label || '',
                  confidence: r.confidence, provider: r.provider, reason: r.reason };
    }
  } catch (e) {
    console.warn('[atlas] layers/locate failed:', e.message);
    return res.status(502).json({ error: 'the address lookup could not be reached: ' + e.message });
  }
  // A session lives on disk and is re-read on every request, so what was found
  // has to be written down before the next one asks for the rest of it.
  imports.saveImport(session);
  const total = only ? only.size : rows.length;
  const done = only ? [...only].filter((i) => held[i]).length : Object.keys(held).length;
  res.json({ column: col, total, done, more: Math.max(0, total - done),
             looked, results: locateSoFar(session).filter((r) => want(r.row)) });
});

/* The second request: these rows, the ones somebody looked at and kept.

   The coordinates are written onto the rows as two ordinary columns and the
   layer becomes a coordinates layer — so everything after this point is the
   path a file with latitude and longitude has always taken, and none of it had
   to learn about geocoding. */
router.post('/layers/locate/keep', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (!locateGate(req, res, session)) return;
  const held = (session.located && session.located.byRow) || null;
  if (!held) return res.status(400).json({ error: 'nothing has been looked up yet' });

  const wanted = new Set((Array.isArray(b.rows) ? b.rows : []).map(Number).filter(Number.isFinite));
  const rows = session.rows || [];

  /* Beside the outlines (the setup page, from October 2026): the ticked rows
     are noted as points and the layer stays a join to outlines, so every row
     an outline holds keeps it. placeAll makes the second layer from these. */
  if (b.alongside) {
    if (session.strategy !== 'adminJoin') {
      return res.status(400).json({ error: 'these rows are not placed by name, so there are no outlines to keep' });
    }
    session.pointRows = {};
    for (const i of wanted) {
      const p = held[i];
      if (!Number.isInteger(i) || i < 0 || i >= rows.length || !p || p.lat == null) continue;
      session.pointRows[i] = { lat: p.lat, lng: p.lng, label: p.label || '' };
    }
    imports.saveImport(session);
    try {
      const parts = placeAll(session);
      return res.json({
        placed: parts.points ? parts.points.features.length : 0,
        outlines: parts.outline.features.length, of: rows.length,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  const free = (base) => {
    let n = base, k = 2;
    while ((session.columnsRaw || []).includes(n)) n = base + ' ' + (k++);
    return n;
  };
  if (!session.locatedCols) {
    session.locatedCols = [free('latitude'), free('longitude')];
    session.columnsRaw = (session.columnsRaw || []).concat(session.locatedCols);
  }
  const [latName, lngName] = session.locatedCols;

  // pressing Use these twice must not leave last time's answers behind
  let placed = 0;
  rows.forEach((r, i) => {
    delete r[latName]; delete r[lngName];
    const p = held[i];
    if (!wanted.has(i) || !p || p.lat == null) return;
    r[latName] = p.lat; r[lngName] = p.lng;
    placed++;
  });
  session.columns = (session.columns || [])
    .filter((c) => c.name !== latName && c.name !== lngName)
    .concat([{ name: latName, role: 'latitude' }, { name: lngName, role: 'longitude' }]);
  session.strategy = 'coordinates';
  imports.saveImport(session);
  res.json({ latColumn: latName, lngColumn: lngName, placed, of: rows.length });
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
  if (b.joinLayer) { session.joinLayer = String(b.joinLayer); session.joinLayerExplicit = true; }
  if (Array.isArray(b.columns)) {
    const placeWas = rolesMap(session.columns || []).placeName;
    session.columns = b.columns
      .filter((c) => c && session.columnsRaw.includes(c.name))
      .map((c) => ({ name: c.name, role: String(c.role) }));
    // a different place column is a different question: let its lead be found
    // afresh, unless a row has already been fixed against the old one
    if (rolesMap(session.columns).placeName !== placeWas &&
        !Object.keys(session.matchState || {}).length) delete session.leadLayer;
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
    else continue;
    // the owner has looked at this row: it is no longer the model's suggestion
    if (session.suggested) delete session.suggested[f.row];
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
// 4: nor the model's notes on answers about who made it; 3 and earlier still hold names
const SEARCH_INDEX_V = 4;
// the same for the meaning vectors: versions 1 and 2 were built from text with names in it
const ROW_VEC_V = 3;
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
/* A floor alone let nearly every row through: on the multispecies atlas,
   "tiger conservation" scored all eleven people between 0.49 and 0.62, so 9
   of 11 "matched" and the search said nothing. Scores from one model on one
   query bunch together, so what separates a real answer is how close it is to
   the BEST one. A paraphrase is kept only within this band of the top score
   (and above the floor). 0.06 keeps the BRT tiger-reserve respondent (0.558)
   under the top (0.615) there — one query, so revisit with real traffic. */
const ROW_BAND = 0.06;
/* And meaning is the fallback, not an addition. When the words typed appear
   in some rows, those rows are the answer: "Telugu" is in one person's
   languages, yet by meaning alone six more scored 0.50–0.55 and joined them.
   Paraphrases are used only when no row has the words, and only if the best
   one is a clear signal rather than the bunched middle of the scale. */
const ROW_STRONG = 0.55;
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

/* A stand-in for the embedding model, for checking the road a search by
   meaning takes on a machine with no key: ATLAS_FAKE_EMBED=1 turns a text into
   a vector of its letter-triples, so two spellings of one word land close and
   two unrelated words do not. It knows nothing of meaning. What it lets the
   checks prove is that a public atlas and a private one take the SAME road —
   rows embedded, a query embedded, rows scored — with nothing to tell them
   apart but where the files sit. Its vectors are labelled as the stand-in's,
   so a server with a real model never trusts a side-file one of these wrote. */
// the same three locks as FAKE_READING: a dev server, no model key, not production
const FAKE_EMBED = process.env.ATLAS_FAKE_EMBED === '1' &&
  !!process.env.LOKA_DEV_STATIC && !process.env.GEMINI_API_KEY &&
  process.env.NODE_ENV !== 'production';
if (FAKE_EMBED) console.warn('[atlas] ATLAS_FAKE_EMBED is on — search by meaning uses letter-triples, not a model');
function fakeEmbed(text) {
  const v = new Array(EMBED_DIM).fill(0);
  const s = ' ' + String(text || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ') + ' ';
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 0;
    for (let j = i; j < i + 3; j++) h = (h * 31 + s.charCodeAt(j)) >>> 0;
    v[h % EMBED_DIM] += 1;
  }
  return v;
}
// which model answers for meaning: the real one, the stand-in, or nobody
const embedModelName = () => (FAKE_EMBED ? 'stand-in' : getEmbedModel());
const embedReady = () => !!ai || FAKE_EMBED;

async function embedTexts(texts) {
  if (!texts.length) return null;
  if (FAKE_EMBED) return texts.map(fakeEmbed);
  if (!ai) return null;
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
/* What counts as searchable text, and the vocabulary built from it, lives in
   api/lib/atlas/search-text.js so the server and the rebuild script read a
   place the same way. Answers to a question about people are left out there. */
const { searchSkipProp, searchCellText, searchSkipValue, featureSearchText, SEARCH_STOP, termsFromValue, peopleTerms } = searchText;
const layerVocabTerms = (stanza, features) => searchText.layerVocabTerms(stanza, features, SEARCH_MAX_TERMS);

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
  // the naming columns are part of the key: a rename rewrites only the
  // manifest, not the file, and search must show the new names at once
  const key = dir + '|' + stanza.source + '|' + sig + '|' +
    ((stanza.popup && stanza.popup.title) || '') + '|' + ((stanza.popup && stanza.popup.titleAlso) || '') +
    '|' + JSON.stringify(stanza.keyColumns || {});   // which questions are about people decides what is left out
  const hit = layerTextCache.get(key);
  if (hit) return hit;
  let gj = null;
  try { gj = JSON.parse(fs.readFileSync(path.join(dir, String(stanza.source)), 'utf8')); } catch { return []; }
  const titleProp = (stanza.popup && stanza.popup.title) || '';
  const alsoProp = (stanza.popup && stanza.popup.titleAlso) || '';
  const rows = ((gj && gj.features) || []).map((f, i) => {
    const p = (f && f.properties) || {};
    const text = featureSearchText(p, stanza);
    // the stanza's title property can be missing from the data (older layers) —
    // fall back to the head of the searchable text so a hit is still legible.
    // A second naming column is joined the way the card joins it.
    const named = [searchCellText(p[titleProp]).trim(), alsoProp ? searchCellText(p[alsoProp]).trim() : '']
      .filter(Boolean).join(' · ');
    const title = (named || text).slice(0, 120);
    return { i, title, text };
  });
  if (layerTextCache.size >= 8) layerTextCache.delete(layerTextCache.keys().next().value);
  layerTextCache.set(key, rows);
  return rows;
}

// The words that came from people columns of a layer, read once per version of its file.
const peopleTermCache = new Map();
function layerPeopleTerms(dir, stanza, sig) {
  const key = dir + '|' + stanza.source + '|' + sig + '|' + JSON.stringify(stanza.keyColumns || {});
  const hit = peopleTermCache.get(key);
  if (hit) return hit;
  let set = new Set();
  try {
    const gj = JSON.parse(fs.readFileSync(path.join(dir, String(stanza.source)), 'utf8'));
    set = peopleTerms(stanza, (gj && gj.features) || []);
  } catch { /* unreadable file: nothing to hide, and nothing to search either */ }
  if (peopleTermCache.size >= 8) peopleTermCache.delete(peopleTermCache.keys().next().value);
  peopleTermCache.set(key, set);
  return set;
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
  if (!file || searchText.isNeverTouched(dir)) return;   // last line of defence: never deoria's folder
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
  const header = Buffer.from(JSON.stringify({ v: ROW_VEC_V, sig, model: embedModelName(), dim: EMBED_DIM, count }) + '\n');
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
  if (!h || !searchText.vecVersionOk(h.v, ROW_VEC_V, dir) || h.sig !== sig || h.model !== embedModelName() || h.dim !== EMBED_DIM) return null;
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
  if (!embedReady()) return false;
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
    // an entry written before people were left out (v 2) is rebuilt even though the file has not changed
    if (cur && searchText.indexVersionOk(cur.v, SEARCH_INDEX_V, dataset) && cur.terms && cur.terms.length && cur.sig === sig) continue;
    let features = null;
    try { features = JSON.parse(fs.readFileSync(path.join(m.dir, String(L.source)), 'utf8')).features || []; } catch { continue; }
    if (!features.length) continue;
    const terms = layerVocabTerms(L, features);
    if (!terms.length) continue;
    // Terms are written bare: their vectors moved to the row side-file, so a
    // rebuild is also the moment an old vector-carrying entry slims down.
    const entry = { v: SEARCH_INDEX_V, sig, terms: terms.map((t) => ({ t })) };
    out.idx[L.id] = entry;
    out.built.push(L.id);
    // the deoria-bioregion atlas is never written to, not even by a visitor's search:
    // its words are held in memory for this answer only
    if (searchText.isNeverTouched(dataset)) continue;
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
  if (!embedReady() || !layerIds.length || embedInFlight.has(dataset) || searchText.isNeverTouched(dataset)) return;
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

/* The meaning index, asked for from outside. A layer's vectors are normally
   built the first time somebody searches it (queueRowEmbeddings above), which
   is the same for a public atlas and a private one. What that cannot do is
   build them BEFORE anyone searches — for the atlases that were already live
   when search by meaning arrived, or after the embedding model changes and
   every side-file goes stale at once. This list is how an operator asks for
   that: deploy/queue-meaning-index.mjs puts layers on it, and the server works
   through them one at a time, picked up within a minute. It is the same
   waiting list the questions and the short names use, with the same rules —
   once per version of a layer's file, never deoria-bioregion, survives a
   restart — and the work it does is the one function the search already
   uses, so there is one way to build a layer's vectors and not two. */
export const MEANING_INDEX_FILE = path.join(reg.DATA_DIR, 'meaning-index.json');
const meaningQueue = createQueue({ file: MEANING_INDEX_FILE });
async function meaningIndexJob(job) {
  if (searchText.isNeverTouched(job.dataset)) return { state: 'failed', reason: 'never touched (standing rule)' };
  if (!embedReady()) return { state: 'failed', reason: 'there is no embedding model configured' };
  const m = imports.readManifest(job.dataset);
  if (!m) return { state: 'failed', reason: 'no such atlas' };
  const L = searchLayers(m).find((l) => l.id === job.layerId);
  if (!L) return { state: 'failed', reason: 'no such layer, or not one the search covers' };
  const sig = layerSig(m.dir, L);
  if (readRowVectors(m.dir, L.id, sig)) return { state: 'done', reason: 'already built' };
  const rows = layerSearchRows(m.dir, L, sig);
  if (!rows.length) return { state: 'done', reason: 'nothing to index' };
  const ok = await embedRowsForLayer(m.dir, L.id, sig, rows.map((r) => r.text));
  return ok ? { state: 'done', reason: '' } : { state: 'failed', reason: 'the embedding model did not answer' };
}

// After a commit: store the layer's vocabulary immediately (lexical, always)
// and embed its rows if the model answers. No embeddings → search still works.
// (Named for the vocabulary it has always written; row vectors ride along now.)
async function embedAndStoreVocab(dataset, layerId, stanza, features) {
  const dir = imports.datasetDir(dataset);
  const sig = dir ? layerSig(dir, stanza) : '';
  const terms = layerVocabTerms(stanza, features);
  if (terms.length) imports.writeSearchIndex(dataset, layerId, { v: SEARCH_INDEX_V, sig, terms: terms.map((t) => ({ t })) });
  if (!dir || !embedReady()) return;
  await embedRowsForLayer(dir, layerId, sig, features.map((f) => featureSearchText((f && f.properties) || {}, stanza)));
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
  // A draft (<slug>--draft-<import>) has no record of its own and is read
  // under its PARENT's permission, exactly as the file route reads it.
  const searchInst = reg.getInstance(dataset.split('--draft-')[0]);
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
    // an index written before people were left out may still hold names, so
    // anything that came from a people column is dropped here as well
    const ofPeople = layerPeopleTerms(built.dir, L, layerSig(built.dir, L));
    for (const term of searchText.tagTerms(built.idx[L.id], ofPeople)) {
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
  if (Object.keys(rowVecs).length && embedReady() && geminiAllowed(req)) {
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
      const scored = [];
      for (const r of rows) {
        const lex = needles.some((n) => n && r.text.indexOf(n) >= 0);
        // cosine is scale-invariant, so the int8 row is scored as stored
        const score = rv ? cosine(qv, rv.q.subarray(r.i * rv.dim, (r.i + 1) * rv.dim)) : null;
        scored.push({ i: r.i, title: r.title, lex, score });
      }
      const top = Math.max(-1, ...scored.filter((f) => f.score != null).map((f) => f.score));
      const bar = Math.max(ROW_MIN_COSINE, top - ROW_BAND);
      const anyLex = scored.some((f) => f.lex);
      const found = anyLex ? scored.filter((f) => f.lex)
        : (top >= ROW_STRONG ? scored.filter((f) => f.score != null && f.score >= bar) : []);
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

/* Committing a layer used to exist only as the tail of an HTTP handler, so the
   only way to finish a reading was to have a browser open with somebody signed
   in and watching it. A reading retried an hour later has nobody there. The
   work moves out of the route, and the route becomes what it should always
   have been: a way in from the web, not the only way.

   A refusal has to survive the move. Inside a handler it was res.status(403);
   here it is thrown carrying the same number, and whoever called renders it —
   the route as a response, the retry as a line in the log. */
function refuse(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  if (extra) Object.assign(e, extra);
  return e;
}

/* Write a prepared layer onto an atlas. `who` is the caller for the permission
   check: the request, or the literal 'server' for work the server is finishing
   on an owner's behalf — a retry of a reading it already accepted from them. */
function commitLayer({ importId, dataset }, who, opts) {
  const session = imports.getImport(String(importId || ''));
  if (!session) throw refuse(404, 'import expired or unknown');

  // A session set up before the atlas existed is bound to it here — the wizard
  // sends the slug it got back from the build.
  if (!session.dataset && dataset) {
    const slug = String(dataset);
    if (!imports.datasetDir(slug)) throw refuse(404, 'unknown dataset');
    session.dataset = slug;
    imports.saveImport(session);
  }
  if (!session.dataset) throw refuse(400, 'which atlas should this layer go on?');

  // auth: the atlas's signed-in owner, its edit token, or admin (e.g. the deoria dataset)
  const inst = reg.getInstance(session.dataset);
  const ok = who === 'server' || (inst && callerCanEdit(who, inst)) || auth.isAdmin(who);
  if (!ok) throw refuse(403, 'sign in as this atlas’s owner to change it', { needsAuth: true });

  try {
    // the twin a replaced layer had, read before the write takes the name off (pairing, below)
    const twinBefore = session.replacingLayerId && !session.pointRows && !session.pointsLayerId
      ? ((((imports.readManifest(session.dataset) || {}).local || {}).layers || [])
          .find((l) => l.id === session.replacingLayerId) || {}).sameFileAs || null
      : null;
    /* Outlines, and — when rows were chosen to go on as points beside them —
       a second layer of points (placeAll has the rule). */
    const parts = placeAll(session);
    const report = parts.report || {};
    const outFeats = parts.outline.features;
    const ptFeats = parts.points ? parts.points.features : [];
    /* A layer with nothing on it is not added. It used to be: a sheet of
       village names joined to district outlines placed none of its rows, and
       an empty layer went onto the atlas as if it had worked. */
    if (!outFeats.length && !ptFeats.length && (session.rows || []).length) {
      throw refuse(400, 'none of the rows found a place on the map, so nothing was added', { nothingPlaced: true });
    }
    let layerId = null, pointsLayerId = null, stanza = null;
    if (outFeats.length) {
      const c = commitPart(session, parts.outline.frag, outFeats);
      layerId = c.layerId; stanza = c.stanza;
    } else if (session.replacingLayerId && session.pointRows) {
      // every row the outlines held has since been put on as a point
      imports.removeLayer(session.dataset, session.replacingLayerId);
    }
    if (ptFeats.length) {
      const c = commitPart(parts.pointsSession, parts.points.frag, ptFeats);
      pointsLayerId = c.layerId; if (!stanza) stanza = c.stanza;
    } else if (session.pointsLayerId) {
      // and every point has since been given an outline, or left off
      imports.removeLayer(session.dataset, session.pointsLayerId);
    }
    /* A layer put back in place keeps its twin. One upload can be two layers,
       its outlines and the rows that went on as points beside them, each
       naming the other (sameFileAs). A reading writes one of the two back on
       its own, and pairing it with nobody used to take the name off it — so a
       question landing on the outlines quietly split the owner's "one file,
       one row" into two. The twin it had before is the twin it keeps, unless
       this commit is itself re-deciding the split (a repair with pointRows). */
    imports.pairLayers(session.dataset, layerId, pointsLayerId || twinBefore);
    /* Rows that still need a place — skipped, not found, or put by their
       neighbours and not yet checked — stay fixable from the finished atlas.
       The import is kept for them, pointed at the layers it just made so the
       next commit replaces them in place (imports.keepForRepair has the
       rule for letting it go). Nothing left to look at: it goes, as before. */
    const open = toFix(report, session).length;
    if (open) {
      // null: the next row given an outline (or a point) starts that layer afresh
      session.replacingLayerId = layerId;
      session.pointsLayerId = pointsLayerId;
      session.replacingAddedBy = session.replacingAddedBy || stanza.addedBy || null;
      session.replacingAddedAt = session.replacingAddedAt || stanza.addedAt || null;
      session.replacingUploadedAs = session.replacingUploadedAs || stanza.uploadedAs || '';
      const os = parts.outline.frag.stanza;
      if (layerId && os.credits) session.replacingCredits = os.credits;
      if (layerId && os.attribution) session.replacingAttribution = os.attribution;
      imports.keepForRepair(session, layerId || pointsLayerId, open, [layerId, pointsLayerId]);
    } else {
      imports.discardImport(session.id);
    }
    /* Every way a layer reaches an atlas comes through here — the wizard's
       hand-off, adding data, a re-commit, a repair — so this is where its
       questions are asked for. Never allowed to stop the commit itself. */
    for (const id of [layerId, pointsLayerId]) {
      if (!id) continue;
      try { considerReading(session.dataset, id, opts); } catch (e) {
        console.warn('[questions] could not look at ' + session.dataset + '/' + id + ' — ' + (e && e.message));
      }
      // and, the same way, a short name for each of its long column headings
      try { considerShortLabels(session.dataset, id); } catch (e) {
        console.warn('[labels] could not look at ' + session.dataset + '/' + id + ' — ' + (e && e.message));
      }
      // and short names for its places, when their only name is a sentence
      try { considerPlaceNames(session.dataset, id); } catch (e) {
        console.warn('[names] could not look at ' + session.dataset + '/' + id + ' — ' + (e && e.message));
      }
      /* and a reading's own write: an Explore whose buttons came from the
         analysis has them worked out again from the new answers (unless the
         owner edited them). After this commit, never holding it up. */
      if (opts && opts.fromReading) {
        const ds = session.dataset;
        setImmediate(() => {
          reworkSmartButtons(ds, id).catch((e) => console.warn('[buttons] could not rework ' + ds + '/' + id + ' — ' + (e && e.message)));
          // and an atlas in Insight with "the story of the place" on: written again if the words changed (the server's allowance)
          try {
            const ins = reg.getInstance(ds);
            if (ins && insightSummary.shouldRewrite(ds, readOverlay(ins).local, NEVER_READ) === true) runInsightSummary(ds, 'server', { markPending: true });
          } catch (e) { console.warn('[insight] could not look at ' + ds + ' — ' + (e && e.message)); }
        });
      }
    }
    // places were added or replaced: the list's small photos may need remaking
    setImmediate(() => { const ds = reg.getInstance(session.dataset); if (ds) queueSmallPhotos(ds); });
    // and a mode chosen while building may now be possible
    setImmediate(() => { applyWantedMode(session.dataset); });
    return { ok: true, layerId: layerId || pointsLayerId, pointsLayerId, dataset: session.dataset };
  } catch (e) {
    if (e && e.status) throw e;
    throw refuse(400, e.message);
  }
}

/* One layer onto the atlas: the outlines, or the points beside them. Takes
   the import (or, for the points, placeAll's copy of it) and what transform
   made of it, and answers with the layer it wrote. */
function commitPart(session, frag, features) {
  // Same data twice is almost always a mistake (a re-upload, or the wizard's
  // auto-add racing a manual one). Fingerprint the resulting features and
  // refuse a second copy — the authoritative check, since every path (bench,
  // data-first auto-add) commits through here.
  const contentHash = hashRows(session.rows);
  const hit = findLayerByContent(session.dataset, contentHash, frag.stanza.label,
    session.replacingLayerId || frag.stanza.id);
  if (hit && hit.exact) {
    throw refuse(409, 'this data is already on the atlas as “' + (hit.layer.label || hit.layer.id) +
      '” — remove that layer first if you want to add it again',
      { duplicate: true, layerId: hit.layer.id });
  }
  frag.stanza.contentHash = contentHash;
  frag.stanza.spec = session.spec || undefined;   // so "edit this layer" can start from it
  /* The file somebody actually sent. Nothing recorded it before, and the gap
     showed the day a layer's name went wrong: the name is derived from the
     rows by the model, the derivation ran again on every reading, and when it
     drifted there was nothing left saying where the data had come from.

     A name and a provenance are different things and were being asked to be
     one. The name is for reading; this is for knowing which upload you are
     looking at — telling two similar layers apart, recognising your own file
     a month later, and having something true to fall back on.

     Only a real file name is kept. A reading replaces a layer by handing back
     its own label as the "filename", which is not one, so the extension is
     what tells them apart. Once set it travels with the layer; it describes
     the upload, and a re-reading is not a new upload. */
  const sentAs = String(session.filename || '').trim();
  const wasAFile = /\.[A-Za-z0-9]{1,8}$/.test(sentAs);
  const keptFile = session.replacingUploadedAs || '';
  if (wasAFile) frag.stanza.uploadedAs = sentAs.slice(0, 120);
  else if (keptFile) frag.stanza.uploadedAs = keptFile;
  /* Credit the contributor: which org, and which person, added this layer.
     The session is carried on the import rather than read from a request,
     because the request may be long gone — a reading retried an hour later
     still belongs to whoever asked for it, not to nobody. */
  const by = session.addedBy || null;
  if (by && by.email) {
    const acc = reg.getAccount(by.email);
    frag.stanza.addedBy = { email: by.email, name: (acc && acc.name) || '', org: (acc && acc.org) || '' };
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
    /* And whose shapes these are, when this reading is in no position to say.

       Credits are worked out while rows are joined to borrowed outlines. A
       layer reopened for editing skips that entirely — its shapes are already
       there, so there is nothing to join and nothing to notice — and the
       credits would have been dropped on the floor. Re-committing a layer to
       fix its wording would quietly have stopped naming the mountain
       inventory, the reserve register and OpenStreetMap as the source of the
       outlines it draws, which is the thing those licences actually ask for.

       So a replace keeps what it cannot re-derive. A reading that DID work
       them out wins, because it has looked at the data and this has not. */
    if (!frag.stanza.credits && session.replacingCredits && session.replacingCredits.length) {
      frag.stanza.credits = session.replacingCredits;
    }
    if (!frag.stanza.attribution && session.replacingAttribution) {
      frag.stanza.attribution = session.replacingAttribution;
    }
  }
  if (session.patternsNone) frag.stanza.patternsNone = true;
  /* Merge, so a name an owner gave some other key survives — but a question's
     own labels are replaced wholesale, not merged. A fresh set with fewer
     questions would otherwise leave the old fourth question's name on the
     layer, naming a key that no longer exists. */
  const dropStale = (was, now) => {
    const keep = {};
    for (const k of Object.keys(was || {})) if (!/^pattern_\d+$/.test(k)) keep[k] = was[k];
    return Object.assign(keep, now);
  };
  if (session.keyLabels && Object.keys(session.keyLabels).length) {
    frag.stanza.keyLabels = dropStale(frag.stanza.keyLabels, session.keyLabels);
  }
  if (session.keyKinds && Object.keys(session.keyKinds).length) {
    frag.stanza.keyKinds = dropStale(frag.stanza.keyKinds, session.keyKinds);
  }
  /* Replaced with the labels, whether or not this write names any columns: a
     question's column from an earlier set must not stay on a new question
     that happens to take its place. */
  if (session.keyLabels && Object.keys(session.keyLabels).length) {
    const cols = dropStale(frag.stanza.keyColumns, session.keyColumns || {});
    if (Object.keys(cols).length) frag.stanza.keyColumns = cols;
    else delete frag.stanza.keyColumns;
  }
  /* The nouns for "Explore by …", one per question at most. This write's own
     where it names one; otherwise the layer's old one, but only where the
     question at that place is word for word the question it was picked for —
     a new question that happens to take an old one's place does not inherit
     its heading. Each is checked against its question once more. */
  {
    const labels = frag.stanza.keyLabels || {};
    const given = (session.keyLabels && Object.keys(session.keyLabels).length) ? (session.keyNouns || {}) : {};
    const was = session.replacingKeyNouns || {}, wasLabels = session.replacingKeyLabels || {};
    const nouns = {};
    for (const c of Object.keys(labels)) {
      if (!RULES.isQuestionColumn(c)) continue;
      const n = given[c] || (wasLabels[c] === labels[c] ? was[c] : '');
      const ok = shortLabels.LABELS.nounFromQuestion(n, labels[c]);
      if (ok) nouns[c] = ok;
    }
    if (Object.keys(nouns).length) frag.stanza.keyNouns = nouns;
    else delete frag.stanza.keyNouns;
  }
  // this reading's account if it made one, otherwise the one already there
  const account = session.reading || session.replacingReading;
  const sorts = (session.facts && session.facts.length) ? session.facts : session.replacingFacts;
  if (account) frag.stanza.reading = account;
  if (sorts && sorts.length) frag.stanza.facts = sorts;
  if (session.replacingHidden && session.replacingHidden.length) {
    frag.stanza.hiddenKeys = session.replacingHidden;
  }
  const out = imports.commitLayer(session.dataset, frag.stanza, frag.sourceFile,
    { type: 'FeatureCollection', features });
  // embed this layer's tag vocabulary for semantic search (non-blocking)
  embedAndStoreVocab(session.dataset, out.layerId, frag.stanza, features).catch(() => {});
  return { layerId: out.layerId, stanza: frag.stanza };
}

router.post('/layers/commit', (req, res) => {
  const b = req.body || {};
  try {
    res.json(commitLayer({ importId: b.importId, dataset: b.dataset }, req));
  } catch (e) {
    res.status(e.status || 400).json(
      Object.assign({ error: e.message }, e.needsAuth ? { needsAuth: true } : {}));
  }
});

/* Editing a layer that is already on the atlas. Its geometry and properties are
   settled — what the user wants to change is how it looks — so this rebuilds an
   import session straight from the committed geojson (strategy 'geometry', so
   transform passes the shapes through) and hands back the same shape as ingest.
   The style step then works unchanged, and commit replaces the layer in place.
   Permission is the same rule as removal: the owner may edit any layer, an
   invited editor only the ones they added. */
/* What a committed layer was built with: the spec it was built with when we
   have it; otherwise read back off the stanza as faithfully as the stanza
   allows. Two callers start from it — an owner reopening a layer to edit it,
   and a reading handing an area layer's shapes back with its answers — so
   that both put the layer back as it was rather than as a fresh upload. */
function specOfLayer(layer, layerId, rows, columns) {
  if (layer.spec && typeof layer.spec === 'object') {
    // the column LOKA's short names come from travels with the choice of them
    if (layer.lokaNames && layer.lokaNames.from && !layer.spec.placeNamesFrom) {
      return Object.assign({}, layer.spec, { placeNamesFrom: layer.lokaNames.from });
    }
    return layer.spec;
  }
  const matchCol = columnFromMatch(layer.paint && layer.paint.color, columns);
  const catCol = layer.markerBy === '_category'
    ? recoverCategoryColumn(rows, columns)
    : (layer.markerBy || matchCol || undefined);
  // a plain colour on the stanza is one of the named ones; read the name back
  // so the layer keeps its colour, rather than the default for its kind
  const named = (hex) => typeof hex === 'string' &&
    Object.keys(MARKER_COLORS).find((k) => MARKER_COLORS[k].toLowerCase() === hex.toLowerCase());
  const p = layer.paint || {};
  return {
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
    popupTitleAlso: (layer.popup && layer.popup.titleAlso) || undefined,
    placeNamesFrom: (layer.lokaNames && layer.lokaNames.from) || undefined,
    popupColumns: ((layer.popup && layer.popup.fields) || []).map((f) => f.property),
    imageColumn: (((layer.popup && layer.popup.fields) || []).find((f) => f.type === 'image') || {}).property,
    palette: 'marigold',
    markerColor: named(p.color) || 'rust',
    lineColor: (layer.type === 'line' && named(p.color)) || 'slate',
    fillColor: named(p.fillColor) || 'moss',
  };
}

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

  // the short names LOKA wrote are the machinery's, put back by transform from what the list kept
  const rows = feats.map((f) => { const o = Object.assign({}, f.properties); delete o[placeNames.NAME_FIELD]; return o; });
  const geoms = feats.map((f) => f.geometry);
  const columns = Object.keys(rows[0] || {}).slice(0, MAX_COLS);
  const cls = /Polygon/.test(geoms[0] && geoms[0].type) ? 'polygon'
    : /LineString/.test(geoms[0] && geoms[0].type) ? 'line' : 'point';

  const spec = specOfLayer(layer, layerId, rows, columns);

  const session = imports.newImport({
    dataset, filename: (layer.label || layerId) + ' (existing layer)',
    meta: { notices: [], geometry: { class: cls, count: feats.length, vertices: 0 } },
    columnsRaw: columns, rows,
    geomIdx: feats.map((_, i) => i),
    replacingLayerId: layerId,
    replacingAddedBy: layer.addedBy || null,
    replacingAddedAt: layer.addedAt || null,
    replacingCredits: layer.credits || null,
    replacingAttribution: layer.attribution || '',
  });
  imports.writeGeoms(session.id, geoms);
  session.strategy = 'geometry';
  session.columns = columns.map((c) => ({ name: c, role: c === placeRoleColumn(spec) ? 'placeName' : 'text' }));
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
  // where the server has got to finding each layer's questions (see questions-queue.js)
  const reading = QUESTIONS.forDataset(dataset);
  const all = (m && m.local && m.local.layers) || [];
  /* One file, read through its pins (considerReading): while the pins half is
     waiting or being read, the outlines half is too, so its row says so —
     the owner's page lists the file by its outlines. */
  const stateOf = (l) => {
    const pins = l.sameFileAs && RULES.readByItsTwin(l, all) ? reading[l.sameFileAs] : null;
    return pins && (pins.state === 'queued' || pins.state === 'running') ? pins : (reading[l.id] || null);
  };
  const layers = all.map((l) => ({
    id: l.id, label: l.label || l.id,
    questions: stateOf(l),
    // where the short names for its places have got to (place-names.js), when it has them
    placeNames: placeNames.stateFor(l, placeNames.queue.get(dataset, l.id)),
    addedBy: l.addedBy ? { email: l.addedBy.email, name: l.addedBy.name || '', org: l.addedBy.org || '' } : null,
    addedAt: l.addedAt || null,
    /* Two different questions, which were one flag for too long.

       Removing a layer takes somebody's data off the map and cannot be undone,
       so it stays with whoever contributed it, or with an owner of the atlas.

       Asking a question of a layer adds a column to its places and a key to the
       map. It is additive, it can be turned off, and a question that came out
       wrong can be put right where it sits. It is also the entire point of
       being invited to an atlas. Deciding it by canRemove meant somebody
       invited to an atlas full of another person's places got no Questions tab
       at all — an invitation to work on data they could not ask anything of. */
    canRemove: role === 'owner' || !!(who && l.addedBy && l.addedBy.email === who.email),
    canAsk: !!role,
  }));
  res.json({ layers, role });
});

// Remove a contributed layer — owner: any; editor: only their own.
/* Setting a name and choosing which column names each place. Small on purpose:
   the reading decides how a layer is drawn now, so these two are all that is
   left of "change this layer", and putting them through a draft build was
   costing an upload, a preview and a commit to write two strings. */
/* Asking a question of your own.

   The reading finds what a set of places can honestly be asked, and settles on
   it. That is right, and it leaves no room for the one thing an owner knows that
   the model cannot: what THEY want to know about their own places. So this adds
   one question to a layer without disturbing the ones already there.

   Three steps, because the middle one takes half a minute and nobody should
   spend it not knowing what they will get:

     kinds   the model reads the places and proposes what the answers look like.
             Seconds. The owner edits them; they are the map's colours.
     try     the first forty places are actually answered — real answers, not a
             sample — and handed back with the share they reached. This IS the
             preview: the work is kept, not thrown away, and it doubles as the
             progress a person watches.
     keep    the rest are answered and the column is written alongside the
             others. Nothing already on the layer is touched.

   A sample of twenty would have been faster to show and would have cost an extra
   call, been discarded, and been wrong by about a fifth at that size. The first
   batch is bigger, free, and kept. */
/* As many questions as the map can wear at once: past this the key rows hang
   further below a pin than the folding rule keeps pins apart, which is the
   viewer's own KEY_STACK_CAP. Asking for a sixth would be asking for one that
   could never be switched on beside the others. */
const ASKING = new Map();          // token -> a half-answered question, briefly
const ASK_TTL = 30 * 60 * 1000;

function sweepAsking(now) {
  for (const [k, v] of [...ASKING.entries()]) if (now - v.at > ASK_TTL) ASKING.delete(k);
}

/* The questions a layer already carries, with the answers already on its places.
   Read back rather than re-asked: they are settled, and answering them again
   would be paying for a reading nobody asked for and risking a different one. */
function questionsAsAnswered(layer, rows) {
  return questionsOn(layer, rows).map((q, n) => {
    const col = 'pattern_' + (n + 1);
    const whyCol = col + '_why';
    const categories = rows.map((r) => String((r && r[col]) || ''));
    const tally = new Map();
    categories.forEach((c) => { if (c) tally.set(c, (tally.get(c) || 0) + 1); });
    return {
      question: q.question,
      // its heading's noun, kept as it was (the page and the commit check it again)
      noun: q.noun || '',
      /* Every answer this question was given, including the ones no place is
         using at the moment.

         These counts become the question's remembered answers, and dropping the
         empty ones meant a question quietly forgot them: keep anything on a
         layer and every OTHER question on it came back missing whichever of its
         answers happened to match nobody that day. A later reading was then
         handed a shorter list than the question actually has, and places that
         belonged in the forgotten answer had nowhere to go — the same way a map
         with no answer for a park files its parks under heritage. An answer
         with no places is not a mistake; it is a place for something that has
         not been added yet. */
      counts: q.kinds.map((k) => ({ name: k.name, definition: k.definition || '',
        count: tally.get(k.name) || 0 })),
      categories,
      why: rows.map((r) => String((r && r[whyCol]) || '').split(',').map((w) => w.trim()).filter(Boolean)),
    };
  });
}

router.post('/layers/ask', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || ''), layerId = String(b.layerId || '');
  const phase = String(b.phase || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
  if (!ai) return res.status(503).json({ error: 'there is no model configured' });
  sweepAsking(Date.now());

  try {
    const m = imports.readManifest(dataset);
    const layer = m && imports.mergedLayers(m).find((L) => L.id === layerId);
    if (!layer || !layer.source) return res.status(404).json({ error: 'layer not found' });
    // a file that went on as two layers is asked as one file — see fileHalves
    const halves = fileHalves(m, layer);
    if (!halves) return res.status(404).json({ error: 'the layer\'s places are missing' });
    const rows = rowsOf(halves);
    if (!rows.length) return res.status(400).json({ error: 'that layer has no places' });
    const fields = wordColumnsOf(rows);
    if (!fields.length) return res.status(400).json({ error: 'none of those columns hold words to read' });
    const title = (inst && inst.title) || dataset;
    const question = String(b.question || '').trim().slice(0, MAX_QUESTION_CHARS);

    /* Putting an existing question right, rather than adding another one.

       The column says which: pattern_2 is the layer's second question. Repair
       is the answer to a question that came out wrong — a map that asked "what
       kind of place is it?" and offered no answer for a park had thirteen parks
       filed under heritage, and until now the only way out was to throw away
       every question on the map and read it again. This changes the one that is
       wrong and leaves the rest alone. */
    // settled on whichever half carries them (a file read before both halves
    // were read together has its questions on the pins alone)
    const settledOn = halves.find((h) => questionsOn(h.layer, rows).length) || halves[0];
    const settled = questionsOn(settledOn.layer, rows);
    const putRight = RULES.isQuestionColumn(String(b.replacing || ''))
      ? Number(String(b.replacing).split('_')[1]) - 1
      : -1;
    const repairing = putRight >= 0 && putRight < settled.length;

    if (phase === 'kinds') {
      if (!question) return res.status(400).json({ error: 'ask a question first' });
      /* There used to be a cap of five. It was a guess about how many keys a
         map can wear before the panel stops being readable, made before anybody
         had five — and the first person to reach it was stopped from asking a
         sixth thing about their own places, which is a strange way to treat
         somebody doing exactly what the product is for. How many questions are
         too many is something whoever made the map can see for themselves:
         every one has a switch, and a question nobody wants can be turned off
         or put right. */
      const out = await enrich.proposeKinds({
        digest: enrich.buildDigest(rows, fields), question, title,
        callJSON: aiCaller('server'), model: getFlashModel(),
        alreadyKeyed: enrich.keyKindsByColumn(rows, fields),
      });
      return res.json(out);
    }

    if (phase === 'try' || phase === 'keep') {
      const kinds = (Array.isArray(b.kinds) ? b.kinds : [])
        .map((k) => ({ name: String((k && k.name) || '').trim().slice(0, 40),
          definition: String((k && k.definition) || '').slice(0, 200) }))
        .filter((k) => k.name);
      if (!question || kinds.length < 2) {
        return res.status(400).json({ error: 'a question needs at least two kinds of answer' });
      }
      /* Answered through the same path every reading uses, with the question
         handed in as settled — so the counting after it (a kind under three
         places folded away, a name shared with another question resolved, a
         word arguing two ways dropped) applies here exactly as it does there. */
      /* The noun the kinds step picked from the question's own words, handed
         back by the page; checked again, so only the question's words survive. */
      const noun = shortLabels.LABELS.nounFromQuestion(b.noun, question);
      const out = await enrich.enrichRows({
        rows, fields, title, mode: 'questions',
        keepQuestions: [{ question, kinds, noun }],
        seedSet: keptCatSet(dataset),
        callJSON: aiCaller('server'),
        models: { flash: getFlashModel(), flashLite: getFlashLiteModel() },
      });
      if (out.verdict !== 'questions' || !(out.questions || []).length) {
        return res.json({ verdict: out.verdict, note: out.note || '', trouble: out.trouble || '',
          unread: out.unread || 0 });
      }
      const q = out.questions[0];
      const answered = (q.categories || []).filter((c) => c && c !== 'other').length;
      const preview = {
        verdict: 'answered', question: q.question,
        // what its heading will read on the map, so nothing is reworded unseen
        noun: q.noun || '',
        answered, places: rows.length,
        kinds: (q.counts || []).map((c) => ({ name: c.name, count: c.count })),
        /* A handful of real ones, so the number has faces behind it.

           When a question is being put right, `was` carries what the place used
           to answer, and the places that moved are shown first — those are the
           whole point of the repair, and a preview that happened to show six
           places that did not move would look like nothing had happened. */
        examples: (q.categories || []).map((c, i) => {
          const before = repairing ? String(rows[i]['pattern_' + (putRight + 1)] || '') : '';
          return {
            place: String(rows[i].description || rows[i].name || '').slice(0, 60),
            answer: c, words: (q.why[i] || []).join(', '),
            was: (before && before !== c) ? before : '',
          };
        }).filter((e) => e.answer && e.place)
          .sort((a, b) => (b.was ? 1 : 0) - (a.was ? 1 : 0))
          .slice(0, 6),
        moved: repairing
          ? (q.categories || []).filter((c, i) => {
            const before = String(rows[i]['pattern_' + (putRight + 1)] || '');
            return c && before && before !== c;
          }).length
          : 0,
      };

      if (phase === 'try') {
        const token = crypto.randomBytes(8).toString('hex');
        ASKING.set(token, { at: Date.now(), dataset, layerId, question: q.question, q });
        return res.json(Object.assign({ token }, preview));
      }

      /* Kept. The layer's own questions are read back with the answers already
         on its places, this one takes its place among them, and all of them are
         written together — so nothing that was there is re-asked or lost.

         A new question goes on the end. A repaired one goes back exactly where
         it was, so the keys on the map keep their order and anybody holding a
         link sees the same question in the same place, put right. */
      const held = b.token && ASKING.get(String(b.token));
      const fresh = (held && held.dataset === dataset && held.layerId === layerId) ? held.q : q;
      if (b.token) ASKING.delete(String(b.token));
      const all = questionsAsAnswered(settledOn.layer, rows);
      if (repairing) all[putRight] = fresh; else all.push(fresh);
      // each half of a split file takes its own share, and keeps its own shapes
      await writeReadingToHalves({ dataset, halves, questions: all });
      return res.json(Object.assign({ wrote: true, questionsNow: all.length }, preview));
    }

    return res.status(400).json({ error: 'unknown step' });
  } catch (e) {
    if (!e.status) console.error('[atlas] asking a question failed:', e && e.stack);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/layers/relabel', (req, res) => {
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
  /* What a layer is CALLED, which column names its places and what its cards
     show are about whose layer it is, so they keep the rule the removal route
     applies: a collaborator may change what their own organisation contributed,
     an owner may change anything here.

     Which questions are switched off is not about whose layer it is. It is
     about what this map shows the people who open it, every one of them sees
     the same thing, and turning one back on costs nothing. Anybody trusted to
     edit the atlas may do that — otherwise somebody can ask a question and then
     be unable to take it down again, which is a worse place to leave them than
     never having asked. */
  const onlyHiding = Array.isArray(b.hiddenKeys)
    && typeof b.label !== 'string'
    && typeof b.titleColumn !== 'string'
    && typeof b.titleAlso !== 'string'
    && !Array.isArray(b.cardColumns);
  if (role !== 'owner' && !onlyHiding) {
    const who = auth.sessionFromReq(req);
    if (!who || !layer.addedBy || layer.addedBy.email !== who.email) {
      return res.status(403).json({ error: 'you can only change layers your organisation added' });
    }
  }
  const naming = {
    titleColumn: typeof b.titleColumn === 'string' ? b.titleColumn : undefined,
    titleAlso: typeof b.titleAlso === 'string' ? b.titleAlso : undefined,
  };
  /* "Short names written by LOKA" is a choice like any column, but the
     column is written by the server: choosing it writes the stand-in at
     once, marks the stanza and asks the model (place-names.js); choosing
     another column after it switches it off and the list remembers. One
     file, one way of naming: a split file's other half follows. */
  let namesState = null;
  if (naming.titleColumn === placeNames.NAME_FIELD) {
    const from = String(b.namesFrom || placeNames.sourceColumnOf(layer) || '').trim().slice(0, 60);
    if (!from) return res.status(400).json({ error: 'say which column the short names should come from' });
    namesState = switchOnPlaceNames(dataset, layerId, from);
    if (layer.sameFileAs) switchOnPlaceNames(dataset, layer.sameFileAs, from);
    naming.titleColumn = undefined;   // the stanza already names the written column
    if (naming.titleAlso === from) naming.titleAlso = '';
  } else if (naming.titleColumn !== undefined && layer.lokaNames) {
    switchOffPlaceNames(dataset, layerId);
    if (layer.sameFileAs) switchOffPlaceNames(dataset, layer.sameFileAs);
  }
  const out = imports.relabelLayer(dataset, layerId, Object.assign({
    label: typeof b.label === 'string' ? b.label : undefined,
    hiddenKeys: Array.isArray(b.hiddenKeys) ? b.hiddenKeys : undefined,
    cardColumns: Array.isArray(b.cardColumns) ? b.cardColumns : undefined,
  }, naming));
  if (!out) return res.status(404).json({ error: 'layer not found' });
  /* One file, one set of keys: a question switched off on one half of a split
     file is off on the other too, or the Map Browser's one row — whose keys
     read both halves — would keep offering it. And one file, one way of naming
     its places: the column that identifies a place names it on both halves. */
  if (layer.sameFileAs) {
    const twin = {};
    if (Array.isArray(b.hiddenKeys)) twin.hiddenKeys = b.hiddenKeys;
    if (naming.titleColumn !== undefined || naming.titleAlso !== undefined) Object.assign(twin, naming);
    if (Object.keys(twin).length) imports.relabelLayer(dataset, layer.sameFileAs, twin);
  }
  res.json(Object.assign({ ok: true }, out, namesState ? { placeNames: namesState } : {}));
});

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
  /* One file that went on as outlines and points both is one thing to the
     owner: taking it off takes both layers. */
  const partner = layer.sameFileAs && ((m.local.layers || []).find((l) => l.id === layer.sameFileAs));
  const also = partner && imports.removeLayer(dataset, partner.id) ? [partner.id] : [];
  // a layer that is gone has nothing left to be read
  QUESTIONS.forget(dataset, layerId);
  for (const id of also) QUESTIONS.forget(dataset, id);
  res.json({ ok: gone, also });
});

router.post('/layers/discard', (req, res) => {
  const session = imports.getImport(String((req.body || {}).importId || ''));
  if (session) imports.discardImport(session.id);
  res.json({ ok: true });
});

/* ---------- rows that need a place, after the build ----------

   A row the setup flow skipped, one no outline was found for, and one put by
   its neighbours that nobody has checked yet all stay listed on the finished
   atlas (commitLayer keeps their import; imports.keepForRepair says for how
   long). The list is worked out afresh from the import each time, so it can
   never disagree with the layer it describes. */
function toFix(report, session) {
  const out = [];
  /* What the map lookup found for a row, when it was looked up and not put
     on — left unticked, or not offered — so the fix page can offer it as a
     point without asking the map again. */
  const held = (session && session.located && session.located.byRow) || {};
  const foundFor = (row) => {
    const h = held[row];
    return h && h.lat != null ? { find: { label: h.label || '', lat: h.lat, lng: h.lng } } : {};
  };
  const take = (list, kind) => {
    for (const e of (list || [])) {
      out.push({
        ...(kind === 'byNeighbours' || kind === 'suggested' ? {} : foundFor(e.row)),
        row: e.row, name: e.name, kind,
        code: e.code != null ? String(e.code) : null, place: e.place || '', parent: e.parent || '', area: e.area || '',
        sameName: !!e.sameName,
        candidates: (e.candidates || []).slice(0, 8).map((c) => ({
          code: String(c.code), name: c.name || '', parent: c.parent || '', area: c.area || '',
          ...(c.km != null ? { km: c.km } : {}), ...(c.inside ? { inside: true } : {}), ...(c.at ? { at: c.at } : {}),
        })),
        ...(e.reason ? { reason: e.reason } : {}),
      });
    }
  };
  take(report.ambiguous, 'question');
  take(report.skipped, 'skipped');
  take(report.unmatched, 'unplaced');
  take(report.byNeighbours, 'byNeighbours');
  take(report.suggested, 'suggested');
  return out;
}

router.get('/layers/repair', (req, res) => {
  const dataset = String(req.query.dataset || '');
  if (!requireDatasetEditor(req, res, dataset)) return;
  const out = [];
  for (const s of imports.repairsFor(dataset)) {
    try {
      const rows = toFix(placeAll(s).report || {}, s);
      if (!rows.length) continue;
      out.push({ importId: s.id, layerId: s.repair.layerId, pointsLayerId: s.pointsLayerId || null,
        label: (s.spec && s.spec.label) || s.repair.layerId,
        // a row can be given a point only where the rows are placed by name
        canPoint: s.strategy === 'adminJoin',
        file: s.filename || '', total: (s.rows || []).length, rows });
    } catch (e) { console.warn('[atlas] repair list for', s.id, 'failed:', e.message); }
  }
  res.json({ imports: out });
});

/* Places of a typed name on the layer the rows were joined to — for a row no
   place was found for, so the owner can give it one by name. Only places the
   atlas already has; nothing is looked up elsewhere. */
router.get('/layers/repair/find', (req, res) => {
  const session = imports.getImport(String(req.query.importId || ''));
  if (!session || !session.repair) return res.status(404).json({ error: 'that list of rows has been closed' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ matches: [] });
  const bt = session.strategy === 'adminJoin' ? boundaryTargets(session, session.joinLayer) : null;
  if (!bt) return res.json({ matches: [], note: 'these rows are placed by coordinates, not by name' });
  const k = norm(q);
  const scored = bt.targets
    .map((t) => ({ t, s: norm(t.name).startsWith(k) ? 1.01 : dice(q, t.name) }))
    .filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s).slice(0, 6);
  res.json({ matches: scored.map((x) => ({ code: x.t.code, name: x.t.name, parent: x.t.parent || '', area: x.t.area || '' })) });
});

/* Look one row up on the map, for the fix page — a row nobody looked up
   while setting up, or one whose first answer was not the place. The name
   and the columns that say where it is (a district, a state) go together,
   the way the setup page asked; nothing goes on the map until the owner
   says "put it here". */
router.post('/layers/repair/locate', async (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session || !session.repair) return res.status(404).json({ error: 'that list of rows has been closed' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  if (session.strategy !== 'adminJoin') return res.status(400).json({ error: 'these rows are placed by coordinates, not by name' });
  const row = Number(b.row);
  const r = Number.isInteger(row) ? (session.rows || [])[row] : null;
  if (!r) return res.status(400).json({ error: 'which row?' });
  const roles = rolesMap(session.columns || []);
  const asked = session.located && session.located.asked ? String(session.located.asked).split('|') : [];
  const col = asked[0] || roles.placeName;
  const context = asked.length ? asked.slice(1)
    : (session.columns || []).filter((c) => c.role === 'adminParent').map((c) => c.name).slice(0, 2);
  const cell = (c) => String(r[c] == null ? '' : r[c]).trim();
  const name = cell(col);
  if (!name) return res.status(400).json({ error: 'this row has no name to look up' });
  const query = [name].concat(context.map(cell).filter((v) => v && norm(v) !== norm(name))).join(', ');
  let got;
  try { got = await geocodeOne(query, locateBias(session)); } catch (e) {
    return res.status(502).json({ error: 'the map lookup could not be reached: ' + e.message });
  }
  if (!session.located) session.located = { column: col, asked: [col].concat(context).join('|'), byRow: {} };
  session.located.byRow[row] = { query, lat: got.lat, lng: got.lng, label: got.label || '',
    confidence: got.confidence, provider: got.provider, reason: got.reason };
  session.repair.touchedAt = Date.now();
  imports.saveImport(session);
  res.json(got.lat != null ? { find: { label: got.label || '', lat: got.lat, lng: got.lng } } : { find: null });
});

/* Fix rows on the finished atlas: the same fixes /layers/resolve takes, then
   the layer is committed again in place. `dismiss` lets the list go without
   changing anything — the owner has seen it and is done with it. */
router.post('/layers/repair', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session || !session.repair) return res.status(404).json({ error: 'that list of rows has been closed' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  if (b.dismiss) { imports.discardImport(session.id); return res.json({ ok: true, rows: [] }); }
  session.matchState = session.matchState || {};
  let n = 0;
  for (const f of (Array.isArray(b.fixes) ? b.fixes : [])) {
    if (!f || !Number.isInteger(f.row) || f.row < 0 || f.row >= (session.rows || []).length) continue;
    /* A point: the row is held off the outlines and put on the points layer
       beside them, where the map lookup found it (/layers/repair/locate). An
       outline, or leaving it off: it comes off the points layer if it was
       there. Each fix lands in the layer it belongs to; commitLayer writes
       both. */
    if (f.point) {
      const h = session.located && session.located.byRow && session.located.byRow[f.row];
      if (session.strategy !== 'adminJoin' || !h || h.lat == null) continue;
      session.pointRows = session.pointRows || {};
      session.pointRows[f.row] = { lat: h.lat, lng: h.lng, label: h.label || '' };
      session.matchState[f.row] = 'skip';
    } else if (f.skip) session.matchState[f.row] = 'skip';
    else if (typeof f.code === 'string') session.matchState[f.row] = f.code;
    else continue;
    if (!f.point && session.pointRows) delete session.pointRows[f.row];
    if (session.suggested) delete session.suggested[f.row];
    n++;
  }
  if (!n) return res.status(400).json({ error: 'which rows, and where do they go?' });
  imports.saveImport(session);
  try {
    const out = commitLayer({ importId: session.id, dataset: session.dataset }, req);
    const still = imports.getImport(session.id);
    const rows = still && still.repair ? toFix(placeAll(still).report || {}, still) : [];
    res.json({ ok: true, layerId: out.layerId, pointsLayerId: out.pointsLayerId || null, rows });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
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
      // the questions this layer already settled on, if it has any
      keepQuestions: Array.isArray(b.keepQuestions) ? b.keepQuestions : [],
      // questions mode asks what these places can be asked, rather than assuming
      // the one question the old reading always asked
      mode: b.mode === 'questions' ? 'questions' : undefined,
      seedSet: dataset ? keptCatSet(dataset) : [],
      callJSON,
      models: { flash: getFlashModel(), flashLite: getFlashLiteModel() },
    });
    /* A reading that could not be finished is written down rather than shrugged
       off. The browser is told, but the browser goes away — the list is what
       brings somebody back to this layer once the model is answering again. */
    if (out && cannotReach(out.verdict) && dataset && b.layerId) {
      const asked = auth.sessionFromReq(req);
      const inst = reg.getInstance(dataset);
      owed.owe({
        dataset, layerId: String(b.layerId),
        email: (asked && asked.email) || (inst && inst.email) || '',
        payer: payerOf(inst),
        kind: troubleKind(out.trouble), trouble: out.trouble || '',
      });
    }
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

/* ---------------- link previews, for chat apps only (Mithun, 7 Nov 2026) ----------------
   Only a link-preview robot ever reaches this route — Apache's rewrite
   (deploy/lokaApps.conf) sends a handful of known crawler user-agents here
   for /apps/atlas/?dataset=<slug>, and api/server.js mimics the same rewrite
   for local dev. Every human visit keeps the plain static page untouched.

   Reads atlas/index.html from the repo at request time, cached by its mtime
   (it changes on a deploy, never between requests), and swaps its one
   generic <meta name="description"> for a description plus og:/twitter:
   tags built from the atlas's own public fields and its own place files —
   already on disk, no model call, nothing written. A private atlas, an
   unknown slug or deoria-bioregion gets the same generic block loka.place/
   itself shows: never its title, region or any photo. req.query.key is
   never read, nothing but ?dataset= is honoured, and no tag ever echoes the
   request's own URL — og:url is always the plain /apps/atlas/ address. */
const PREVIEW_INDEX_PATH = path.join(REPO_ROOT, 'atlas', 'index.html');
const PREVIEW_BASE = (process.env.ATLAS_PUBLIC_BASE || 'https://loka.place').replace(/\/+$/, '');
let previewIndexCache = null; // { mtimeMs, html }
// A failed stat or read (a deploy mid-write, a permissions hiccup) keeps
// whatever was last read rather than failing the request — a stale page for
// one crawler hit beats a broken one. Only with nothing cached yet does the
// route itself answer 503.
function previewIndexHtml() {
  try {
    const stat = fs.statSync(PREVIEW_INDEX_PATH);
    if (!previewIndexCache || previewIndexCache.mtimeMs !== stat.mtimeMs) {
      previewIndexCache = { mtimeMs: stat.mtimeMs, html: fs.readFileSync(PREVIEW_INDEX_PATH, 'utf8') };
    }
  } catch (e) {
    if (!previewIndexCache) throw e;
  }
  return previewIndexCache.html;
}
const PREVIEW_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escPreview(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => PREVIEW_ESCAPE[c]);
}
// trimmed to about n characters, always at a word's own boundary, never
// through the middle of one: cut at the last space at or before n, or — for
// one word longer than n itself — extended forward to that word's own next
// space instead of being sliced apart.
function previewTrim(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  let sp = t.slice(0, n).lastIndexOf(' ');
  if (sp < 0) sp = t.indexOf(' ');
  const kept = sp < 0 ? t : t.slice(0, sp);
  return kept.trim() + '…';
}
// a place's own photo, if it has one: photo_1_url is already an absolute
// https address; photo_small is a filename inside the atlas's own dataset
// folder, so it is turned into one. Never a relative or non-https address.
function previewPhotoOf(props, slug) {
  if (!props) return null;
  const abs = String(props.photo_1_url || '').trim();
  if (/^https:\/\//i.test(abs)) return abs;
  const small = String(props.photo_small || '').trim();
  if (small && SAFE_LAYER_FILE.test(small) && !small.includes('..')) {
    return `${PREVIEW_BASE}/apps/atlas/datasets/${encodeURIComponent(slug)}/${small}`;
  }
  return null;
}
function previewPlaceName(props) {
  const p = props || {};
  return String(p.description || p.name || p.title || '').trim();
}
/* The best place photo for the card: a photo belonging to a place the
   atlas's own "story of the place" already quotes (same places.tag_id ids
   insight-mode.js's candidates use — see atlas/insight-mode.js
   placeIdOf), read straight out of the overlay nothing here computes; else
   the first place, in layer order, that has a photo at all. null when the
   atlas has neither a story nor any place with a photo.

   Cached per slug by the mtimes of manifest.local.json and of the layer
   files it names: a repeated hit (every crawler re-checks a link now and
   then) re-reads and re-parses nothing — not even the geojson, which can run
   to thousands of places — as long as none of those files have moved since
   the last hit. A change to any of them, or the overlay itself, invalidates
   the cache on its own next read of the overlay's mtime. */
const previewPhotoCache = new Map(); // slug -> { overlayMtime, layerFiles, layerMtimes, result }
function statMtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return -1; }
}
function previewBestPhoto(inst) {
  const dir = datasetDirFor(inst);
  const overlayMtime = statMtime(path.join(dir, 'manifest.local.json'));
  if (overlayMtime < 0) { previewPhotoCache.delete(inst.slug); return null; }
  const cached = previewPhotoCache.get(inst.slug);
  if (cached && cached.overlayMtime === overlayMtime) {
    const layerMtimes = cached.layerFiles.map((f) => statMtime(path.join(dir, f)));
    if (layerMtimes.length === cached.layerMtimes.length && layerMtimes.every((m, i) => m === cached.layerMtimes[i])) {
      return cached.result;
    }
  }
  const { local } = readOverlay(inst);
  if (!local) { previewPhotoCache.delete(inst.slug); return null; }
  const layers = ownLayers(local);
  const result = previewBestPhotoCompute(inst, local, layers);
  const layerFiles = layers.map((L) => L.source);
  previewPhotoCache.set(inst.slug, { overlayMtime, layerFiles, layerMtimes: layerFiles.map((f) => statMtime(path.join(dir, f))), result });
  return result;
}
function previewBestPhotoCompute(inst, local, layers) {
  const mode = local.mode;
  if (mode && mode.story && Array.isArray(mode.story.quotes) && mode.story.quotes.length) {
    const storyLayer = layers.find((l) => l.id === mode.layer);
    const feats = storyLayer ? placesOf(inst, storyLayer) : null;
    if (feats) {
      for (const q of mode.story.quotes) {
        const f = feats.find((x) => x && x.properties && String(x.properties.tag_id || '') === String((q && q.id) || ''));
        const url = f && previewPhotoOf(f.properties, inst.slug);
        if (url) return { url, name: previewPlaceName(f.properties) || (q && q.name) || '' };
      }
    }
  }
  for (const L of layers) {
    const feats = placesOf(inst, L);
    if (!feats) continue;
    for (const f of feats) {
      const url = f && previewPhotoOf(f.properties, inst.slug);
      if (url) return { url, name: previewPlaceName(f.properties) };
    }
  }
  return null;
}
// og:description, in order: the subtitle, else "about" (trimmed), else the
// first sentence of the kept story, else a plain line naming the region.
function previewDescription(inst) {
  const subtitle = String(inst.subtitle || '').trim();
  if (subtitle) return previewTrim(subtitle, 160);
  const about = String(inst.about || '').trim();
  if (about) return previewTrim(about, 160);
  try {
    const { local } = readOverlay(inst);
    const sentences = (local && local.mode && local.mode.story && local.mode.story.sentences) || [];
    const first = sentences.find((s) => s && String(s.text || '').trim());
    if (first) return previewTrim(first.text, 160);
  } catch { /* fall through to the region line below */ }
  const region = String(inst.regionLabel || '').trim();
  return region ? `A map of ${region} on LOKA Atlas` : 'LOKA Atlas — layered, shareable maps for any geography, built from open data.';
}
const PREVIEW_DEFAULT_DESC = 'LOKA Atlas — layered, shareable maps for any geography, built from open data.';
function previewTagsBlock({ title, description, image, imageAlt, url }) {
  return [
    `<meta property="og:title" content="${escPreview(title)}" />`,
    `<meta property="og:description" content="${escPreview(description)}" />`,
    `<meta property="og:image" content="${escPreview(image)}" />`,
    `<meta property="og:image:alt" content="${escPreview(imageAlt || '')}" />`,
    `<meta property="og:url" content="${escPreview(url)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta name="twitter:card" content="summary_large_image" />',
  ].join('\n  ');
}
function genericPreviewTags() {
  return previewTagsBlock({
    title: 'LOKA Atlas', description: PREVIEW_DEFAULT_DESC,
    image: `${PREVIEW_BASE}/og-default.png`, imageAlt: 'LOKA Atlas',
    url: `${PREVIEW_BASE}/apps/atlas/`,
  });
}
function atlasPreviewTags(inst, description) {
  const photo = previewBestPhoto(inst);
  return previewTagsBlock({
    title: `${inst.title || 'LOKA Atlas'} — LOKA Atlas`,
    description,
    image: photo ? photo.url : `${PREVIEW_BASE}/og-default.png`,
    imageAlt: photo && photo.name ? photo.name : 'LOKA Atlas',
    url: `${PREVIEW_BASE}/apps/atlas/?dataset=${encodeURIComponent(inst.slug)}`,
  });
}
// Only a dataset's own public, published instance qualifies — never deoria-
// bioregion, same test as GET /instances/:slug a line up (inst.status ===
// 'published' && inst.visibility === 'public').
function previewEligible(inst) {
  return !!inst && inst.status === 'published' && inst.visibility === 'public' && inst.slug !== 'deoria-bioregion';
}
router.get('/preview', (req, res) => {
  // Only the dataset name is read. A crawler's request can carry whatever
  // Apache's [QSA] passed along — a private link's view key among it — and
  // none of that belongs in a tag a stranger will see.
  const slug = String(req.query.dataset || '');
  let description = PREVIEW_DEFAULT_DESC;
  let tags = genericPreviewTags();
  try {
    const inst = slug ? reg.getInstance(slug) : null;
    if (previewEligible(inst)) {
      description = previewDescription(inst);
      tags = atlasPreviewTags(inst, description);
    }
  } catch (e) {
    console.warn('[preview] ' + slug + ' — ' + (e && e.message));
  }
  let html;
  try { html = previewIndexHtml(); } catch { return res.status(503).type('text/plain').send('preview unavailable'); }
  // The plain <meta name="description"> carries the very same words as
  // og:description — a search engine or a chat app that ignores og: tags
  // still gets the atlas's own description, never the generic line.
  html = html.replace(
    /<meta name="description"[^>]*\/?>/,
    `<meta name="description" content="${escPreview(description)}" />\n  ${tags}`,
  );
  res.set('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(html);
});
