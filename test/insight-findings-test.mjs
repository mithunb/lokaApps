/* Run me with: node test/run.mjs — or on my own with node.
 *
 * "What the places say", version 2 (atlas/insight-mode.js summaryDigest,
 * api/lib/atlas/insight-summary.js writeFindings) — 5 November 2026, a
 * MOCK-UP: a short summary and 3 to 5 findings, each with a count and a
 * quote in a place's own words. Nothing here is on the visitor page yet; the
 * shipped summary (SUMMARY_VERSION, writeSummary) is untouched, and the last
 * check below holds that.
 * These checks hold:
 *   - the digest: never a people question, never a tagger's name, never a
 *     credit line, a link, an email or a phone number in a quote; the wider
 *     people rule catches a plain column called "creator" that no question
 *     was read from;
 *   - the checks: a cell that is not in the tables (a fabricated pair) is
 *     dropped whole; a quote whose words were changed is dropped; a quote
 *     whose place is not in the group that finding counts is dropped; a
 *     question the owner has switched off has no cell to state, and a finding
 *     written before it was switched off stops showing;
 *   - under two findings, nothing is shown, and a summary sentence with a
 *     number it cannot back is dropped;
 *   - the proofread: a finding judged not ok goes, a quote said to name a
 *     person goes while its finding stays. */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const IM = require(ROOT + '/atlas/insight-mode.js');
