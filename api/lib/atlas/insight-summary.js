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

/* ====== "What the places say", version 2: what people are saying ==========
   A MOCK-UP, not the shipped summary (docs/plan-places-say-v2.md). Nothing
   above this line changed: SUMMARY_VERSION, writeSummary and the server's
   call are as they were. These pieces are exported so deploy/measure-story.mjs
   can run the proposed pipeline on a local layer and show Mithun what it
   would say.

   Mithun, 5-6 Nov 2026, after seeing the models try to describe the places:
   "Summarize what people are saying using the quotes. Whether they are
   curious, concerned, enjoying and so on. Mention the quotes at the bottom as
   evidence." So the story is no longer a description of the places; it is a
   short account of what the people who wrote about them are saying and how
   they feel, and each sentence stands on the very quotes it cites.

     a paragraph of 3 to 5 plain sentences, each citing the quotes it rests on,
     then those quotes underneath, in the order they are cited, as the evidence.

   The pipeline: the code works out the digest (insight-mode.js storyDigest —
   the places' own words, and the pointed sentences worth quoting, scored by
   IM.quoteScore) → the model writes once, citing 1 to 3 quote ids a sentence
   → the code checks (no digit, no amount or ranking word, no borrowed filing
   word unless the cited quotes use it, every id a quote it was offered) → the
   model proofreads once, seeing each sentence beside the very quotes it cites
   and answering one question: do these quotes show this feeling about this
   thing? → what was dropped goes back once with its reasons, and the rewrite
   is checked and proofread the same way, once. Under two sentences, or under
   two quotes left to show, nothing is shown; and with no proofread, nothing is
   shown either. */
export const STORY_VERSION = 2;
// the digest carries the places' own words, so the story is given longer than the shipped summary's TIMEOUT_MS
export const STORY_TIMEOUT_MS = 90000;
const MAX_STORY_CHARS = 240;

export function storySig(digest) {
  // the words are in the fingerprint too, so an edited description is never quoted stale
  return crypto.createHash('sha1').update(STORY_VERSION + '\u0004' + JSON.stringify(digest || {})).digest('hex').slice(0, 20);
}

// the answer labels of two words or more: LOKA's filing words
function labelsOf(digest) {
  const out = [];
  ((digest && digest.questions) || []).forEach((q) => (q.answers || []).forEach((a) => {
    if (String(a || '').trim().split(/\s+/).length > 1) out.push(a);
  }));
  return out;
}
// the quotes the model may cite, by id
function quotesById(digest) {
  const by = Object.create(null);
  ((digest && digest.candidates) || []).forEach((c) => { by[c.id] = c; });
  return by;
}
const LQ = '\u201c', RQ = '\u201d', DASH = '\u2014';
// the writer's own voice, telling the reader what ought to happen
const ADVICE = /\b(should|shouldn\u2019t|must|mustn\u2019t|ought to|requires?|needs? to|has to|have to|it is important|we need|let us|let\u2019s)\b/i;
// "Somebody...", "Another person...": one voice at a time, which is the list we are trying not to write
const ONE_BY_ONE = /^(somebody|someone|another person|a person|one person|a visitor|an observer|a walker|another)\b/i;
function onePerSentence(sentences, already) {
  return (already || []).concat(sentences || []).filter((s) => ONE_BY_ONE.test(s.text)).length;
}

// a place's own words are compared as a reader sees them: spacing and the kind of quote mark do not count
function sameWords(a, b) { return IM.foldName(a) === IM.foldName(b); }

/* What the model is shown: the quotes it may cite, each with its id, and the
   places' own words behind them. No counts anywhere. */
