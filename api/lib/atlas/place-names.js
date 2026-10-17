/* A short name for every place whose only name is a sentence.

   A layer exported from the LOKA tagging app has no name column, only the
   tagger's own words ("description"). Beside a pin, in a search hit and at
   the top of a card that is half a sentence: on Cubbon Park 19 of 33
   descriptions run past 32 characters, on Bengaluru on LOKA 107 of 134. The
   atlas cannot invent a name, but it can write one out of the words that are
   there — "Wonder how deep this Ant Mansion is?" is a place called "Ant
   Mansion" — and that is what this does, for any layer whose chosen naming
   column is long for more than half its places.

   What is written, and where:

     - a NEW column on every feature, NAME_FIELD ("loka_name"). The column it
       was made from is never touched: that is the data-enrichment rule. A
       short description (at most NAME_MAX characters) is copied as it is and
       never sent anywhere; a long one gets a name from the model, checked, or
       the plain cut (label-rules firstWords) when there is no model's name
       yet or the model's name broke a rule.
     - on the stanza: popup.title = NAME_FIELD, so the pin, the card and
       search follow it (relabelLayer, label_text); and `lokaNames` saying
       which column the names come from, whether they are the model's or the
       first words standing in, and how many places are still waiting.

   The rules the model is given, and the server checks every answer against:
   only words from the description (joining words may be added), at most
   MAX_WORDS words and NAME_MAX characters, the tagger's language, voice and
   spelling, never a fact, species, place or judgement that is not there, and
   "no fair name" rather than invent. An answer that fails falls back to the
   plain cut. Nothing here talks to the model: api/apps/atlas.js
   (placeNamesJob) hands the prompt and schema made here to the same budgeted
   caller a reading uses, one call per PER_CALL long places, at most
   CALLS_PER_HOUR calls per job per hour; the rest wait for the next hour
   (questions-queue notBefore).

   Each name is kept on the list's own record under a fingerprint of its
   description (descHash), so a re-upload keeps every unchanged place's name
   and asks only about new or changed ones, and a re-commit that rebuilds the
   stanza gets them put back for nothing. The column is left out of a layer's
   reading fingerprint (reading-rules isAnswerColumn), so writing names never
   triggers a question reading. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createQueue, NEVER_READ } from './questions-queue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the same folder registry.js keeps its files in (see short-labels.js for why it is not imported)
const DATA_DIR = process.env.LOKA_DATA_DIR || path.join(HERE, '..', '..', 'data', 'atlas');
const LABELS = createRequire(import.meta.url)(path.join(HERE, '..', '..', '..', 'atlas', 'label-rules.js'));

export const NAME_FIELD = LABELS.NAME_FIELD;      // "loka_name"
export const NAME_MAX = LABELS.NAME_MAX;          // 32 characters
export const MAX_WORDS = 4;
export const PER_CALL = 40;                        // long places per call to the model
export const CALLS_PER_HOUR = 24;                  // per job; the rest wait for the next hour
export const NO_NAME = 'no fair name';
export const firstWords = LABELS.firstWords;

export function createPlaceNamesQueue(opts = {}) {
  return createQueue({ file: opts.file || path.join(DATA_DIR, 'place-names.json') });
}
export const queue = createPlaceNamesQueue();

/* ---------- the words ---------- */

export function clean(v) {
  if (v === null || v === undefined || typeof v === 'object') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return (s === 'null' || s === 'undefined') ? '' : s;
}
export function isLong(text) { return clean(text).length > NAME_MAX; }

/* The fingerprint of one description — what a name is kept under. */
export function descHash(text) {
  return crypto.createHash('sha1').update(clean(text).toLowerCase()).digest('hex').slice(0, 16);
}

/* Joining words the model may add: nothing else may be. */
const JOINERS = new Set(('a an the of for and or in on at to with by from as its it is are was were ' +
  'this that these those into onto over under near beside between').split(' '));

/* A word as it is compared: lower case, accents kept, the punctuation round
   it dropped, commas out of numbers ("1,300" is "1300"). */
