/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Insight mode (atlas/insight-mode.js, api/lib/atlas/insight-summary.js),
 * 25 October 2026: the questions LOKA asked of the places, as bar lists that
 * colour the map, with "Voices" above them — one panel, named
 * Insights, since 5 Nov 2026 (the owner has one tab more, Settings).
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
check('"being written" for over seven minutes is stuck, not pending; no time is not pending (the story is four Pro calls, not four flash ones)',
  [IM.isPending({ summaryPending: true, summaryPendingAt: Date.now() - 1000 }), IM.isPending({ summaryPending: true, summaryPendingAt: Date.now() - 1000 - IM.PENDING_STALE_MS }), IM.isPending({ summaryPending: true }), IM.PENDING_STALE_MS], [true, false, false, 7 * 60 * 1000]);

console.log('\n  one panel, "Insights": Voices on top, the questions below (Mithun, 5 Nov 2026)');
const sumMode = { summaryOn: true, summary: { sentences: [good1, good2] } };
const shownBoth = ['pattern_3', 'pattern_4'];
check('a visitor has the one panel and so no tab row at all — summary or no summary, being written or not',
  [IM.panelTabs(sumMode, shownBoth), IM.panelTabs({ summaryOn: false, summary: sumMode.summary }, shownBoth),
    IM.panelTabs({ summaryOn: true, summary: null }, shownBoth),
    IM.panelTabs({ summaryOn: true, summary: null, summaryPending: true, summaryPendingAt: Date.now() }, shownBoth)], [[], [], [], []]);
const ownerTab = { key: 'settings', label: 'Settings' };
check('the owner sees Insights · Settings, and the same with the summary switched off',
  [IM.panelTabs(sumMode, shownBoth, ownerTab).map((x) => x.key + ':' + x.label),
    IM.panelTabs({ summaryOn: false }, shownBoth, ownerTab).map((x) => x.key + ':' + x.label)],
  [['q:Insights', 'settings:Settings'], ['q:Insights', 'settings:Settings']]);
/* The phone sheet's head is a kicker ("INSIGHTS") over a count line ("96
   places"). Before the places were counted the count line fell back to the
   label, so the head read "INSIGHTS / Insights" (and "VENUES / Venues" on a
   festival guide) until the map had loaded — 7 Nov 2026. Now an empty count
   is an empty line, which the page's own css hides (.sheet-layer:empty). */
const evHeadSrc = fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8');
const exHeadSrc = fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8');
check('before the places are counted the head says "Insights" once, over an empty line',
  /if \(!state\.ready\) return \{ label: "Insights", small: "" \};/.test(imSrc) &&
  /if \(sh\.small\) who\.appendChild\(el\("span", "sheet-layer-name", esc\(sh\.small\)\)\);/.test(imSrc), true);
check('and no head — the page\'s, Event\'s, Explore\'s — writes the label where the count goes',
  [viewerSrc, evHeadSrc, exHeadSrc, imSrc].map((s) => /esc\(sh\.small \|\| sh\.label\)/.test(s)), [false, false, false, false]);
check('the page hides an empty count line', /\.sheet-layer:empty \{ display:none; \}/.test(page), true);
check('Voices is drawn above the questions in that one panel, and when there is nothing to say it is not drawn at all (no empty heading)',
  [/var voice = voiceHTML\(\);/.test(imSrc),
    /var h = voice \+ '<div class="in-sect"><span class="in-stamp">The questions/.test(imSrc),
    /if \(isPending\(mode\)\)[\s\S]*?\n      return "";\n    }/.test(imSrc)], [true, true, true]);
check('the second tab and its "see the questions" link are gone, and the old name with them',
  [/What the places say/.test(imSrc), /in-tolink/.test(imSrc), /data-in="tab"/.test(imSrc), /Story of the place in their own words/.test(imSrc)], [false, false, false, true]);
const voiceCSS = IM.CSS.split('\n').filter((r) => /^\s*"?\.in-sum|^\s*"?\.in-quotes|^\s*"?\.in-fq/.test(r)).join(' ');
check('the layout is plain: no box, no background, no left rule, no rule between, no indent',
  [/border-left|border-top|border-radius|border:\s*1px|background:\s*(?!none)/.test(voiceCSS), /padding-left|padding:\s*[^0;}]/.test(voiceCSS), /list-style:none/.test(voiceCSS)],
  [false, false, true]);