export function storyPromptFor(digest) {
  const d = digest || {};
  const by = quotesById(d);
  const groups = (d.groups || []).map((g) => ({ group: g.id, feeling: g.feels, about: g.about || undefined,
    alone: g.alone || undefined, quotes: g.quotes.map((id) => ({ id, quote: (by[id] || {}).text || '' })) }));
  const tensions = (d.tensions || []).map((t) => ({ about: t.about, groups: t.groups, feelings: t.feels }));
  const labels = labelsOf(d);
  const pairs = (d.groups || []).filter((g) => !g.alone).length;
  return [
    'People wrote notes about places on a map. The code has already sorted the pointed ones into GROUPS: quotes that feel the same way about something in common. Each group has an id, what it feels, and what it is about.',
    '',
    'Write what these people are saying, gathering each group into ONE sentence. Not a sentence a quote, and never a list of feelings one after another: "People wonder how deep an ant\u2019s burrow goes" is a group spoken as one; "Somebody is curious. Somebody feels concerned. Another person is enjoying" is what this must not read like.',
    '',
    '1. "sentences": one sentence for each group you use, ' + IM.MIN_STORY + ' to ' + IM.MAX_STORY + ' in all, in an order that reads as one paragraph.',
    '2. Every sentence carries "quotes": the ids it rests on, ' + IM.STORY_CITES_MIN + ' to ' + IM.STORY_CITES_MAX + ' of them, ALL FROM ONE GROUP. Those quotes are shown underneath as the evidence.',
    (pairs ? '3. A sentence may rest on a single quote only when its group holds just one (marked "alone"). Where a group holds two or three, gather them.' : '3. Gather what you can; the groups here are small.'),
    (tensions.length ? '4. Where two groups feel differently about the same thing, one sentence may hold both: "People enjoy X, while others worry that ...". Cite quotes from both groups for it. The pairs are listed under "tensions".' : ''),
    '',
    'How to write it:',
    '- Say it of the people together: "People wonder...", "Others worry that...", "A few lines keep coming back to..." (without saying how many). "One person" is fine once, for a quote that stands alone.',
    '- Do not open the paragraph with "Another". Do not begin sentence after sentence with Somebody, Someone, Another person, A person.',
    '- Name what the feeling is about, in the words the quotes use.',
    '- Your own voice gives no advice and no instruction: no "should", "must", "needs to", "requires", "it is important". Those words are fine inside a quote, never in your sentence.',
    (labels.length ? '- Do not borrow the questions\u2019 filing words ' + DASH + ' ' + labels.slice(0, 8).map((x) => LQ + x + RQ).join(', ') + ' and the like ' + DASH + ' unless a quote you cite uses those very words.' : '- Do not write in filing words.'),
    '- Never name a person. Never say who did something ' + DASH + ' walkers, visitors, residents ' + DASH + ' unless a cited quote says so.',
    '- No numbers and no amounts: not a digit, not "most", "many", "a few", "all", "every", "often", and nothing about which is commonest.',
    '- No framing: not ' + LQ + 'this map shows places where X and Y intertwine' + RQ + '. Under 25 words a sentence, finished, plain text, no markdown or quotation marks of your own.',
    '',
    'Groups:',
    JSON.stringify(groups),
    (tensions.length ? 'Tensions (two groups, one thing):' : ''),
    (tensions.length ? JSON.stringify(tensions) : ''),
  ].filter((l) => l !== '').join('\n');
}

export function storySchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['sentences'],
    properties: {
      sentences: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['text', 'quotes'],
          properties: { text: { type: Type.STRING }, quotes: { type: Type.ARRAY, items: { type: Type.STRING } } },
        },
      },
    },
  };
}

/* The sentences the model wrote, checked by the code: { sentences, dropped }.
   Each kept sentence carries the ids it cites, in its own order. Every reason
   is written from the ids and the rules, never from a place's words. */
