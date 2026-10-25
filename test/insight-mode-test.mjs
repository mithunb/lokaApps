/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Insight mode (atlas/insight-mode.js, api/lib/atlas/insight-summary.js),
 * 25 October 2026: the questions LOKA asked of the places, as bar lists that
 * colour the map, with a short summary written by AI from the counts (in its
 * own tab since the same day: What the places say · Questions).
 * These checks hold:
 *   - which questions show: never one whose answers are people, even if the
 *     owner tries; the owner's order and switches otherwise;
 *   - the few-places shelf (under a quarter, or under 8) and the compare rule
 *     (at least a tenth of the places AND at least 5 answer both), on the
 *     Bengaluru and Cubbon Park fixtures, with the mock-up's numbers;
 *   - the summary: each sentence names the cell it states and the cell is
 *     checked exactly (in the tables, its numbers and no others, its answers
 *     named, "all" only for the whole), a sentence that fails is dropped and
 *     the retry is told why; kept by its fingerprint (one model call across
 *     repeated switches); written again after a reading only in Insight with
 *     the summary on, never on the operator's own atlas; the sentences that
 *     pass are proofread once more, each beside its fact, and a proofread
 *     that fails changes nothing; one that leaves under two brings one
 *     re-write, four calls at most;
 *   - the route, on a throwaway server, public and private: owner only,
 *     canInsight, settings, Write it again, modeKept round trip;
 *   - Standard, Event and Explore are as they were (their own tests run untouched).
 * The places are test/fixtures/insight/*.json (no taggers' names or ids). */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const IM = require(ROOT + '/atlas/insight-mode.js');
const SUM = await import(ROOT + '/api/lib/atlas/insight-summary.js');
const { keepAside } = await import(ROOT + '/deploy/event-mode-lib.mjs');
const BLR = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/insight/bengaluru.json', 'utf8'));
const CUB = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/insight/cubbon.json', 'utf8'));
const viewerSrc = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const ownerJs = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ownerModes = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const imSrc = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
const bl = BLR.layer, bf = BLR.features, cl = CUB.layer, cf = CUB.features;
const counts = (st) => st.answers.map((a) => [a.name, a.count]);

/* ---------------- which questions show ---------------- */
console.log('\n  which questions show');
check('Bengaluru: "Who created this place?" is a people question (keyColumns created_by)', IM.isPeople(bl, 'pattern_5'), true);
check('…and so is any *_user_id or created_by_user_id column', [IM.isPeople({ keyColumns: { p: ['owner_user_id'] } }, 'p'), IM.isPeople({ keyColumns: { p: 'created_by_user_id' } }, 'p'), IM.isPeople({ keyColumns: { p: ['spaces'] } }, 'p')], [true, true, false]);
const blrShown = IM.shownStats(bl, bf, IM.defaultInsight(bl)).map((s) => s.col);
check('a new Insight shows every question but the people one, in the analysis\'s order', blrShown, ['pattern_1', 'pattern_2', 'pattern_3', 'pattern_4', 'pattern_6']);
check('…and its settings say so', IM.defaultInsight(bl).shown, { pattern_1: true, pattern_2: true, pattern_3: true, pattern_4: true, pattern_5: false, pattern_6: true });
check('a people question saved as shown is still not shown', IM.shownStats(bl, bf, { shown: { pattern_5: true } }).some((s) => s.col === 'pattern_5'), false);
check('the owner trying to show it is refused, in plain words', IM.cleanSettings(bl, { shown: { pattern_5: true } }, {}).error, IM.PEOPLE_REFUSED);
check('a question that is not the atlas\'s is refused', !!IM.cleanSettings(bl, { order: ['pattern_9'] }, {}).error, true);
check('a question twice in the order is refused', !!IM.cleanSettings(bl, { order: ['pattern_1', 'pattern_1'] }, {}).error, true);
check('summaryOn must be true or false', !!IM.cleanSettings(bl, { summaryOn: 'yes' }, {}).error, true);
const cs = IM.cleanSettings(bl, { order: ['pattern_3', 'pattern_4'], shown: { pattern_6: false } }, {}).settings;
check('a good order: the rest follow in their own order; switches kept; the people one off', [cs.order, cs.shown.pattern_6, cs.shown.pattern_5, cs.summaryOn],
  [['pattern_3', 'pattern_4', 'pattern_1', 'pattern_2', 'pattern_5', 'pattern_6'], false, false, true]);
check('the owner\'s order is the visitor\'s order, the switched-off one gone', IM.shownStats(bl, bf, { ...cs }).map((s) => s.col), ['pattern_3', 'pattern_4', 'pattern_1', 'pattern_2']);
check('a question new since the order was saved comes after it, shown', IM.settingsOf(bl, { order: ['pattern_4'] }).order.slice(0, 2), ['pattern_4', 'pattern_1']);
check('questions read as questions: a capital first; one saved cut off ends "…"',
  [IM.questionText(cl.keyLabels.pattern_4), IM.questionText(cl.keyLabels.pattern_5)], ['What species can be seen?', 'What locations are human-friendly and wh\u2026']);

/* ---------------- counts, and the few-places shelf ---------------- */
console.log('\n  counts and the few-places shelf');
const imp = IM.stats(bl, bf, 'pattern_3'), fun = IM.stats(bl, bf, 'pattern_4');
check('Bengaluru: 134 places; environmental impact answered for 115 (73 · 28 · 14), 19 say nothing',
  [imp.total, imp.answered, counts(imp), imp.none], [134, 115, [['Positive or preserved', 73], ['Neutral or observed', 28], ['Negative or degraded', 14]], 19]);
check('primary function answered for 123 (35 · 26 · 24 · 24 · 14)', [fun.answered, fun.answers.map((a) => a.count)], [123, [35, 26, 24, 24, 14]]);
check('colours follow the order of the answers, red kept late', imp.answers.map((a) => a.color), IM.PAL.slice(0, 3));
check('the coverage words', [IM.coverWords(imp), IM.coverWords(IM.stats(bl, bf, 'pattern_1'))], ['Answered for 115 of 134 places', 'Answered for 133 of 134 places']);
const cond = IM.stats(cl, cf, 'pattern_3');
check('Cubbon Park: 33 places; "condition" is said by 6, so it goes to the few-places shelf', [cond.total, cond.answered, cond.sparse, IM.coverWords(cond)], [33, 6, true, 'Only 6 of 33 places say anything about this']);
check('Cubbon\'s other questions are not on that shelf', IM.shownStats(cl, cf, {}).filter((s) => s.sparse).map((s) => s.col), ['pattern_3']);
check('nothing in Bengaluru is', IM.shownStats(bl, bf, {}).filter((s) => s.sparse).map((s) => s.col), []);
check('the rule: under a quarter, or under 8', [IM.isSparse(7, 10), IM.isSparse(8, 10), IM.isSparse(9, 40), IM.isSparse(10, 40)], [true, false, true, false]);
check('every place is answered: "Answered for all N places"', IM.coverWords({ answered: 9, total: 9, sparse: false }), 'Answered for all 9 places');
check('a people question\'s answers are never counted', IM.stats(bl, bf, 'pattern_5').answers, []);