function wordKey(w) {
  return String(w).toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
export function wordsOf(text) {
  return clean(text).split(' ').map(wordKey).filter(Boolean);
}
/* The forms of a description's word a name may use: the word, its possessive
   and plain forms ("Hebbal", "Hebbal's"; "trees", "tree"), and each part of
   a hyphenated word. A name is the tagger's words, not the tagger's grammar. */
function allowedForms(words) {
  const out = new Set();
  const add = (w) => {
    if (!w) return;
    out.add(w);
    if (/'s$/.test(w)) out.add(w.slice(0, -2)); else out.add(w + "'s");
    if (/’s$/.test(w)) out.add(w.slice(0, -2));
    if (/s$/.test(w) && w.length > 3) out.add(w.slice(0, -1)); else out.add(w + 's');
  };
  for (const w of words) {
    add(w);
    if (w.indexOf('-') > 0) w.split('-').forEach(add);
  }
  return out;
}

/* The model's answer for one place, checked against the rules. Answers the
   name to keep, or "" when it breaks a rule (and the plain cut stands in):
   empty, "no fair name", over NAME_MAX characters, over MAX_WORDS words, or
   any word that is neither the description's nor a joining word. */
export function checkName(name, description) {
  const s = clean(name);
  if (!s) return '';
  if (s.toLowerCase().replace(/[.!?]+$/, '') === NO_NAME) return '';
  if (s.length > NAME_MAX) return '';
  const words = s.split(' ');
  if (words.length > MAX_WORDS) return '';
  const allowed = allowedForms(wordsOf(description));
  for (const w of words) {
    const k = wordKey(w);
    if (!k) continue;                       // a lone punctuation mark says nothing
    if (JOINERS.has(k) || allowed.has(k)) continue;
    // a word with punctuation inside ("trees—fungi"): each part must be the tagger's
    const parts = k.split(/[^\p{L}\p{N}'’]+/u).filter(Boolean);
    if (parts.length > 1 && parts.every((p) => JOINERS.has(p) || allowed.has(p))) continue;
    return '';
  }
  return s;
}

/* ---------- which layers, and what they are missing ---------- */

/* How long the chosen column is across these places: the trigger is
   "longer than NAME_MAX for more than half its places". */
export function countLong(rows, col) {
  let filled = 0, long = 0;
  for (const r of rows || []) {
    const v = clean((r || {})[col]);
    if (!v) continue;
    filled += 1;
    if (v.length > NAME_MAX) long += 1;
  }
  return { total: (rows || []).length, filled, long };
}
export function wantsNames(rows, col) {
  if (!col || col === NAME_FIELD) return false;
  const c = countLong(rows, col);
  return c.long > 0 && c.long > c.total / 2;
}

/* The column the names come from: what the stanza says, else the layer's own
   naming column when it is not the written one. */
export function sourceColumnOf(layer, spec) {
  const L = layer || {};
  if (L.lokaNames && L.lokaNames.from) return L.lokaNames.from;
  if (spec && spec.placeNamesFrom) return spec.placeNamesFrom;
  const t = (L.popup && L.popup.title) || (spec && spec.popupTitleColumn) || '';
  return t && t !== NAME_FIELD ? t : '';
}

/* The long places with no kept name yet, one entry per distinct description,
   in the shape the model is asked about. A kept "" means the model was asked
   and had no fair name, so the place keeps its first words and is not asked
   again. */
export function wanting(rows, col, kept) {
  const have = kept || {};
  const out = [], seen = new Set();
  for (const r of rows || []) {
    const text = clean((r || {})[col]);
    if (!text || text.length <= NAME_MAX) continue;
    const key = descHash(text);
    if (seen.has(key) || have[key] !== undefined) continue;
    seen.add(key);
    out.push({ key, text });
  }
  return out;
}

/* The name of every place, from what is kept: a short description as it
   is, a kept model name, else the first words. Also how many are still
   waiting for the model and how many the model named. */
export function namesFor(rows, col, kept) {
  const have = kept || {};
  const values = [];
  let waiting = 0, fromModel = 0, long = 0;
  for (const r of rows || []) {
    const text = clean((r || {})[col]);
    if (!text) { values.push(''); continue; }
    if (text.length <= NAME_MAX) { values.push(text); continue; }
    long += 1;
    const k = have[descHash(text)];
    if (typeof k === 'string' && k) { values.push(k); fromModel += 1; }
    else {
      if (k === undefined) waiting += 1;
      values.push(firstWords(text));
    }
  }
  return { values, waiting, fromModel, long, total: (rows || []).length };
}

/* Write the names onto the features themselves (NAME_FIELD only; nothing
   else on a feature is touched). Answers the counts. */
export function applyNames(feats, col, kept) {
  const rows = (feats || []).map((f) => (f && f.properties) || {});
  const got = namesFor(rows, col, kept);
  (feats || []).forEach((f, i) => {
    if (!f) return;
    f.properties = f.properties || {};
    f.properties[NAME_FIELD] = got.values[i];
  });
  return got;
}

/* The fingerprint of what a job is for: the column and the long
   descriptions in it. The same places again are the same job. */
export function sigFor(rows, col) {
  const keys = [];
  for (const r of rows || []) {
    const text = clean((r || {})[col]);
    if (text.length > NAME_MAX) keys.push(descHash(text));
  }
  return crypto.createHash('sha1').update(col + '\u0001' + keys.sort().join('\u0002')).digest('hex').slice(0, 20);
}

/* ---------- what the model is asked ---------- */

export function promptFor(items, col, title) {
  return [
    'These are the "' + col + '" entries of places on a map' + (title ? ' called "' + title + '"' : '') + ',',
    'written by the people who tagged them. Each is too long to be a name. Give each place a short name.',
    'Rules, all of them:',
    '- Use only words that are in the entry. Joining words (a, the, of, for, and) may be added; nothing else.',
    '- At most ' + MAX_WORDS + ' words and at most ' + NAME_MAX + ' characters.',
    '- Keep the tagger\'s language, voice and spelling: a Kannada entry gets a Kannada name, "Bifurcatree" stays "Bifurcatree".',
    '- Never add a fact, a species, a place or a judgement the entry does not state.',
    '- If no fair name can be made from the entry\'s own words, answer exactly "' + NO_NAME + '".',
    'Answer for every key, in the same order.',
    JSON.stringify({ places: items.map((it) => ({ key: it.key, text: it.text })) }),
  ].join('\n');
}

export function schemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['names'],
    properties: {
      names: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['key', 'name'],
          properties: { key: { type: Type.STRING }, name: { type: Type.STRING } },
        },
      },
    },
  };
}