export function checkStory(digest, answer, already) {
  const by = quotesById(digest);
  const labels = labelsOf(digest);
  const dropped = [];
  const sentences = [];
  const seen = new Set((already || []).map((s) => IM.foldName(s.text)));
  (answer && Array.isArray(answer.sentences) ? answer.sentences : []).forEach((s) => {
    if (sentences.length + (already || []).length >= IM.MAX_STORY) return;
    const text = String((s && s.text) || '').replace(/\s*\(?\bpattern_\d+\b\)?/g, '').replace(/\s+/g, ' ').trim();
    const no = (why) => dropped.push({ what: 'sentence', text, why });
    if (!text) return no('it is empty');
    if (text.length > MAX_STORY_CHARS) return no('it is too long');
    if (/[%<>*#`_\[\]{}|\\]|https?:/i.test(text)) return no('it has a percentage, a link or markup');
    if (/\d/.test(text)) return no('it writes a number, and the story says no numbers at all');
    if (IM.hasAmountWords(text)) return no('it says how many in words');
    /* The writer's own voice gives no orders (Mithun, 6 Nov 2026, after
       Divar's "Preserving the area requires raising awareness"): advice is
       not what anybody said. Inside a quote those words are fine. */
    if (ADVICE.test(text)) return no('it gives advice, which is the writer talking and not what anybody wrote');
    const given = Array.isArray(s && s.quotes) ? s.quotes.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
    const ids = given.filter((id, i) => given.indexOf(id) === i);
    const strange = ids.filter((id) => !by[id]);
    if (strange.length) return no('it cites a quote it was not given (' + strange[0].slice(0, 80) + ')');
    if (ids.length < IM.STORY_CITES_MIN) return no('it cites no quote to stand on');
    if (ids.length > IM.STORY_CITES_MAX) return no('it cites more than ' + IM.STORY_CITES_MAX + ' quotes');
    /* One sentence gathers one group. Two groups are allowed only where the
       code offered them as a tension: different feelings about one thing. */
    const groups = ids.map((id) => IM.groupOfQuote(digest.groups, id)).filter(Boolean);
    const keys = groups.map((g) => g.id).filter((k, n, a) => a.indexOf(k) === n);
    if (keys.length > 1) {
      const paired = (digest.tensions || []).some((t) => keys.length === 2 && t.groups.indexOf(keys[0]) >= 0 && t.groups.indexOf(keys[1]) >= 0);
      if (!paired) return no('it mixes quotes from groups the code did not put together (' + keys.join(' + ') + ')');
    }
    // where its group holds more than one voice, the sentence speaks for them together
    if (ids.length === 1 && groups[0] && groups[0].quotes.length > 1) {
      return no('its group holds more voices saying the same thing, so gather them');
    }
    /* No enumeration: a paragraph of "Somebody... Another person... A
       person..." is a list of feelings, which is what Mithun asked us to stop
       (6 Nov 2026). The first such sentence stands; the next is dropped. */
    const opener = ONE_BY_ONE.exec(text);
    if (opener) {
      if (!sentences.length && !(already || []).length && /^another\b/i.test(text)) {
        return no('a paragraph cannot open with ' + LQ + 'Another' + RQ);
      }
      if (onePerSentence(sentences, already) >= 1) return no('it starts like the one before it, and the story is not a list of feelings');
    }
    /* LOKA's filing words are not anybody's own ("highlighting both
       established structures and natural features") — unless a quote the
       sentence cites uses those very words, in which case they are what
       somebody wrote (Mithun, 6 Nov 2026). */
    const folded = IM.foldName(text);
    const said = ids.map((id) => IM.foldName(by[id].text)).join(' \u0004 ');
    const borrowed = labels.find((l) => IM.hasWhole(folded, IM.foldName(l)) && !IM.hasWhole(said, IM.foldName(l)));
    if (borrowed) return no('it uses the question’s filing words “' + borrowed + '”, which no quote it cites says');
    if (seen.has(IM.foldName(text))) return no('it says again what another sentence says');
    seen.add(IM.foldName(text));
    sentences.push({ text, quotes: ids });
  });
  return { sentences, dropped };
}

/* The evidence under the paragraph: the quotes the kept sentences cite, in
   the order they cite them, each with the code's own copy of the words and
   the place it belongs to. At most STORY_QUOTES_MAX. */
export function evidenceFor(digest, sentences) {
  const by = quotesById(digest);
  const places = IM.offeredById(digest);
  // Every sentence keeps one visible quote first (Mithun, 5 Nov 2026: "one per
  // sentence, up to 5"); the remaining room goes to further citations in order.
  // Shown in the order the sentences cite them.
  const cited = [];
  (sentences || []).forEach((s, si) => (s.quotes || []).forEach((id, qi) => {
    if (by[id]) cited.push({ id, si, qi });
  }));
  const pick = new Set();
  cited.forEach((c) => {
    if (pick.size >= IM.STORY_QUOTES_MAX || pick.has(c.id)) return;
    if (!cited.some((d) => d.si === c.si && pick.has(d.id))) pick.add(c.id);
  });
  cited.forEach((c) => { if (pick.size < IM.STORY_QUOTES_MAX) pick.add(c.id); });
  const out = [], seen = new Set();
  cited.forEach((c) => {
    if (!pick.has(c.id) || seen.has(c.id)) return;
    seen.add(c.id);
    const place = places[c.id] || {};
    out.push({ id: c.id, text: by[c.id].text, name: place.name || '' });
  });
  return out;
}

/* The proofread: one question a sentence, beside the very quotes it cites.
   Easier to judge than a description, and strict — a missing verdict is a no. */
export function storyProofreadPromptFor(digest, sentences) {
  const by = quotesById(digest);
  const list = (sentences || []).map((s, i) => ({ index: i, sentence: s.text,
    quotes: (s.quotes || []).map((id) => (by[id] || {}).text || '') }));
  return [
    'Below are sentences from a short account of what people are saying about places on a map. Each comes with the quotes it rests on — the words those people wrote.',
    'For each sentence answer "shows": do these quotes show this feeling about this thing? Mark it false when the feeling is not in the quotes, when the sentence is about something the quotes do not mention, when it says how many, when it names a person, when it gives advice, when the grammar is broken ("A observer", a sentence that does not parse), or when it stops part way. There is no benefit of the doubt: if you are not sure the quotes show it, mark it FALSE.',
    'For each quote answer "namesPerson": true when it names a person, a username or a handle, or carries an email, a phone number, a link or a photo credit. A place’s own name, or a god’s, is not a person. When unsure, mark it true.',
    'In "why" put the fault in a few plain words (empty when there is none).',
    'Sentences and the quotes they cite:',
    JSON.stringify(list),
    'Quotes, in order:',
    JSON.stringify(evidenceFor(digest, sentences).map((q, i) => ({ index: i, quote: q.text }))),
  ].join('\n');
}

export function storyProofreadSchemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['sentences', 'quotes'],
    properties: {
      sentences: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, required: ['index', 'shows', 'why'],
          properties: { index: { type: Type.INTEGER }, shows: { type: Type.BOOLEAN }, why: { type: Type.STRING } } },
      },
      quotes: {
        type: Type.ARRAY,
        items: { type: Type.OBJECT, required: ['index', 'namesPerson', 'why'],
          properties: { index: { type: Type.INTEGER }, namesPerson: { type: Type.BOOLEAN }, why: { type: Type.STRING } } },
      },
    },
  };
}

