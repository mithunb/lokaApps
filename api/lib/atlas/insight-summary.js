/* The short summary on top of an atlas in Insight mode, "What the places say"
   (Mithun, 25 October 2026).

   A few plain sentences, written by a model from the answer counts and
   nothing else: each question LOKA asked of the places with how many places
   give each answer, and the pairs of questions that pass the compare rule
   (atlas/insight-mode.js summaryTables — the same counts the visitor sees as
   bars). No place's own words, no names: a question whose answers are people
   is never in the tables.

   Every sentence must carry its numbers, and every number in it must be one
   the tables hold for the questions it names (insight-mode.js
   checkSentences); a sentence that fails is dropped, and under two left there
   is no summary (the card is hidden). The summary is kept with a fingerprint
   of the tables (summarySig): while the answers are the same it is used again
   with no call.

   Written on switching to Insight and on "Write it again" (the owner's
   allowance), and after a reading is written (the server's) — api/apps/atlas.js
   makes the call (aiCaller) and writes the overlay; nothing here talks to the
   model or touches a file. Never throws. */

import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const IM = createRequire(import.meta.url)(path.join(HERE, '..', '..', '..', 'atlas', 'insight-mode.js'));

// raised when the instructions change, so every summary is written again once
export const SUMMARY_VERSION = 1;
export const TIMEOUT_MS = 25000;

export function summarySig(tables) {
  return crypto.createHash('sha1').update(SUMMARY_VERSION + '\u0004' + JSON.stringify(tables || {})).digest('hex').slice(0, 20);
}

// the counts and nothing else: not even the atlas's title
export function promptFor(tables) {
  return [
    'A map shows ' + tables.places + ' places. LOKA asked each place a few questions.',
    'The tables below count how many places give each answer; a place may say nothing about a question. "pairs" show, for the places that answer both of two questions, how the answers of one split by the answers of the other.',
    'Write 3 to 5 short sentences in plain everyday words saying what stands out, for a reader who is not an expert.',
    'Rules:',
    '- Every sentence carries its numbers, written as digits and copied exactly from the tables. They count places.',
    '- Do not work out percentages, fractions, sums, differences or any other new number.',
    '- Write every amount as digits from the tables, never in words: not "two", "half", "a third", "twice", "a dozen" or "one in five". "Most" and "few" are fine.',
    '- Numbers count places, not people. Never name a person.',
    '- For a question marked fewPlaces, say it is a hint rather than a finding.',
    '- Plain text only: no markdown, no lists, no emoji, no quotation marks around answers.',
    '- For each sentence, give the ids of the questions it uses (for example "pattern_3").',
    JSON.stringify(tables),
  ].join('\n');
}

export function schemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['sentences'],
    properties: {
      sentences: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['text', 'questions'],
          properties: {
            text: { type: Type.STRING },
            questions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
      },
    },
  };
}

/* The stand-in's answer (no model, ATLAS_FAKE_READING): plain sentences built
   from the tables, so a check can predict them and they always pass. */
export function standInAnswer(tables) {
  const qs = ((tables && tables.questions) || []).slice();
  const main = qs.filter((q) => !q.fewPlaces).sort((a, b) => b.answered - a.answered).slice(0, 3);
  const few = qs.filter((q) => q.fewPlaces).slice(0, 1);
  const sentences = main.map((q) => {
    const top = q.answers[0];
    return { text: 'Of the ' + q.answered + ' places that answer “' + q.question + '”, ' + top.places + ' say ' + top.answer.toLowerCase() + '.', questions: [q.id] };
  }).concat(few.map((q) => ({ text: 'Only ' + q.answered + ' places say anything about “' + q.question + '”, so this is a hint rather than a finding.', questions: [q.id] })));
  return { sentences };
}

/* After a reading is written: should the summary be looked at again? Only
   for an atlas in Insight with its summary on, never the operator's own
   atlas. Answers true or a reason. */
export function shouldRewrite(dataset, local, neverRead) {
  if (neverRead && neverRead.has && neverRead.has(dataset)) return 'never touched';
  const m = local && local.mode;
  if (!m || typeof m !== 'object' || m.name !== 'insight') return 'not in Insight';
  if (m.summaryOn === false) return 'summary off';
  return true;
}

/* The summary for these places. `prev` is the mode in use: its summary is
   used again, with no call, while the tables are the same (unless `force`,
   "Write it again"). `call` is the budgeted model caller or null. Answers
   { summary, by, sig, dropped }: summary null means no card. On a timeout or
   any trouble the old summary is kept as it was (keep: true). */
export async function writeSummary({ layer, features, prev, call, model, Type, timeoutMs, force }) {
  const tables = IM.summaryTables(layer, features);
  const sig = summarySig(tables);
  const old = prev && prev.summary && typeof prev.summary === 'object' && Array.isArray(prev.summary.sentences) ? prev.summary : null;
  if (!tables.questions.length) return { summary: null, by: 'no questions', sig, tables };
  if (!force && old && old.sig === sig) return { summary: old, by: 'kept', sig, tables };
  if (!call) return { summary: old, by: 'no model', sig, tables, keep: true };
  let answer = null;
  try {
    const ask = Promise.resolve().then(() => call(model, promptFor(tables), schemaFor(Type), { file: true }));
    let timer = null;
    const wait = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the model took too long')), timeoutMs || TIMEOUT_MS); });
    answer = await Promise.race([ask, wait]).finally(() => clearTimeout(timer));
  } catch (e) {
    return { summary: old, by: 'kept (' + String((e && e.message) || 'no answer').slice(0, 80) + ')', sig, tables, keep: true };
  }
  let asked = answer && Array.isArray(answer.sentences) ? answer.sentences : [];
  let sentences = IM.checkSentences(asked, tables);
  if (!sentences.length && asked.length) {
    // nothing passed: say what came back (the sentences are written from the counts only), then ask once more
    asked.slice(0, 5).forEach((s) => console.warn('[insight] dropped: ' + String((s && s.text) || s).slice(0, 200) + ' — cites ' + JSON.stringify((s && s.questions) || [])));
    try {
      const again = await Promise.race([
        Promise.resolve().then(() => call(model, promptFor(tables) + '\nYour last answer could not be used: each sentence must use only numbers that appear in the tables for the questions it names, as digits, with no percentages.', schemaFor(Type), { file: true })),
        new Promise((_, no) => setTimeout(() => no(new Error('the model took too long')), timeoutMs || TIMEOUT_MS)),
      ]);
      const more = again && Array.isArray(again.sentences) ? again.sentences : [];
      const kept = IM.checkSentences(more, tables);
      if (kept.length) { asked = more; sentences = kept; }
    } catch { /* keep "nothing usable" */ }
  }
  const dropped = Math.min(asked.length, 5) - sentences.length;
  if (!sentences.length) return { summary: null, by: 'nothing usable', sig, tables, dropped: asked.length };
  return { summary: { sig, sentences, at: Date.now() }, by: 'model', sig, tables, dropped: Math.max(0, dropped) };
}
