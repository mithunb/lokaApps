/* What deploy/apply-event-mode.mjs and deploy/refresh-event-atlas.mjs share:
 * turning an atlas's places into a festival guide (atlas/event-mode.js).
 *
 * Every rule that decides what a visitor sees — how a programme is read, which
 * of the four categories a place is in, how far apart two places are — comes
 * from atlas/event-mode.js, the file the viewer itself runs. So what these
 * scripts print in a dry run is what the page will draw.
 *
 * Nothing here knows which festival it is working on. What is particular to
 * one atlas (its days, its venue question, a pin to correct) is in
 * deploy/events/<slug>.json. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const EV = require(path.join(ROOT, 'atlas', 'event-mode.js'));

export const NEVER = new Set(['deoria-bioregion']);
/* The two mirrors api/atlas-builders/recipes.py already uses, then two more:
   on 22 Oct 2026 both of those answered "at capacity" and the mail.ru one
   served the query. Tried in order; the first that answers wins. */
export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
export const OSM_CREDIT = '© OpenStreetMap contributors';

export function dataDir() {
  return process.env.LOKA_DATA_DIR || path.join(ROOT, 'api', 'data', 'atlas');
}
export function atlasDir(slug) {
  // LOKA_PUBLIC_DATASETS: the checks point this away from the real folder
  const pub = process.env.LOKA_PUBLIC_DATASETS || path.join(ROOT, 'atlas', 'datasets');
  const roots = [pub, path.join(dataDir(), 'private-datasets')];
  return roots.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json'))) || null;
}
export function loadConfig(slug) {
  const file = path.join(ROOT, 'deploy', 'events', slug + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// a fix's photo, kept at deploy/events/<slug>/<file>; null when absent or
// named in a way the atlas's data route would refuse to serve
export function photoSrc(slug, file) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(jpg|png)$/.test(String(file || '')) || String(file).includes('..')) return null;
  const f = path.join(ROOT, 'deploy', 'events', slug, file);
  return fs.existsSync(f) ? f : null;
}
export function writeJson(file, obj, indent) {
  fs.writeFileSync(file + '.tmp', indent ? JSON.stringify(obj, null, indent) : JSON.stringify(obj));
  fs.renameSync(file + '.tmp', file);
}

/* The layer that holds the venues. After a fresh upload of the tags the
   layer can carry a new id and file (a commit writes user-<id>.geojson), so
   the one the mode or the config names is tried first, then any contributed
   pin layer whose places carry the programme column. */
export function pickLayer(local, cfg, dir) {
  const layers = (local && local.layers) || [];
  const want = [local && local.mode && local.mode.layer, cfg.layer].filter(Boolean);
  const read = (L) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, L.source), 'utf8')); } catch { return null; }
  };
  for (const id of want) {
    const L = layers.find((x) => x.id === id && x.type === 'marker' && x.source);
    const gj = L && read(L);
    if (gj) return { layer: L, gj };
  }
  for (const L of layers) {
    if (!(L.userLayer && L.type === 'marker' && L.source)) continue;
    const gj = read(L);
    const has = gj && (gj.features || []).some((f) => f.properties && f.properties[cfg.programmeFrom] != null);
    if (has) return { layer: L, gj };
  }
  return null;
}

/* The whole of each place's programme, from a spreadsheet exported from LOKA.

   An atlas keeps at most 500 characters of any one cell (the upload cuts
   them: api/apps/atlas.js, the `slice(0, 500)` on every row). A venue with a
   long programme therefore arrives in the atlas cut off mid-session — on 22
   Oct 2026 three of the seven venues had lost their ends, and two of them
   sessions with it: 15 of the Old Secretariat's and Sunaparanta's 26.
   The export the places were uploaded from still holds every word, so the
   scripts take the programme from it when given one (--full-text=<file.csv>),
   matched by tag_id, column `programmeFrom`.

   Returns Map tag_id -> text. Reads CSV (quoted fields may hold new lines,
   as a programme does) or GeoJSON. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] == null ? '' : r[i]])));
}
export function readFullTexts(file, column) {
  const raw = fs.readFileSync(file, 'utf8');
  let rows;
  if (/\.(geo)?json$/i.test(file)) rows = (JSON.parse(raw).features || []).map((f) => f.properties || {});
  else rows = parseCsv(raw);
  const out = new Map();
  for (const r of rows) if (r.tag_id && r[column]) out.set(String(r.tag_id).trim(), String(r[column]));
  return out;
}
/* Which text to read: the export's, when the atlas's copy is the same text
   cut short (or was cut at the 500 limit); otherwise the atlas's own, which
   may be the newer. */
