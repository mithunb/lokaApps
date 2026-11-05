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
export const SUMMARY_VERSION = 4;
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
    '- One question: "Of the N places that answer <its topic>, M say <Answer>." N is that question\'s "answered", M is that answer\'s "places".',
    '- Unanswered: "N of the ' + tables.places + ' places say nothing about <its topic>." N is "saysNothing".',
    '- A pair: "Of the N places whose <first topic> is <Answer A> and that also name a <second topic>, M say <Answer B>." N is that row\'s "places", M is the matching "split" entry\'s "places".',
    '- Few answers (a question marked fewPlaces): "Only N places say anything about <its topic>, so this is a hint, not a finding." N is "answered".',
    '- Name each question by its topic in two or three plain words, never by copying the question. For a question like "What material is it made of?" write: "Of the 40 places that name a material, 25 say Wood." For a pair: "Of the 12 places made of Wood that also name a use, 9 say Housing." Never write "what is" or "answer what".',
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
  if (c.shape === 'compare') {
    const q1 = ask(c.questions[1]);
    return 'Of the ' + c.of + ' places whose answer to “' + q0 + '” is ' + c.answers[0] + ' and that also answer “' + q1 + '”, ' +
      c.count + ' answer ' + c.answers[2] + '; of the ' + c.of2 + ' whose answer is ' + c.answers[1] + ', ' + c.count2 + ' do.';
  }
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

/* ================== "What the places say", version 2 ======================
   A MOCK-UP, not the shipped summary (docs/plan-places-say-v2.md, 5 Nov
   2026). Nothing above this line changed: SUMMARY_VERSION, writeSummary and
   the server's call are as they were. These pieces are exported so
   deploy/measure-findings.mjs can run the proposed pipeline on a local layer
   and show Mithun what it would say.

   The pipeline: the code works out the digest (insight-mode.js
   summaryDigest) → the model writes once (a short summary and 3 to 5
   findings, each with the cell it states and the ids of the quotes it chose)
   → the code checks (the same exact-cell check, plus: a quote's id must be
   one offered for that very cell, its words must be the words offered, and
   the code puts its own copy of the text back) → the model proofreads once
   (each finding beside its fact, and "does this quote name a person?") →
   under two findings, or an empty summary, nothing is shown. */
export const FINDINGS_VERSION = 1;
export const MAX_SUMMARY_SENTENCES = 3;
// the findings prompt carries the whole digest, so it is given longer than the shipped summary's TIMEOUT_MS
export const FINDINGS_TIMEOUT_MS = 90000;
export const MAX_QUOTES_PER_FINDING = 2;
const MAX_SUMMARY_CHARS = 240;

export function findingsSig(digest) {
  // the quotes are in the fingerprint too, so an edited description is never quoted stale
  return crypto.createHash('sha1').update(FINDINGS_VERSION + '\u0004' + JSON.stringify(digest || {})).digest('hex').slice(0, 20);
}

/* What the model is shown: the counts, what the code found notable, and the
   quotes it may choose from, by cell. No place's name, no tagger, no column
   the people rule touches. */