check('the atlas opens on that one panel; there is no second tab to open on', /state = \{ ready: false, tab: null,/.test(imSrc) && /curTab\(\) === "sum"/.test(imSrc), false);
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
  check('the server\'s story caller allows four; its stand-in answers the proofread',
    /return aiCaller\(payer \|\| 'server', 4, stub\);/.test(server) && /if \(o && o\.proofread\) return insightSummary\.standInStoryProofread\(prompt\);/.test(server), true);
}
{
  const P = SUM.promptFor(T);
  check('the prompt asks for short sentences, one fact each, finished, in one of four shapes',
    [/Under 25 words\. One fact per sentence; never join two facts with "and", "while" or a comma\. Finish every sentence\./, /- One question: /, /- Unanswered: /, /- A pair: /, /- Few answers /].every((r) => r.test(P)), true);
  check('a pair\'s row is the places that answer both: the shape says so',
    P.includes('- A pair: "Of the N places whose <first topic> is <Answer A> and that also name a <second topic>, M say <Answer B>."'), true);
  check('…and so does its fact', SUM.factFor(T, { cell: { shape: 'pair', questions: ['pattern_1', 'pattern_2'], answers: ['Natural feature', 'Natural elements'], count: 37, of: 38, ofRow: true } }),
    'Of the 38 places whose answer to “What is its current status?” is Natural feature and that also answer “What is its primary material or design?”, 37 answer Natural elements.');
  check('…"all" only when M equals N, and answer names kept as spelt',
    /Say "all" or "every" only when M equals N/.test(P) && /Keep every answer name exactly as the tables spell it/.test(P), true);
  check('the rules name no atlas\'s own answers', /tree|bark|shelter|species/i.test(SUM.promptFor({ places: 0, questions: [], pairs: [] })), false);
  check('the prompt tells the writer to name each question by its topic, not copy it',
    [P.includes('Name each question by its topic in two or three plain words, never by copying the question.'), P.includes('Never write "what is" or "answer what".'), /<first topic>/.test(P)], [true, true, true]);
  const ENR = await import('../api/lib/atlas/enrich.js');
  const q70 = 'What kinds of places here are meant for people to sit and rest awhile?';
  check('a 70-character question is kept whole; one over 120 is cut at a word with "?"',
    [q70.length, ENR.clipQuestion(q70), ENR.clipQuestion('word '.repeat(40)).length <= 121, /\?$/.test(ENR.clipQuestion('word '.repeat(40))), / \?$/.test(ENR.clipQuestion('word '.repeat(40)))], [70, q70, true, true, false]);
  check('the clip agrees with the server\'s own cap',
    [/const MAX_QUESTION_CHARS = (\d+);/.exec(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../api/apps/atlas.js'), 'utf8'))[1] * 1], [ENR.MAX_QUESTION_CHARS]);
  const crypto = await import('node:crypto');
  const v2 = crypto.createHash('sha1').update('2\u0004' + JSON.stringify(T)).digest('hex').slice(0, 20);
  check('SUMMARY_VERSION is 4, so a summary kept under 2 is written again', [SUM.SUMMARY_VERSION, SUM.summarySig(T) !== v2], [4, true]);
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
const SAYSLUG = 'insight-say-' + TAG, OLDSLUG = 'insight-old-' + TAG, OLDBARESLUG = 'insight-oldbare-' + TAG;
// what an atlas written before the story carries: a summary, and no story at all
const OLDSUM = { sig: 'from-before', at: 1, sentences: [{ text: 'Of the 26 places that say what kind of place they are, 20 say Garden.', questions: ['pattern_1'] },
  { text: 'Of the 26 places that say what kind of place they are, 6 say Shrine.', questions: ['pattern_1'] }] };
const OLDMODE = (fx) => ({ ...IM.defaultInsight(fx.layer), layer: 'tags', summary: OLDSUM });
/* An atlas whose places have words of their own, so the whole of "What the
   places say" runs: the digest, the stand-in's paragraph, the proofread,
   the quotes under it. Every place carries a tagger (pattern_5, read from
   created_by), who must appear nowhere in the story or on the card. */
const SAYFX = (() => {
  const layer = { id: 'tags', popup: { title: 'name' }, keyNouns: { pattern_1: 'kind of place', pattern_2: 'what it is made of' },
    keyLabels: { pattern_1: 'What kind of place is it?', pattern_2: 'What is it made of?', pattern_5: 'Who created this place?' },
    keyColumns: { pattern_5: ['created_by'] } };
  const corner = ['by the gate', 'behind the library', 'near the water tank', 'at the bus stand', 'under the flyover', 'beside the school'];
  let n = 0;
  const place = (id, p1, p2, description) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.59 + (n++) / 1000, 12.97] },
    properties: { tag_id: id, name: 'Place ' + id, description, pattern_1: p1, pattern_1_why: '', pattern_2: p2, pattern_2_why: '',
      pattern_5: 'Pratham', created_by: 'Pratham' } });
  const features = [];
  for (let i = 1; i <= 6; i++) features.push(place('g' + i, 'Garden', 'Natural elements', 'A quiet garden ' + corner[i - 1] + ' where the old rain tree still stands.'));
  for (let i = 1; i <= 4; i++) features.push(place('s' + i, 'Shrine', 'Stone or masonry', 'A small stone shrine ' + corner[i - 1] + ', but somebody still keeps it clean.'));
  features.push(place('d1', 'Garden', 'Natural elements', 'I love this garden and the shade here is wonderful on a hot day.'));
  features.push(place('d2', 'Garden', 'Natural elements', 'A lovely corner, peaceful and green, and the benches are a treat.'));
  features.push(place('w1', 'Garden', 'Natural elements', 'The trees here have been cut down for a building site and the shade is gone.'));
  features.push(place('w2', 'Garden', 'Natural elements', 'Rubbish is dumped by the wall and the water in the tank is dirty.'));
  features.push(place('q1', 'Shrine', 'Stone or masonry', 'Does anyone know who built this shrine, and when?'));
  return { layer, features };
})();
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-insight-check-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', PUBSLUG);
const PRIV = path.join(DATA, 'private-datasets', PRIVSLUG);
const BARE = path.join(DATA, 'private-datasets', BARESLUG);
const SAY = path.join(DATA, 'private-datasets', SAYSLUG);
const OLD = path.join(DATA, 'private-datasets', OLDSLUG);
const OLDBARE = path.join(DATA, 'private-datasets', OLDBARESLUG);
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test';
function seed(dir, fx, withQuestions, mode) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Insight check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
  const L = { id: 'tags', label: 'Tags', group: 'userdata', type: 'marker', userLayer: true, source: 'user-tags.geojson' };
  if (withQuestions) Object.assign(L, { keyLabels: fx.layer.keyLabels, keyKinds: fx.layer.keyKinds, keyColumns: fx.layer.keyColumns, keyNouns: fx.layer.keyNouns });
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify(mode ? { layers: [L], mode } : { layers: [L] }));
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features: fx.features }));
}
seed(PUB, BLR, true);
seed(PRIV, CUB, true);
seed(BARE, CUB, false);
seed(SAY, SAYFX, true);
seed(OLD, SAYFX, true, OLDMODE(SAYFX));
seed(OLDBARE, BLR, true, OLDMODE(BLR));
const rec = (slug, vis) => ({ slug, title: 'Insight check', visibility: vis, status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
  tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }] });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [PUBSLUG]: rec(PUBSLUG, 'public'), [PRIVSLUG]: rec(PRIVSLUG, 'private'), [BARESLUG]: rec(BARESLUG, 'private'), [SAYSLUG]: rec(SAYSLUG, 'private'), [OLDSLUG]: rec(OLDSLUG, 'private'), [OLDBARESLUG]: rec(OLDBARESLUG, 'private') },
  accounts: { [OWNER]: { email: OWNER, instances: [PUBSLUG, PRIVSLUG, BARESLUG, SAYSLUG, OLDSLUG, OLDBARESLUG], verifiedAt: 1 }, [EDITOR]: { email: EDITOR, instances: [], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
  drafts: {},
}));
let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [PUB, DATA]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
process.on('exit', cleanup);
async function startServer(extra) {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: 'nobody@example.test', ...(extra || {}) },
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
// runs of the story job, and the ones a model actually wrote
const ran = (slug) => (out.match(new RegExp('\\[insight\\] ' + slug + ' — story: ', 'g')) || []).length;
const written = (slug) => (out.match(new RegExp('\\[insight\\] ' + slug + ' — story: model', 'g')) || []).length;
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
    /* These two fixtures carry no words of anybody's own (they were scrubbed
       to hold no tagger and no free text), so the story has nothing to quote.
       What matters here is the plumbing: the fingerprint is kept even then, so
       the job is not run again on every update, and the older summary is gone. */
    check('the story is written after the answer; with nothing worth quoting it still keeps its fingerprint',
      [!!f.mode.story, f.mode.story.sentences.length, f.mode.story.quotes.length, !!f.mode.story.sig, f.mode.summary],
      [true, 0, 0, true, null]);
    check('one run, and no model asked: these places have no words of their own', [ran(slug), written(slug)], [1, 0]);
    if (label === 'public') {
      const peep = await call('POST', M(slug), { cookie: ownerC, body: { insight: { shown: { pattern_5: true } } } });
      check('the owner trying to show the people question is refused, and nothing changes', [peep.status, peep.j.error, fileOf(dir)], [400, IM.PEOPLE_REFUSED, f]);
      check('\u2026nor is a people answer anywhere in the story', /Person [A-D]|Other users/.test(JSON.stringify(f.mode.story)), false);
    }
    const ord = IM.settingsOf(fx.layer, f.mode).order.slice().reverse();
    const set = await call('POST', M(slug), { cookie: ownerC, body: { insight: { order: ord, shown: { pattern_1: false } } } });
    f = fileOf(dir);
    // switching a question off is not worth four calls to a Pro model: the card drops that question's quotes instead
    check('order and switches saved; the story kept, and no run at all',
      [set.status, f.mode.order, f.mode.shown.pattern_1, ran(slug), f.mode.summaryPending], [200, ord, false, 1, undefined]);
    const off = await call('POST', M(slug), { cookie: ownerC, body: { insight: { summaryOn: false } } });
    check('Voices switched off', [off.status, fileOf(dir).mode.summaryOn], [200, false]);
    check('\u2026and Write it again is refused while it is off', (await call('POST', M(slug), { cookie: ownerC, body: { rewriteSummary: true } })).status, 409);
    await call('POST', M(slug), { cookie: ownerC, body: { insight: { summaryOn: true } } });
    check('back on, with the same places: still no run', [ran(slug), fileOf(dir).mode.summaryPending], [1, undefined]);
    const before = fileOf(dir);
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'standard' } });
    f = fileOf(dir);
    check('to Standard: no mode, the Insight settings kept whole', ['mode' in f, f.modeKept && f.modeKept.insight], [false, before.mode]);
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'explore' } });
    await call('POST', M(slug), { cookie: ownerC, body: { name: 'insight' } });
    f = fileOf(dir);
    check('to Explore and back to Insight: the same settings and the same story, no run', [f.mode, ran(slug), f.modeKept && 'insight' in f.modeKept], [before.mode, 1, false]);
    const again = await call('POST', M(slug), { cookie: ownerC, body: { rewriteSummary: true } });
    check('Write it again: one more run, and the answer carries the story', [again.status, again.j.by, ran(slug), !!again.j.mode.story, again.j.mode.summaryPending],
      [200, 'no place has words worth quoting', 2, true, undefined]);
  }
  console.log('\n  an atlas whose places have words of their own: the whole story');
  {
    const sw = await call('POST', M(SAYSLUG), { cookie: ownerC, body: { name: 'insight' } });
    check('switched to Insight, the story being written', [sw.status, sw.j.mode.summaryPending], [200, true]);
    const f = await settled(SAY);
    const st = f.mode.story;
    check('the story is kept whole: a paragraph, the quotes it rests on, its fingerprint, and the older summary gone',
      [st.sentences.length >= 2, st.quotes.length >= 2, st.ownWords, !!st.sig, typeof st.at, 'summary' in f.mode],
      [true, true, false, true, 'number', false]);
    check('every quote shown is one place\u2019s own words, word for word, and is cited by a sentence that stands',
      [st.quotes.every((q) => SAYFX.features.some((x) => x.properties.tag_id === q.id && x.properties.description.indexOf(q.text) >= 0)),
        st.quotes.every((q) => st.sentences.some((x) => x.quotes.indexOf(q.id) >= 0))], [true, true]);
    check('the model wrote it: the write and its proofread, each named in the log, on the two models the config names',
      [written(SAYSLUG), /\[insight\] .* \u2014 write on /.test(out), /\[insight\] .* \u2014 proofread on /.test(out)], [1, true, true]);
    check('no tagger anywhere in what was kept', /Pratham/.test(JSON.stringify(f.mode)), false);
    /* The card a visitor sees, from the very overlay the server wrote. */
    const shown = IM.storyToShow(f.mode, SAYFX.layer, SAYFX.features);
    const card = IM.storyCardHTML(shown);
    check('the card shows the paragraph, then the quotes, each a button to its place, then the small print',
      [card.indexOf('in-story') < card.indexOf('in-quotes'), card.indexOf(st.sentences[0].text) >= 0,
        (card.match(/data-in="place" data-i="\d+"/g) || []).length, /See \u201cPlace /.test(card),
        /Written by AI from what people wrote about these places\. The counts are in the questions\./.test(card),
        /Pratham/.test(card.replace(/<span class="in-by-name">[^<]*<\/span>/g, ''))],
      [true, true, shown.quotes.length, true, true, false]);
    check('a visitor reads it in the one Insights panel, with no tab row, and the owner has Settings beside it',
      [IM.panelTabs(f.mode, ['pattern_1', 'pattern_2']), IM.panelTabs(f.mode, ['pattern_1', 'pattern_2'], { key: 'settings', label: 'Settings' }).map((t) => t.key + ':' + t.label),
        /aria-label="Story of the place in their own words"/.test(card), card.indexOf('Story of the place') < card.indexOf('in-story')],
      [[], ['q:Insights', 'settings:Settings'], true, true]);
  }
  check('a private atlas is written where it lives, never in the public folder', fs.existsSync(path.join(ROOT, 'atlas', 'datasets', PRIVSLUG)), false);
  console.log('\n  an atlas not yet read');
  check('the owner is told Insight cannot be chosen yet', (await call('GET', M(BARESLUG), { cookie: ownerC })).j.canInsight, false);
  const bare = await call('POST', M(BARESLUG), { cookie: ownerC, body: { name: 'insight' } });
  check('switching is refused in the sentence the dialog shows', [bare.status, bare.j.error, bare.j.needsQuestions], [409, IM.NO_QUESTIONS, true]);
  check('a name not among the four is refused, naming them', (await call('POST', M(BARESLUG), { cookie: ownerC, body: { name: 'field' } })).j.error, 'Choose Standard, Event, Explore or Insight.');

  /* ---- the model cannot be had at all ----
     The same server again with no model and no stand-in, which is what an
     outage looks like from here. Nothing may be written over what stands, and
     nothing may be stamped with this fingerprint, or it would never be tried
     again (Mithun, 5 Nov 2026). */
  console.log('\n  the model cannot be had');
  const sayBefore = fileOf(SAY).mode.story;
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 400));
  out = '';
  await startServer({ ATLAS_FAKE_READING: '' });
  const ownerC2 = await signIn(OWNER);
  const tryAgain = async (slug, dir) => {
    const j = await call('POST', M(slug), { cookie: ownerC2, body: { rewriteSummary: true } });
    return [j, await settled(dir)];
  };
  {
    const [j, f] = await tryAgain(SAYSLUG, SAY);
    check('an atlas with a story: the one that stands is left exactly as it was, and the owner is told why',
      [j.status, f.mode.story, f.mode.storyFailed.why, typeof f.mode.storyFailed.at, f.mode.summaryPending],
      [200, sayBefore, 'the writer could not be reached', 'number', undefined]);
    check('…and the model’s own words never reach the overlay, which is public',
      /503|overloaded|refused|Error|no model|no answer/.test(JSON.stringify(f.mode.storyFailed)), false);
  }
  {
    const [j, f] = await tryAgain(OLDSLUG, OLD);
    check('an atlas written before the story: its summary stands, nothing is stamped, so the next update tries again',
      [j.status, 'story' in f.mode, f.mode.summary, f.mode.storyFailed.why],
      [200, false, OLDSUM, 'the writer could not be reached']);
    check('…and Voices still shows that summary to a visitor',
      [IM.storyToShow(f.mode, SAYFX.layer, SAYFX.features),
        IM.visibleSentences(f.mode.summary, IM.shownStats(SAYFX.layer, SAYFX.features, f.mode).map((st) => st.col)).length],
      [null, f.mode.summary.sentences.length]);
  }
  {
    // a run that honestly finds nothing is no failure: it is stamped, and the older summary stays until a story stands
    const [j, f] = await tryAgain(OLDBARESLUG, OLDBARE);
    check('a run that found nothing to say: stamped so it is not asked again, the summary kept, and no failure recorded',
      [j.j.by, !!f.mode.story.sig, f.mode.story.sentences.length, f.mode.summary, 'storyFailed' in f.mode],
      ['no place has words worth quoting', true, 0, OLDSUM, false]);
    check('…and Voices still shows the summary', [IM.storyToShow(f.mode, SAYFX.layer, SAYFX.features), IM.visibleSentences(f.mode.summary, ['pattern_1']).length], [null, 2]);
  }
} catch (e) {
  fail++;
  console.log('  FAIL the route checks stopped: ' + (e && e.message) + '\n' + out.slice(-1500));
}

