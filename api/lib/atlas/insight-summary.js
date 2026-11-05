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

/* ============ "What the places say", version 2: a short STORY =============
   A MOCK-UP, not the shipped summary (docs/plan-places-say-v2.md, 5 Nov
   2026). Nothing above this line changed: SUMMARY_VERSION, writeSummary and
   the server's call are as they were. These pieces are exported so
   deploy/measure-story.mjs can run the proposed pipeline on a local layer and
   show Mithun what it would say.

   Mithun, 5 Nov 2026: "focus on writing a short summary or story of the
   places. Stats are less important because the questions cover it." So this
   version has no counts in it at all. The shape:

     one short paragraph, three to five plain sentences about what this map is
     and what people noticed, then two short quotes in the places' own words,
     each linking to its place.

   The pipeline: the code works out the digest (insight-mode.js storyDigest —
   the places' own words and their answers, no counts) → the model writes once
   (the sentences, each with the ids of the places it draws from, and the two
   quotes it chose) → the code checks (no digit, no number word, no amount
   word; every id one of the places offered; two to six ids a sentence; a
   quote's words must be words that place was offered for, and the code puts
   its own copy back) → the model proofreads once, reading each sentence
   beside those places' own words and answers, and each quote for a person's
   name → a sentence nobody vouches for is dropped, and under two left nothing
   is shown. When the proofread cannot be had, nothing is shown either: the
   story is never put up unchecked. */
export const STORY_VERSION = 1;
// the digest carries the places' own words, so the story is given longer than the shipped summary's TIMEOUT_MS
export const STORY_TIMEOUT_MS = 90000;
const MAX_STORY_CHARS = 240;

export function storySig(digest) {
  // the words are in the fingerprint too, so an edited description is never quoted stale
  return crypto.createHash('sha1').update(STORY_VERSION + '\u0004' + JSON.stringify(digest || {})).digest('hex').slice(0, 20);
}

/* What the model is shown: the places themselves — id, name, their own words
   and their answers as plain labels — and nothing counted. */
export function storyPromptFor(digest) {
  const d = digest || {};
  const places = (d.offered || []).map((o) => ({ id: o.id, name: o.name || undefined, words: o.words,
    answers: (o.answers || []).map((a) => a.question + ': ' + a.answer) }));
  // the answer labels of two words or more: LOKA's filing words, which the story may not borrow
  const labels = [];
  (d.questions || []).forEach((q) => (q.answers || []).forEach((a) => { if (String(a).trim().split(/\s+/).length > 1) labels.push(a); }));
  return [
    'Below are places on one map, in their own words: what the person who tagged each one wrote about it, and the answers LOKA read from it.',
    '',
    'Write a short story of these places for somebody looking at this map for the first time, in the words a neighbour would use.',
    '',
    '1. "sentences": write ' + IM.MAX_STORY + ' short sentences, one paragraph, saying what this map is about and what people noticed. Each one is checked on its own and a weak one is thrown away, so write ' + IM.MAX_STORY + ' that can each stand alone and still read as one piece of writing.',
    '2. "quotes": exactly two, from the "quotes to choose from" at the end: give the place\u2019s "id" and copy its sentence, letter for letter, into "text". Two different places. Those are the sentences worth showing \u2014 somebody asking something, noticing something, saying how a place feels. No other sentence may be quoted. Prefer places your sentences draw on. Never change a quote, not a word, not a comma.',
    '',
    'Name concrete things, in the places\u2019 own terms: a rain tree, a stone step, a bench made from a door, egg rice. The reader should be able to picture what is there.',
    (labels.length ? 'NEVER use the questions\u2019 answer labels as your own wording \u2014 not ' + labels.slice(0, 8).map((x) => '\u201c' + x + '\u201d').join(', ') + ', nor any other label of two words or more. They are LOKA\u2019s filing words, not what anybody wrote, and a sentence carrying one is thrown away. Say what the place is, the way the person who wrote about it would say it.'
      : 'Never write in filing words: say what the place is, the way the person who wrote about it would say it.'),
    'Never say who did something \u2014 no people, observers, walkers, visitors, travellers, residents, locals \u2014 unless the place\u2019s own words say so. Write about the places, not about whoever looked at them.',
    'No framing and no summing up: not \u201cthis map shows places where X and Y intertwine\u201d, not \u201ca blend of\u201d, not \u201ca tapestry of\u201d. One plain thing a sentence.',
    '',
    'NO NUMBERS AT ALL. Not a digit, not a number in words, and no word for how many: no "most", "many", "few", "some", "almost all", "a handful", "half", "often", "all", "every". The questions under this story already show every count, so a sentence that tries to say how many is thrown away. Say what is there, not how much of it there is.',
    '',
    'EVERY sentence must come with "places": the ids of the 2 to 6 places it draws from, from the list below. They are checked: an id that is not in the list, or fewer than two, and the sentence is thrown away. Each sentence is then read again beside those places’ own words, and anything they do not plainly support is thrown away, however true it sounds. So write about places you can point at.',
    '',
    'Also:',
    '- Never name a person, and never pick a quote that names one, or that carries an email, a phone number, a link or a photo credit.',
    '- Do not name the atlas, the region or the organisation: this is about the places.',
    '- Under 25 words a sentence. Finish every sentence.',
    '- Plain text: no markdown, lists, emoji or quotation marks in your own sentences.',
    '',
    JSON.stringify({ questions: (d.questions || []).map((q) => ({ id: q.id, question: q.text, answers: q.answers })), places }),
    '',
    'Quotes to choose from (nothing else may be quoted):',
    JSON.stringify((d.candidates || []).map((c) => ({ id: c.id, text: c.text }))),
  ].join('\n');
}