export const CELL_LIMIT = 500;
export function chooseText(atlasText, fullText) {
  const a = String(atlasText == null ? '' : atlasText);
  const full = fullText == null ? null : String(fullText);
  if (full == null || full === a) return { text: a, from: 'atlas', cut: a.length >= CELL_LIMIT };
  const norm = (s) => s.replace(/\r/g, '');
  if (norm(full).startsWith(norm(a)) || a.length >= CELL_LIMIT) return { text: full, from: 'export', cut: false, differs: !norm(full).startsWith(norm(a)) };
  return { text: a, from: 'atlas', cut: false, differs: true };
}

/* venue, sessions and programme_text on every place. A place is a venue when
   the config's question says so (pattern_4 = "Venue") OR its programme reads
   as sessions — so a place tagged since the questions were last read, whose
   answer is not in yet, still counts if its text says it holds sessions. */
export function deriveVenueFields(gj, cfg, mode, fullTexts) {
  const out = [];
  for (const f of gj.features || []) {
    const p = f.properties || (f.properties = {});
    const chosen = chooseText(p[cfg.programmeFrom], fullTexts ? fullTexts.get(String(p.tag_id || '').trim()) : null);
    const text = chosen.text;
    const parsed = EV.parseProgramme(text, mode.days);
    const vf = cfg.venueFrom;
    const byQuestion = !!(vf && String(p[vf.column] == null ? '' : p[vf.column]).trim() === vf.equals);
    const venue = byQuestion || parsed.sessions.length > 0;
    p.venue = venue;
    delete p.merged_into;   // merges are applied afresh after this (applyMerges)
    if (venue) {
      p.sessions = parsed.sessions;
      if (parsed.ok) delete p.programme_text;
      else p.programme_text = String(text || '').trim();
    } else {
      delete p.sessions;
      delete p.programme_text;
    }
    if (venue) {
      out.push({
        name: p.loka_name || p.name || p.tag_id || '(no name)',
        tag_id: p.tag_id || null,
        pt: f.geometry && f.geometry.coordinates,
        sessions: parsed.sessions.length,
        declared: parsed.declared,
        byQuestion,
        programmeText: !parsed.ok,
        unparsed: parsed.unparsed,
        textFrom: chosen.from,
        cut: chosen.cut,
        differs: !!chosen.differs,
      });
    }
  }
  return out;
}

// a pin moved to where it belongs; reports how far, and says so when it is already there
/* One place's programme moved onto another, which becomes the venue; the
   first leaves the guide (`merged_into`, read by event-mode.js) but stays in
   the atlas's data. A data fix listed in deploy/events/<slug>.json under
   "merges" — never code — so the refresh applies it again each time:

     { "from": "<name>", "into": "<name>", "by": "loka_name",
       "fromId": "<tag_id>", "intoId": "<tag_id>", "why": "..." }

   A place is found by its tag_id when one is given and still there, else by
   its name in the `by` column. The target keeps its own photograph; it takes
   the source's only when it has none, or when the fix says "photo": "from". */