export function findingsPromptFor(digest) {
  const d = digest || {};
  return [
    'A map shows ' + d.places + ' places. LOKA asked each place a few questions and read an answer from what people wrote about it. Below are the counts, the cells the code already found worth a look, and quotes: a few places’ own words, each with its place id, listed under the cell they belong to.',
    '',
    'Write for somebody looking at this map for the first time, in the words a neighbour would use. Say what stands out and what it means. Do not write table rows: "Of the 40 places that name a material, 25 say Wood" is the shape to avoid.',
    '',
    '1. "summary": 2 or 3 short sentences saying what this map is like as a whole.',
    '2. "findings": 3 to 5 of them, each one thing worth knowing, told in one sentence.',
    '',
    'EVERY sentence, in the summary as well as the findings, must come with the cell of the counts it rests on. A sentence that rests on nothing counted — a guess about why people tagged what they did, a line about what the map is "like" — is thrown away, however true it sounds. A summary sentence may leave the numbers out of its words, but it must still be about its cell.',
    '   - "questions": the question ids, the first question first for a pair;',
    '   - "answers": the answer names spelt exactly as they are below (these are for the check, not for your sentence);',
    '   - "meansAnswers": the same answer names again, as a plain statement of what your sentence means. Say them exactly. If your sentence does not mean those answers, write a different sentence.',
    '   - "count" (M) and "of" (N), copied as digits from the cell;',
    '   - for a comparison, two more: "count2" and "of2", the second row’s numbers.',
    'The shapes a cell can have:',
    '   - One question: count is that answer’s "places", of is that question’s "answered".',
    '   - A pair: count is the "split" entry’s "places", of is that row’s "places".',
    '   - A comparison (the "contrast" entries under notable): answers are the two rows compared and then the answer they are compared on; count and of are the first row, count2 and of2 the second.',
    '   - Unanswered: count is "saysNothing", of is ' + d.places + '.',
    '   - Few answers (a question marked fewPlaces): count and of are both "answered".',
    '',
    'Your own words, the numbers checked:',
    '- You do not have to use the answer’s label. Call "Positive or preserved" looked after, "Observation or habitat" somewhere wildlife lives — whatever is true and plain. The cell you give is what is checked, not your wording.',
    '- Your plainer words must mean the SAME as the label. Saying "run down" of a cell whose answer is Positive or preserved is the worst thing you can do here: it is read as the truth and it is false. The sentence is read once more against its label, and anything that does not plainly mean it is thrown away.',
    '- Never name a different answer to either of your own questions in the sentence: that reads as a number put on the wrong answer, and the sentence is thrown away.',
    '- Copy every number as digits from the cell. Never work out a percentage, fraction, sum or difference. Never write an amount in words: not "two", "half", "a third", "twice" or "one in five".',
    '- A sentence with no number at all may not say how many either: no "most", "mostly", "nearly all", "majority", "many", "few", "largely". Say how many with the digits from a cell, or say nothing about how many.',
    '- Say "all" or "every" only when M equals N. A count of 0 may be written as "none" or "not one".',
    '- Under 25 words a sentence. One thing per sentence. Finish every sentence.',
    '- Numbers count places, not people. Never name a person, in a sentence or by choosing a quote that names one.',
    '',
    '"quotes": one or two of the quotes offered under THAT cell, each given back as its "id" and its "text" copied letter for letter. Let the quote carry the meaning: pick the one that shows the reader what these places are like. Never change a quote, not a word, not a comma; one you cannot copy exactly, leave out. A finding about what is not said gets no quote.',
    '',
    'What to pick: the cells under "notable" are the ones that say something the bars do not — the code has already left out the cells that merely restate their row. Do not write the same thing twice.',
    'Plain text: no markdown, lists, emoji or quotation marks in your own sentences.',
    '',
    JSON.stringify({ places: d.places, questions: d.questions, pairs: d.pairs, notable: d.notable, quotes: d.quotes }),
  ].join('\n');
}

export function findingsSchemaFor(Type) {
  const cell = {
    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
    answers: { type: Type.ARRAY, items: { type: Type.STRING } },
    count: { type: Type.INTEGER },
    of: { type: Type.INTEGER },
    // a comparison only: the second row's numbers
    count2: { type: Type.INTEGER },
    of2: { type: Type.INTEGER },
    // the same answers again, as the sentence's own statement of what it means
    meansAnswers: { type: Type.ARRAY, items: { type: Type.STRING } },
  };
  return {
    type: Type.OBJECT,
    required: ['summary', 'findings'],
    properties: {
      summary: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['text', 'questions', 'answers', 'count', 'of'], properties: Object.assign({ text: { type: Type.STRING } }, cell) } },
      findings: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['text', 'questions', 'answers', 'count', 'of'],
          properties: Object.assign({ text: { type: Type.STRING },
            quotes: { type: Type.ARRAY, items: { type: Type.OBJECT, required: ['id', 'text'], properties: { id: { type: Type.STRING }, text: { type: Type.STRING } } } } }, cell),
        },
      },
    },
  };
}

// a place's own words are compared as a reader sees them: spacing and the kind of quote mark do not count
function sameWords(a, b) { return IM.foldName(a) === IM.foldName(b); }