export function storySchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['sentences', 'quotes'],
    properties: {
      sentences: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['text', 'places'],
          properties: { text: { type: Type.STRING }, places: { type: Type.ARRAY, items: { type: Type.STRING } } },
        },
      },
      quotes: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, required: ['id', 'text'], properties: { id: { type: Type.STRING }, text: { type: Type.STRING } } },
      },
    },
  };
}

// a place's own words are compared as a reader sees them: spacing and the kind of quote mark do not count
function sameWords(a, b) { return IM.foldName(a) === IM.foldName(b); }

// the answer labels of two words or more: the filing words a sentence may not borrow
function labelsOf(digest) {
  const out = [];
  ((digest && digest.questions) || []).forEach((q) => (q.answers || []).forEach((a) => {
    if (String(a || '').trim().split(/\s+/).length > 1) out.push(a);
  }));
  return out;
}

/* The model's answer, checked by the code: { sentences, quotes, dropped }.
   Every reason is written from the ids and the rules, never from a place's
   words, so the whole dropped list is safe to log. */
export function checkStory(digest, answer) {
  const by = IM.offeredById(digest);
  const dropped = [];
  const sentences = [];
  (answer && Array.isArray(answer.sentences) ? answer.sentences : []).forEach((s) => {
    if (sentences.length >= IM.MAX_STORY) return;
    const text = String((s && s.text) || '').replace(/\s*\(?\bpattern_\d+\b\)?/g, '').replace(/\s+/g, ' ').trim();
    const no = (why) => dropped.push({ what: 'sentence', text, why });
    if (!text) return no('it is empty');
    if (text.length > MAX_STORY_CHARS) return no('it is too long');
    if (/[%<>*#`_\[\]{}|\\]|https?:/i.test(text)) return no('it has a percentage, a link or markup');
    // the story carries no counts: the questions under it already show them (Mithun, 5 Nov 2026)
    if (/\d/.test(text)) return no('it writes a number, and the story says no numbers at all');
    if (IM.hasAmountWords(text)) return no('it says how many in words');
    /* LOKA's filing words are not anybody's own (Mithun, 6 Nov 2026, on
       "highlighting both established structures and natural features"): a
       sentence that borrows an answer label of two words or more is dropped.
       A one-word label is an ordinary word — Market, Trees — and is left alone. */
    const folded = IM.foldName(text);
    const borrowed = labelsOf(digest).find((l) => IM.hasWhole(folded, IM.foldName(l)));
    if (borrowed) return no('it uses the question’s answer label “' + borrowed + '” as its own words');
    const given = Array.isArray(s && s.places) ? s.places.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
    const ids = given.filter((id, i) => given.indexOf(id) === i);
    const strange = ids.filter((id) => !by[id]);
    if (strange.length) return no('it names a place it was not given (' + strange[0].slice(0, 80) + ')');
    if (ids.length < IM.STORY_IDS_MIN) return no('it names fewer than ' + IM.STORY_IDS_MIN + ' places it draws from');
    if (ids.length > IM.STORY_IDS_MAX) return no('it names more than ' + IM.STORY_IDS_MAX + ' places');
    sentences.push({ text, places: ids });
  });

  /* The quotes: by id, from the places offered, the words re-inserted by the
     code. Two different places, and a place the story names comes first. */
  const named = new Set();
  sentences.forEach((s) => s.places.forEach((id) => named.add(id)));
  const seen = new Set(), inStory = [], outside = [];
  (answer && Array.isArray(answer.quotes) ? answer.quotes : []).forEach((q) => {
    const id = q && typeof q.id === 'string' ? q.id.trim() : '';
    // a dropped quote is named by its place id and never by its words
    const no = (why) => dropped.push({ what: 'quote', text: id || '(a quote with no place id)', why });
    if (!id) return no('it names no place');
    const place = by[id];
    if (!place) return no('that place is not one of the places it was given');
    if (seen.has(id)) return no('that place is already quoted');
    const mine = (place.sentences || []).find((one) => sameWords(one, q && q.text));
    if (!mine) return no('the quote is not this place’s own words, as they were offered');
    /* Only the pointed sentences may be quoted (Mithun, 6 Nov 2026): a bare
       label — "table made with waste materials" — says what a thing is and
       nothing more, and the questions already say that. */
    if (!(digest.candidates || []).some((c) => c.id === id && sameWords(c.text, mine))) {
      return no('those words only say what the place is; the story quotes what somebody noticed');
    }
    // the code's own copy, read again by the safety rules before it is kept
    const fault = IM.quoteFault(mine, []);
    if (fault) return no(fault);
    seen.add(id);
    (named.has(id) ? inStory : outside).push({ id, text: mine, name: place.name || '', inStory: named.has(id) });
  });
  const all = inStory.concat(outside);
  const quotes = all.slice(0, IM.STORY_QUOTES);
  all.slice(IM.STORY_QUOTES).forEach((q) => dropped.push({ what: 'quote', text: q.id, why: 'the story shows ' + IM.STORY_QUOTES + ' quotes, and that many already passed' }));
  /* The shape is the paragraph AND its quotes (Mithun, 5 Nov 2026), so a
     story with too few quotes is not shown at all rather than shown short. */
  const enough = quotes.length >= IM.STORY_QUOTES;
  if (!enough) quotes.forEach((q) => dropped.push({ what: 'quote', text: q.id, why: 'the story needs ' + IM.STORY_QUOTES + ' quotes, and fewer passed' }));
  return { sentences: sentences.length >= IM.MIN_STORY ? sentences : [], quotes: enough ? quotes : [], dropped,
    tooFew: sentences.length > 0 && sentences.length < IM.MIN_STORY ? sentences.length : 0,
    tooFewQuotes: enough ? 0 : quotes.length };
}

/* The proofread: each sentence beside the very places it says it draws from —
   their own words and their answers — and each quote on its own. No benefit
   of the doubt: a sentence nobody vouches for is dropped. */
export function storyProofreadPromptFor(digest, sentences, quotes) {
  const by = IM.offeredById(digest);
  const list = (sentences || []).map((s, i) => ({ index: i, sentence: s.text,
    places: (s.places || []).map((id) => {
      const p = by[id] || {};
      return { words: p.words || '', answers: (p.answers || []).map((a) => a.question + ': ' + a.answer) };
    }) }));
  const qs = (quotes || []).map((q, i) => ({ index: i, quote: q.text }));
  return [
    'Below are sentences from a short story about places on a map. Each comes with the places it was written from: what somebody wrote about each one, and the answers read from it. After them are the quotes shown beside the story.',
    'For each sentence answer: "supported" — do these places’ own words and answers plainly bear this sentence out? Mark it false when the sentence goes beyond them, when it says how many (the story may not), when it names a person, or when it stops part way. Mark it false too when it says who did something — people, observers, walkers, visitors, residents — and the words beside it do not say so, or when it is filing words rather than what is there. There is no benefit of the doubt: if you are not sure the places bear it out, mark it FALSE.',
    'For each quote answer: "namesPerson" — true when it names a person, a username or a handle, or carries an email, a phone number, a link or a photo credit such as "Photo: A. Name". A place’s own name, or a god’s, is not a person. When unsure, mark it true.',
    'In "why" put the fault in a few plain words (empty when there is none).',
    'Sentences:',
    JSON.stringify(list),
    'Quotes:',
    JSON.stringify(qs),
  ].join('\n');
}

export function storyProofreadSchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['sentences', 'quotes'],
    properties: {
      sentences: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, required: ['index', 'supported', 'why'],
          properties: { index: { type: Type.INTEGER }, supported: { type: Type.BOOLEAN }, why: { type: Type.STRING } } },
      },
      quotes: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, required: ['index', 'namesPerson', 'why'],
          properties: { index: { type: Type.INTEGER }, namesPerson: { type: Type.BOOLEAN }, why: { type: Type.STRING } } },
      },
    },
  };
}

