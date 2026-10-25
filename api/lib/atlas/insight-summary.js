/* The short summary on top of an atlas in Insight mode, "What the places say"
   (Mithun, 25 October 2026).

   A few plain sentences, written by a model from the answer counts and
   nothing else: each question LOKA asked of the places with how many places
   give each answer, and the pairs of questions that pass the compare rule
   (atlas/insight-mode.js summaryTables — the same counts the visitor sees as
   bars). No place's own words, no names: a question whose answers are people
   is never in the tables.

   Every sentence states one cell of the tables and says which (its
   questions, answers, count and group), and the cell is checked exactly
   (insight-mode.js checkSentencesWithReasons): a cell that is not in the
   tables, a number that is not the cell's, an answer not named, an "all" of
   a part. A sentence that fails is dropped, and under two left there is no
   summary (the card is hidden). When none pass, the model is asked once more
   with the reason for each. The sentences that pass are then read once more
   by the same model (proofread), each beside the fact its cell states: one
   that stops part way, or says something its fact does not, is dropped too.
   When the proofread leaves under two, the summary is written once more with
   the reasons, and checked (not proofread again). When the proofread cannot
   be had, the checked sentences stand as they are. The summary is kept with
   a fingerprint of the tables (summarySig): while the answers are the same
   it is used again with no call.

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

/* raised when the instructions change, so every summary is written again once.
   2 (25 October 2026): the short-sentence and "all" rules, and the proofread.
   3 (25 October 2026): each sentence names its cell, checked exactly; the
   proofread reads each sentence beside its own fact; one re-write. */
export const SUMMARY_VERSION = 3;
export const TIMEOUT_MS = 25000;

export function summarySig(tables) {
  return crypto.createHash('sha1').update(SUMMARY_VERSION + '\u0004' + JSON.stringify(tables || {})).digest('hex').slice(0, 20);
}

/* The counts and nothing else: not even the atlas's title. (v3, reviewed 25
   Oct 2026) The old number check let through a true number put on the wrong
   cell (a count that is true of another row), and long sentences lost their
   way. So each sentence is one cell in one of four shapes, and names that
   cell, which the server then checks exactly. A pair's row counts only the
   places that answer both questions, so its shape says so: "whose X is A"
   alone sounds like every place answering A, a bigger group. */
export function promptFor(tables) {
  return [
    'A map shows ' + tables.places + ' places. LOKA asked each place a few questions. The tables below count how many places give each answer; a place may say nothing about a question. "pairs" show, for the places that answer both of two questions, how the answers to the first split by the answers to the second: each row is one answer to the first question, and its "split" is how those places answer the second.',
    'Write 3 to 5 short sentences in plain everyday words for a reader who is not an expert. Each sentence states one fact from one cell of the tables, in one of these shapes:',
    '- One question: "Of the N places that answer <what the question asks, in plain words>, M say <Answer>." N is that question\'s "answered", M is that answer\'s "places".',
    '- Unanswered: "N of the ' + tables.places + ' places say nothing about <what the question asks>." N is "saysNothing".',
    '- A pair: "Of the N places whose <first question, in plain words> is <Answer A> and that also answer <second question, in plain words>, M say <Answer B>." N is that row\'s "places", M is the matching "split" entry\'s "places".',
    '- Few answers (a question marked fewPlaces): "Only N places say anything about <what the question asks>, so this is a hint, not a finding." N is "answered".',
    'What to pick: start with the answer the most places give on each of the 2 or 3 questions the most places answer. Add a pair sentence only when one split entry holds most of its row, so it says something a single question does not. Skip a cell that repeats a sentence already written.',
    'Rules:',
    '- Copy every number as digits from the table cell. Never work out a percentage, fraction, sum, difference or any other number. Never write an amount in words: not "two", "half", "a third", "twice", "a dozen" or "one in five". "Most" and "few" are fine.',
    '- Keep every answer name exactly as the tables spell it.',
    '- Say "all" or "every" only when M equals N.',
    '- Under 25 words. One fact per sentence; never join two facts with "and", "while" or a comma. Finish every sentence.',
    '- Numbers count places, not people. Never name a person.',
    '- Plain text: no markdown, lists, emoji or quotation marks.',
    '- With each sentence give the cell it states: questions (the ids; for a pair, the first question first), answers (the exact answer names in the same order; empty for an unanswered or few-answers sentence), count (M) and of (N). The sentence must contain exactly these numbers and no others.',
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
          required: ['text', 'questions', 'answers', 'count', 'of'],
          properties: {
            text: { type: Type.STRING },
            questions: { type: Type.ARRAY, items: { type: Type.STRING } },
            answers: { type: Type.ARRAY, items: { type: Type.STRING } },
            count: { type: Type.INTEGER },
            of: { type: Type.INTEGER },
          },
        },
      },
    },
  };
}