/* The quotes of one finding, checked: the id must be one of those offered
   for that very cell, the words must be the words offered (the model may not
   edit them), and the code puts its own copy back. Answers { quotes, dropped }. */
export function checkQuotes(digest, cell, given, used) {
  const offered = IM.quotesOffered(digest, cell);
  const quotes = [], dropped = [];
  const list = Array.isArray(given) ? given.slice(0, MAX_QUOTES_PER_FINDING + 2) : [];
  // a dropped quote is named by its place id and never by its words: the log keeps ids only (the plan, 5 Nov 2026)
  for (const q of list) {
    if (quotes.length >= MAX_QUOTES_PER_FINDING) break;
    const id = q && typeof q.id === 'string' ? q.id.trim() : '';
    const named = id ? id.slice(0, 80) : '(a quote with no place id)';
    if (cell.shape === 'unanswered' || cell.shape === 'few') { dropped.push({ what: 'quote', text: named, why: 'a finding about what is not said gets no quote' }); continue; }
    if (!id) { dropped.push({ what: 'quote', text: named, why: 'it names no place' }); continue; }
    const mine = offered.find((o) => o.id === id);
    if (!mine) { dropped.push({ what: 'quote', text: id, why: 'that place is not in the group this finding counts' }); continue; }
    if (!sameWords(mine.text, q.text)) { dropped.push({ what: 'quote', text: id, why: 'the quote was changed from the place’s own words' }); continue; }
    if (used && used.has(id)) { dropped.push({ what: 'quote', text: id, why: 'that place is already quoted' }); continue; }
    // the code's own copy, read again by the safety rules before it is kept
    const fault = IM.quoteFault(mine.text, []);
    if (fault) { dropped.push({ what: 'quote', text: id, why: fault }); continue; }
    if (used) used.add(id);
    quotes.push({ id: mine.id, text: mine.text });
  }
  return { quotes, dropped };
}

/* The model's answer, checked whole: { summary, findings, dropped }.
   `findings` holds { text, cell, count, of, quotes } and is empty when under
   two pass. Every reason is written from the counts and the ids, so the whole
   dropped list is safe to log. */