/* What the verdicts do: a sentence vouched for stands; one marked false, and
   one the proofread says nothing about, is dropped. A quote said to name a
   person goes, and so does one with no verdict. An answer with no verdict in
   it at all is no proofread: `skipped` says so and the caller shows nothing. */
export function applyStoryProofread(checked, answer) {
  const sentences = checked.sentences || [], quotes = checked.quotes || [];
  const sv = answer && Array.isArray(answer.sentences) ? answer.sentences : Array.isArray(answer) ? answer : [];
  const qv = answer && Array.isArray(answer.quotes) ? answer.quotes : [];
  const said = sv.filter((c) => c && Number.isInteger(c.index) && c.index >= 0 && c.index < sentences.length);
  if (!said.length) return { sentences: [], quotes: [], dropped: [], skipped: 'no usable answer' };
  const why = (c) => String((c && c.why) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const good = new Map();
  said.forEach((c) => { if (!good.has(c.index)) good.set(c.index, { ok: c.supported === true, why: why(c) }); });
  const dropped = [];
  const keptSentences = [];
  sentences.forEach((s, i) => {
    const v = good.get(i);
    if (v && v.ok) { keptSentences.push(s); return; }
    dropped.push({ what: 'sentence', text: s.text, why: (v && v.why) || 'the proofread does not vouch for it' });
  });
  const named = new Set();
  keptSentences.forEach((s) => s.places.forEach((id) => named.add(id)));
  const person = new Map();
  qv.forEach((c) => { if (c && Number.isInteger(c.index) && !person.has(c.index)) person.set(c.index, c); });
  const keptQuotes = [];
  quotes.forEach((q, i) => {
    const c = person.get(i);
    if (!c) { dropped.push({ what: 'quote', text: q.id, why: 'the proofread does not vouch for it' }); return; }
    if (c.namesPerson === true) { dropped.push({ what: 'quote', text: q.id, why: why(c) || 'it names a person' }); return; }
    keptQuotes.push(Object.assign({}, q, { inStory: named.has(q.id) }));
  });
  return { sentences: keptSentences, quotes: keptQuotes, dropped, skipped: '' };
}

/* The whole story pipeline over one layer, for the mock-up. Two calls: the
   write and the proofread, each with the model it ran on and how long it
   took (`calls`). `story` null means nothing would be shown, and `by` says
   why. Never throws on the model's account. */
export async function writeStory({ layer, features, call, model, proofreadModel, Type, timeoutMs, shownCols, cap }) {
  timeoutMs = timeoutMs || STORY_TIMEOUT_MS;
  const digest = IM.storyDigest(layer, features, { shownCols: shownCols || null, cap: cap || 0 });
  const sig = storySig(digest);
  const calls = [];
  const base = { digest, sig, dropped: [], story: null, calls, quality: digest.quality, at: Date.now() };
  if (!digest.offered.length) return Object.assign({}, base, { by: 'no place has words of its own' });
  if (!call) return Object.assign({}, base, { by: 'no model' });
  const ask = async (what, who, prompt, schema, opts) => {
    const started = Date.now();
    try {
      const out = await askWithin(call, [who, prompt, schema, opts], timeoutMs);
      calls.push({ what, model: who, seconds: Number(((Date.now() - started) / 1000).toFixed(1)) });
      return out;
    } catch (e) {
      calls.push({ what, model: who, seconds: Number(((Date.now() - started) / 1000).toFixed(1)), failed: String((e && e.message) || 'no answer').slice(0, 120) });
      throw e;
    }
  };
  let answer = null;
  try {
    answer = await ask('write', model, storyPromptFor(digest), storySchemaFor(Type), { file: true });
  } catch (e) {
    return Object.assign({}, base, { by: 'no answer (' + String((e && e.message) || '').slice(0, 80) + ')' });
  }
  const checked = checkStory(digest, answer);
  const dropped = checked.dropped.slice();
  if (!checked.sentences.length) {
    return Object.assign({}, base, { dropped, by: checked.tooFew ? 'under two sentences passed the checks' : 'nothing usable' });
  }
  if (!checked.quotes.length) {
    return Object.assign({}, base, { dropped, by: 'under ' + IM.STORY_QUOTES + ' quotes passed the checks' });
  }
  /* The proofread is not optional here: an unchecked story is never shown
     (Mithun, 5 Nov 2026). */
  let read = null;
  try {
    const verdicts = await ask('proofread', proofreadModel || model,
      storyProofreadPromptFor(digest, checked.sentences, checked.quotes), storyProofreadSchemaFor(Type), { file: true, proofread: true });
    read = applyStoryProofread(checked, verdicts);
  } catch (e) {
    return Object.assign({}, base, { dropped, by: 'the proofread could not be had (' + String((e && e.message) || 'no answer').slice(0, 80) + ')' });
  }
  if (read.skipped) return Object.assign({}, base, { dropped: dropped.concat(read.dropped), by: 'the proofread could not be had (' + read.skipped + ')' });
  read.dropped.forEach((d) => dropped.push(d));
  if (read.sentences.length < IM.MIN_STORY) {
    return Object.assign({}, base, { dropped, by: 'under two sentences were vouched for' });
  }
  if (read.quotes.length < IM.STORY_QUOTES) {
    return Object.assign({}, base, { dropped, by: 'under ' + IM.STORY_QUOTES + ' quotes passed the checks' });
  }
  return Object.assign({}, base, { story: { sentences: read.sentences, quotes: read.quotes }, dropped, by: 'model' });
}