const SUM = await import(ROOT + '/api/lib/atlas/insight-summary.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

/* ---------------- a layer made for these checks ----------------
   Twenty places. pattern_5's answers are people (its keyColumns name
   created_by), so it is never read. One place's words are a credit line, one
   names the tagger who wrote them, one names a "creator" column nothing was
   read from, one holds an email address. */
const layer = {
  id: 'tiny',
  popup: { title: 'name' },
  keyLabels: { pattern_1: 'What kind of place is it?', pattern_2: 'What is it made of?', pattern_5: 'Who created this place?' },
  keyColumns: { pattern_5: ['created_by', 'created_by_user_id'] },
};
const place = (id, p1, p2, description, extra) => ({ type: 'Feature', properties: Object.assign({
  tag_id: id, name: 'Place ' + id, description, pattern_1: p1, pattern_1_why: '', pattern_2: p2, pattern_2_why: '',
  pattern_5: 'Pratham', created_by: 'Pratham', created_by_user_id: 'u-1' }, extra || {}) });
const features = [];
// every place says something of its own: words several places share are a field, not a quote (checked below)
const corner = ['by the gate', 'behind the library', 'near the water tank', 'at the bus stand', 'under the flyover',
  'beside the school', 'off the main road', 'past the market', 'on the hill', 'where the lane bends'];
for (let i = 1; i <= 10; i++) features.push(place('g' + i, 'Garden', 'Natural elements', 'A quiet garden ' + corner[i - 1] + ' where the old rain tree still stands.'));
for (let i = 1; i <= 5; i++) features.push(place('s' + i, 'Shrine', 'Stone or masonry', 'A small stone shrine ' + corner[i - 1] + ', kept clean by the street.'));
features.push(place('x1', 'Garden', '', 'Photo: J. H. Furneaux, Public domain, via Wikimedia Commons'));
features.push(place('x2', 'Garden', '', 'Pratham brought the whole class here to count the ants.'));
features.push(place('x3', 'Garden', '', 'beardcoded cleans this corner of the park every Sunday.', { creator: 'beardcoded' }));
features.push(place('x4', 'Garden', '', 'Write to hello@example.com before you visit this garden.'));
features.push(place('x5', 'Garden', '', 'Call +91 98450 12345 and somebody opens the gate for you.'));

const digest = IM.summaryDigest(layer, features);
const all = JSON.stringify(digest);

console.log('\n  the digest');
check('the people question is not in it, and nor is the tagger', [/pattern_5/.test(all), /Pratham/i.test(all), /u-1/.test(all)], [false, false, false]);
check('it counts the places and the questions that are left', [digest.places, digest.questions.map((q) => q.id), digest.pairs.length], [20, ['pattern_1', 'pattern_2'], 1]);
check('the pair cell one answer holds most of is found in code, not left to the model',
  digest.notable.filter((n) => n.kind === 'cell').map((n) => [n.answers.join(' + '), n.count, n.of]),
  [['Garden + Natural elements', 10, 10], ['Shrine + Stone or masonry', 5, 5]]);
check('a credit line is never a quote', IM.quoteOf(layer, features[15], 'pattern_1').why, 'it is a credit line');
check('a sentence naming the tagger is never a quote', IM.quoteOf(layer, features[16], 'pattern_1').why, 'it names a person (Pratham)');
check('…nor one naming a plain "creator" column nothing was read from (the wider people rule)',
  [IM.quoteOf(layer, features[17], 'pattern_1').why, IM.isPeopleColumn('creator'), IM.isPeople(layer, 'pattern_1')],
  ['it names a person (beardcoded)', true, false]);
check('an email or a phone number keeps the words out', [IM.quoteOf(layer, features[18], 'pattern_1').why, IM.quoteOf(layer, features[19], 'pattern_1').why],
  ['it has a link, an email, a phone number or an @handle', 'it has a link, an email, a phone number or an @handle']);
check('the quotes offered for a cell come only from the places that cell counts',
  IM.quotesOffered(digest, { shape: 'single', questions: ['pattern_2'], answers: ['Stone or masonry'] }).every((q) => q.id.startsWith('s')), true);
check('a line break ends a sentence, and an initial or "St." does not',
  IM.splitSentences('Rising beside St. John’s Church, named for J. H. Furneaux.\nPhoto: somebody, via Wikimedia Commons'),
  ['Rising beside St. John’s Church, named for J. H. Furneaux.', 'Photo: somebody, via Wikimedia Commons']);

/* ---------------- the checks over the model's answer ---------------- */
const gardenQuote = IM.quotesOffered(digest, { shape: 'single', questions: ['pattern_1'], answers: ['Garden'] })[0];
const shrineQuote = IM.quotesOffered(digest, { shape: 'single', questions: ['pattern_1'], answers: ['Shrine'] })[0];
const good = () => ({
  summary: [{ text: '15 of the 20 places here are gardens.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] }],
  findings: [
    { text: 'Of the 20 places that say what kind of place they are, 15 say Garden.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20,
      meansAnswers: ['Garden'], quotes: [{ id: gardenQuote.id, text: gardenQuote.text }] },
    { text: 'Of the 20 places that say what kind of place they are, 5 say Shrine.', questions: ['pattern_1'], answers: ['Shrine'], count: 5, of: 20,
      meansAnswers: ['Shrine'], quotes: [{ id: shrineQuote.id, text: shrineQuote.text }] },
    { text: 'Of the 10 Garden places that also say what they are made of, 10 say Natural elements.',
      questions: ['pattern_1', 'pattern_2'], answers: ['Garden', 'Natural elements'], meansAnswers: ['Garden', 'Natural elements'], count: 10, of: 10, quotes: [] },
  ],
});
console.log('\n  the checks');
const ok0 = SUM.checkFindings(digest, good());
check('a well-made answer passes whole, its quotes kept', [ok0.findings.length, ok0.dropped.length, ok0.findings[0].quotes[0].text], [3, 0, gardenQuote.text]);

const madeUp = good();
madeUp.findings[2] = { text: 'Of the 9 Shrine places that also say what they are made of, 8 say Natural elements.',
  questions: ['pattern_2', 'pattern_1'], answers: ['Natural elements', 'Shrine'], count: 8, of: 9, quotes: [] };
const r1 = SUM.checkFindings(digest, madeUp);
check('a fabricated pair is dropped whole', [r1.findings.length, r1.dropped[0].what, /no such cell/.test(r1.dropped[0].why)], [2, 'finding', true]);

const edited = good();
edited.findings[0].quotes = [{ id: gardenQuote.id, text: gardenQuote.text.replace('quiet', 'lovely quiet') }];
const r2 = SUM.checkFindings(digest, edited);
check('a quote the model edited is dropped, the finding kept',
  [r2.findings.length, r2.findings[0].quotes.length, r2.dropped[0].why], [3, 0, 'the quote was changed from the place’s own words']);

const borrowed = good();
borrowed.findings[1].quotes = [{ id: gardenQuote.id, text: gardenQuote.text }];
const r3 = SUM.checkFindings(digest, borrowed);
check('a quote from a place the finding does not count is dropped',
  [r3.findings[1].quotes.length, r3.dropped[0].why], [0, 'that place is not in the group this finding counts']);

const invented = good();
invented.findings[1].quotes = [{ id: 'no-such-place', text: 'Something nobody wrote.' }];
check('an id that is in no cell at all is dropped', SUM.checkFindings(digest, invented).dropped[0].why, 'that place is not in the group this finding counts');

const sayNothing = good();
sayNothing.findings[2] = { text: '5 of the 20 places say nothing about what they are made of.', questions: ['pattern_2'], answers: [], count: 5, of: 20,
  quotes: [{ id: gardenQuote.id, text: gardenQuote.text }] };
const r4 = SUM.checkFindings(digest, sayNothing);
check('a finding about what is not said gets no quote', [r4.findings.length, r4.findings[2].quotes.length, r4.dropped[0].why],
  [3, 0, 'a finding about what is not said gets no quote']);

console.log('\n  the summary and the floor');
const numbers = good();
numbers.summary = [{ text: 'Gardens are what this map is about.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] },
  { text: 'Nearly 44 of them are gardens.', questions: ['pattern_1'], answers: ['Garden'], count: 44, of: 20, meansAnswers: ['Garden'] },
  { text: 'Of the 20 places that say what kind of place they are, 15 say Garden.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] }];
const r5 = SUM.checkFindings(digest, numbers);
check('a summary sentence with a number it cannot back is dropped; one with no number at all stands on its cell',
  [r5.summary.length, r5.summary.map((s) => s.text.slice(0, 18)), r5.dropped.some((d) => d.what === 'summary')],
  [2, ['Gardens are what t', 'Of the 20 places t'], true]);

const one = good();
one.findings = [one.findings[0], { text: 'Of the 44 places that say what kind of place they are, 15 say Garden.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 44, meansAnswers: ['Garden'] }];
const r6 = SUM.checkFindings(digest, one);
check('under two findings, nothing is shown', [r6.findings, r6.tooFew], [[], 1]);

console.log('\n  a question the owner switches off');
const hidden = IM.summaryDigest(layer, features, { shownCols: ['pattern_1'] });
check('it is not in the digest, so no finding can state it', [hidden.questions.map((q) => q.id), hidden.pairs.length, /pattern_2/.test(JSON.stringify(hidden.quotes))], [['pattern_1'], 0, false]);
check('…and a finding written before it was switched off stops showing', SUM.checkFindings(hidden, good()).dropped.map((d) => d.why),
  ['no such cell: there is no question pattern_2']);
check('…and the two that are left still need a third to show at all', IM.visibleFindings(ok0.findings, ['pattern_1']).length, 2);
check('one finding on show is no card', IM.visibleFindings(ok0.findings, ['pattern_2']), []);

console.log('\n  the proofread');
const read = SUM.applyFindingsProofread(ok0.findings, { checks: [
  { index: 0, ok: true, meansAnswer: true, namesPerson: true, why: 'the quote names somebody' },
  { index: 1, ok: false, meansAnswer: true, namesPerson: false, why: 'it says all of a part' },
  { index: 2, ok: true, meansAnswer: true, namesPerson: false, why: '' }] });
check('a finding judged not ok goes; a quote said to name a person goes while its finding stays',
  [read.findings.map((f) => [f.text.slice(0, 14), (f.quotes || []).length]), read.dropped.map((d) => d.what)],
  [[['Of the 20 plac', 0], ['Of the 10 Gard', 0]], ['quote', 'finding']]);
check('an answer with no verdict in it changes nothing', SUM.applyFindingsProofread(ok0.findings, { checks: [] }).skipped, 'no usable answer');

/* ---------------- the rework (Mithun, 5 November 2026) ----------------
   A second small layer, built so that one pair cell merely restates its row:
   wood is what most places of any kind are made of, so "every garden is
   wooden" says nothing new, while "every shrine is stone" does. */
console.log('\n  obvious pair cells are left out in code');
const L2 = { id: 'two', popup: { title: 'name' }, keyLabels: { pattern_1: 'What kind of place is it?', pattern_2: 'What is it made of?' } };
const F2 = [];
const mk = (id, p1, p2, d) => ({ type: 'Feature', properties: { tag_id: id, name: 'Place ' + id, description: d, pattern_1: p1, pattern_2: p2, pattern_1_why: '', pattern_2_why: '' } });
const spot = ['by the gate', 'behind the library', 'near the tank', 'at the bus stand', 'under the flyover', 'beside the school',
  'off the main road', 'past the market', 'on the hill', 'where the lane bends', 'at the crossing', 'below the bridge'];
for (let i = 1; i <= 12; i++) F2.push(mk('w' + i, 'Garden', 'Wood', 'A wooden bench ' + spot[i - 1] + ', painted green and worn smooth.'));
for (let i = 1; i <= 6; i++) F2.push(mk('m' + i, 'Market', 'Wood', 'Wooden stalls go up ' + spot[i - 1] + ' every Sunday morning.'));
for (let i = 1; i <= 6; i++) F2.push(mk('t' + i, 'Shrine', 'Stone', 'A stone shrine ' + spot[i - 1] + ', swept and lit each evening.'));
const d2 = IM.summaryDigest(L2, F2);
const notableCells = d2.notable.filter((n) => n.kind === 'cell');
check('the cell that only restates its row is not offered (wood is what most places are, whatever kind they are)',
  notableCells.map((n) => n.answers.join(' + ')), ['Shrine + Stone']);
check('…and the one that is offered carries the same answer over all the places answering both, to compare against',
  [notableCells[0].count, notableCells[0].of, notableCells[0].overall.count, notableCells[0].overall.of], [6, 6, 6, 24]);
check('a contrast carries both rows’ numbers', d2.notable.filter((n) => n.kind === 'contrast').map((n) => [n.answer, n.rows.map((r) => r.count + '/' + r.of)]),
  [['Wood', ['12/12', '0/6']], ['Stone', ['6/6', '0/12']]]);

console.log('\n  a comparison is checked on both its number pairs');
const cmp = (over) => Object.assign({ text: 'All 12 of the 12 garden spots are wooden, while not one of the 6 shrines is.',
  questions: ['pattern_1', 'pattern_2'], answers: ['Garden', 'Shrine', 'Wood'], meansAnswers: ['Garden', 'Shrine', 'Wood'],
  count: 12, of: 12, count2: 0, of2: 6, quotes: [] }, over || {});
const t2 = IM.tablesOf(d2);
check('both pairs true: it passes, and a count of 0 may be written "not one"',
  IM.checkCellsWithReasons([cmp()], t2, 5, { plainAnswers: true }).kept.map((k) => [k.cell.shape, k.count, k.of, k.count2, k.of2]), [['compare', 12, 12, 0, 6]]);
check('a second row the tables do not say is dropped', IM.checkCellsWithReasons([cmp({ count2: 3 })], t2, 5, { plainAnswers: true }).dropped.map((d) => d.why),
  ['3 is not the cell for Shrine + Wood; the table says 0']);
check('a comparison the wrong way round is dropped',
  IM.checkCellsWithReasons([cmp({ text: 'Not one of the 6 shrines is wooden, while 12 of the 12 gardens are.', answers: ['Shrine', 'Garden', 'Wood'], meansAnswers: ['Shrine', 'Garden', 'Wood'], count: 0, of: 6, count2: 12, of2: 12 })], t2, 5, { plainAnswers: true }).dropped.map((d) => d.why),
  ['the comparison does not hold: 0 of 6 is not more than 12 of 12']);
check('a comparison may quote from the row it leads with',
  IM.quotesOffered(d2, { shape: 'compare', questions: ['pattern_1', 'pattern_2'], answers: ['Garden', 'Shrine', 'Wood'] }).length > 0, true);

console.log('\n  everyday words, with the cell still checked');
const plain = { text: 'Every one of the 6 shrines here is cut from stone, 6 of 6.', questions: ['pattern_1', 'pattern_2'], answers: ['Shrine', 'Stone'], count: 6, of: 6 };
check('the sentence need not use the answer’s label, as long as its cell is right',
  IM.checkCellsWithReasons([{ text: 'All 6 of the 6 small roadside shrines are cut from rock.', questions: ['pattern_1', 'pattern_2'], answers: ['Shrine', 'Stone'], meansAnswers: ['Shrine', 'Stone'], count: 6, of: 6 }], t2, 5, { plainAnswers: true }).kept.length, 1);
check('…but naming a different answer to its own question is a drop',
  IM.checkCellsWithReasons([{ text: 'All 6 of the 6 shrines are stone, unlike the Garden places made of Wood.', questions: ['pattern_1', 'pattern_2'], answers: ['Shrine', 'Stone'], meansAnswers: ['Shrine', 'Stone'], count: 6, of: 6 }], t2, 5, { plainAnswers: true }).dropped.map((d) => d.why),
  ['it names Garden, which is not the answer its cell counts']);
check('the shipped summary still insists on the label (nothing loosened there)',
  IM.checkCellsWithReasons([{ text: 'All 6 of the 6 small roadside shrines are cut from rock.', questions: ['pattern_1', 'pattern_2'], answers: ['Shrine', 'Stone'], meansAnswers: ['Shrine', 'Stone'], count: 6, of: 6 }], t2, 5).dropped.map((d) => d.why),
  ['it does not name Shrine']);

console.log('\n  a share said in words needs a number behind it');
const shares = SUM.checkFindings(digest, Object.assign(good(), { summary: [
  { text: 'This map is mostly green corners of the city.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] },
  { text: 'Gardens are what this map is about.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] }] }));
check('an unnumbered sentence claiming a share is dropped; the plain one stays',
  [shares.summary.map((s) => s.text), shares.dropped.filter((d) => d.what === 'summary').map((d) => d.why)],
  [['Gardens are what this map is about.'], ['it says how many in words, with no number the code can check']]);
check('the same words are fine beside a checked number', IM.hasShareWords('Most of them') && SUM.checkFindings(digest, Object.assign(good(), { summary: [
  { text: 'Most of these places are gardens: 15 of the 20 say so.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] },
  { text: 'Gardens are what this map is about.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] }] })).summary.length, 2);

console.log('\n  words several places share are not anybody’s own words');
const shareLayer = { id: 'sp', keyLabels: { pattern_1: 'What kind of place is it?' }, keyColumns: { pattern_1: ['spaces'] } };
const shareF = [];
for (let i = 1; i <= 6; i++) shareF.push({ type: 'Feature', properties: { tag_id: 'sp' + i, pattern_1: 'Cubbon Park', pattern_1_why: 'Cubbon Park',
  spaces: 'Cubbon Park - Is this seat taken', description: 'A bench ' + corner[i - 1] + ' that nobody seems to sit on.' } });
const shareD = IM.summaryDigest(shareLayer, shareF);
check('a space’s name, copied onto every place, is never quoted; the place’s own line is',
  shareD.quotes[0].quotes.map((q) => q.text.slice(0, 8)), ['A bench ', 'A bench ', 'A bench ']);
check('…and when that is all a place has, it says why', IM.quoteOf(shareLayer, shareF[0], 'pattern_1', { shared: () => true }).why,
  'those words stand on several places, so they are not this place’s own');

console.log('\n  the link under a quote names the place the words came from');
const byId = new Map(features.map((f, i) => [IM.placeIdOf(f, i), f]));
check('every kept quote is that place’s own sentence, and the name comes from the same place',
  ok0.findings.filter((f) => f.quotes.length).map((f) => f.quotes.map((q) => [
    IM.quoteOf(layer, byId.get(q.id), f.questions[0], { shared: () => false }).text === q.text, IM.placeNameOf(layer, byId.get(q.id))])),
  [[[true, 'Place g1']], [[true, 'Place s1']]]);

/* ---------------- after the Opus review (5 November 2026) ----------------
   Two of these were regressions in the SHIPPED sentence check, found by the
   reviewer's probes; the rest close gaps the mock-up left open. */
console.log('\n  the shipped check, as it was');
const T1 = IM.summaryTables(layer, features);
const stone = { text: 'Of the 20 places that say what kind of place they are, 5 say Shrine.', questions: ['pattern_1'], answers: ['Shrine'], count: 5, of: 20 };
check('"at all" followed by a number is still the sentence saying all',
  IM.checkSentencesWithReasons([{ text: 'Garden is at all 15 of the 20 places that say what kind of place they are.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20 }, stone], T1).dropped.map((d) => d.why),
  ['it says all but the count is a part (15 of 20)']);
check('…while the idiom still passes', IM.checkSentencesWithReasons([
  { text: '5 of the 20 places say nothing at all about what they are made of.', questions: ['pattern_2'], answers: [], count: 5, of: 20 }, stone], T1).kept.length, 2);
check('a cell whose count and group are swapped cannot hide its 0',
  IM.checkSentencesWithReasons([{ text: '20 of the places say nothing about what kind of place they are.', questions: ['pattern_1'], answers: [], count: 20, of: 0 }, stone], T1).dropped.map((d) => d.why),
  ['number 0 of its cell is not in it']);
check('…and a comparison may still leave its own 0 out, in words',
  IM.checkCellsWithReasons([cmp()], t2, 5, { plainAnswers: true }).kept.length, 1);

console.log('\n  plain words cannot mean the opposite');
const T3 = IM.summaryTables({ id: 'u', keyLabels: { pattern_3: 'What is its environmental impact?' } },
  Array.from({ length: 30 }, (x, i) => ({ type: 'Feature', properties: { tag_id: 'a' + i, pattern_3: i < 20 ? 'Positive or preserved' : 'Negative or degraded' } })));
const inverted = { text: '20 of the 30 places are run down and badly neglected.', questions: ['pattern_3'], answers: ['Positive or preserved'], count: 20, of: 30 };
check('a sentence that does not say which answer it means is dropped',
  IM.checkCellsWithReasons([inverted], T3, 5, { plainAnswers: true }).dropped.map((d) => d.why), ['it does not say which answer it means']);
check('…and one that says it means another answer is dropped',
  IM.checkCellsWithReasons([Object.assign({ meansAnswers: ['Negative or degraded'] }, inverted)], T3, 5, { plainAnswers: true }).dropped.map((d) => d.why),
  ['it says it means Negative or degraded, but its cell counts Positive or preserved']);
check('the proofread is asked the meaning question with no benefit of the doubt',
  [/does the sentence mean the answer label exactly/i.test(SUM.findingsProofreadPromptFor(digest, ok0.findings)),
    /mark it FALSE\. There is no benefit of the doubt/.test(SUM.findingsProofreadPromptFor(digest, ok0.findings))], [true, true]);
check('a sentence the proofread will not vouch for the meaning of is dropped, even when it is "ok"',
  SUM.applyFindingsProofread(ok0.findings, { checks: ok0.findings.map((f, i) => ({ index: i, ok: true, namesPerson: false, why: '' })) }).findings.length, 0);
check('…and one it says means something else is dropped with its reason',
  SUM.applyFindingsProofread(ok0.findings, { checks: ok0.findings.map((f, i) => ({ index: i, ok: true, meansAnswer: i > 0, namesPerson: false, why: i ? '' : 'it reads as the opposite' })) }).dropped,
  [{ what: 'finding', text: ok0.findings[0].text, why: 'it reads as the opposite' }]);

console.log('\n  a summary sentence rests on a cell too');
const guesses = SUM.checkFindings(digest, Object.assign(good(), { summary: [
  { text: 'People tagged what caught their eye, so the map leans towards what is easy to notice.' },
  { text: 'Gardens are what this map is about.', questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20, meansAnswers: ['Garden'] }] }));
check('a guess about why people tagged things is dropped; the line about a counted cell stays',
  [guesses.summary.map((s) => s.text), guesses.dropped.filter((d) => d.what === 'summary').map((d) => d.why)],
  [['Gardens are what this map is about.'], ['names no question']]);
check('every kept summary sentence carries its cell and its questions',
  guesses.summary.map((s) => [s.cell.shape, s.questions]), [['single', ['pattern_1']]]);

console.log('\n  the rest of the review');
check('a keyColumn that is not free text (a space’s name) is no quote source either',
  IM.quoteSourcesOf({ keyColumns: { pattern_1: ['spaces'] } }, { spaces: 'Cubbon Park - Is this seat taken', description: 'A bench by the gate that nobody seems to sit on.' }, 'pattern_1'),
  ['A bench by the gate that nobody seems to sit on.']);
const noWords = SUM.checkFindings(digest, (() => { const a = good(); a.findings[0].quotes = [{ id: '', text: 'words that must never be logged' }]; return a; })());
check('a dropped quote is named by its place id, never by its words',
  [noWords.dropped[0].text, JSON.stringify(noWords.dropped).includes('must never be logged')], ['(a quote with no place id)', false]);
check('the findings get longer than the shipped summary to answer in', [SUM.FINDINGS_TIMEOUT_MS, SUM.TIMEOUT_MS], [90000, 25000]);

console.log('\n  the shipped summary is untouched');
const tables = IM.summaryTables(layer, features);
const sent = (text, cell) => Object.assign({ text }, cell);
check('the cell check still hides a lone sentence (the two-sentence floor)',
  IM.checkSentences([sent('Of the 20 places that say what kind of place they are, 15 say Garden.', { questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20 })], tables), []);
check('…and still keeps two', IM.checkSentences([
  sent('Of the 20 places that say what kind of place they are, 15 say Garden.', { questions: ['pattern_1'], answers: ['Garden'], count: 15, of: 20 }),
  sent('Of the 20 places that say what kind of place they are, 5 say Shrine.', { questions: ['pattern_1'], answers: ['Shrine'], count: 5, of: 20 })], tables).length, 2);
check('the summary version and its fingerprint have not moved', [SUM.SUMMARY_VERSION, SUM.summarySig(tables) === SUM.summarySig(tables)], [4, true]);
check('the findings keep a fingerprint of their own, quotes and all',
  [SUM.findingsSig(digest) === SUM.findingsSig(IM.summaryDigest(layer, features)), SUM.findingsSig(digest) === SUM.findingsSig(hidden)], [true, false]);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