/* The model's answer, checked place by place. Answers what to keep: a name
   that passed, or "" for one the model declined or that broke a rule (the
   first words stand in, and it is not asked again). A key the model left
   out is not kept, so it is asked once more next time. */
export function cleanAnswer(answer, items) {
  const said = {};
  for (const n of (answer && Array.isArray(answer.names)) ? answer.names : []) {
    if (n && typeof n.key === 'string') said[n.key.trim()] = n.name;
  }
  const names = {};
  let fromModel = 0, declined = 0;
  for (const it of items) {
    if (said[it.key] === undefined) continue;
    const ok = checkName(said[it.key], it.text);
    names[it.key] = ok;
    if (ok) fromModel += 1; else declined += 1;
  }
  return { names, fromModel, declined };
}

/* The stand-in's answer, for a machine with no model (ATLAS_FAKE_READING):
   the first words that fit the rules — at most MAX_WORDS of them, under
   NAME_MAX, no ellipsis — so the whole road runs, check included. */
export function standInAnswer(items) {
  return { names: items.map((it) => {
    const words = firstWords(it.text).replace(/…$/, '').split(' ').slice(0, MAX_WORDS);
    // a trailing joining word says nothing on its own
    while (words.length > 1 && JOINERS.has(wordKey(words[words.length - 1]))) words.pop();
    const name = words.join(' ').replace(/[\s,;:(–—-]+$/, '');
    return { key: it.key, name: name.length <= NAME_MAX && name ? name : NO_NAME };
  }) };
}

/* ---------- writing ---------- */

function writeJSON(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/* The stanza, switched on: the written column names each place, the pin's
   name follows it, and the stanza says where the names came from. The same
   rules imports.relabelLayer applies when an owner picks a column, kept
   here so the one-off script and the job need nothing that starts the
   server. */
export function markStanza(layer, { from, by, waiting, long, total, anyNamed }) {
  layer.popup = layer.popup || {};
  layer.popup.title = NAME_FIELD;
  if (layer.popup.titleAlso === NAME_FIELD || layer.popup.titleAlso === from) delete layer.popup.titleAlso;
  if (layer.popup.fields) layer.popup.fields = layer.popup.fields.filter((f) => f && f.property !== NAME_FIELD);
  if (layer.spec && typeof layer.spec === 'object') {
    layer.spec.popupTitleColumn = NAME_FIELD;
    layer.spec.placeNamesFrom = from;
    if (layer.spec.popupTitleAlso === NAME_FIELD || layer.spec.popupTitleAlso === from) delete layer.spec.popupTitleAlso;
  }
  /* A written name is at most NAME_MAX already, so the map's own cut beside a
     pin (maxChars, 28 on some older stanzas) is set to the same number: a
     name made to fit is never cut again. */
  if (layer.type === 'fill' || layer.type === 'polygon') {
    layer.label_text = Object.assign({}, layer.label_text || {}, { property: NAME_FIELD });
  } else if (layer.type === 'marker') {
    if (anyNamed) layer.label_text = Object.assign({}, layer.label_text || {}, { property: NAME_FIELD, maxChars: NAME_MAX });
    else delete layer.label_text;
  } else if (layer.label_text && layer.label_text.property) {
    layer.label_text.property = NAME_FIELD;
  }
  layer.lokaNames = { from, by: waiting ? 'first words' : by, waiting, long, total, at: Date.now() };
  return layer;
}

/* The owner chose another column: the stanza stops saying the names are
   LOKA's. The column stays on the features (it is the machinery's, left out
   of everything) so switching back costs nothing. */
export function unmarkStanza(layer) {
  delete layer.lokaNames;
  if (layer.spec && typeof layer.spec === 'object') delete layer.spec.placeNamesFrom;
  return layer;
}

/* Names onto the layer's file (the path the manifest names) and the stanza
   onto manifest.local.json, touching nothing else in either. Answers the
   counts, or null when the layer or its file is gone. */
export function writeNames(dir, layerId, { from, kept, by }) {
  const file = path.join(dir, 'manifest.local.json');
  let local;
  try { local = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const layer = (local.layers || []).find((L) => L.id === layerId);
  if (!layer || !layer.source) return null;
  const gjFile = path.join(dir, layer.source);
  let gj;
  try { gj = JSON.parse(fs.readFileSync(gjFile, 'utf8')); } catch { return null; }
  const got = applyNames(gj.features || [], from, kept);
  writeJSON(gjFile, gj);
  markStanza(layer, { from, by, waiting: got.waiting, long: got.long, total: got.total,
    anyNamed: got.values.some(Boolean) });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 1));
  fs.renameSync(tmp, file);
  return got;
}

/* ---------- the list ---------- */

/* What a layer's record says, for the owner's page: whether names are still
   being written, and for how many places. */
export function stateFor(layer, record) {
  const L = layer || {};
  if (!L.lokaNames) return null;
  const r = record || {};
  const busy = r.state === 'queued' || r.state === 'running';
  return { from: L.lokaNames.from, by: L.lokaNames.by, waiting: L.lokaNames.waiting || 0,
    long: L.lokaNames.long || 0, total: L.lokaNames.total || 0,
    state: busy ? 'writing' : (r.state === 'failed' ? 'failed' : 'done'),
    reason: r.reason || '' };
}

/* Should this layer be on the list, now that it has just been written?
   Answers a word saying what was done.

     never        — the operator's own atlas (NEVER_READ)
     none         — no naming column, or not long for more than half its places
     switched off — the owner chose another column; left alone
     has them     — every long place has the model's name (or its answer)
     queued       — on the list; the server names them within a minute
     not queued   — already waiting or being named for this version

   `write` is called first whenever the file does not yet carry the written
   column, or the stanza does not name it: the stand-in goes on at once, so
   the owner never waits to see a name. */
export function consider({ dataset, layerId, layer, rows, dir, payer, spec, q }) {
  const Q = q || queue;
  if (NEVER_READ.has(dataset)) return 'never';
  const had = Q.get(dataset, layerId);
  if (had && had.off) return 'switched off';
  const from = sourceColumnOf(layer, spec) || (had && had.from) || '';
  if (!from || !wantsNames(rows, from)) return 'none';
  const kept = (had && had.names) || {};
  const sig = sigFor(rows, from);
  const on = layer && layer.popup && layer.popup.title === NAME_FIELD && layer.lokaNames;
  const carried = (rows || []).every((r) => r && r[NAME_FIELD] !== undefined);
  let got = namesFor(rows, from, kept);
  if (dir && (!on || !carried)) {
    const by = got.fromModel ? ((had && had.by) || 'model') : 'first words';
    got = writeNames(dir, layerId, { from, kept, by }) || got;
  }
  if (!got.waiting) {
    if (!(had && had.sig === sig && had.state === 'done')) {
      Q.remember(dataset, layerId, { sig, state: 'done', reason: '', from, names: kept, by: (had && had.by) || 'model' });
    }
    return 'has them';
  }
  return Q.offer({ dataset, layerId, sig, payer: payer || '' }) ? 'queued' : 'not queued';
}