/* ---------------- compare ---------------- */
console.log('\n  compare with another question');
check('the rule: at least a tenth of the places AND at least 5', [IM.canCompare(5, 50), IM.canCompare(4, 20), IM.canCompare(5, 60), IM.canCompare(6, 60)], [true, false, false, true]);
const blrOpts = IM.compareOptions(IM.shownStats(bl, bf, {}), bf, 'pattern_3');
check('Bengaluru: environmental impact can be compared with every other question shown', blrOpts.map((o) => o.st.col), ['pattern_1', 'pattern_2', 'pattern_4', 'pattern_6']);
const x = IM.crossTable(bf, imp, fun);
const neg = x.find((r) => r.answer === 'Negative or degraded');
check('Negative + Commerce or services is 5 places (the mock-up\'s slice); harm at shops 5 of 21, at culture 1 of 22',
  [neg.cells.find((c) => c.answer === 'Commerce or services').count,
    x.reduce((s, r) => s + ((r.cells.find((c) => c.answer === 'Commerce or services') || {}).count || 0), 0),
    x.reduce((s, r) => s + ((r.cells.find((c) => c.answer === 'Cultural or spiritual') || {}).count || 0), 0),
    (neg.cells.find((c) => c.answer === 'Cultural or spiritual') || {}).count], [5, 21, 22, 1]);
const cubStats = IM.shownStats(cl, cf, {});
const cubPairs = [];
cubStats.forEach((a) => IM.compareOptions(cubStats, cf, a.col).forEach((o) => cubPairs.push([a.col, o.st.col, o.both])));
check('Cubbon: every pair offered has at least 5 places answering both (a tenth of 33 is 3.3)', cubPairs.every((p) => p[2] >= 5), true);
check('Cubbon: "condition" (6 places) is offered only "main feature", the one question 5 of its places also answer',
  [IM.compareOptions(cubStats, cf, 'pattern_3').map((o) => [o.st.col, o.both]), cubStats.filter((b) => b.col !== 'pattern_3' && b.col !== 'pattern_1').map((b) => IM.bothCount(cf, 'pattern_3', b.col) < 5)],
  [[['pattern_1', IM.bothCount(cf, 'pattern_3', 'pattern_1')]], [true, true, true]]);
check('Cubbon: a pair under 5 is not offered', cubStats.every((a) => cubStats.filter((b) => b.col !== a.col && IM.bothCount(cf, a.col, b.col) < 5)
  .every((b) => !IM.compareOptions(cubStats, cf, a.col).some((o) => o.st.col === b.col))), true);

/* ---------------- the summary's numbers ---------------- */
console.log('\n  the summary: every number from the counts');
const T = IM.summaryTables(bl, bf);
check('the tables hold no people question and no tagger', [T.questions.some((q) => q.id === 'pattern_5'), /Person [A-D]|Other users/.test(JSON.stringify(T))], [false, false]);
check('…and no place\'s own words (no read-from words, no names of places)', /stone-carving|Krishna and Radha/.test(JSON.stringify(T)), false);
check('the pairs in them pass the compare rule', T.pairs.every((p) => IM.canCompare(p.answerBoth, T.places)), true);
// each sentence names the cell it states: its questions, answers, count and group (v3)
const good1 = { text: 'Of the 115 places that say what their impact is, 73 say Positive or preserved.', questions: ['pattern_3'], answers: ['Positive or preserved'], count: 73, of: 115 };
const good2 = { text: 'Of the 123 places that say what they are for, 35 say Observation or habitat.', questions: ['pattern_4'], answers: ['Observation or habitat'], count: 35, of: 123 };
const bad = { text: 'Of the 115 places that say what their impact is, 17 say Negative or degraded.', questions: ['pattern_3'], answers: ['Negative or degraded'], count: 17, of: 115 };
const pct = { text: 'About 54% of the 134 places say Positive or preserved.', questions: ['pattern_3'], answers: ['Positive or preserved'], count: 73, of: 115 };
// the reasons a sentence is dropped, alone (none: kept)
const why = (s, t = T) => IM.checkSentencesWithReasons([s], t).dropped.map((d) => d.why);
const kept = IM.checkSentences([good1, bad, good2, pct], T);
check('a sentence with a number not its cell\'s (17) is dropped; one with a percentage too; the true ones stay, as { text, questions } only',
  kept, [{ text: good1.text, questions: good1.questions }, { text: good2.text, questions: good2.questions }]);
check('…and the reasons say which, and what the table says', IM.checkSentencesWithReasons([good1, bad, good2, pct], T).dropped.map((d) => [d.index, d.why]),
  [[1, '17 is not the cell for Negative or degraded; the table says 14'], [3, 'it has a percentage, a link or markup']]);
const pairRight = { text: 'Of the 38 places whose status is Natural feature, 37 also say Natural elements for what they are made of.',
  questions: ['pattern_1', 'pattern_2'], answers: ['Natural feature', 'Natural elements'], count: 37, of: 38 };
check('a pair: the cell under its row is kept', why(pairRight), []);
check('a pair: 36 for a cell the table holds as 37 (36 is true of another row) is dropped, not the cell',
  why({ ...pairRight, text: pairRight.text.replace('37', '36'), count: 36 }), ['36 is not the cell for Natural feature + Natural elements; the table says 37']);
check('a pair with one answer is no cell', why({ ...pairRight, answers: ['Natural feature'] }).map((w) => w.startsWith('no such cell')), [true]);
check('a pair out of the places answering both (99) is a cell too; any other group is not',
  [why({ ...pairRight, text: 'Of the 99 places that say both, 37 say Natural feature and Natural elements.', of: 99 }).length,
    why({ ...pairRight, text: 'Of the 133 places, 37 say Natural feature and Natural elements.', of: 133 }).length], [0, 1]);