const PHOTO_FIELDS = ['photo_file', 'photo_credit', 'photo_credit_link', 'photo_urls', 'photo_1_url', 'photo_2_url', 'thumbnail_url', 'photo_count', 'image_urls'];
function hasPhoto(p) { return ['photo_file', 'photo_urls', 'photo_1_url', 'image_urls'].some((k) => String(p[k] == null ? '' : p[k]).trim()); }
export function applyMerges(gj, merges) {
  const out = [];
  const feats = gj.features || [];
  const find = (id, name, by) => (id && feats.find((f) => f.properties.tag_id === id)) ||
    feats.find((f) => String(f.properties[by] == null ? '' : f.properties[by]).trim() === String(name || '').trim()) || null;
  for (const m of merges || []) {
    const by = m.by || 'loka_name';
    const src = find(m.fromId, m.from, by), dst = find(m.intoId, m.into, by);
    if (!src || !dst || src === dst) { out.push({ from: m.from, into: m.into, missing: !src ? m.from : !dst ? m.into : 'the same place twice' }); continue; }
    const s = src.properties, d = dst.properties;
    d.venue = true;
    // added to the target's own, never in place of them: a later export may
    // give the target sessions of its own. One listed in both is kept once.
    const seen = new Set(), both = [];
    for (const x of [].concat(Array.isArray(d.sessions) ? d.sessions : [], Array.isArray(s.sessions) ? s.sessions : [])) {
      const k = [x.day, x.start, x.end, String(x.title || '').trim().toLowerCase()].join('|');
      if (!seen.has(k)) { seen.add(k); both.push(x); }
    }
    d.sessions = both;
    const texts = [d.programme_text, s.programme_text].filter(Boolean);
    if (texts.length) d.programme_text = texts.join('\n\n'); else delete d.programme_text;
    // "photo": "from" in the fix takes the source's picture even when the
    // target has one (a target whose only picture is a drawn marker)
    let photo = 'its own';
    if ((m.photo === 'from' || !hasPhoto(d)) && hasPhoto(s)) {
      for (const k of PHOTO_FIELDS) if (k in s) d[k] = s[k];
      photo = 'taken from ' + m.from;
    }
    s.venue = false;
    delete s.sessions;
    delete s.programme_text;
    s.merged_into = d.tag_id || m.into;
    out.push({ from: m.from, into: m.into, fromId: s.tag_id, intoId: d.tag_id, sessions: d.sessions.length, photo, apart: Math.round(EV.metres(src.geometry.coordinates, dst.geometry.coordinates)), why: m.why });
  }
  return out;
}

/* A place put right by hand, listed in deploy/events/<slug>.json under
   "placeFixes" (older files: "pinFixes") and found by its tag_id. Any of:
     "lng", "lat"   the pin moved there
     "set"          { column: value } written over what the tags say
     "photo"        { "file", "credit", "link" }: a picture kept beside the
                    deploy/events/<slug>/ fixes, copied next to the atlas's
                    data, shown with its credit in place of the tag's own
   Applied again on every refresh, since a fresh upload brings the tags back
   as they were tagged. */
export function applyPinFixes(gj, fixes) {
  const out = [];
  for (const fx of fixes || []) {
    const f = (gj.features || []).find((x) => x.properties && x.properties.tag_id === fx.tag_id);
    if (!f) { out.push({ name: fx.name, missing: true }); continue; }
    const p = f.properties;
    const r = { name: fx.name, place: p.loka_name, source: fx.source };
    if (Number.isFinite(fx.lng) && Number.isFinite(fx.lat)) {
      r.from = f.geometry.coordinates.slice();
      r.to = [fx.lng, fx.lat];
      r.moved = Math.round(EV.metres(r.from, r.to) * 10) / 10;
      f.geometry.coordinates = r.to;
      if ('longitude' in p) p.longitude = fx.lng;
      if ('latitude' in p) p.latitude = fx.lat;
    }
    if (fx.set && typeof fx.set === 'object') {
      r.set = [];
      for (const [k, v] of Object.entries(fx.set)) {
        if (String(p[k] == null ? '' : p[k]) !== String(v)) r.set.push(k + ': "' + (p[k] == null ? '' : p[k]) + '" → "' + v + '"');
        p[k] = v;
      }
    }
    if (fx.photo && fx.photo.file) {
      for (const k of ['photo_urls', 'photo_1_url', 'photo_2_url', 'thumbnail_url', 'image_urls']) if (k in p) p[k] = '';
      p.photo_file = fx.photo.file;
      p.photo_credit = fx.photo.credit || '';
      p.photo_credit_link = fx.photo.link || '';
      if ('photo_count' in p) p.photo_count = '1';
      r.photo = fx.photo.file;
    }
    out.push(r);
  }
  return out;
}

