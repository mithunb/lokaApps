/* A short name for every long column heading, decided once per layer and
   stored with it.

   A spreadsheet's heading can be a whole survey question — "What languages do
   you primarily work in? Feel free to mention all if there is more than one."
   — and that heading is the name of a key, a card's field, a legend's line.
   atlas/label-rules.js has the plain-code cut that every page applies on its
   own ("Languages"), so nothing waits on this. This file is the better name:
   the model is asked once per layer, for all its long headings at once, and
   the answer is written onto the layer's stanza as

       shortLabels: { "<heading>": "<short name>" }

   where the viewer finds it beside keyLabels. A name the owner gave by hand
   (keyLabels) always wins over both and is never asked about.

   It is the same waiting list as the questions (questions-queue.js), kept in
   its own file: once per version of a layer's headings, one at a time on the
   whole server, written to disk so a restart carries on, charged to the atlas
   owner's hourly allowance as a reading is. The fingerprint is of the long
   headings alone, so re-uploading the same columns with different rows costs
   nothing, and the names found are kept on the list's own record as well as
   on the layer — a re-commit that rebuilds the stanza gets them put back
   without a second call.

   Nothing here talks to the model. What a call looks like is decided in
   api/apps/atlas.js (shortLabelsJob), which hands the prompt and the schema
   made here to the same budgeted caller a reading uses. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createQueue, NEVER_READ } from './questions-queue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* The same folder registry.js keeps its files in, worked out here rather than
   imported, for the reason questions-queue.js gives: the one-off script must
   be able to load this without starting anything. */
const DATA_DIR = path.join(HERE, '..', '..', 'data', 'atlas');
export const LABELS = createRequire(import.meta.url)(path.join(HERE, '..', '..', '..', 'atlas', 'label-rules.js'));

export function createShortLabelsQueue(opts = {}) {
  return createQueue({ file: opts.file || path.join(DATA_DIR, 'short-labels.json') });
}
export const queue = createShortLabelsQueue();

/* The columns of these rows, as a spreadsheet would list them. The server
   writes a blank for every column on every place, so the first few rows see
   them all; the union is taken in case a column arrived on a later row only. */
export function columnsOf(rows) {
  const seen = [];
  for (const r of (rows || []).slice(0, 25)) {
    for (const k of Object.keys(r || {})) if (seen.indexOf(k) < 0) seen.push(k);
  }
  return seen;
}

/* The headings a short name is wanted for: long, a label, and not already
   named by the owner. */
export function headingsWanting(layer, rows) {
  const given = (layer && layer.keyLabels) || {};
  return LABELS.longHeadingsOf(columnsOf(rows)).filter((h) => !given[h]);
}

/* The fingerprint of a layer's long headings — what the list is keyed on. */
export function headingSig(headings) {
  return crypto.createHash('sha1').update(headings.slice().sort().join('\u0001')).digest('hex').slice(0, 20);
}

/* Does the layer already carry an acceptable stored name for every heading? */
export function hasNamesFor(layer, headings) {
  const have = (layer && layer.shortLabels) || {};
  return headings.every((h) => LABELS.acceptableShort(have[h], h));
}

/* The plain-code names, the same ones the viewer would work out itself. */
export function fallbackNames(headings) {
  const out = {};
  for (const h of headings) out[h] = LABELS.shortHeading(h);
  return out;
}

/* What the model is asked. One call for the whole layer. The rules it is
   given are the rules label-rules.js keeps for the plain cut, so a name from
   either source reads the same way: the heading's own words, no new meaning,
   the heading's own language, at most SHORT_MAX characters. */
export function promptFor(headings, title) {
  return [
    'These are column headings from a spreadsheet of places' + (title ? ' for a map called "' + title + '"' : '') + '.',
    'Each is too long to be a label. Give each one a short name to print instead.',
    'Rules: at most 4 words and at most ' + LABELS.SHORT_MAX + ' characters. Plain words a reader with no',
    'background would understand. Use the heading\'s own words where you can and never add a meaning',
    'the heading does not have. Keep the heading\'s language: a Hindi heading gets a Hindi name.',
    'Drop the asking words ("What is your…", "Please select all that apply"), the examples in brackets,',
    'and the form\'s instructions. Keep proper nouns as they are written. Do not end with a question mark',
    'unless the short name is itself a question. Answer for every heading, in the same order.',
    JSON.stringify({ headings }),
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
          required: ['heading', 'short'],
          properties: { heading: { type: Type.STRING }, short: { type: Type.STRING } },
        },
      },
    },
  };
}

/* The model's answer, checked heading by heading. A name that breaks the
   rules (too long, empty, the heading again) is replaced by the plain cut, so
   the layer always ends up with a name for every heading it asked about. */
export function cleanNames(answer, headings) {
  const said = {};
  for (const n of (answer && Array.isArray(answer.names)) ? answer.names : []) {
    if (n && typeof n.heading === 'string') said[n.heading.trim()] = n.short;
  }
  // the model may tidy the heading's spaces; match loosely on the way back
  const loose = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const byLoose = {};
  for (const k of Object.keys(said)) byLoose[loose(k)] = said[k];
  const out = {};
  let fromModel = 0;
  for (const h of headings) {
    const raw = said[h] !== undefined ? said[h] : byLoose[loose(h)];
    const ok = LABELS.acceptableShort(raw, h);
    if (ok) { out[h] = ok; fromModel += 1; } else out[h] = LABELS.shortHeading(h);
  }
  return { names: out, fromModel };
}

/* Write the names onto the layer's stanza in manifest.local.json — the one
   place the viewer reads them from — touching nothing else in the file. */
export function writeNames(dir, layerId, names, by) {
  const file = path.join(dir, 'manifest.local.json');
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const layer = (local.layers || []).find((L) => L.id === layerId);
  if (!layer) return false;
  layer.shortLabels = names;
  layer.shortLabelsBy = by;    // "model" or "stand-in"; a plain cut is never written, the viewer makes its own
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 1));
  fs.renameSync(tmp, file);
  return true;
}

/* Should this layer be asked for short names, now that it has just been
   written? Answers a word saying what was done.

     never      — the operator's own atlas (NEVER_READ)
     none       — no long heading without an owner's name: nothing to ask
     has them   — the layer already carries a name for every long heading
     put back   — the list had this version's names; written on again, no call
     queued     — on the list; the server asks within a minute
     not queued — already waiting or being asked for this version */
export function consider({ dataset, layerId, layer, rows, dir, payer, q }) {
  const Q = q || queue;
  if (NEVER_READ.has(dataset)) return 'never';
  const headings = headingsWanting(layer, rows);
  if (!headings.length) return 'none';
  if (hasNamesFor(layer, headings)) return 'has them';
  const sig = headingSig(headings);
  const had = Q.get(dataset, layerId);
  if (had && had.sig === sig && had.names && (had.state === 'done')) {
    const { names } = cleanNames({ names: Object.entries(had.names).map(([heading, short]) => ({ heading, short })) }, headings);
    if (dir && writeNames(dir, layerId, names, had.by || 'model')) return 'put back';
  }
  return Q.offer({ dataset, layerId, sig, payer: payer || '' }) ? 'queued' : 'not queued';
}