check('the ids the other way round, with the answers the other way round: the same cell, kept',
  why({ text: 'Of the 38 places that are a Natural feature, 37 are made of Natural elements.', questions: ['pattern_2', 'pattern_1'], answers: ['Natural elements', 'Natural feature'], count: 37, of: 38 }), []);
check('…and with the answers left as they were: no cell',
  why({ text: 'Of the 38 places that are a Natural feature, 37 are made of Natural elements.', questions: ['pattern_2', 'pattern_1'], answers: ['Natural feature', 'Natural elements'], count: 37, of: 38 }).map((w) => w.startsWith('no such cell')), [true]);
check('"all" when the count is a part of its group is dropped; "all" when it is the whole is kept',
  [why({ ...pairRight, text: 'All of the 38 places whose status is Natural feature have Natural elements, 37 of them.' }),
    why({ text: 'All 8 places made of Upcycled or reused say Positive or preserved for their impact.', questions: ['pattern_2', 'pattern_3'], answers: ['Upcycled or reused', 'Positive or preserved'], count: 8, of: 8 })],
  [['it says all but the count is a part (37 of 38)'], []]);
check('a number in the text outside its cell (and the map\'s total) is dropped',
  why({ ...good1, text: 'Of the 115 places that say what their impact is, 73 say Positive or preserved, against 28 others.' }), ['number 28 is not in its cell']);
check('…and so is a sentence missing its cell\'s number', why({ ...good1, text: 'Of the places that say what their impact is, 73 say Positive or preserved.' }), ['number 115 of its cell is not in it']);
check('an answer the cell names but the text does not is dropped', why({ ...good1, text: 'Of the 115 places that say what their impact is, 73 say it is good.' }), ['it does not name Positive or preserved']);
check('one answer: the group is the places that answer, never the whole map',
  why({ ...good1, text: 'Of the 134 places, 73 say Positive or preserved.', of: 134 }), ['134 is not the group for Positive or preserved; the table says 115 places answer pattern_3']);
check('unanswered: "N of the {places} places say nothing" is kept (either way round); out of the answered it is not',
  [why({ text: '19 of the 134 places say nothing about their impact.', questions: ['pattern_3'], answers: [], count: 19, of: 134 }),
    why({ text: '19 of the 134 places say nothing about their impact.', questions: ['pattern_3'], answers: [], count: 134, of: 19 }),
    why({ text: '19 of the 115 places say nothing about their impact.', questions: ['pattern_3'], answers: [], count: 19, of: 115 }).length], [[], [], 1]);
const TC = IM.summaryTables(cl, cf);
const fewS = { text: 'Only 6 places say anything about their condition, so this is a hint, not a finding.', questions: ['pattern_3'], answers: [], count: 6, of: 6 };
check('few answers: count and group are the few that answer; on a question not marked few it is no cell',
  [why(fewS, TC), why({ ...fewS, text: 'Only 20 places say anything about the main feature, so this is a hint.', questions: ['pattern_1'], count: 20, of: 20 }, TC).length], [[], 1]);
{
  const TA = { places: 10, questions: [{ id: 'pattern_1', question: 'What is it?', answered: 8, places: 10, saysNothing: 2, fewPlaces: false, answers: [{ answer: 'Children\'s  play', places: 5 }] }], pairs: [] };
  check('answer names match whatever the case, spacing and kind of apostrophe',
    IM.checkSentencesWithReasons([{ text: 'Of the 8 places that answer, 5 say children’s play.', questions: ['pattern_1'], answers: ['CHILDREN’S PLAY '], count: 5, of: 8 },
      { text: '2 of the 10 places say nothing about it.', questions: ['pattern_1'], answers: [], count: 2, of: 10 }], TA).kept.map((x) => x.answers), [['Children\'s  play'], []]);
}
{
  // answers that look like numbers or number words, and short answers inside longer words
  const one = (answers, answered, places) => ({ places, pairs: [], questions: [{ id: 'pattern_1', question: 'What is it?', answered, places, saysNothing: places - answered, fewPlaces: false,
    answers: answers.map(([answer, n]) => ({ answer, places: n })) }] });
  const TN = one([['1', 12], ['4', 28]], 40, 50);
  check('answers "1" and "4": a sentence with 12 and 40 in it keeps its numbers whole, and is kept',
    IM.checkSentencesWithReasons([{ text: 'Of the 40 places that answer how many floors, 12 say 1.', questions: ['pattern_1'], answers: ['1'], count: 12, of: 40 },
      { text: 'Of the 40 places that answer how many floors, 28 say 4.', questions: ['pattern_1'], answers: ['4'], count: 28, of: 40 }], TN).kept.length, 2);
  const TY = one([['No', 5], ['Yes', 3]], 8, 10);
  check('"No" is not named by "nothing", nor "Yes" by "eyes"; named whole, they are',
    [why({ text: 'Of the 8 places that answer, 5 say nothing more.', questions: ['pattern_1'], answers: ['No'], count: 5, of: 8 }, TY),
      why({ text: 'Of the 8 places that answer, 3 have eyes on it.', questions: ['pattern_1'], answers: ['Yes'], count: 3, of: 8 }, TY),
      why({ text: 'Of the 8 places that answer, 5 say No.', questions: ['pattern_1'], answers: ['No'], count: 5, of: 8 }, TY)],
    [['it does not name No'], ['it does not name Yes'], []]);
  const TW = one([['Two-wheeler', 6]], 9, 12);
  check('the answer "Two-wheeler" is not an amount in words; "two" of the sentence\'s own still is',
    [why({ text: 'Of the 9 places that answer how people come, 6 say Two-wheeler.', questions: ['pattern_1'], answers: ['Two-wheeler'], count: 6, of: 9 }, TW),
      why({ text: 'Of the 9 places that answer, 6 say Two-wheeler, two more than cars.', questions: ['pattern_1'], answers: ['Two-wheeler'], count: 6, of: 9 }, TW)],
    [[], ['it writes an amount in words']]);
}
check('fewer than two left: no summary', IM.checkSentences([good1, bad], T), []);
check('a stray comma after the full stop is taken off', IM.checkSentences([{ ...good1, text: good1.text + ',' }, good2], T)[0].text, good1.text);
check('amounts in words are dropped ("two", "half", "twice", "one in five"); "one of the" and "no one" are fine',
  ['Two of the 115 places say Positive or preserved, 73.', 'Half of the 115 places say Positive or preserved, 73.', 'Positive or preserved is twice as common, at 73 of 115 places.', 'One in five of the 115 places, 73, say Positive or preserved.', 'Of the 115 places, one of the answers leads: 73 say Positive or preserved.', 'No one answer beats Positive or preserved: 73 of the 115 places.']
    .map((t) => IM.checkSentences([good1, { ...good1, text: t }], T).length), [0, 0, 0, 0, 2, 2]);
