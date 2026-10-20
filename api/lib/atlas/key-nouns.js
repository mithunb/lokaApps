/* The noun each question's heading reads "Explore by …" with, for questions
   that were found before the reading picked one ("version D", Mithun, October
   2026).

   Since then, the reading picks the noun in the same call that finds the
   question (enrich.js NOUN_RULE), and the owner's own question gets one in the
   call that works out its answers. A question found before that has none, and
   its row shows the question as written, which works. This is how those get a
   noun: one small call per layer, for all of its questions at once, stored on
   the layer beside keyLabels as

       keyNouns: { "pattern_1": "function" }

   Every noun is checked before it is stored (atlas/label-rules.js
   nounFromQuestion): every word must be a word of the question. A noun that
   fails is not stored, and that question keeps its own wording as its heading.

   It is the same waiting list as the questions (questions-queue.js), in its own
   file, put on only by the one-off script (deploy/queue-key-nouns.mjs): one at
   a time on the whole server, written to disk so a restart carries on, charged
   to the atlas owner's hourly allowance as a reading is. Nothing here talks to
   the model; api/apps/atlas.js (keyNounsJob) makes the call. */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createQueue } from './questions-queue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// the folder registry.js keeps its files in (short-labels.js says why it is worked out here)
const DATA_DIR = path.join(HERE, '..', '..', 'data', 'atlas');
export const LABELS = createRequire(import.meta.url)(path.join(HERE, '..', '..', '..', 'atlas', 'label-rules.js'));

export function createKeyNounsQueue(opts = {}) {
  return createQueue({ file: opts.file || path.join(DATA_DIR, 'key-nouns.json') });
}
export const queue = createKeyNounsQueue();

const isQuestionColumn = (c) => /^pattern_\d+$/.test(String(c));

/* The questions on this layer that want a noun: a question's own wording,
   no noun stored for it, and not a yes-or-no question (which keeps its own
   wording as its heading whatever a model says). In the layer's own order. */
export function questionsWanting(layer) {
  const labels = (layer && layer.keyLabels) || {};
  const have = (layer && layer.keyNouns) || {};
  return Object.keys(labels)
    .filter(isQuestionColumn)
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))
    .filter((c) => typeof labels[c] === 'string' && labels[c].trim())
    .filter((c) => !LABELS.nounFromQuestion(have[c], labels[c]))
    .filter((c) => !LABELS.isYesNo(labels[c]))
    .map((c) => ({ col: c, question: labels[c].trim() }));
}

// the fingerprint of the questions asked about — what the list is keyed on
export function questionsSig(wanting) {
  return crypto.createHash('sha1')
    .update(wanting.map((w) => w.col + '\u0002' + w.question).join('\u0001'))
    .digest('hex').slice(0, 20);
}

/* What the model is asked. One call for the whole layer. The rule is the
   reading's own (enrich.js NOUN_RULE), said for a list. */
export function promptFor(wanting, title) {
  return [
    'These are questions a map' + (title ? ' called "' + title + '"' : '') + ' asks of its places.',
    'Each becomes a heading on the map that reads "Explore by" and then a few words.',
    'For each question give those words: the word, or the few words (at most four), copied from the',
    'question itself that name what it sorts places by. Copy them exactly as the question has them;',
    'add no word that is not in the question. Give an empty noun for a question answered yes or no,',
    'or when no words of the question name it. Answer for every question, in the same order.',
    JSON.stringify({ questions: wanting.map((w) => w.question) }),
  ].join('\n');
}

export function schemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['nouns'],
    properties: {
      nouns: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['question', 'noun'],
          properties: { question: { type: Type.STRING }, noun: { type: Type.STRING } },
        },
      },
    },
  };
}

/* The model's answer, checked question by question. Only the nouns that pass
   are kept; a question without one keeps its wording as its heading. */
export function cleanNouns(answer, wanting) {
  const loose = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const said = {};
  const list = (answer && Array.isArray(answer.nouns)) ? answer.nouns : [];
  list.forEach((n, i) => {
    if (!n) return;
    said[loose(n.question)] = n.noun;
    said['#' + i] = n.noun;
  });
  const out = {};
  wanting.forEach((w, i) => {
    const raw = said[loose(w.question)] !== undefined ? said[loose(w.question)] : said['#' + i];
    const ok = LABELS.nounFromQuestion(raw, w.question);
    if (ok) out[w.col] = ok;
  });
  return out;
}

/* Written onto the layer's stanza in manifest.local.json, beside the nouns it
   already has, touching nothing else. A noun is written only if the question
   at that place is still the one it was picked for. */
export function writeNouns(dir, layerId, nouns, wanting) {
  const file = path.join(dir, 'manifest.local.json');
  const local = JSON.parse(fs.readFileSync(file, 'utf8'));
  const layer = (local.layers || []).find((L) => L.id === layerId);
  if (!layer) return 0;
  const labels = layer.keyLabels || {};
  const asked = Object.fromEntries((wanting || []).map((w) => [w.col, w.question]));
  const next = Object.assign({}, layer.keyNouns || {});
  let n = 0;
  for (const [c, noun] of Object.entries(nouns || {})) {
    if (asked[c] !== undefined && String(labels[c] || '').trim() !== asked[c]) continue;
    const ok = LABELS.nounFromQuestion(noun, labels[c]);
    if (ok) { next[c] = ok; n += 1; }
  }
  if (!n) return 0;
  layer.keyNouns = next;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 1));
  fs.renameSync(tmp, file);
  return n;
}

/* What the stand-in (no model) answers: the plain rule a check can predict —
   the question's last word, when the page's own rule accepts it. Never used
   on a server with a model. */
export function standInAnswer(wanting) {
  return { nouns: wanting.map((w) => {
    const words = w.question.replace(/[?.!]+$/, '').split(/\s+/);
    return { question: w.question, noun: words[words.length - 1] || '' };
  }) };
}
