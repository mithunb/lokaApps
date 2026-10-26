/* What a place's search text and a layer's search vocabulary are made from.
   One home for it, so the server (api/apps/atlas.js) and the rebuild script
   (deploy/rebuild-search-index.mjs) read a place the same way.

   Who made a record is never searchable (25 Oct 2026). A question read from a
   column that names the person (created_by, any *_user_id) has people for
   answers, and the visitor's search used to light up a contributor's places
   when their name was typed. Such a question's answers, and those raw columns,
   are left out of the text, the vocabulary and the meaning vectors built from
   it. The test is the one the map and Insight already use
   (atlas/label-rules.js isPeopleQuestion); if that file cannot be read, every
   question column is left out rather than risk one (fails closed). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as placeNames from './place-names.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let LABEL_RULES = null;
try { LABEL_RULES = createRequire(import.meta.url)(path.join(REPO_ROOT, 'atlas', 'label-rules.js')); } catch { LABEL_RULES = null; }

// a raw column that says who made the record
export function isPeopleRawColumn(name) {
  const n = String(name == null ? '' : name).trim().toLowerCase();
  return n === 'created_by' || n === 'created_by_user_id' || /_user_id$/.test(n);
}
/* Is this column one whose values are people? A raw people column, or a
   pattern_N column whose question is about people. */
export function isPeopleColumn(stanza, col) {
  if (isPeopleRawColumn(col)) return true;
  /* The model's note on why it gave an answer ("pattern_5_why") quotes the
     place's own words, and for a question about who made the record that is
     the person's name: it goes wherever its question goes (found live on
     Bengaluru, 26 Oct 2026). */
  const why = /^(pattern_\d+)_why$/.exec(String(col));
  if (why) col = why[1];
  if (!/^pattern_\d+$/.test(String(col))) return false;
  if (!LABEL_RULES || typeof LABEL_RULES.isPeopleQuestion !== 'function') return true;   // fail closed
  try { return !!LABEL_RULES.isPeopleQuestion(stanza || {}, col); } catch { return true; }
}

/* What counts as searchable text. Enrichment writes its output (category,
   labels) into the row as ordinary properties before the layer is committed, so
   "user-submitted" and "enriched" are the same thing by the time we get here:
   index EVERY text-bearing property rather than a curated tag column. Ids,
   urls, coordinates and timestamps are excluded — they would make a stray digit
   or date match on every feature. */
export function searchSkipProp(name, stanza) {
  if (isPeopleColumn(stanza, name)) return true;
  const n = String(name == null ? '' : name).toLowerCase();
  // the short name LOKA wrote is the description's own words: counting it
  // again would weight those places twice (its place is the hit's title)
  if (n === placeNames.NAME_FIELD) return true;
  if (/(^|[^a-z])(id|ids|uuid|guid|url|uri|link|href|image|images|img|photo|photos|thumb|thumbnail|icon|lat|latitude|lon|lng|long|longitude|x|y|geom|geometry|wkt|color|colour)([^a-z]|$)/.test(n)) return true;
  return /(created|updated|modified|timestamp)/.test(n);
}
export function searchCellText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x))).join('; ');
  if (typeof v === 'object') return '';
  return String(v);
}
export function searchSkipValue(v) {
  const s = searchCellText(v).trim();
  if (s.length < 2) return true;
  if (!/[a-z]/i.test(s)) return true;                        // numbers, codes, coordinates
  if (/^(https?:|www\.|data:|\/\/)/i.test(s)) return true;   // urls
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s)) return true;  // uuids
  if (/^\d{4}-\d{2}-\d{2}[t ]/i.test(s)) return true;        // timestamps
  return false;
}
// One searchable blob per feature: what the viewer matches a raw query against.
export function featureSearchText(props, stanza) {
  const parts = [];
  for (const k in (props || {})) {
    if (searchSkipProp(k, stanza)) continue;
    const v = props[k];
    if (searchSkipValue(v)) continue;
    parts.push(searchCellText(v));
  }
  return parts.join(' · ').toLowerCase().slice(0, 4000);
}

export const SEARCH_STOP = new Set(('the a an and or of in on at to for with from by is are was were this that these those it its as be' +
  ' been near not no you your our their they he she we i but if then than so such very more most other some any all each' +
  ' one two three new near around about into over under out up down off can will just also').split(' '));
// A cell becomes either one term (a tag / short phrase) or its significant words
// (free text), so "bamboo-wall" survives whole while a sentence contributes
// "recycled", "library".
export function termsFromValue(v, out) {
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
export function layerVocabTerms(stanza, features, maxTerms) {
  const SEARCH_MAX_TERMS = maxTerms || 300;
  const tagFields = [];
  if (stanza.markerBy) tagFields.push(stanza.markerBy);
  ((stanza.popup && stanza.popup.fields) || []).forEach((f) => { if (f.type === 'tags' && f.property) tagFields.push(f.property); });
  // a tag column that holds people is never offered as vocabulary
  for (let i = tagFields.length - 1; i >= 0; i--) if (isPeopleColumn(stanza, tagFields[i])) tagFields.splice(i, 1);

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
      if (tagFields.indexOf(k) >= 0 || searchSkipProp(k, stanza) || searchSkipValue(p[k])) continue;
      termsFromValue(p[k], out);
    }
  });
  const quota = Math.round(SEARCH_MAX_TERMS * SEARCH_TAG_QUOTA);
  const merged = tagged.slice(0, quota).concat(free.slice(0, SEARCH_MAX_TERMS - Math.min(tagged.length, quota)));
  // room left over (few free-text terms) goes back to the tag column
  return merged.concat(tagged.slice(quota)).slice(0, SEARCH_MAX_TERMS);
}


/* Every term that came from a people column of this layer. The search route
   takes these out of what it returns, so an index written before this rule
   (with names in it) never shows one. */
export function peopleTerms(stanza, features) {
  const set = new Set();
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    for (const k in p) {
      if (!isPeopleColumn(stanza, k)) continue;
      const out = [];
      termsFromValue(p[k], out);
      for (const t of out) set.add(t);
    }
  }
  return set;
}

/* The standing rule: the deoria-bioregion atlas is never written to. Matches a
   dataset name or a folder path, in any case, and the folder a link points to. */
export function isNeverTouched(nameOrPath) {
  const s = String(nameOrPath == null ? '' : nameOrPath);
  if (s.toLowerCase().indexOf('deoria-bioregion') >= 0) return true;
  if (s.indexOf('/') >= 0) {
    try { return fs.realpathSync(s).toLowerCase().indexOf('deoria-bioregion') >= 0; } catch { /* not there */ }
  }
  return false;
}

/* The search route's last check on a word it is about to offer as a tag: not
   one that came from a people column, even if an old index still holds it. */
export function keepTag(term, ofPeople) {
  return !!term && !(ofPeople && ofPeople.has(String(term)));
}
/* The vocabulary of an index entry (old or new) with people taken out. */
export function tagTerms(entry, ofPeople) {
  return ((entry && entry.terms) || []).map((t) => String((t && t.t) || '')).filter((t) => keepTag(t, ofPeople));
}

/* Which saved versions of a layer's meaning file and words are still trusted.
   Others must be rebuilt, because the text they were built from still held
   people. Deoria is never rebuilt (standing rule), so what it has is used as it
   is; the route's people filter still applies to its tags. */
export function vecVersionOk(version, current, dirOrDataset) {
  return version === current || (isNeverTouched(dirOrDataset) && version === 1);
}
export function indexVersionOk(version, current, dataset) {
  return version === current || (isNeverTouched(dataset) && typeof version === 'number');
}