check('a sentence must name the questions it draws on, each one of the tables\'',
  [IM.checkSentences([good1, { ...good2, questions: [] }], T).length, IM.checkSentences([good1, { ...good2, questions: ['pattern_9'] }], T).length, IM.checkSentences([good1, { ...good2, questions: ['pattern_4', 'pattern_9'] }], T).length], [0, 0, 0]);
check('the visitor sees only sentences about questions on show', IM.visibleSentences({ sentences: [good1, good2, { text: 'x 9', questions: ['pattern_2'] }] }, ['pattern_3', 'pattern_4']).length, 2);
check('…and none when under two remain', IM.visibleSentences({ sentences: [good1, good2] }, ['pattern_3']), []);
check('a sentence naming no question is never shown', IM.visibleSentences({ sentences: [good1, good2, { text: 'x 9', questions: [] }] }, ['pattern_3', 'pattern_4']).length, 2);
check('a sentence naming any hidden question is hidden', IM.visibleSentences({ sentences: [good1, good2, { text: 'x 5', questions: ['pattern_3', 'pattern_2'] }] }, ['pattern_3', 'pattern_4']).length, 2);
check('"being written" for over two minutes is stuck, not pending; no time is not pending',
  [IM.isPending({ summaryPending: true, summaryPendingAt: Date.now() - 1000 }), IM.isPending({ summaryPending: true, summaryPendingAt: Date.now() - 121000 }), IM.isPending({ summaryPending: true })], [true, false, false]);