export function checkFindings(digest, answer) {
  const tables = IM.tablesOf(digest);
  const dropped = [];
  const asked = answer && Array.isArray(answer.findings) ? answer.findings : [];
  // the sentence may call an answer what a reader would call it; the cell it gives is what is checked
  const check = IM.checkCellsWithReasons(asked, tables, IM.MAX_FINDINGS, { plainAnswers: true });
  check.dropped.forEach((d) => dropped.push({ what: 'finding', text: d.text, why: d.why }));
  const used = new Set();
  const findings = check.kept.map((k) => {
    const given = asked[k.index] && asked[k.index].quotes;
    const q = checkQuotes(digest, k.cell, given, used);
    q.dropped.forEach((d) => dropped.push(Object.assign({ finding: k.text }, d)));
    const out = { text: k.text, questions: k.questions, answers: k.answers, count: k.count, of: k.of, cell: k.cell, quotes: q.quotes };
    if (k.cell.shape === 'compare') { out.count2 = k.cell.count2; out.of2 = k.cell.of2; }
    return out;
  });
  /* The summary rests on the counts too (Mithun, 5 Nov 2026): every sentence
     names the cell it is about, exactly as a finding does. A sentence with
     no number may stand only when its cell holds it up and the proofread
     says it means what that cell says — so "People tagged what caught their
     eye, so the map leans towards what is easy to notice", which rests on
     nothing anybody counted, is dropped. */
  const sum = [];
  (answer && Array.isArray(answer.summary) ? answer.summary : []).forEach((s) => {
    if (sum.length >= MAX_SUMMARY_SENTENCES) return;
    const text = String((s && s.text) || '').replace(/\s*\(?\bpattern_\d+\b\)?/g, '').replace(/\s+/g, ' ').trim();
    const no = (why) => dropped.push({ what: 'summary', text, why });
    if (!text) return no('it is empty');
    if (text.length > MAX_SUMMARY_CHARS) return no('it is too long');
    if (/[%<>*#`_\[\]{}|\\]|https?:/i.test(text)) return no('it has a percentage, a link or markup');
    if (IM.hasNumberWords(text)) return no('it writes an amount in words');
    // no number, so it may not claim a share in words either
    if (!/\d/.test(text) && IM.hasShareWords(text)) return no('it says how many in words, with no number the code can check');
    const one = IM.checkCellsWithReasons([Object.assign({}, s, { text })], tables, 1, { plainAnswers: true, noNumbersNeeded: true });
    if (!one.kept.length) return no((one.dropped[0] && one.dropped[0].why) || 'it rests on nothing the code counted');
    sum.push({ text: one.kept[0].text, questions: one.kept[0].questions, cell: one.kept[0].cell });
  });
  return { summary: sum, findings: findings.length >= IM.MIN_FINDINGS ? findings : [], dropped,
    tooFew: findings.length > 0 && findings.length < IM.MIN_FINDINGS ? findings.length : 0 };
}

/* The proofread: each finding beside the fact its cell states (written here
   from the counts) and beside its quotes. Two questions, as the plan asks:
   does the sentence say what its fact says, and does the quote name a
   person? */
export function findingsProofreadPromptFor(digest, findings) {
  const tables = IM.tablesOf(digest);
  const list = (findings || []).map((f, i) => ({ index: i, text: f.text, fact: factFor(tables, f),
    answer: (f.cell && f.cell.answers || []).join(' + '), quotes: (f.quotes || []).map((q) => q.text) }));
  return [
    'Below are numbered sentences written from a table of counts. Each comes with the fact it is meant to state, the answer label that fact is about, and the places’ own words quoted beside it.',
    'For each one answer three questions.',
    '1. "ok": mark it false ONLY when the sentence is unfinished, or says something its fact does not: a different group of places, a different answer, a number attached to the wrong answer, or "all" of a group when the fact’s count is less than its group. The sentence is meant to be in everyday words: calling an answer something plainer than its label is right, not wrong, as long as it means the same. A plainer phrasing of a question is fine too. Do not judge style, length or whether it is interesting. When unsure, mark it ok.',
    '2. "meansAnswer": does the sentence mean the answer label exactly? The sentence is meant to say the label in everyday words. Mark it false when it means something else, and above all when it means the opposite — "run down" where the label is Positive or preserved, "built" where the label is Natural feature. If you are not sure the sentence means that label, mark it FALSE. There is no benefit of the doubt on this one.',
    '3. "namesPerson": true when any quote beside it names a person — anybody’s name, a username or a handle, or a credit such as "Photo: A. Name". A place’s own name, or a god’s, is not a person. When unsure, mark it true.',
    'In "why" put the fault in a few plain words (empty when there is none).',
    'Sentences:',
    JSON.stringify(list),
  ].join('\n');
}

export function findingsProofreadSchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['checks'],
    properties: {
      checks: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['index', 'ok', 'meansAnswer', 'namesPerson', 'why'],
          properties: { index: { type: Type.INTEGER }, ok: { type: Type.BOOLEAN }, meansAnswer: { type: Type.BOOLEAN },
            namesPerson: { type: Type.BOOLEAN }, why: { type: Type.STRING } },
        },
      },
    },
  };
}

/* What the proofread's verdicts do: a finding judged not ok is dropped whole,
   with its quotes; a finding whose quote is said to name a person keeps its
   sentence and loses its quotes. A verdict that is not about a finding in the
   list, or not true or false, counts for nothing. */