export function osmKinds(mode) {
  const kinds = [];
  for (const c of mode.categories || []) for (const k of c.osm || []) if (!kinds.includes(k)) kinds.push(k);
  return kinds;
}
/* One statement per venue: Overpass reads several points in one `around` as
   a line through them, not as several circles. Named places only is applied
   after, so the count of unnamed ones can be reported. */
/* Which OpenStreetMap key each kind lives under; a kind not listed here is
   an amenity (restaurant, cafe, toilets, marketplace, place_of_worship…). */
export const KIND_KEY = {
  bus_stop: 'highway', beach: 'natural',
  viewpoint: 'tourism', attraction: 'tourism', museum: 'tourism', gallery: 'tourism',
  park: 'leisure', garden: 'leisure', monument: 'historic', memorial: 'historic',
};
export function overpassQuery(points, radius, kinds) {
  const byKey = {};
  for (const k of kinds) (byKey[KIND_KEY[k] || 'amenity'] = byKey[KIND_KEY[k] || 'amenity'] || []).push(k);
  const parts = [];
  for (const [lng, lat] of points) {
    const at = `(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})`;
    for (const [key, ks] of Object.entries(byKey)) {
      // a bus stop is a point on the road; anything else may be drawn as an area
      parts.push(`${key === 'highway' ? 'node' : 'nwr'}["${key}"~"^(${ks.join('|')})$"]${at};`);
    }
  }
  return `[out:json][timeout:90];\n(\n${parts.join('\n')}\n);\nout center tags;`;
}
/* Mirrors can lag: on 22 Oct 2026 one answered with OpenStreetMap as it was
   on 24 July. An answer more than FRESH_DAYS old is kept only if no mirror
   has a fresher one; the report says how old the data is either way. */
export const FRESH_DAYS = 7;
export function ageDays(data, now = Date.now()) {
  const t = Date.parse((data && data.osm3s && data.osm3s.timestamp_osm_base) || '');
  return Number.isFinite(t) ? (now - t) / 86400000 : Infinity;
}
export async function fetchOverpass(query, log = () => {}) {
  let best = null;
  for (const url of OVERPASS) {
    const got = await askMirror(url, query, log);
    if (!got) continue;
    const age = ageDays(got.data);
    if (age <= FRESH_DAYS) return got;
    log('    its data is ' + Math.round(age) + ' days old; trying the next');
    if (!best || age < ageDays(best.data)) best = got;
  }
  return best;
}
async function askMirror(url, query, log) {
  try {
    log('  asking ' + url.split('/')[2] + ' …');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'LOKA-Atlas event mode (loka.place)' },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) { log('    answered ' + r.status); return null; }
    const data = await r.json();
    if (!Array.isArray(data.elements)) { log('    answered without places'); return null; }
    return { data, mirror: url };
  } catch (e) {
    log('    failed: ' + (e && e.message));
    return null;
  }
}

// the first kind the mode asks for that this place is, key by key
const KEY_ORDER = ['amenity', 'highway', 'natural', 'tourism', 'leisure', 'historic'];
function kindOf(tags, wanted) {
  if (!tags) return null;
  for (const key of KEY_ORDER) {
    const v = tags[key];
    if (v && (KIND_KEY[v] || 'amenity') === key && (!wanted || wanted.includes(v))) return v;
  }
  return null;
}
/* "Architectural significance" read from the data (Fable's rule, Mithun's
   yes, 23 Oct 2026): a place listed under a category's `notableOnly` kinds
   (a church or temple) comes in only with a Wikipedia or Wikidata link, a
   heritage or historic mark, or as a listed sight. A place the event team
   tags always shows; that is how a notable one the data misses gets in. */