/* ---------------- the key, and the coloured discs (Mithun, 7 Nov 2026) ----------------
   The "Coloured by" chip is the key: the question, then one row per answer
   (dot, name, count), at most six, "+ n more" after them, "Doesn't say" when
   any place is blank; open everywhere, folded to the one-line chip by a tap on
   the question. The same six answers colour the counted discs (atlas.js,
   COLOURED DISCS): the viewer lends the colouring through api.colourDiscs, and
   a place's slot is its answer's index, blank or past the sixth into the pool.
   A chosen answer's places never fold (answerOn). Run for real on the
   Bengaluru fixture with a stand-in page. */
console.log('\n  the key, and the coloured discs');
{
  const lent = [];
  const vapi = { esc: (x) => String(x), el: () => ({}), data: () => ({ features: bf }), markers: () => [], locPinEl: () => ({}), shotsHTML: () => '', linksIn: () => [],
    cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false, colourDiscs: (c) => lent.push(c) };
  const v = IM.viewer(IM.defaultInsight(bl), vapi);
  const X = v.layers([bl])[0];
  v.ready();
  const st = IM.shownStats(bl, bf, IM.defaultInsight(bl))[0];
  check('the map opens coloured by the first question, and the discs are lent that colouring at once', [v.state.open, lent.length, lent[0] && lent[0].colours], ['pattern_1', 1, st.answers.map((a) => a.color)]);
  const c = lent[0];
  check('its names are the key\'s, and the pool is "Doesn’t say"', [c.names, c.pool], [st.answers.map((a) => a.name), 'Doesn’t say']);
  const first = bf.find((f) => f.properties.pattern_1 === st.answers[0].name), blank = bf.find((f) => !f.properties.pattern_1);
  check('a place\'s slot is its answer\'s place in the key; a blank place goes into the pool (6); so does another marker layer\'s place, which does not answer the question (its disc\'s shares stay right)',
    [c.slotOf(X, first), c.slotOf(X, blank), c.slotOf({ id: 'other' }, { properties: { name: 'x' } })], [0, 6, 6]);
  const html = v.chipsHTML();
  const rows = (html.match(/<li>/g) || []).length;
  check('the key: the question on top, one row per answer with its count, "Doesn’t say" with the blank count, open by default (aria-expanded)',
    [/Coloured by: What is its current status\?/.test(html), rows, />Established<\/span><span class="in-key-n">92<\/span>/.test(html), /Doesn’t say<\/span><span class="in-key-n">1<\/span>/.test(html), /aria-expanded="true"/.test(html), /data-folded="0"/.test(html), /▾/.test(html)],
    [true, 3, true, true, true, true, true]);
  v.state.keyFolded = true;
  const folded = v.chipsHTML();
  check('folded: the same chip, one line, aria-expanded false and the chevron pointing on', [/aria-expanded="false"/.test(folded), /data-folded="1"/.test(folded), /▸/.test(folded), /in-key-l/.test(folded)], [true, true, true, true]);
  v.state.keyFolded = false;
  check('a tap on the question folds and opens it (data-in="key"), and the list is hidden by css when folded',
    [/data-in="key"/.test(html), /if \(d === "key"\) \{ state\.keyFolded = !state\.keyFolded; renderChips\(\); return; \}/.test(imSrc), /\.in-key\[data-folded=\\"1\\"\] \.in-key-l\{display:none\}/.test(imSrc)], [true, true, true]);
  // more than six answers: six rows, "+ n more", and the rest pooled on the discs
  const many = bf.map((f, i) => ({ type: 'Feature', geometry: f.geometry, properties: { ...f.properties, pattern_4: i < 8 ? 'Kind ' + i : i < 40 ? 'Kind 0' : '' } }));
  const lent2 = [];
  const v2 = IM.viewer(IM.defaultInsight(bl), { ...vapi, data: () => ({ features: many }), colourDiscs: (c) => lent2.push(c) });
  const X2 = v2.layers([bl])[0];
  v2.ready();
  v2.state.open = 'pattern_4'; v2.state.filter = null;
  v2.state.keyFolded = false;
  const st4 = IM.stats(bl, many, 'pattern_4');
  const html2 = (v2.chipsHTML());
  check('a question with eight answers: six rows, "+ 2 more", then "Doesn’t say"', [(html2.match(/<li>/g) || []).length, /\+ 2 more/.test(html2), /\+ 2 more<\/li><li><span class="in-sw in-sw-none">/.test(html2)], [7, true, true]);
  v2.state.open = 'pattern_1'; v2.renderPanel(); v2.state.open = 'pattern_4';
  const c2 = v2.discColouring();
  const seventh = many.find((f) => f.properties.pattern_4 === st4.answers[6].name);
  check('…and on the discs the seventh answer pools with the blanks, the pool saying so', [c2.colours.length, c2.slotOf(X2, seventh), c2.pool], [6, 6, 'Doesn’t say, or another answer']);
  // the chosen answer never folds
  check('no answer chosen: the layer folds as any other', v.answerOn(X), false);
  v.state.filter = { col: 'pattern_1', ans: 'established' };
  check('an answer chosen: its layer is exempt from the fold (atlas.js answerNamesOn asks EV.answerOn), another layer is not', [v.answerOn(X), v.answerOn({ id: 'other' })], [true, false]);
  check('a chosen answer\'s chip comes after the key (above it on a phone: column-reverse), with its count',
    [/Established · 92 places/.test(v.chipsHTML()), v.chipsHTML().indexOf('in-key') < v.chipsHTML().indexOf('Established · 92'), /flex-direction:column-reverse/.test(imSrc)], [true, true, true]);
  v.state.filter = null;
  check('the question changing lends the discs the new colouring; choosing an answer does not', (() => { const n = lent.length; v.state.open = 'pattern_4'; v.state.filter = { col: 'pattern_4', ans: 'x' }; v.renderPanel(); return lent.length - n; })(), 0);
  check('the page asks the mode (EV.answerOn) and treats it as a Standard key\'s picked answer', /if \(EV && EV\.answerOn && EV\.answerOn\(L\)\) return true;/.test(viewerSrc), true);
  check('on a phone the key stands above the credits strip, clear of the LOKA badge, and the cue is lifted over it by the key\'s measured height',
    [/bottom:calc\(var\(--sheet-h,0px\) \+ 48px\);flex-direction:column-reverse/.test(imSrc), /\.in-chip\.in-key\{max-width:228px\}/.test(imSrc), /\.atlas-stage\.in-on \.atlas-cue\{bottom:calc\(var\(--sheet-h,0px\) \+ var\(--in-chips-h,0px\) \+ 60px\)\}/.test(imSrc), /--in-chips-h/.test(imSrc)], [true, true, true, true]);
  check('and the map frames the places above the key, not behind it (viewPadding) — with the sheet folded away too',
    [/chips\.offsetHeight \+ 48/.test(viewerSrc), /var foot = \(sheet > 0 \? sheet \+ 16 \+ evRows : 0\) \+ chipsH;\n\s+if \(foot > 0\) pad\.bottom = Math\.min\(Math\.max\(pad\.bottom, foot\)/.test(viewerSrc)], [true, true]);
  /* The key counts what is on the map (review, 7 Nov 2026): a chosen answer,
     a search or "around here" takes places off it and the key follows. */
  v.state.open = 'pattern_1'; v.state.filter = { col: 'pattern_1', ans: 'established' };
  const kf = v.chipsHTML();
  check('an answer chosen: the key counts only the places shown — 92 Established, 0 Natural feature, 0 Doesn\u2019t say',
    [/Established<\/span><span class="in-key-n">92<\/span>/.test(kf), /Natural feature<\/span><span class="in-key-n">0<\/span>/.test(kf), /Doesn\u2019t say<\/span><span class="in-key-n">0<\/span>/.test(kf)], [true, true, true]);
  v.state.filter = null;
  const marks = bf.map((f, i) => ({ f, hidden: i % 2 === 0, subOff: false }));
  const v3 = IM.viewer(IM.defaultInsight(bl), { ...vapi, markers: () => marks, colourDiscs: () => {} });
  v3.layers([bl]); v3.ready();
  const est = bf.filter((f, i) => i % 2 && f.properties.pattern_1 === 'Established').length;
  check('places a search hid are left out of the key\'s counts (the markers, when the map has them)', new RegExp('Established</span><span class="in-key-n">' + est + '</span>').test(v3.chipsHTML()), true);
  check('the key\'s "Doesn\u2019t say" mark is the ring\'s pooled grey, and the two are one colour',
    [/\.in-key-l \.in-sw-none\{background:" \+ POOL \+ "\}/.test(imSrc), (imSrc.match(/var POOL = "(#[0-9A-F]{6})"/) || [])[1], (viewerSrc.match(/var DISC_POOL = "(#[0-9A-F]{6})"/) || [])[1]], [true, '#B8B3A9', '#B8B3A9']);
  check('the fold button says which question it folds', [/aria-label="Fold the key: coloured by What is its current status\?"/.test(v.chipsHTML()), (v.state.keyFolded = true, /aria-label="Show the key: coloured by What is its current status\?"/.test(v.chipsHTML()))], [true, true]);
  v.state.keyFolded = false;
  check('the chips are not a live region; one small status line says "Map coloured by: …" only when the question changes, and a redraw keeps the fold button\'s focus',
    [/state\.chips\.setAttribute\("aria-live"/.test(imSrc), /state\.live\.setAttribute\("aria-live", "polite"\)/.test(imSrc), /if \(said !== state\.said\) \{ state\.said = said; state\.live\.textContent = said; \}/.test(imSrc), /if \(state\.chips\._html !== html\) \{/.test(imSrc), /if \(focused\) \{ var again = state\.chips\.querySelector/.test(imSrc)], [false, true, true, true, true]);
}

/* ---------------- the panel as a legend, and Research mode (Mithun, 7 Nov 2026) ----------------
   Default view, every visit: the questions section looks like the map's key —
   a header line per question, and open, one row per answer (mark, name,
   count) with a small ⓘ at its end holding what the long row used to say.
   Pins wear one question's colours; no marks, no compare select, no split
   bar. A "Research mode" switch at the very bottom, OFF on every load: on,
   each question gets a tick box ("Show on the map", three at most), pins
   turn the neutral grey ink and each ticked question wears its own shape
   beside the pin in tick order (circle, square, triangle; re-ordered when
   one is unticked); discs ring by the 1st ticked only; the key has one block
   per ticked question; the compare select and the split bar live here alone.
   Off again: one question (the first ticked), coloured pins, today's view. */
console.log('\n  the panel as a legend, and Research mode');
{
  const pins = [];
  const rapi = { esc: (x) => String(x), el: () => ({ classList: { add() {} } }), data: () => ({ features: bf }), markers: () => [], shotsHTML: () => '', linksIn: () => [],
    cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false, colourDiscs() {},
    locPinEl: (c) => { pins.push({ color: c, rows: null }); return { classList: { add() {} } }; },
    markRowsEl: (c, rows) => { pins.push({ color: c, rows }); return { classList: { add() {} }, _rowsW: rows.length ? 15 : 0 }; } };
  const v = IM.viewer(IM.defaultInsight(bl), rapi);
  const X = v.layers([bl])[0];
  v.ready();
  const st = IM.shownStats(bl, bf, IM.defaultInsight(bl))[0];
  const keyRows = (html) => (html.match(/<li>(?:(?!<\/li>).)*<\/li>/g) || []).map((li) => li.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, ''));
  const panelRows = (html) => (html.match(/<button type="button" class="in-ans-row[^"]*"[^>]*>(?:(?!<\/button>).)*<\/button>/g) || []).map((b) => b.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|').replace(/^\||\|$/g, ''));
  let html = v.panelHTML();
  check('the switch is off on load, a real switch at the very bottom, with its one line', [v.state.research, /class="in-rsw" role="switch" aria-checked="false" data-in="research"/.test(html), html.indexOf('in-rmode') > html.lastIndexOf('in-q '), /Put two or three questions on the map at once and compare them\./.test(html)], [false, true, true, true]);
  check('the hint under THE QUESTIONS stays plain', /Open a question to colour the map by its answers\. Tap an answer to show only those places\./.test(html), true);
  pins.length = 0; bf.slice(0, 12).forEach((f) => v.pinEl(X, f));
  check('default: pins wear the open question\'s colours, no marks', [pins.length, pins.every((p) => p.rows === null), pins.some((p) => st.answers.some((a) => a.color === p.color))], [12, true, true]);
  check('the panel\'s answer rows are the key\'s rows: the same names and counts in the same order, a dot before each, "Doesn’t say" hollow',
    [panelRows(html), keyRows(v.chipsHTML()).map((r) => r.replace(/\|?\d+$/, '')).every((r, i) => panelRows(html)[i].indexOf(r) === 0), /in-sw in-sw-hollow"><\/span>Doesn’t say/.test(html), (html.match(/class="in-nm"><span class="in-sw" style="background:#/g) || []).length],
    [st.answers.map((a) => a.name + '|' + a.count).concat(['Doesn’t say|' + st.none]), true, true, st.answers.length]);
  check('no header line, no bar, no description, no "Answered for" on the rows; no compare select; no split bar',
    [/in-bar|in-def|in-mini|Answered for/.test(html), /in-cmprow|data-in="cmp"/.test(html), /in-split/.test(html)], [false, false, false]);
  check('one ⓘ per answer: a button "About <answer>", aria-expanded, after its row', [(html.match(/data-in="info"/g) || []).length, /aria-label="About Established" aria-expanded="false">i<\/button>/.test(html), /aria-label="About Doesn’t say"/.test(html)], [st.answers.length + 1, true, true]);
  v.state.info = 'pattern_1|established';
  html = v.panelHTML();
  const a0 = st.answers.find((a) => a.key === 'established');
  check('open, the ⓘ says the answer\'s description, "N of M places (x%)" and the words it was read from; the button says it is expanded', [/data-in="info"[^>]*aria-expanded="true"/.test(html), (html.match(/data-in="info"[^>]*aria-expanded="true"/g) || []).length, new RegExp('<div class="in-info" id="in-info-0-' + st.answers.indexOf(a0) + '">' + (a0.definition ? '<p>' : '')).test(html), new RegExp(a0.count + ' of ' + st.total + ' places \\(' + Math.round(100 * a0.count / st.total) + '%\\)\\.').test(html), /Read from: <q>/.test(html)], [true, 1, true, true, true]);
  check('a second tap closes it; Escape closes it; one open at a time (a single state key)', [/if \(d === "info"\) \{\n\s+var ia = t\.getAttribute\("data-a"\) \|\| "", ik = col \+ "\|" \+ ia;\n\s+state\.info = state\.info === ik \? null : ik;/.test(imSrc), /if \(e\.key !== "Escape" \|\| !state\.info\) return;[\s\S]{0,200}?state\.info = null;\n\s+renderPanel\(\);/.test(imSrc)], [true, true]);
  v.state.info = null;
  check('the ⓘ for "Doesn’t say" counts the blanks', (v.state.info = 'pattern_1|', new RegExp(st.none + ' of ' + st.total + ' places \\(\\d+%\\) say nothing about this\\.').test(v.panelHTML())), true);
  v.state.info = null;
  check('a split filter picked earlier never shows a split bar outside Research mode', (v.state.filter = { col: 'pattern_1', ans: 'established', col2: 'pattern_2', ans2: 'x' }, /in-split/.test(v.panelHTML())), false);
  v.state.filter = null;
  check('desktop: the map key stands down while the panel is open and comes back when it folds; a phone keeps it', [/function hideKeyOnDesktop\(\) \{\n\s+if \(typeof document === "undefined" \|\| api\.onPhone\(\)\) return false;\n\s+var panel = document\.getElementById\("atlas-panel"\);\n\s+return !!panel && !panel\.classList\.contains\("collapsed"\);/.test(imSrc), /var h = api\.onPhone\(\) \? tinyChipHTML\(st\) : hideKeyOnDesktop\(\) \? "" : keyHTML\(st\);/.test(imSrc), /new MutationObserver\(function \(\) \{ renderChips\(\); \}\)\.observe\(panel, \{ attributes: true, attributeFilter: \["class"\] \}\);/.test(imSrc)], [true, true, true]);
  // Research mode on
  v.setResearch(true);
  pins.length = 0; bf.slice(0, 40).concat([bf.find((f) => !f.properties.pattern_1)]).forEach((f) => v.pinEl(X, f));
  html = v.panelHTML();
  const cols = IM.shownStats(bl, bf, IM.defaultInsight(bl)).map((s) => s.col);
  check('on: the question that was open is ticked, the switch says so, every question has a tick box "Show … on the map"', [v.state.ticks, /aria-checked="true"/.test(html), (html.match(/data-in="tick"/g) || []).length, /data-in="tick" data-col="pattern_1" aria-label="Show What is its current status\? on the map" checked>/.test(html)], [['pattern_1'], true, cols.length, true]);
  check('pins turn neutral, each with one circle in its answer\'s colour (none when the place does not answer)', [pins.every((p) => p.color === '#4A4A4A'), pins.some((p) => p.rows && p.rows.length === 1 && p.rows[0].shape === 'circle' && p.rows[0].color === undefined && p.rows[0].colors.length === 1), pins.some((p) => p.rows && !p.rows.length)], [true, true, true]);
  check('compare select, and the split bar under a picked answer, appear here', [/data-in="cmp"/.test(html), (v.state.filter = { col: 'pattern_1', ans: 'established' }, /in-split|in-split-one/.test(v.panelHTML()))], [true, true]);
  v.state.filter = null;
  // ticking: never opens; the cap; shapes by tick order
  v.state.ticks = ['pattern_1', 'pattern_2']; v.state.open = 'pattern_3';
  pins.length = 0; v.renderPanel();
  html = v.panelHTML();
  check('ticking is separate from opening: pattern_3 is open and unticked, its rows wear a plain dot; ticked questions\' rows wear their shape', [/data-col="pattern_3" aria-label="[^"]*"(?: checked)?>/.test(html) && !/data-col="pattern_3" aria-label="[^"]*" checked>/.test(html), /data-col="pattern_3" aria-expanded="true"/.test(html), /in-ans-row[^>]*data-col="pattern_3"[^>]*><span class="in-nm"><span class="in-sw" style="background:/.test(html)], [true, true, true]);
  v.state.open = 'pattern_2'; html = v.panelHTML();
  check('…the 2nd ticked question\'s rows are squares', /in-ans-row[^>]*data-col="pattern_2"[^>]*><span class="in-nm"><svg class="in-mk"[^>]*><path d="M2\.6 2\.6h8\.8v8\.8h-8\.8z"/.test(html), true);
  v.state.ticks = ['pattern_1', 'pattern_2', 'pattern_3']; html = v.panelHTML();
  check('three ticked: the others\' boxes are disabled, "Three at most"', [(html.match(/ disabled>/g) || []).length, (html.match(/title="Three at most"/g) || []).length, /data-col="pattern_4" aria-label="[^"]*" disabled>/.test(html)], [cols.length - 3, cols.length - 3, true]);
  pins.length = 0; v.renderPanel(); v.state.open = 'pattern_1'; v.renderPanel();
  const kh = v.chipsHTML();
  check('the key: one block per ticked question, headed by its shape — "Circles" alone while more than one is ticked (the discs wear no ring then)', [/Circles: What is its current status\?/.test(kh), /Circles and discs/.test(kh), /Squares: /.test(kh), /Triangles: /.test(kh), (kh.match(/in-chip in-key/g) || []).length], [true, false, true, true, 3]);
  check('more than one question ticked: the discs wear no ring and no colour, the count alone (round 2)', v.discColouring(), null);
  v.state.ticks = ['pattern_1']; v.renderPanel();
  check('one question ticked: the discs ring by it, and its block says "Circles and discs"', [v.discColouring().colours, /Circles and discs: What is its current status\?/.test(v.chipsHTML())], [st.answers.slice(0, 6).map((a) => a.color), true]);
  v.state.ticks = ['pattern_1', 'pattern_2', 'pattern_3']; v.renderPanel();
  const q3 = IM.shownStats(bl, bf, IM.defaultInsight(bl)).find((s) => s.col === 'pattern_3');
  const three = bf.find((f) => f.properties.pattern_1 && f.properties.pattern_2 && f.properties.pattern_3);
  pins.length = 0; v.pinEl(X, three);
  check('a place answering all three wears circle, square, triangle in that order', pins[0].rows.map((r) => r.shape), ['circle', 'square', 'triangle']);
  // unticking re-orders
  v.state.ticks = ['pattern_1', 'pattern_2', 'pattern_3'];
  v.state.ticks.splice(0, 1);   // what a tap on pattern_1's box does (onClick "tick")
  pins.length = 0; v.pinEl(X, three);
  check('unticking the 1st: the 2nd becomes circles and the 3rd squares; two still ticked, so no ring; down to one, the discs ring by the one left', [pins[0].rows.map((r) => r.shape), v.discColouring(), (v.state.ticks = ['pattern_2'], v.discColouring().colours)], [['circle', 'square'], null, IM.shownStats(bl, bf, IM.defaultInsight(bl)).find((s) => s.col === 'pattern_2').answers.slice(0, 6).map((a) => a.color)]);
  check('the tick handler: untick removes, tick appends up to three, never opens', /if \(d === "tick"\) \{\n\s+var at = state\.ticks\.indexOf\(col\);\n\s+if \(at >= 0\) state\.ticks\.splice\(at, 1\);[^\n]*\n\s+else if \(state\.ticks\.length < 3\) state\.ticks\.push\(col\);\n\s+else return;/.test(imSrc) && !/if \(d === "tick"\)[\s\S]{0,400}state\.open = /.test(imSrc), true);
  check('a phone in Research mode (a small tablet can reach it): the tiny chip of the first ticked question, never the big blocks', (() => { const p = IM.viewer(IM.defaultInsight(bl), { ...rapi, onPhone: () => true }); p.layers([bl]); p.ready(); p.setResearch(true); p.state.ticks = ['pattern_2', 'pattern_1']; const h = p.chipsHTML(); return [/in-keys|in-chip in-key/.test(h), /class="in-chip in-tiny" data-in="panel" data-col="pattern_2"/.test(h)]; })(), [false, true]);
  check('the marks\' width reaches the fold, the merge and the fan through the entry (repaint copies _rowsW off the holder)', /e\._rowsW = \(pin && pin\._rowsW\) \|\| 0;/.test(imSrc) && /e\.node\.querySelector\("\.atlas-rowed"\) \|\| e\.node\.querySelector\("\.atlas-pin"\)/.test(imSrc), true);
  // off again
  v.state.ticks = ['pattern_2', 'pattern_3']; v.state.open = 'pattern_1'; v.state.filter = { col: 'pattern_2', ans: 'x', col2: 'pattern_3', ans2: 'y' };
  pins.length = 0;
  v.setResearch(false);
  html = v.panelHTML();
  check('off: one question — the first ticked — coloured pins, no ticks, no marks, no compare, a slice filter let go', [v.state.open, v.state.ticks, pins.every((p) => p.rows === null), /data-in="tick"|data-in="cmp"|in-split/.test(html), v.state.filter, /aria-checked="false"/.test(html)], ['pattern_2', [], true, false, null, true]);
  check('the owner\'s panel is the same panel (one panelHTML, no owner branch)', (imSrc.match(/function panelHTML\(\)/g) || []).length === 1 && !/owner/.test(imSrc.slice(imSrc.indexOf('function questionHTML'), imSrc.indexOf('function compareHTML'))), true);
}

/* ---------------- review fixes (Opus, 7 Nov 2026) ----------------
   A re-render must not drop the keyboard: the ⓘ button (click or Escape) and
   the tick box are found again by walking attribute values, never by a
   selector built from an answer key. Popover ids are numbers (unique per
   answer, any column name), aria-controls only while the popover exists.
   Turning Research mode on drops a filter on a question that is not the
   ticked one, as turning it off does. */
console.log('\n  review fixes: focus, ids, filters');
{
  const rapi = { esc: (x) => String(x), el: () => ({ classList: { add() {} } }), data: () => ({ features: bf }), markers: () => [], shotsHTML: () => '', linksIn: () => [],
    cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false, colourDiscs() {}, locPinEl: () => ({ classList: { add() {} } }), markRowsEl: () => ({ classList: { add() {} } }) };
  const v = IM.viewer(IM.defaultInsight(bl), rapi);
  v.layers([bl]); v.ready();
  const st = IM.shownStats(bl, bf, IM.defaultInsight(bl))[0];
  let html = v.panelHTML();
  check('closed: the ⓘ names no popover (no aria-controls to nothing)', [/aria-controls/.test(html), /in-info-btn/.test(html)], [false, true]);
  v.state.info = 'pattern_1|established'; html = v.panelHTML();
  const a0 = st.answers.findIndex((a) => a.key === 'established');
  check('open: id and aria-controls are the question\'s and the answer\'s places in their lists — numbers, so any column name or key works, and unique per answer',
    [new RegExp('aria-controls="in-info-0-' + a0 + '"').test(html), new RegExp('<div class="in-info" id="in-info-0-' + a0 + '">').test(html), (html.match(/aria-controls=/g) || []).length], [true, true, 1]);
  v.state.info = 'pattern_1|'; check('"Doesn’t say" gets its own id', /id="in-info-0-none"/.test(v.panelHTML()), true);
  v.state.info = null;
  check('refocus walks the buttons by attribute value, never a selector from an answer key; tick, ⓘ click and Escape all use it',
    [/function refocus\(kind, col, a\) \{[\s\S]*?querySelectorAll\('\[data-in="' \+ kind \+ '"\]'\)[\s\S]*?getAttribute\("data-col"\) !== col[\s\S]*?getAttribute\("data-a"\) \|\| ""\) !== a/.test(imSrc),
     /changed\(true\);\n\s+refocus\("tick", col\);/.test(imSrc), /renderPanel\(\);\n\s+refocus\("info", col, ia\);/.test(imSrc),
     /if \(e\.key !== "Escape" \|\| !state\.info\) return;[\s\S]*?state\.info = null;\n\s+renderPanel\(\);\n\s+refocus\("info", icol, ia\);/.test(imSrc), /querySelector\('\[data-in="info"\]\[data-col="' \+ col/.test(imSrc)], [true, true, true, true, false]);
  // the walk, run for real on stand-in nodes
  const focused = [];
  const node = (kind, col, a) => ({ getAttribute: (k) => ({ 'data-col': col, 'data-a': a })[k], focus() { focused.push(kind + ':' + col + ':' + a); } });
  const box = { querySelectorAll: (sel) => sel.indexOf('"info"') >= 0 ? [node('info', 'q"1', 'a\\b'), node('info', 'q"1', 'it\'s')] : [node('tick', 'q"1', null), node('tick', 'q2', null)] };
  const refocus = new Function('state', imSrc.match(/\n    function refocus\(kind, col, a\) \{[\s\S]*?\n    \}\n/)[0] + '\nreturn refocus;')({ box });
  refocus('info', 'q"1', 'it\'s'); refocus('tick', 'q2'); refocus('info', 'q"1', 'none');
  check('…a quote, a backslash or an apostrophe in a key or column is no trouble; nothing matching, nothing focused', focused, ['info:q"1:it\'s', 'tick:q2:null']);
  // turning on
  v.state.open = 'pattern_1'; v.state.filter = { col: 'pattern_2', ans: 'x' };
  v.setResearch(true);
  check('on: a filter on a question that is not the ticked one is let go', [v.state.ticks, v.state.filter], [['pattern_1'], null]);
  v.setResearch(false);
  v.state.filter = { col: 'pattern_1', ans: 'established' };
  v.setResearch(true);
  check('…but the ticked question\'s own filter stays', v.state.filter, { col: 'pattern_1', ans: 'established' });
  v.setResearch(false);
  check('the research key blocks are built once per render', [(imSrc.match(/: researchKeyHTML\(\);/g) || []).length, (imSrc.match(/researchKeyHTML\(\) \?/g) || []).length], [1, 0]);
}

/* ---------------- round 2 (Mithun, 7 Nov 2026, after seeing the build) ----------------
   R1 the panel minimal like the key; R2 no ring with more than one question
   ticked (checked above); R3 research pins a pure neutral grey (above);
   R4 whole place names, the map's collision deciding; R5 a phone gets one
   tiny chip, not the big key, and a tap opens the panel at that question;
   R6 Research mode not offered below 600px; and the three tidy items. */
console.log('\n  round 2');
{
  check('R1: no box, no card, no serif heading — a plain small bold question line, a hairline between questions, the key\'s own rows',
    [/"\.in-q\{margin:0;padding:\.1rem 0\}"/.test(imSrc), /"\.in-q\+\.in-q\{border-top:1px solid/.test(imSrc), /\.in-q\{border:1px solid|\.in-q\.open\{border-color|box-shadow:0 2px 10px/.test(imSrc), /"\.in-qt\{font-weight:600;font-size:var\(--t-ui,\.9rem\)/.test(imSrc), /font-family:var\(--font-display,Georgia,serif\);font-weight:700;font-size:1\.02rem/.test(imSrc), /"\.in-ans-row \.in-nm\{flex:1 1 auto;min-width:0;font-weight:400;display:flex/.test(imSrc)],
    [true, true, false, true, false, true]);
  check('R4: Insight asks for whole names (fullNames) and the page writes them uncut; Standard and Explore keep maxChars', [/^\s+fullNames: true,$/m.test(imSrc), /var max = EV && EV\.fullNames \? FULL_NAME_MAX : \(t\.maxChars \|\| 32\);/.test(viewerSrc) && /var FULL_NAME_MAX = 90;/.test(viewerSrc), /fullNames/.test(fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8'))], [true, true, false]);
  const rapi = { esc: (x) => String(x), el: () => ({ classList: { add() {} } }), data: () => ({ features: bf }), markers: () => [], shotsHTML: () => '', linksIn: () => [],
    cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => true, colourDiscs() {}, locPinEl: () => ({ classList: { add() {} } }), markRowsEl: () => ({ classList: { add() {} } }) };
  const p = IM.viewer(IM.defaultInsight(bl), rapi);
  p.layers([bl]); p.ready();
  const st = IM.shownStats(bl, bf, IM.defaultInsight(bl))[0];
  const h = p.chipsHTML();
  check('R5: a phone gets one tiny chip — the open question, then every answer as a dot with its name, "Doesn’t say" last — and no big key',
    [/^<button type="button" class="in-chip in-tiny" data-in="panel" data-col="pattern_1" aria-label="Open the questions at: What is its current status\?">/.test(h), (h.match(/class="in-tiny-i"/g) || []).length, /in-sw in-sw-none"><\/span>Doesn’t say<\/span><\/span><\/button>$/.test(h), /in-chip in-key|in-key-l/.test(h)],
    [true, st.answers.length + 1, true, false]);
  check('…every answer shown whole, wrapping — never cut to "+ n more" (Mithun, 7 Nov 2026); a tap opens the panel (the sheet full) at that question',
    [/fitTinyChip|in-tiny-more"\)|\+ n more/.test(imSrc.replace(/\/\*[\s\S]*?\*\//g, '')), /if \(d === "panel"\) \{[\s\S]*?if \(api\.setSheet\) api\.setSheet\("full"\);[\s\S]*?scrollIntoView/.test(imSrc), /\.in-chip\.in-tiny\{[^"]*max-height:40vh;overflow-y:auto/.test(imSrc)], [false, true, true]);
  check('…a phone\'s chosen answer chip still follows the tiny chip', (p.state.filter = { col: 'pattern_1', ans: 'established' }, /in-tiny[\s\S]*Established · 92 places/.test(p.chipsHTML())), true);
  p.state.filter = null;
  check('…the panel lists every question whole (names wrap, nothing cut) with the first one expanded', [/white-space:nowrap/.test((imSrc.match(/"\.in-ans-row \.in-nm\{[^"]*"/) || [''])[0]), p.state.open, (p.panelHTML().match(/data-in="open"/g) || []).length, (p.panelHTML().match(/aria-expanded="true"/g) || []).length], [false, 'pattern_1', IM.shownStats(bl, bf, IM.defaultInsight(bl)).length, 1]);
  check('R6: Research mode is not offered on a phone — the switch is hidden below 600px (desktop and tablet keep it)', /"@media \(max-width:600px\)\{\.in-rmode\{display:none\}\}"/.test(imSrc), true);
  check('on a phone, a plain line in the switch\'s place says where Research mode lives (Mithun, 7 Nov 2026)',
    [/class="in-rphone">To put several questions on the map at once, or compare one question with another, open LOKA Atlas on a computer or in your browser’s desktop mode\./.test(imSrc), /\.in-rphone\{display:none;/.test(imSrc), /"@media \(max-width:600px\)\{\.in-rphone\{display:block\}\}"/.test(imSrc)], [true, true, true]);
  check('tidy: an unknown column never borrows question 0\'s popover id', /var qi = Q\(\)\.cols\.indexOf\(st\.col\);\n\s+return "in-info-" \+ \(qi >= 0 \? qi : "x" \+ String\(st\.col\)\.replace/.test(imSrc), true);
  const q = IM.viewer(IM.defaultInsight(bl), { ...rapi, onPhone: () => false });
  q.layers([bl]); q.ready();
  q.state.open = 'no_such_column'; q.state.filter = { col: 'no_such_column', ans: 'x' };
  q.setResearch(true);
  check('tidy: Research ON with an unknown open question ticks nothing and keeps no filter', [q.state.ticks, q.state.filter], [[], null]);
  q.setResearch(false);
  check('tidy: the Standard ring passes its family index to keyKindColor', /keyKindColor\(L, opt, found\.fi, i\)/.test(viewerSrc) && /found = \{ L: L, opt: act\[0\], fi: 0 \};/.test(viewerSrc), true);
}

/* ---------------- round-2 review (Opus, 7 Nov 2026) ----------------
   Research mode cannot be left on where its switch is hidden: a screen that
   shrinks below 600px with it on drops it (renderPanel, and the resize
   handler). The tiny chip is fitted again whenever the chips' width changes,
   from the untrimmed html. Whole names stop at 90 characters, cut at a word. */
console.log('\n  round-2 review: no stuck Research mode, the chip refits, names cap');
{
  const rapi = { esc: (x) => String(x), el: () => ({ classList: { add() {} } }), data: () => ({ features: bf }), markers: () => [], shotsHTML: () => '', linksIn: () => [],
    cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false, colourDiscs() {}, locPinEl: () => ({ classList: { add() {} } }), markRowsEl: () => ({ classList: { add() {} } }) };
  const v = IM.viewer(IM.defaultInsight(bl), rapi);
  v.layers([bl]); v.ready();
  let wide = true;
  globalThis.matchMedia = (q) => ({ matches: q === '(max-width:600px)' && !wide });
  v.setResearch(true); v.state.ticks = ['pattern_1', 'pattern_2']; v.renderPanel();
  check('wide: Research mode on with two ticked', [v.state.research, v.state.ticks.length], [true, 2]);
  wide = false;
  const dropped = v.dropResearchIfSmall();   // what the resize handler asks
  check('the screen shrinks below 600px (a phone turned upright): Research mode goes, one question stays — the first ticked — nothing ticked', [dropped, v.state.research, v.state.ticks, v.state.open, /aria-checked="false"/.test(v.panelHTML())], [true, false, [], 'pattern_1', true]);
  check('…and renderPanel drops it too, on its own, so no path leaves it on', (v.state.research = true, v.state.ticks = ['pattern_2'], v.renderPanel(), [v.state.research, v.state.open]), [false, 'pattern_2']);
  wide = true;
  check('wide again: it can be turned on as before', (v.setResearch(true), [v.state.research, v.dropResearchIfSmall()]), [true, false]);
  v.setResearch(false);
  delete globalThis.matchMedia;
  check('the resize handler asks before drawing', /window\.addEventListener\("resize", function \(\) \{\n\s+var cur = viewer\._current;\n\s+if \(!cur\) return;\n\s+if \(cur\.dropResearchIfSmall\(\)\) return;/.test(imSrc) && /function renderPanel\(\) \{\n\s+if \(dropResearchIfSmall\(\)\) return;/.test(imSrc), true);
  // whole names: a generous cap, cut at a word
  const shortName = new Function(viewerSrc.match(/\n  function shortName\(s, max\) \{[\s\S]*?\n  \}\n/)[0] + '\nreturn shortName;')();
  const long = 'Interesting mangrove tree ecosystem roots. But leaves look like sal tree and the bandh beyond it is broken in two places now';
  check('a 72-character name is written whole; a paragraph ends at a word with "…" inside 90', [shortName(long.slice(0, 72), 90), shortName(long, 90).length <= 90, /…$/.test(shortName(long, 90)), /\S…$/.test(shortName(long, 90))], [long.slice(0, 72), true, true, true]);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