/* What was wrong with the last answer, sentence by sentence, for the next
   write (the retry, the re-write). The model does not see its last answer,
   so each reason carries its sentence. */
export function reasonsFor(dropped) {
  const list = (dropped || []).slice(0, 5);
  if (!list.length) return 'Your last answer could not be used: it needs at least 2 sentences that each state one cell of the tables.';
  return ['Your last answer could not be used. What was wrong, sentence by sentence:']
    .concat(list.map((d) => 'Sentence ' + (d.index + 1) + ' (“' + String(d.text || '').slice(0, 200) + '”): ' + String(d.why || '').replace(/[.\s]+$/, '') + '.'))
    .join('\n');
}

/* The stand-in's answer (no model, ATLAS_FAKE_READING): plain sentences built
   from the tables, so a check can predict them and they always pass. */
export function standInAnswer(tables) {
  const qs = ((tables && tables.questions) || []).slice();
  const main = qs.filter((q) => !q.fewPlaces).sort((a, b) => b.answered - a.answered).slice(0, 3);
  const few = qs.filter((q) => q.fewPlaces).slice(0, 1);
  const sentences = main.map((q) => {
    const top = q.answers[0];
    return { text: 'Of the ' + q.answered + ' places that answer “' + q.question + '”, ' + top.places + ' say ' + top.answer.toLowerCase() + '.', questions: [q.id],
      answers: [top.answer], count: top.places, of: q.answered };
  }).concat(few.map((q) => ({ text: 'Only ' + q.answered + ' places say anything about “' + q.question + '”, so this is a hint rather than a finding.', questions: [q.id],
    answers: [], count: q.answered, of: q.answered })));
  return { sentences };
}

/* ---------------- the proofread ----------------
   The cell check (insight-mode.js checkSentencesWithReasons) knows the cell
   each sentence states is in the tables and its numbers and answers are in
   the sentence. It cannot tell that a sentence stops part way, or that its
   words say something else of those numbers ("all 9 of them" for a part, a
   number put beside the wrong answer). So the sentences that pass are shown
   to the same model once more, each beside the fact its cell states, written
   here from the tables, and judged one by one. The tables themselves are no
   longer shown (review, 25 Oct 2026): each sentence is judged against its
   own fact, not against every cell. Only a sentence
   judged not ok is dropped; one with no verdict stays. The sentences are
   written from the counts only, so they are safe to put in the server's log
   when dropped. */
// the fact a checked sentence's cell states, the questions as LOKA asked them
export function factFor(tables, s) {
  const c = s && s.cell;
  if (!c) return '';
  const ask = (id) => ((tables.questions || []).find((q) => q.id === id) || {}).question || id;
  const q0 = ask(c.questions[0]);
  if (c.shape === 'single') return 'Of the ' + c.of + ' places that answer “' + q0 + '”, ' + c.count + ' say ' + c.answers[0] + '.';
  if (c.shape === 'unanswered') return c.count + ' of the ' + tables.places + ' places say nothing about “' + q0 + '”.';
  if (c.shape === 'few') return 'Only ' + c.of + ' places answer “' + q0 + '”.';
  if (c.shape === 'pair') {
    const q1 = ask(c.questions[1]);
    return c.ofRow
      ? 'Of the ' + c.of + ' places whose answer to “' + q0 + '” is ' + c.answers[0] + ' and that also answer “' + q1 + '”, ' + c.count + ' answer ' + c.answers[1] + '.'
      : 'Of the ' + c.of + ' places that answer both “' + q0 + '” and “' + q1 + '”, ' + c.count + ' answer ' + c.answers[0] + ' and ' + c.answers[1] + '.';
  }
  return '';
}