export function isNotable(tags) {
  return !!(tags && (tags.wikipedia || tags.wikidata || tags.heritage || tags.historic || tags.tourism === 'attraction'));
}
const FAITH_WORD = { christian: 'Church', hindu: 'Temple', muslim: 'Mosque', sikh: 'Gurdwara', jain: 'Jain temple', buddhist: 'Buddhist temple' };
/* The nearby places, from what OpenStreetMap returned, category by category
   as the mode's categories say:
     - a category with `perVenue` (Eat & Drink: 8, Mithun 2026-10-22): per
       venue, the nearest that many within the radius — bars and pubs count
       within the number — and fewer if fewer exist;
     - any other (Essentials): every one within the radius of any venue;
   a category with `namedOnly` keeps named places only (a nameless restaurant
   is no use); the others call a nameless place by its kind ("Public
   toilets", "Bus stop"), since Mithun asked for all of them. Each place
   once; no opening hours (OpenStreetMap rarely has them; none are invented). */
/* `tagged`: the places the event team tagged ({ name, pt, cat, group }); an
   OpenStreetMap place standing within 100 m of one under the same sub-group
   (where the category has sub-groups) or sharing a word of its name (where
   it has none: a tagged pharmacy must not hide the toilets next door) is the
   same place twice and is left out — the team's own words win. */
function sharesWord(a, b) {
  const ws = (x) => String(x || '').toLowerCase().split(/[^a-z0-9\u00c0-\u024f]+/).filter((w) => w.length >= 4);
  const A = new Set(ws(a));
  return ws(b).some((w) => A.has(w));
}
export function buildAround(venues, data, mode, tagged = []) {
  const R = mode.aroundRadiusM || 400;
  const cats = (mode.categories || []).filter((c) => c.osm && c.osm.length);
  const catOf = Object.fromEntries(cats.map((c) => [c.id, c]));
  const seen = new Set();
  const items = [];
  let unnamed = 0;
  for (const el of (data && data.elements) || []) {
    const key = el.type + '/' + el.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = kindOf(el.tags, osmKinds(mode));
    const cat = EV.osmCategory(kind, mode);
    if (!cat) continue;
    if ((catOf[cat].notableOnly || []).includes(kind) && !isNotable(el.tags)) continue;
    const pt = el.lon != null ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
    if (!pt) continue;
    let name = String((el.tags && el.tags.name) || '').trim();
    // a public toilet or a bus stop rarely has a name, and is no less use for it
    // (Mithun, 2026-10-22: utils are all included); a nameless restaurant is no use
    if (!name && !catOf[cat].namedOnly) {
      const by = String((el.tags && (el.tags.operator || el.tags.brand)) || '').trim();
      name = EV.kindWord(kind) + (by ? ' · ' + by : '');
    }
    if (!name) { unnamed++; continue; }
    const group = EV.groupOf({ kind }, catOf[cat], true);
    if (tagged.some((t) => t.cat === cat && EV.metres(t.pt, pt) <= 100 &&
      (group ? t.group && t.group.label === group.label : sharesWord(t.name, name)))) continue;
    const d = venues.map((v) => EV.metres(v.pt, pt));
    const word = kind === 'place_of_worship' ? FAITH_WORD[String(el.tags.religion || '').toLowerCase()] || null : null;
    items.push({ key, kind, cat, pt, name, d, word });
  }
  const keep = new Map();
  const perVenue = venues.map((v) => Object.assign({ name: v.name }, Object.fromEntries(cats.map((c) => [c.id, 0]))));
  venues.forEach((v, i) => {
    for (const c of cats) {
      let mine = items.filter((it) => it.cat === c.id && it.d[i] <= R).sort((a, b) => a.d[i] - b.d[i]);
      if (c.perVenue) mine = mine.slice(0, c.perVenue);
      perVenue[i][c.id] = mine.length;
      mine.forEach((it) => keep.set(it.key, it));
    }
  });
  const features = [...keep.values()].map((it) => {
    let best = 0;
    it.d.forEach((m, i) => { if (m < it.d[best]) best = i; });
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+it.pt[0].toFixed(7), +it.pt[1].toFixed(7)] },
      properties: {
        name: it.name, kind: it.kind, ...(it.word ? { word: it.word } : {}), category: it.cat, source: 'osm', osm: it.key,
        near: venues[best].name, near_m: Math.round(it.d[best]),
      },
    };
  }).sort((a, b) => (a.properties.category + a.properties.name).localeCompare(b.properties.category + b.properties.name));
  const fc = {
    type: 'FeatureCollection',
    attribution: OSM_CREDIT + ', under the Open Database Licence (ODbL 1.0) — https://www.openstreetmap.org/copyright',
    license: 'ODbL-1.0',
    osm_data_as_of: (data && data.osm3s && data.osm3s.timestamp_osm_base) || null,
    taken_at: new Date().toISOString(),
    features,
  };
  return { fc, perVenue, unnamed };
}