console.log('\n  the panel\'s tabs: What the places say · Questions, or no tabs at all');
const keys = (t) => t.map((x) => x.key);
const sumMode = { summaryOn: true, summary: { sentences: [good1, good2] } };
const shownBoth = ['pattern_3', 'pattern_4'];
check('a summary to show: two tabs, the summary first', keys(IM.panelTabs(sumMode, shownBoth)), ['sum', 'q']);
check('…named in plain words, "Summary" where they do not fit', IM.panelTabs(sumMode, shownBoth).map((x) => [x.label, x.short || '']), [['What the places say', 'Summary'], ['Questions', '']]);
check('summary turned off: no tab row', IM.panelTabs({ summaryOn: false, summary: sumMode.summary }, shownBoth), []);
check('under two sentences on show: no tab row', IM.panelTabs(sumMode, ['pattern_3']), []);
check('none written yet: no tab row', IM.panelTabs({ summaryOn: true, summary: null }, shownBoth), []);
check('being written: the summary tab stays (it says so)', keys(IM.panelTabs({ summaryOn: true, summary: null, summaryPending: true, summaryPendingAt: Date.now() }, shownBoth)), ['sum', 'q']);
check('the owner\'s Settings comes third, and stands even with no summary', [keys(IM.panelTabs(sumMode, shownBoth, { key: 'settings' })), keys(IM.panelTabs({ summaryOn: false }, shownBoth, { key: 'settings' }))], [['sum', 'q', 'settings'], ['q', 'settings']]);
check('the atlas opens on the summary; the Questions tab has no summary card', /state = \{ ready: false, tab: "sum",/.test(imSrc) && /if \(curTab\(\) === "sum"\) return summaryHTML\(\);/.test(imSrc), true);
check('the summary tab links to the questions', /See the questions these numbers come from/.test(imSrc) && /data-in="tab" data-tab="q"/.test(imSrc), true);
check('the whole summary on a phone too: no cut-off left', /Read the whole summary|summore|sumOpen/.test(imSrc), false);
check('a sentence is escaped, its numbers bold', IM.sentenceHTML('<b>x</b> & 73 of 1,115'), '&lt;b&gt;x&lt;/b&gt; &amp; <b>73</b> of <b>1,115</b>');

console.log('\n  the summary: written once, kept by its fingerprint');
let calls = 0;
// the proofread (the call marked proofread: true) passes every sentence, as the stand-in's does
const fake = (answer) => async (m, prompt, schema, o) => { calls++; return o && o.proofread ? SUM.standInProofread(prompt) : answer; };
const Type = { OBJECT: 'object', ARRAY: 'array', STRING: 'string', BOOLEAN: 'boolean', INTEGER: 'integer' };
const r1 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, call: fake({ sentences: [good1, bad, good2] }), model: 'm', Type });
check('first time: one call to write and one to proofread; the invented sentence dropped', [calls, r1.by, r1.summary.sentences.length, r1.dropped], [2, 'model', 2, 1]);
const r2 = await SUM.writeSummary({ layer: bl, features: bf, prev: { summary: r1.summary }, call: fake({ sentences: [] }), model: 'm', Type });
check('the same answers again: kept, no call', [calls, r2.by, r2.summary], [2, 'kept', r1.summary]);
const r3 = await SUM.writeSummary({ layer: bl, features: bf, prev: { summary: r1.summary }, call: fake({ sentences: [good2, good1] }), model: 'm', Type, force: true });
check('"Write it again" asks again (and proofreads again)', [calls, r3.by], [4, 'model']);
const changed = bf.map((f, i) => i ? f : { ...f, properties: { ...f.properties, pattern_3: 'Negative or degraded' } });
const r4 = await SUM.writeSummary({ layer: bl, features: changed, prev: { summary: r1.summary }, call: fake({ sentences: [] }), model: 'm', Type });
check('new answers: asked again; nothing usable means no summary (and nothing to proofread)', [calls, r4.by, r4.summary], [5, 'nothing usable', null]);
const slow = () => new Promise(() => {});
const r5 = await SUM.writeSummary({ layer: bl, features: changed, prev: { summary: r1.summary }, call: slow, model: 'm', Type, timeoutMs: 50 });
check('a model that takes too long: the old summary is kept, nothing thrown', [r5.summary, r5.keep], [r1.summary, true]);
const r6 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, call: () => { throw new Error('too many'); }, model: 'm', Type });
check('a refused call: no summary, nothing thrown', [r6.summary, r6.keep], [null, true]);
check('the stand-in\'s sentences always pass the cell check, on both atlases', [IM.checkSentences(SUM.standInAnswer(T).sentences, T).length >= 2, IM.checkSentences(SUM.standInAnswer(TC).sentences, TC).length >= 2], [true, true]);
check('the prompt carries the counts only: not even the atlas\'s title', !/Bengaluru Secret Title/.test(SUM.promptFor(T, 'Bengaluru Secret Title')) && /Never write an amount in words/.test(SUM.promptFor(T)), true);
check('one summary job per atlas at a time; a stuck pending flag lets a new one start',
  /if \(INSIGHT_RUNNING\.has\(slug\)\) return 'already writing';/.test(server) && /finally \{\s*INSIGHT_RUNNING\.delete\(slug\);/.test(server) && /!INSIGHT\.isPending\(mode\) && !INSIGHT_RUNNING\.has\(inst\.slug\)/.test(server), true);
check('the visitor page stops asking: a cap, a failed fetch, or the mode gone',
  /if \(tries > MAX_TRIES\) \{ stop\(true\); return; \}/.test(imSrc) && /if \(!m \|\| m\.name !== "insight"\) \{ stop\(true\); return; \}/.test(imSrc) && /\.catch\(function \(\) \{ if \(pollT\) stop\(true\); \}\)/.test(imSrc), true);
check('the prompt carries the tables and asks for numbers copied from the cell', /Copy every number as digits from the table cell/.test(SUM.promptFor(T, 'x')) && SUM.promptFor(T, 'x').endsWith(JSON.stringify(T)), true);
check('…and for the cell each sentence states, which the answer\'s shape carries',
  /give the cell it states: questions .*answers .*count \(M\) and of \(N\)/.test(SUM.promptFor(T)) && /134 of|of the 134 places say nothing/.test(SUM.promptFor(T)) &&
  JSON.stringify(SUM.schemaFor(Type).properties.sentences.items.required) === JSON.stringify(['text', 'questions', 'answers', 'count', 'of']), true);

console.log('\n  the summary: proofread once more, by the same model, each sentence beside its fact');
{
  const good3 = { text: 'Of the 14 places whose impact is Negative or degraded, 5 also say Commerce or services for what they are for.',
    questions: ['pattern_3', 'pattern_4'], answers: ['Negative or degraded', 'Commerce or services'], count: 5, of: 14 };
  const three = { sentences: [good1, good2, good3] };
  // a fake model: the write answers `write`; the proofread answers `proof` (or throws it)
  const seen = [];
  const model = (write, proof) => async (m, prompt, schema, o) => {
    seen.push(o || {});
    if (!(o && o.proofread)) return typeof write === 'function' ? write(prompt) : write;
    if (proof instanceof Error) throw proof;
    return typeof proof === 'function' ? proof(prompt) : proof;
  };
  // the write: `first` the first time, `later` after
  const turns = (first, later) => { let k = 0; return () => (k++ ? later : first); };
  const warned = [];
  const warn = console.warn;
  console.warn = (msg) => { warned.push(String(msg)); };
  const p2Prompts = [];
  let p1, p2, p2b, p3, p4, p5, p6;
  try {
    p1 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type,
      call: model(three, { checks: [{ index: 0, ok: true, why: '' }, { index: 1, ok: false, why: 'says all, but its number is not the whole group' }, { index: 2, ok: true, why: '' }] }) });
    const second = turns(three, { sentences: [good2, good1] });
    p2 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type,
      call: model((pr) => { p2Prompts.push(pr); return second(); }, { checks: [{ index: 0, ok: false, why: 'stops part way' }, { index: 2, ok: false, why: 'contradicts itself' }] }) });
    p2b = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type,
      call: model(turns(three, { sentences: [good1, bad] }), { checks: [{ index: 0, ok: false, why: 'stops part way' }, { index: 2, ok: false, why: 'contradicts itself' }] }) });
    p3 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, call: model(three, new Error('too many readings in the last hour')) });
    p4 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, call: model(three, { checks: 'nonsense' }) });
    p5 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, call: model(three, { checks: [{ index: 9, ok: false, why: 'x' }, { index: '1', ok: 'no' }] }) });
    p6 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, timeoutMs: 50, call: model(three, () => new Promise(() => {})) });
  } finally { console.warn = warn; }
  check('a sentence the proofread marks not ok is dropped; the rest are kept, in order', p1.summary.sentences.map((s) => s.text), [good1.text, good3.text]);
  check('…kept as { text, questions } only: the cell is for checking', p1.summary.sentences.map((s) => Object.keys(s)), [['text', 'questions'], ['text', 'questions']]);
  check('…and the result says what the cell check kept and what the proofread dropped, and why',
    [p1.by, p1.checked.length, p1.proofread.dropped, p1.proofread.skipped, p1.rewrite], ['model', 3, [{ text: good2.text, why: 'says all, but its number is not the whole group' }], '', undefined]);
  check('…and the server\'s log says so, sentence and reason',
    warned.includes('[insight] proofread dropped: ' + good2.text + ' — says all, but its number is not the whole group'), true);
  check('the proofread is its own call, marked so, and asked as the write is', [seen[0].proofread, seen[1].proofread, seen[1].file], [undefined, true, true]);
  check('under two left after the proofread: written once more (no second proofread), and that is the summary',
    [p2.by, p2.summary.sentences.map((s) => s.text), p2.proofread.dropped.map((d) => d.why), p2.rewrite.kept.length, p2Prompts.length], ['model', [good2.text, good1.text], ['stops part way', 'contradicts itself'], 2, 2]);
  check('…the re-write is told what the proofread found, sentence by sentence',
    p2Prompts[1].startsWith(SUM.promptFor(T) + '\n') && p2Prompts[1].includes('Sentence 1 (“' + good1.text + '”): stops part way.') && p2Prompts[1].includes('Sentence 3 (“' + good3.text + '”): contradicts itself.'), true);
  check('…and when the re-write fails the cell check too: no summary', [p2b.summary, p2b.by, p2b.rewrite.dropped.map((d) => d.why)], [null, 'nothing usable', ['17 is not the cell for Negative or degraded; the table says 14']]);
  check('a refused proofread: the checked sentences stand, nothing thrown', [p3.summary.sentences.length, p3.by, /too many readings/.test(p3.proofread.skipped)], [3, 'model', true]);
  check('a proofread answer with nothing usable in it: the checked sentences stand', [p4.summary.sentences.length, p4.proofread.skipped, p5.summary.sentences.length, p5.proofread.skipped], [3, 'no usable answer', 3, 'no usable answer']);
  check('a proofread that takes too long: the checked sentences stand', [p6.summary.sentences.length, /took too long/.test(p6.proofread.skipped)], [3, true]);
  check('…and each skip is in the log', warned.filter((w) => w.startsWith('[insight] proofread skipped: ')).length, 4);
  const cells = IM.checkSentencesWithReasons([good1, good3, { ...pairRight, text: 'Of the 99 places that say both, 37 say Natural feature and Natural elements.', of: 99 }], T).kept;
  const pp = SUM.proofreadPromptFor(T, cells);
  check('the proofread is shown no tables: only the sentences, numbered, each with the fact its cell states',
    [pp.includes(JSON.stringify(T)), pp.includes('"pairs"'), pp.endsWith(JSON.stringify([
      { index: 0, text: good1.text, fact: 'Of the 115 places that answer “What is its environmental impact?”, 73 say Positive or preserved.' },
      { index: 1, text: good3.text, fact: 'Of the 14 places whose answer to “What is its environmental impact?” is Negative or degraded and that also answer “What is its primary function?”, 5 answer Commerce or services.' },
      { index: 2, text: 'Of the 99 places that say both, 37 say Natural feature and Natural elements.', fact: 'Of the 99 places that answer both “What is its current status?” and “What is its primary material or design?”, 37 answer Natural feature and Natural elements.' }]))],
    [false, false, true]);
  check('…the facts of the other shapes', IM.checkSentencesWithReasons([fewS,
    { text: '13 of the 33 places say nothing about the main feature.', questions: ['pattern_1'], answers: [], count: 13, of: 33 }], TC).kept.map((x) => SUM.factFor(TC, x)),
    ['Only 6 places answer “What is the place\'s condition?”.', '13 of the 33 places say nothing about “What is this place\'s main feature?”.']);
  check('…and asked only for an unfinished sentence or one saying what its fact does not; when unsure, ok',
    [/it is unfinished/, /it says something its fact does not/, /a number attached to the wrong answer/, /Different wording for the same fact is fine/, /When unsure, mark it ok/].every((r) => r.test(pp)), true);
  check('the stand-in\'s proofread passes every sentence', SUM.standInProofread(pp), { checks: [{ index: 0, ok: true, why: '' }, { index: 1, ok: true, why: '' }, { index: 2, ok: true, why: '' }] });
  // the server's cap is four calls: a write whose cells all fail, the retry, the proofread, the re-write
  const capped = (rewriteAnswer) => {
    let n = 0, proofs = 0;
    const prompts = [];
    const c = async (m, prompt, schema, o) => {
      if (n >= 4) throw new Error('this reading has used its share of the model');
      n++;
      if (o && o.proofread) { proofs++; return { checks: [{ index: 0, ok: false, why: 'stops part way' }, { index: 1, ok: false, why: 'stops part way' }] }; }
      prompts.push(prompt);
      return n === 1 ? { sentences: [bad, pct] } : n === 2 ? three : rewriteAnswer;
    };
    c.state = () => ({ n, proofs, prompts });
    return c;
  };
  const warned2 = [];
  console.warn = (msg) => { warned2.push(String(msg)); };
  let cA, cB, pcA, pcB;
  try {
    cA = capped({ sentences: [good1, good2] });
    pcA = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, call: cA });
    cB = capped({ sentences: [bad] });
    pcB = await SUM.writeSummary({ layer: bl, features: bf, prev: null, model: 'm', Type, call: cB });
  } finally { console.warn = warn; }
  check('the retry is told what was wrong with each sentence, and what the table says',
    cA.state().prompts[1].includes('Sentence 1 (“' + bad.text + '”): 17 is not the cell for Negative or degraded; the table says 14.') &&
    cA.state().prompts[1].includes('Sentence 2 (“' + pct.text + '”): it has a percentage, a link or markup.'), true);
  check('the write, its retry, the proofread and the re-write fit the caller\'s four calls; one proofread', [cA.state().n, cA.state().proofs, pcA.by, pcA.summary.sentences.length], [4, 1, 'model', 2]);
  check('…and a re-write that fails too: no summary, still four calls', [cB.state().n, pcB.summary, pcB.by], [4, null, 'nothing usable']);
  check('the server\'s summary caller allows four; its stand-in answers the proofread',
    /return aiCaller\(payer \|\| 'server', 4, stub\);/.test(server) && /if \(o && o\.proofread\) return insightSummary\.standInProofread\(prompt\);/.test(server), true);
}
{
  const P = SUM.promptFor(T);
  check('the prompt asks for short sentences, one fact each, finished, in one of four shapes',
    [/Under 25 words\. One fact per sentence; never join two facts with "and", "while" or a comma\. Finish every sentence\./, /- One question: /, /- Unanswered: /, /- A pair: /, /- Few answers /].every((r) => r.test(P)), true);
  check('a pair\'s row is the places that answer both: the shape says so',
    P.includes('- A pair: "Of the N places whose <first question, in plain words> is <Answer A> and that also answer <second question, in plain words>, M say <Answer B>."'), true);
  check('…and so does its fact', SUM.factFor(T, { cell: { shape: 'pair', questions: ['pattern_1', 'pattern_2'], answers: ['Natural feature', 'Natural elements'], count: 37, of: 38, ofRow: true } }),
    'Of the 38 places whose answer to “What is its current status?” is Natural feature and that also answer “What is its primary material or design?”, 37 answer Natural elements.');
  check('…"all" only when M equals N, and answer names kept as spelt',
    /Say "all" or "every" only when M equals N/.test(P) && /Keep every answer name exactly as the tables spell it/.test(P), true);
  check('the rules name no atlas\'s own answers', /tree|bark|shelter|species/i.test(SUM.promptFor({ places: 0, questions: [], pairs: [] })), false);
  const crypto = await import('node:crypto');
  const v2 = crypto.createHash('sha1').update('2\u0004' + JSON.stringify(T)).digest('hex').slice(0, 20);
  check('SUMMARY_VERSION is 3, so a summary kept under 2 is written again', [SUM.SUMMARY_VERSION, SUM.summarySig(T) !== v2], [3, true]);
  const kept2 = await SUM.writeSummary({ layer: bl, features: bf, prev: { summary: { sig: v2, sentences: [good1, good2] } }, call: fake({ sentences: [good1, good2] }), model: 'm', Type });
  check('…and is', kept2.by, 'model');
}