/* What the verdicts do: a sentence whose quotes are said to show it stands;
   one marked false, and one the proofread says nothing about, is dropped. A
   quote said to name a person takes the sentences resting on it with it —
   there is no story sentence without its evidence. An answer with no verdict
   in it at all is no proofread: `skipped` says so and the caller shows nothing. */
export function applyStoryProofread(digest, sentences, answer) {
  const sv = answer && Array.isArray(answer.sentences) ? answer.sentences : Array.isArray(answer) ? answer : [];
  const qv = answer && Array.isArray(answer.quotes) ? answer.quotes : [];
  const said = sv.filter((c) => c && Number.isInteger(c.index) && c.index >= 0 && c.index < sentences.length);
  if (!said.length) return { sentences: [], dropped: [], skipped: 'no usable answer' };
  const why = (c) => String((c && c.why) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const good = new Map();
  said.forEach((c) => { if (!good.has(c.index)) good.set(c.index, { ok: c.shows === true, why: why(c) }); });
  const shown = evidenceFor(digest, sentences);
  const person = new Set();
  qv.forEach((c) => { if (c && Number.isInteger(c.index) && c.namesPerson === true && shown[c.index]) person.add(shown[c.index].id); });
  const dropped = [];
  const kept = [];
  sentences.forEach((s, i) => {
    const v = good.get(i);
    if (!v || !v.ok) { dropped.push({ what: 'sentence', text: s.text, why: (v && v.why) || 'the proofread does not vouch for it' }); return; }
    const named = (s.quotes || []).find((id) => person.has(id));
    if (named) {
      dropped.push({ what: 'quote', text: named, why: 'the proofread says it names a person' });
      dropped.push({ what: 'sentence', text: s.text, why: 'the quote it rests on names a person' });
      return;
    }
    kept.push(s);
  });
  return { sentences: kept, dropped, skipped: '' };
}

/* What the model is told when its sentences come back dropped: the reasons,
   once. (The rewrite is checked and proofread like the first draft, and never
   written again.) */
export function storyRewritePromptFor(digest, dropped, kept) {
  const lines = (dropped || []).filter((d) => d.what === 'sentence').slice(0, IM.MAX_STORY)
    .map((d) => ({ sentence: d.text, why: d.why }));
  return [
    storyPromptFor(digest),
    '',
    'YOU HAVE WRITTEN THIS ONCE. These sentences were thrown out, with the reason for each. Write ' +
      (IM.MAX_STORY - (kept || []).length === 1 ? 'one new sentence' : (IM.MAX_STORY - (kept || []).length) + ' new sentences') +
      ' that do not repeat the fault, citing quotes as before. Do not write these again:',
    JSON.stringify(lines),
    (kept || []).length ? 'These stand already, so say something else: ' + JSON.stringify((kept || []).map((s) => s.text)) : '',
  ].join('\n');
}

/* The whole story pipeline over one layer, for the mock-up. Up to four calls:
   the write and its proofread, then one rewrite of what was dropped and its
   proofread. `story` null means nothing would be shown, and `by` says why.
   Never throws on the model's account. */
export async function writeStory({ layer, features, call, model, proofreadModel, Type, timeoutMs, shownCols, cap }) {
  timeoutMs = timeoutMs || STORY_TIMEOUT_MS;
  const digest = IM.storyDigest(layer, features, { shownCols: shownCols || null, cap: cap || 0 });
  const sig = storySig(digest);
  const calls = [];
  const base = { digest, sig, dropped: [], story: null, calls, quality: digest.quality, at: Date.now() };
  if (digest.candidates.length < IM.STORY_QUOTES_MIN) return Object.assign({}, base, { by: 'no place has words worth quoting' });
  /* Few voices: there is nothing to gather, so the card shows the quotes
     themselves and no model writes a word (Mithun, 6 Nov 2026). The code
     picks them, sharpest first, one to a place as always. */
  if (digest.candidates.length < IM.STORY_VOICES_MIN) {
    const places = IM.offeredById(digest);
    const quotes = digest.candidates.slice(0, IM.STORY_VOICES_MIN)
      .map((c) => ({ id: c.id, text: c.text, name: (places[c.id] || {}).name || '' }));
    return Object.assign({}, base, { story: { sentences: [], quotes, ownWords: true },
      by: 'few voices: their own words, with nothing written over them' });
  }
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
  const dropped = [];
  const proofWith = proofreadModel || model;
  /* One round: write (or rewrite) → the code's checks → the proofread.
     Answers the sentences that came through, or null when the proofread
     could not be had at all. */
  const round = async (what, prompt, kept) => {
    let answer = null;
    try {
      answer = await ask(what, model, prompt, storySchemaFor(Type), { file: true });
    } catch (e) {
      return { failed: 'no answer (' + String((e && e.message) || '').slice(0, 80) + ')' };
    }
    const checked = checkStory(digest, answer, kept);
    checked.dropped.forEach((d) => dropped.push(d));
    if (!checked.sentences.length) return { sentences: [], dropped: checked.dropped };
    let read;
    try {
      const verdicts = await ask(what === 'write' ? 'proofread' : 'proofread (rewrite)', proofWith,
        storyProofreadPromptFor(digest, checked.sentences), storyProofreadSchemaFor(Type), { file: true, proofread: true });
      read = applyStoryProofread(digest, checked.sentences, verdicts);
    } catch (e) {
      return { failed: 'the proofread could not be had (' + String((e && e.message) || 'no answer').slice(0, 80) + ')' };
    }
    if (read.skipped) return { failed: 'the proofread could not be had (' + read.skipped + ')' };
    read.dropped.forEach((d) => dropped.push(d));
    return { sentences: read.sentences, dropped: checked.dropped.concat(read.dropped) };
  };

  const first = await round('write', storyPromptFor(digest), []);
  if (first.failed) return Object.assign({}, base, { dropped, by: first.failed });
  let kept = first.sentences;
  // one rewrite, with the reasons: a weak sentence should not cost the whole story
  if (first.dropped.some((d) => d.what === 'sentence') && kept.length < IM.MAX_STORY) {
    const again = await round('rewrite', storyRewritePromptFor(digest, first.dropped, kept), kept);
    if (!again.failed) kept = kept.concat(again.sentences).slice(0, IM.MAX_STORY);
  }
  if (kept.length < IM.MIN_STORY) {
    return Object.assign({}, base, { dropped, by: 'under two sentences were vouched for' });
  }
  const quotes = evidenceFor(digest, kept);
  if (quotes.length < IM.STORY_QUOTES_MIN) {
    return Object.assign({}, base, { dropped, by: 'under ' + IM.STORY_QUOTES_MIN + ' quotes left to show' });
  }
  return Object.assign({}, base, { story: { sentences: kept, quotes }, dropped, by: 'model' });
}