export function proofreadPromptFor(tables, sentences) {
  const list = (sentences || []).map((s, i) => ({ index: i, text: s.text, fact: factFor(tables, s) }));
  return [
    'Below are numbered sentences written from a table of counts. Each comes with the fact it is meant to state. Mark a sentence not ok ONLY when:',
    '- it is unfinished: it stops before saying what it set out to say; or',
    '- it says something its fact does not: a different group of places, a different answer, a number attached to the wrong answer, or "all" of a group when the fact\'s count is less than its group.',
    'Different wording for the same fact is fine, and so is a plainer phrasing of a question. Do not judge style, length or whether the sentence is interesting. When unsure, mark it ok.',
    'For each sentence give its index, ok true or false, and in "why" the fault in a few plain words (empty when ok).',
    'Sentences:',
    JSON.stringify(list),
  ].join('\n');
}

export function proofreadSchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['checks'],
    properties: {
      checks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['index', 'ok', 'why'],
          properties: {
            index: { type: Type.INTEGER },
            ok: { type: Type.BOOLEAN },
            why: { type: Type.STRING },
          },
        },
      },
    },
  };
}

/* The stand-in's proofread (no model, ATLAS_FAKE_READING): every sentence is
   ok, so the stand-in's summary is exactly its sentences, as before. The
   sentences are the prompt's last line. */
export function standInProofread(prompt) {
  let list = [];
  try { list = JSON.parse(String(prompt).split('\n').pop()); } catch { list = []; }
  return { checks: (Array.isArray(list) ? list : []).map((s, i) => ({ index: i, ok: true, why: '' })) };
}

// a call that gives up after `ms`, its timer cleared either way
function askWithin(call, args, ms) {
  let timer = null;
  const ask = Promise.resolve().then(() => call(...args));
  const wait = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the model took too long')), ms || TIMEOUT_MS); });
  return Promise.race([ask, wait]).finally(() => clearTimeout(timer));
}

/* Proofread checked sentences: { sentences, dropped: [{ text, why }], skipped }.
   On any trouble (a refused or slow call, an answer with no usable verdict)
   the sentences come back as they were, with `skipped` saying why. Under two
   left is for the caller to judge (it runs them back through the cell
   check, which holds the two-sentence floor). Never throws. */