console.log('\n  after a reading: only in Insight with the summary on, never the operator\'s own atlas');
const NEVER = new Set(['deoria-bioregion']);
check('in Insight, summary on', SUM.shouldRewrite('a', { mode: { name: 'insight' } }, NEVER), true);
check('summary off', SUM.shouldRewrite('a', { mode: { name: 'insight', summaryOn: false } }, NEVER), 'summary off');
check('in Explore or Standard', [SUM.shouldRewrite('a', { mode: { name: 'explore' } }, NEVER), SUM.shouldRewrite('a', {}, NEVER)], ['not in Insight', 'not in Insight']);
check('deoria-bioregion is never touched', SUM.shouldRewrite('deoria-bioregion', { mode: { name: 'insight' } }, NEVER), 'never touched');
check('the reading\'s commit asks, after the Explore buttons, with the server\'s allowance',
  /reworkSmartButtons\(ds, id\)[^]*?insightSummary\.shouldRewrite\(ds, readOverlay\(ins\)\.local, NEVER_READ\) === true\) runInsightSummary\(ds, 'server', \{ markPending: true \}\)/.test(server), true);

/* ---------------- the pages ---------------- */
console.log('\n  the pages');
check('insight-mode.js loads after explore-mode.js and before atlas.js', page.indexOf('explore-mode.js?v=dev') < page.indexOf('insight-mode.js?v=dev') && page.indexOf('insight-mode.js?v=dev') < page.indexOf('src="./atlas.js?v=dev"'), true);
check('the viewer draws Insight when the mode says so, before the other modes', /if \(window\.LokaInsightMode && LokaInsightMode\.isOn\(m\)\)/.test(viewerSrc) && viewerSrc.indexOf('LokaInsightMode.isOn(m)') < viewerSrc.indexOf('LokaExploreMode.isOn(m)'), true);
check('no row of buttons in Insight, so no room kept for one', /var evRows = EV && !EV\.insight \?/.test(viewerSrc), true);
check('a place with no answer wears a hollow grey pin', /pin\.classList\.add\("in-hollow"\)/.test(imSrc), true);
check('the look is scoped to Insight (every rule\'s selector names an in- class)', imSrc.slice(imSrc.indexOf('var CSS = ['), imSrc.indexOf('].join("\\n");')).split('\n')
  .filter((l) => /^\s*"[^@]/.test(l)).filter((l) => !/\.in-[a-z]/.test(l.split('{')[0])).length, 0);
check('the place card says what each answer was read from', /Read from: <q>/.test(imSrc) && /Doesn\\u2019t say: /.test(imSrc), true);
check('owner tabs: Insight has the visitor\'s two and Settings (owner.js builds none; owner-modes.js adds Settings)',
  /if \(drawn === "insight"\) return;/.test(ownerJs) && !/"patterns", "Patterns"/.test(ownerJs) && /key: "settings", label: "Settings",/.test(ownerModes), true);
check('an editor gets no Settings tab (only the owner can save it): the visitor\'s tabs only',
  /if \(!INST \|\| INST\.role !== "owner"\) return;/.test(ownerModes.slice(ownerModes.indexOf('function insightTabs()'), ownerModes.indexOf('IM().viewer.extraTab = {'))), true);
check('See it as a visitor puts Settings away: the visitor\'s two tabs are left', /hidden: function \(\) \{ return VISITOR; \}/.test(ownerModes) && /if \(iv && iv\.renderPanel\) iv\.renderPanel\(\);/.test(ownerModes), true);
check('the dialog offers Insight, last, with its words', /var MODE_ORDER = \["standard", "event", "explore", "insight"\];/.test(ownerModes) && /For people reading patterns: the questions, with a short summary on top\./.test(ownerModes), true);
check('no questions yet: the sentence, and no Switch button', /if \(to === "insight" && !\(MODEINFO && MODEINFO\.canInsight\)\) \{\s*conf\.innerHTML = "<p>" \+ esc\(INSIGHT_NOT_READY\) \+ "<\/p>";\s*go\.hidden = true;/.test(ownerModes) &&
  /Insight needs the questions LOKA asks of the places\. They appear once the atlas has been read\./.test(ownerModes), true);
check('the Settings tab: summary switch, Write it again, a switch and arrows per question, the people one locked with its reason',
  /data-iact="sum"/.test(ownerModes) && /Write it again/.test(ownerModes) && /Writing…/.test(ownerModes) && /data-iact="up"/.test(ownerModes) && /data-iact="show"/.test(ownerModes) && /st\.people \? IM\(\)\.PEOPLE_REASON/.test(ownerModes), true);
check('saves say "Saved" and "Order saved"', /"Order saved"/.test(ownerModes) && /, "Saved"\)/.test(ownerModes), true);
check('the deploy scripts put an Insight in use aside, never away', keepAside({ mode: { name: 'insight', order: ['pattern_1'] } }, 'explore'), { insight: { name: 'insight', order: ['pattern_1'] } });

/* ---------------- the route, against a real server ---------------- */
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const PUBSLUG = 'insight-check-' + TAG, PRIVSLUG = 'insight-private-' + TAG, BARESLUG = 'insight-bare-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-insight-check-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', PUBSLUG);
const PRIV = path.join(DATA, 'private-datasets', PRIVSLUG);
const BARE = path.join(DATA, 'private-datasets', BARESLUG);
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test';
function seed(dir, fx, withQuestions) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Insight check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
  const L = { id: 'tags', label: 'Tags', group: 'userdata', type: 'marker', userLayer: true, source: 'user-tags.geojson' };
  if (withQuestions) Object.assign(L, { keyLabels: fx.layer.keyLabels, keyKinds: fx.layer.keyKinds, keyColumns: fx.layer.keyColumns, keyNouns: fx.layer.keyNouns });
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [L] }));
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features: fx.features }));
}
seed(PUB, BLR, true);
seed(PRIV, CUB, true);
seed(BARE, CUB, false);
const rec = (slug, vis) => ({ slug, title: 'Insight check', visibility: vis, status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
  tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }] });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [PUBSLUG]: rec(PUBSLUG, 'public'), [PRIVSLUG]: rec(PRIVSLUG, 'private'), [BARESLUG]: rec(BARESLUG, 'private') },
  accounts: { [OWNER]: { email: OWNER, instances: [PUBSLUG, PRIVSLUG, BARESLUG], verifiedAt: 1 }, [EDITOR]: { email: EDITOR, instances: [], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
  drafts: {},
}));
let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [PUB, DATA]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
process.on('exit', cleanup);
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: 'nobody@example.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) throw new Error('server did not start:\n' + out.slice(-800));
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function signIn(email) {
  const before = out.length;
  let r = await fetch(BASEURL + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('request-link ' + r.status);
  const t0 = Date.now();
  let code = null;
  while (!code) {
    const m = /Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(out.slice(before));
    if (m) code = m[1];
    else if (Date.now() - t0 > 5000) throw new Error('no code in the log');
    else await new Promise((r) => setTimeout(r, 50));
  }
  r = await fetch(BASEURL + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  if (!r.ok) throw new Error('verify-code ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function call(method, p, { cookie, body } = {}) {
  const r = await fetch(BASEURL + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const fileOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'));
const written = (slug) => (out.match(new RegExp('\\[insight\\] ' + slug + ' — summary: model', 'g')) || []).length;
async function settled(dir) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const f = fileOf(dir);
    if (f.mode && !f.mode.summaryPending) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fileOf(dir);
}

try {
  console.log('\n  the route, on a throwaway server (' + BASEURL + ')');
  await startServer();
  const ownerC = await signIn(OWNER), editorC = await signIn(EDITOR), otherC = await signIn(OTHER);
  const M = (slug) => `/api/atlas/instances/${slug}/mode`;
  for (const [slug, dir, label, fx] of [[PUBSLUG, PUB, 'public', BLR], [PRIVSLUG, PRIV, 'private', CUB]]) {
    console.log('\n  a ' + label + ' atlas');
    const start = fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8');
    check('nobody signed in may not switch it to Insight', (await call('POST', M(slug), { body: { name: 'insight' } })).status, 403);
    check('a signed-in stranger may not', (await call('POST', M(slug), { cookie: otherC, body: { name: 'insight' } })).status, 403);
    check('an editor may not, nor change its settings, nor have the summary written',
      [(await call('POST', M(slug), { cookie: editorC, body: { name: 'insight' } })).status, (await call('POST', M(slug), { cookie: editorC, body: { insight: { summaryOn: false } } })).status,
        (await call('POST', M(slug), { cookie: editorC, body: { rewriteSummary: true } })).status], [403, 403, 403]);
    check('nothing was written by any of them', fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'), start);
    check('the owner is told Insight can be chosen', (await call('GET', M(slug), { cookie: ownerC })).j.canInsight, true);
    check('settings are refused while not in Insight', (await call('POST', M(slug), { cookie: ownerC, body: { insight: { summaryOn: false } } })).status, 409);
    const sw = await call('POST', M(slug), { cookie: ownerC, body: { name: 'insight' } });
    check('switched: Insight, every question shown but people ones, the summary being written', [sw.status, sw.j.name, sw.j.mode.summaryOn, sw.j.mode.summaryPending, sw.j.mode.shown],
      [200, 'insight', true, true, IM.defaultInsight(fx.layer).shown]);
    let f = await settled(dir);
    check('the summary is written after the answer: at least two sentences, the stand-in\'s, each through the cell check', [!!f.mode.summary, f.mode.summary && f.mode.summary.sentences.length >= 2,
      f.mode.summary && JSON.stringify(f.mode.summary.sentences) === JSON.stringify(IM.checkSentences(SUM.standInAnswer(IM.summaryTables(fx.layer, fx.features)).sentences, IM.summaryTables(fx.layer, fx.features)))], [true, true, true]);
    check('one model call', written(slug), 1);
    if (label === 'public') {
      const peep = await call('POST', M(slug), { cookie: ownerC, body: { insight: { shown: { pattern_5: true } } } });
      check('the owner trying to show the people question is refused, and nothing changes', [peep.status, peep.j.error, fileOf(dir)], [400, IM.PEOPLE_REFUSED, f]);
      check('…nor is a people answer anywhere in the summary', /Person [A-D]|Other users/.test(JSON.stringify(f.mode.summary)), false);
    }
    const ord = IM.settingsOf(fx.layer, f.mode).order.slice().reverse();
    const set = await call('POST', M(slug), { cookie: ownerC, body: { insight: { order: ord, shown: { pattern_1: false } } } });
    f = fileOf(dir);
    check('order and switches saved; the summary kept (no call)', [set.status, f.mode.order, f.mode.shown.pattern_1, written(slug), !!f.mode.summary], [200, ord, false, 1, true]);
    const off = await call('POST', M(slug), { cookie: ownerC, body: { insight: { summaryOn: false } } });
    check('the summary switched off', [off.status, fileOf(dir).mode.summaryOn], [200, false]);
    check('…and Write it again is refused while it is off', (await call('POST', M(slug), { cookie: ownerC, body: { rewriteSummary: true } })).status, 409);
    await call('POST', M(slug), { cookie: ownerC, body: { insight: { summaryOn: true } } });
    check('back on, with the same answers: no call', [written(slug), fileOf(dir).mode.summaryPending], [1, undefined]);
    const before = fileOf(dir);
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'standard' } });
    f = fileOf(dir);
    check('to Standard: no mode, the Insight settings kept whole', ['mode' in f, f.modeKept && f.modeKept.insight], [false, before.mode]);
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'explore' } });
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'insight' } });
    f = fileOf(dir);
    check('to Explore and back to Insight: the same settings and summary, no call', [f.mode, written(slug), f.modeKept && 'insight' in f.modeKept], [before.mode, 1, false]);
    const again = await call('POST', M(slug), { cookie: ownerC, body: { rewriteSummary: true } });
    check('Write it again: one more call, the answer carries the summary', [again.status, again.j.by, written(slug), !!again.j.mode.summary, again.j.mode.summaryPending], [200, 'model', 2, true, undefined]);
  }
  check('a private atlas is written where it lives, never in the public folder', fs.existsSync(path.join(ROOT, 'atlas', 'datasets', PRIVSLUG)), false);
  console.log('\n  an atlas not yet read');
  check('the owner is told Insight cannot be chosen yet', (await call('GET', M(BARESLUG), { cookie: ownerC })).j.canInsight, false);
  const bare = await call('POST', M(BARESLUG), { cookie: ownerC, body: { name: 'insight' } });
  check('switching is refused in the sentence the dialog shows', [bare.status, bare.j.error, bare.j.needsQuestions], [409, IM.NO_QUESTIONS, true]);
  check('a name not among the four is refused, naming them', (await call('POST', M(BARESLUG), { cookie: ownerC, body: { name: 'field' } })).j.error, 'Choose Standard, Event, Explore or Insight.');
} catch (e) {
  fail++;
  console.log('  FAIL the route checks stopped: ' + (e && e.message) + '\n' + out.slice(-1500));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