// the team's own places, as buildAround wants them, to keep out doubles
export function taggedOf(gj, mode) {
  const catOf = Object.fromEntries((mode.categories || []).map((c) => [c.id, c]));
  return (gj.features || []).map((f) => {
    const cat = EV.placeCategory(f.properties, mode);
    if (!cat || cat === 'venues' || !f.geometry) return null;
    return { name: f.properties.loka_name || f.properties.name, pt: f.geometry.coordinates, cat, group: EV.groupOf(f.properties, catOf[cat], false) };
  }).filter(Boolean);
}

/* ---- the whole job, shared by both commands ---- */
function die(msg) { const e = new Error(msg); e.stop = true; throw e; }

export async function run(opts) {
  const log = opts.log || console.log;
  const { slug, apply } = opts;
  if (!slug) die('usage: node deploy/' + opts.command + ' <atlas address> [--apply]');
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) die('not an atlas address: ' + slug);
  if (NEVER.has(slug)) die(slug + ' is never touched by this script');
  const cfg = loadConfig(slug);
  if (!cfg) die('no event settings for ' + slug + ' (deploy/events/' + slug + '.json)');
  const dir = atlasDir(slug);
  if (!dir) die('no atlas called ' + slug + ' here');
  const localFile = path.join(dir, 'manifest.local.json');
  if (!fs.existsSync(localFile)) die('this atlas has no places of its own (no manifest.local.json)');
  const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
  if (opts.requireMode && !(local.mode && local.mode.name === 'event')) {
    die('this atlas is not in event mode yet — run deploy/apply-event-mode.mjs ' + slug + ' first');
  }
  const mode = Object.assign({}, cfg.mode);
  const picked = pickLayer(local, cfg, dir);
  if (!picked) die('could not find the layer holding the venues');
  const { layer, gj } = picked;

  log(apply ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write');
  log('Atlas:   ' + slug + '  (' + dir + ')');
  log('Places:  layer "' + layer.id + '", ' + layer.source + ', ' + (gj.features || []).length + ' places');

  let fullTexts = null;
  if (opts.fullText) {
    if (!fs.existsSync(opts.fullText)) die('no such file: ' + opts.fullText);
    fullTexts = readFullTexts(opts.fullText, cfg.programmeFrom);
    log('Programmes: the whole text from ' + opts.fullText + ' (' + fullTexts.size + ' places with one)');
  }
  const venues = deriveVenueFields(gj, cfg, mode, fullTexts);
  const fixes = applyPinFixes(gj, cfg.placeFixes || cfg.pinFixes);
  const merges = applyMerges(gj, cfg.merges);
  for (const mg of merges) {
    if (mg.missing) continue;
    const i = venues.findIndex((v) => v.tag_id === mg.fromId);
    const from = i >= 0 ? venues.splice(i, 1)[0] : {};
    const dst = gj.features.find((f) => f.properties.tag_id === mg.intoId);
    venues.push(Object.assign({}, from, { name: dst.properties.loka_name || mg.into, tag_id: mg.intoId, byQuestion: true, mergedFrom: mg.from }));
  }
  // the venues' points AFTER any pin is put right, so "nearby" is near the right spot
  for (const v of venues) {
    const f = gj.features.find((x) => x.properties.tag_id && x.properties.tag_id === v.tag_id);
    if (f) { v.pt = f.geometry.coordinates; v.name = f.properties.loka_name || v.name; }   // a fix may have renamed it
  }
  if (!venues.length) die('no venues found: nothing says a place is a venue');

  // OpenStreetMap, fresh unless told to keep what is there
  let around = null, osmFrom = '';
  const aroundFile = path.join(dir, mode.around || 'around.geojson');
  if (opts.osmFile) {
    around = buildAround(venues, JSON.parse(fs.readFileSync(opts.osmFile, 'utf8')), mode, taggedOf(gj, mode));
    osmFrom = 'file ' + opts.osmFile;
  } else if (opts.keepOsm) {
    if (!fs.existsSync(aroundFile)) die('--keep-osm, but there is no ' + path.basename(aroundFile) + ' to keep');
    osmFrom = 'kept as it was (' + path.basename(aroundFile) + ')';
  } else {
    log('OpenStreetMap: asking for places within ' + mode.aroundRadiusM + ' m of each venue');
    const got = await fetchOverpass(overpassQuery(venues.map((v) => v.pt), mode.aroundRadiusM, osmKinds(mode)), log);
    if (!got) die('OpenStreetMap could not be reached on any mirror. Try again in a few minutes, or add --keep-osm to refresh the programmes and keep the nearby places as they are.');
    around = buildAround(venues, got.data, mode, taggedOf(gj, mode));
    osmFrom = got.mirror.split('/')[2] + ', data as of ' + (got.data.osm3s && got.data.osm3s.timestamp_osm_base);
  }

  log('');
  log('Venues (' + venues.length + '), in the order the guide lists them:');
  const order = EV.venueOrder(gj.features.filter((f) => f.properties.venue), (f) => f.properties.loka_name || f.properties.name || '');
  let total = 0;
  order.forEach((f, i) => {
    const v = venues.find((x) => x.tag_id === f.properties.tag_id) || { sessions: 0 };
    const pv = around ? around.perVenue.find((x) => x.name === v.name) : null;
    total += v.sessions;
    log('  ' + String(i + 1).padStart(2) + '. ' + String(v.name).padEnd(30) + String(v.sessions).padStart(3) + (v.sessions === 1 ? ' session ' : ' sessions') +
      (pv ? (mode.categories || []).filter((c) => c.osm && c.osm.length).map((c) => '   ' + c.label + ' (OSM) ' + String(pv[c.id]).padStart(2)).join('') : '') +
      (v.byQuestion ? '' : '   (venue by its programme; its question answer is not "' + cfg.venueFrom.equals + '")') +
      (v.textFrom === 'export' ? '   (whole text from the export)' : '') +
      (v.differs ? '   NOTE the export and the atlas disagree on this text; used the ' + v.textFrom + "'s" : '') +
      (v.programmeText ? '   PROGRAMME SHOWN AS WRITTEN: ' + (v.unparsed.length ? 'could not read "' + v.unparsed[0] + '"' : 'said ' + v.declared + ', found ' + v.sessions) +
        (v.cut ? ' — the atlas holds only the first ' + CELL_LIMIT + ' characters; give --full-text=<the LOKA export>' : '') : ''));
  });
  log('  sessions in all: ' + total + '; programmes shown as written: ' + venues.filter((v) => v.programmeText).length);
  for (const mg of merges) {
    if (mg.missing) log('Merge:   ' + mg.from + ' → ' + mg.into + ' — NOT DONE: could not find ' + mg.missing);
    else log('Merge:   ' + mg.from + ' → ' + mg.into + ': ' + mg.sessions + ' sessions now on ' + mg.into + ', the venue; ' + mg.from + ' leaves the guide (kept in the data). Photo: ' + mg.photo + '. The two pins are ' + mg.apart + ' m apart; the venue stands at ' + mg.into + '’s.');
  }
  for (const fx of fixes) {
    if (fx.missing) log('Pin:     ' + fx.name + ' — NOT FOUND (no place with that tag_id); nothing moved');
    else {
      log('Fix:     ' + fx.place + ' (' + fx.name + ')' +
        (fx.to ? '\n         pin at ' + fx.to[1] + ', ' + fx.to[0] + (fx.moved < 1 ? ' — already there, nothing moves' : ' — moves ' + fx.moved + ' m') : '') +
        (fx.set ? (fx.set.length ? fx.set.map((x) => '\n         ' + x).join('') : '\n         words already as listed') : '') +
        (fx.photo ? '\n         photo: ' + fx.photo + (photoSrc(slug, fx.photo) ? '' : ' — MISSING from deploy/events/' + slug + '/') : '') +
        (fx.source ? '\n         source: ' + fx.source : ''));
    }
  }
  const photos = fixes.filter((fx) => fx.photo).map((fx) => fx.photo);
  for (const ph of photos) if (!photoSrc(slug, ph)) die('the photo ' + ph + ' is listed but not in deploy/events/' + slug + '/');
  if (around) {
    const by = {};
    around.fc.features.forEach((f) => { by[f.properties.kind] = (by[f.properties.kind] || 0) + 1; });
    log('Nearby:  ' + around.fc.features.length + ' places from OpenStreetMap (' + osmFrom + '): ' +
      Object.entries(by).map(([k, n]) => n + ' ' + EV.kindWord(k).toLowerCase()).join(', ') +
      (around.unnamed ? '; ' + around.unnamed + ' without a name left out' : ''));
  } else log('Nearby:  ' + osmFrom);
  const newMode = Object.assign({}, mode, { layer: layer.id });
  if (around) newMode.osmTakenAt = around.fc.taken_at;
  else if (local.mode && local.mode.osmTakenAt) newMode.osmTakenAt = local.mode.osmTakenAt;
  log('Mode:    ' + (local.mode ? 'updated' : 'switched on') + ' in manifest.local.json (layer "' + layer.id + '")');

  if (!apply) return { venues, fixes, around, total };

  if (!opts.serverIsStopped) {
    let online = false;
    try {
      const { execSync } = await import('node:child_process');
      const list = JSON.parse(execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
      online = list.some((p) => p.name === 'lokaApps' && p.pm2_env && p.pm2_env.status === 'online');
    } catch { /* no pm2 here (a local run): nothing to clash with */ }
    if (online) die('lokaApps is running: stop it first (pm2 stop lokaApps), or add --server-is-stopped');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dataDir(), 'backups', 'event-' + slug + '-' + stamp);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['manifest.local.json', layer.source, path.basename(aroundFile)].concat(photos)) {
    if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(backup, f));
  }
  log('Backup:  ' + backup);
  writeJson(path.join(dir, layer.source), gj);
  if (around) writeJson(aroundFile, around.fc);
  for (const ph of photos) fs.copyFileSync(photoSrc(slug, ph), path.join(dir, ph));
  const fresh = JSON.parse(fs.readFileSync(localFile, 'utf8'));   // the newest copy, not the one read minutes ago
  fresh.mode = newMode;
  writeJson(localFile, fresh, 1);
  log('Wrote:   ' + layer.source + (around ? ', ' + path.basename(aroundFile) : '') + photos.map((ph) => ', ' + ph).join('') + ', manifest.local.json');
  log('Done. Undo: copy the files in the backup folder back into place.');
  return { venues, fixes, around, total, backup };
}

export async function main(command, requireMode) {
  const args = process.argv.slice(2);
  const val = (name) => { const a = args.find((x) => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
  try {
    await run({
      command, requireMode,
      slug: args.find((a) => !a.startsWith('--')),
      apply: args.includes('--apply'),
      serverIsStopped: args.includes('--server-is-stopped'),
      keepOsm: args.includes('--keep-osm'),
      osmFile: val('--osm-file'),
      fullText: val('--full-text'),
    });
  } catch (e) {
    console.error('Stopped: ' + (e && e.message));
    if (!(e && e.stop)) console.error(e && e.stack);
    process.exit(1);
  }
}