export async function proofread({ tables, sentences, call, model, Type, timeoutMs }) {
  const n = sentences.length;
  let answer = null;
  try {
    answer = await askWithin(call, [model, proofreadPromptFor(tables, sentences), proofreadSchemaFor(Type), { file: true, proofread: true }], timeoutMs);
  } catch (e) {
    const why = String((e && e.message) || 'no answer').slice(0, 120);
    console.warn('[insight] proofread skipped: ' + why);
    return { sentences, dropped: [], skipped: why };
  }
  const checks = Array.isArray(answer) ? answer : answer && Array.isArray(answer.checks) ? answer.checks : null;
  // a verdict counts only for a sentence that is there, and only as true or false
  const verdicts = (checks || []).filter((c) => c && Number.isInteger(c.index) && c.index >= 0 && c.index < n && typeof c.ok === 'boolean');
  if (!verdicts.length) {
    console.warn('[insight] proofread skipped: no usable answer');
    return { sentences, dropped: [], skipped: 'no usable answer' };
  }
  const bad = new Map();
  verdicts.forEach((c) => { if (!c.ok && !bad.has(c.index)) bad.set(c.index, String(c.why || 'judged not ok').replace(/\s+/g, ' ').trim().slice(0, 200)); });
  const dropped = [];
  const kept = sentences.filter((s, i) => {
    if (!bad.has(i)) return true;
    dropped.push({ text: s.text, why: bad.get(i) });
    console.warn('[insight] proofread dropped: ' + String(s.text).slice(0, 200) + ' — ' + bad.get(i));
    return false;
  });
  return { sentences: kept, dropped, skipped: '' };
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
   any trouble the old summary is kept as it was (keep: true). `cellDropped`
   is what the cell check dropped from the answer used, with why. When a
   proofread ran: `checked`, the sentences the cell check kept, and
   `proofread`, { dropped: [{ text, why }], skipped } (skipped is the reason
   the checked sentences stood unread, or empty). When it left under two:
   `rewrite`, { kept, dropped, skipped }. At most four calls: the write, one
   more when no sentence passes the cell check, the proofread, one re-write
   when the proofread leaves under two. The kept summary's sentences are
   { text, questions } only: the cell is for checking. */
export async function writeSummary({ layer, features, prev, call, model, Type, timeoutMs, force }) {
  const tables = IM.summaryTables(layer, features);
  const sig = summarySig(tables);
  const old = prev && prev.summary && typeof prev.summary === 'object' && Array.isArray(prev.summary.sentences) ? prev.summary : null;
  if (!tables.questions.length) return { summary: null, by: 'no questions', sig, tables };
  if (!force && old && old.sig === sig) return { summary: old, by: 'kept', sig, tables };
  if (!call) return { summary: old, by: 'no model', sig, tables, keep: true };
  const write = (extra) => askWithin(call, [model, promptFor(tables) + (extra ? '\n' + extra : ''), schemaFor(Type), { file: true }], timeoutMs);
  const listOf = (answer) => answer && Array.isArray(answer.sentences) ? answer.sentences : [];
  const plain = (list) => list.map((s) => ({ text: s.text, questions: s.questions }));
  const told = (list) => list.map((d) => ({ text: d.text, why: d.why }));
  // the sentences are written from the counts only: safe to log, with why
  const logDrops = (list) => list.slice(0, 5).forEach((d) => console.warn('[insight] dropped: ' + String(d.text).slice(0, 200) + ' — ' + d.why));
  let answer = null;
  try {
    answer = await write('');
  } catch (e) {
    return { summary: old, by: 'kept (' + String((e && e.message) || 'no answer').slice(0, 80) + ')', sig, tables, keep: true };
  }
  let asked = listOf(answer);
  let check = IM.checkSentencesWithReasons(asked, tables);
  if (!check.kept.length && asked.length) {
    // nothing passed: ask once more, with the reason for each sentence
    logDrops(check.dropped);
    try {
      const more = listOf(await write(reasonsFor(check.dropped)));
      const again = IM.checkSentencesWithReasons(more, tables);
      if (again.kept.length) { asked = more; check = again; } else logDrops(again.dropped);
    } catch { /* keep "nothing usable" */ }
  }
  const dropped = Math.min(asked.length, 5) - check.kept.length;
  const cellDropped = told(check.dropped);
  if (!check.kept.length) return { summary: null, by: 'nothing usable', sig, tables, dropped: asked.length, cellDropped, checked: [] };
  /* One more call: the proofread (see above). Its drops are counted apart
     from `dropped`, which stays the cell check's. What survives goes back
     through the cell check, which also holds the two-sentence floor. */
  const checked = check.kept;
  const read = await proofread({ tables, sentences: checked, call, model, Type, timeoutMs });
  let final = IM.checkSentencesWithReasons(read.sentences, tables).kept;
  const proof = { dropped: read.dropped, skipped: read.skipped };
  const base = { sig, tables, dropped: Math.max(0, dropped), cellDropped, checked: plain(checked), proofread: proof };
  let rewrite;
  if (!final.length) {
    /* Under two left: write once more, told what the proofread found wrong
       (Mithun, 25 Oct 2026). Checked, not proofread again: the fourth call
       is the last the caller allows. */
    const why = read.dropped.map((d) => ({ index: Math.max(0, checked.findIndex((s) => s.text === d.text)), text: d.text, why: d.why }));
    try {
      const fresh = IM.checkSentencesWithReasons(listOf(await write(reasonsFor(why))), tables);
      if (!fresh.kept.length) logDrops(fresh.dropped);
      rewrite = { kept: plain(fresh.kept), dropped: told(fresh.dropped), skipped: '' };
      final = fresh.kept;
    } catch (e) {
      rewrite = { kept: [], dropped: [], skipped: String((e && e.message) || 'no answer').slice(0, 120) };
    }
    if (!final.length) return Object.assign({ summary: null, by: 'nothing usable' }, base, { rewrite });
  }
  return Object.assign({ summary: { sig, sentences: plain(final), at: Date.now() }, by: 'model' }, base, rewrite ? { rewrite } : {});
}