export function applyFindingsProofread(findings, answer) {
  const n = findings.length;
  const checks = Array.isArray(answer) ? answer : answer && Array.isArray(answer.checks) ? answer.checks : null;
  const said = (checks || []).filter((c) => c && Number.isInteger(c.index) && c.index >= 0 && c.index < n);
  if (!said.length) return { findings, dropped: [], skipped: 'no usable answer' };
  const bad = new Map(), person = new Map();
  said.forEach((c) => {
    const why = String(c.why || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (c.ok === false && !bad.has(c.index)) bad.set(c.index, why || 'judged not ok');
    /* The meaning question has no benefit of the doubt: a sentence whose
       answer label is not clearly what it means is dropped, and so is one
       the proofread says nothing about when it had a label to read. */
    const needsMeaning = !!(findings[c.index] && findings[c.index].cell && (findings[c.index].cell.answers || []).length);
    if (needsMeaning && c.meansAnswer !== true && !bad.has(c.index)) {
      bad.set(c.index, why || 'it does not mean the answer its cell counts');
    }
    if (c.namesPerson === true && !person.has(c.index)) person.set(c.index, why || 'the quote names a person');
  });
  const dropped = [];
  const kept = [];
  findings.forEach((f, i) => {
    if (bad.has(i)) { dropped.push({ what: 'finding', text: f.text, why: bad.get(i) }); return; }
    if (person.has(i) && (f.quotes || []).length) {
      (f.quotes || []).forEach((q) => dropped.push({ what: 'quote', finding: f.text, text: q.id, why: person.get(i) }));
      kept.push(Object.assign({}, f, { quotes: [] }));
      return;
    }
    kept.push(f);
  });
  return { findings: kept, dropped, skipped: '' };
}

/* The whole v2 pipeline over one layer, for the mock-up. Two calls: the
   write and the proofread. Answers everything the measure tool prints:
   { summary, findings, dropped, digest, sig, by, calls }. `summary` null
   means nothing would be shown. Never throws on the model's account. */
export async function writeFindings({ layer, features, call, model, Type, timeoutMs, shownCols }) {
  // the digest is a long prompt and the answer is a long one: the shipped summary's 25 s is too short for it
  timeoutMs = timeoutMs || FINDINGS_TIMEOUT_MS;
  const digest = IM.summaryDigest(layer, features, shownCols ? { shownCols } : null);
  const sig = findingsSig(digest);
  const base = { digest, sig, dropped: [], summary: null, findings: [] };
  if (!digest.questions.length) return Object.assign({}, base, { by: 'no questions' });
  if (!call) return Object.assign({}, base, { by: 'no model' });
  let answer = null;
  try {
    answer = await askWithin(call, [model, findingsPromptFor(digest), findingsSchemaFor(Type), { file: true }], timeoutMs);
  } catch (e) {
    return Object.assign({}, base, { by: 'no answer (' + String((e && e.message) || '').slice(0, 80) + ')' });
  }
  const checked = checkFindings(digest, answer);
  const dropped = checked.dropped.slice();
  if (!checked.findings.length) {
    return Object.assign({}, base, { dropped, by: checked.tooFew ? 'under two findings passed the checks' : 'nothing usable' });
  }
  /* The summary sentences are read beside their own facts too: they carry a
     cell now, so the same proofread judges them (Opus review, 5 Nov 2026). */
  const both = checked.summary.map((s) => Object.assign({ kind: 'summary', quotes: [] }, s))
    .concat(checked.findings.map((f) => Object.assign({ kind: 'finding' }, f)));
  let read = { findings: both, dropped: [], skipped: 'not run' };
  try {
    const verdicts = await askWithin(call, [model, findingsProofreadPromptFor(digest, both), findingsProofreadSchemaFor(Type), { file: true, proofread: true }], timeoutMs);
    read = applyFindingsProofread(both, verdicts);
  } catch (e) {
    read = { findings: both, dropped: [], skipped: String((e && e.message) || 'no answer').slice(0, 120) };
  }
  read.dropped.forEach((d) => dropped.push(d));
  const summary = read.findings.filter((x) => x.kind === 'summary').map((s) => ({ text: s.text, questions: s.questions, cell: s.cell }));
  const findings = read.findings.filter((x) => x.kind !== 'summary').map((f) => { const o = Object.assign({}, f); delete o.kind; return o; });
  if (findings.length < IM.MIN_FINDINGS || !summary.length) {
    return Object.assign({}, base, { dropped, proofread: read.skipped,
      by: findings.length < IM.MIN_FINDINGS ? 'under two findings left' : 'no summary sentence passed' });
  }
  return { summary, findings, dropped, digest, sig, by: 'model', proofread: read.skipped,
    quality: digest.quality, at: Date.now() };
}
