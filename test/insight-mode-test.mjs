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
 *   - the summary: every number must be in the counts, a sentence with an
 *     invented one is dropped; kept by its fingerprint (one model call across
 *     repeated switches); written again after a reading only in Insight with
 *     the summary on, never on the operator's own atlas;
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
const good1 = { text: 'Most of these 134 places are good for their surroundings: 73 of the 115 that say.', questions: ['pattern_3'] };
const good2 = { text: 'Watching nature is the largest single use, at 35 places.', questions: ['pattern_4'] };
const bad = { text: 'Harm shows at 17 places of 115.', questions: ['pattern_3'] };
const pct = { text: 'About 54% of the 134 places are positive.', questions: ['pattern_3'] };
const kept = IM.checkSentences([good1, bad, good2, pct], T);
check('a sentence with an invented number (17) is dropped; one with a percentage too; the true ones stay', kept.map((s) => s.text), [good1.text, good2.text]);
check('a number true for another question is not true for this one', IM.checkSentences([good1, { text: 'Natural elements lead at 55 places.', questions: ['pattern_3'] }], T).length, 0);
check('a sentence with no number is dropped', IM.checkSentences([good1, good2, { text: 'Trees are lovely.', questions: [] }], T).length, 2);
check('fewer than two left: no summary', IM.checkSentences([good1, bad], T), []);
check('a pair\'s numbers are allowed when both its questions are named', IM.checkSentences([good1, { text: 'Harm shows most at shops and services: 5 of 21.', questions: ['pattern_3', 'pattern_4'] }], T).length, 2);
check('the visitor sees only sentences about questions on show', IM.visibleSentences({ sentences: [good1, good2, { text: 'x 9', questions: ['pattern_2'] }] }, ['pattern_3', 'pattern_4']).length, 2);
check('…and none when under two remain', IM.visibleSentences({ sentences: [good1, good2] }, ['pattern_3']), []);
check('amounts in words are dropped ("two", "half", "twice", "one in five"); "one of the" and "no one" are fine',
  ['Two of the 73 places are parks.', 'Half of the 115 places say so.', 'Harm is twice as common, at 14 places.', 'One in five of the 134 places.', 'Most of these 134 places, one of the 115 that say.', 'No one place stands out among the 115.']
    .map((t) => IM.checkSentences([good1, { text: t, questions: ['pattern_3'] }], T).length), [0, 0, 0, 0, 2, 2]);
check('a sentence must name at least one question it draws on', [IM.checkSentences([good1, { text: good2.text, questions: [] }], T).length, IM.checkSentences([good1, { text: good2.text, questions: ['pattern_9'] }], T).length], [0, 0]);
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
const fake = (answer) => async () => { calls++; return answer; };
const Type = { OBJECT: 'object', ARRAY: 'array', STRING: 'string' };
const r1 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, call: fake({ sentences: [good1, bad, good2] }), model: 'm', Type });
check('first time: one call; the invented sentence dropped', [calls, r1.by, r1.summary.sentences.length, r1.dropped], [1, 'model', 2, 1]);
const r2 = await SUM.writeSummary({ layer: bl, features: bf, prev: { summary: r1.summary }, call: fake({ sentences: [] }), model: 'm', Type });
check('the same answers again: kept, no call', [calls, r2.by, r2.summary], [1, 'kept', r1.summary]);
const r3 = await SUM.writeSummary({ layer: bl, features: bf, prev: { summary: r1.summary }, call: fake({ sentences: [good2, good1] }), model: 'm', Type, force: true });
check('"Write it again" asks again', [calls, r3.by], [2, 'model']);
const changed = bf.map((f, i) => i ? f : { ...f, properties: { ...f.properties, pattern_3: 'Negative or degraded' } });
const r4 = await SUM.writeSummary({ layer: bl, features: changed, prev: { summary: r1.summary }, call: fake({ sentences: [] }), model: 'm', Type });
check('new answers: asked again; nothing usable means no summary', [calls, r4.by, r4.summary], [3, 'nothing usable', null]);
const slow = () => new Promise(() => {});
const r5 = await SUM.writeSummary({ layer: bl, features: changed, prev: { summary: r1.summary }, call: slow, model: 'm', Type, timeoutMs: 50 });
check('a model that takes too long: the old summary is kept, nothing thrown', [r5.summary, r5.keep], [r1.summary, true]);
const r6 = await SUM.writeSummary({ layer: bl, features: bf, prev: null, call: () => { throw new Error('too many'); }, model: 'm', Type });
check('a refused call: no summary, nothing thrown', [r6.summary, r6.keep], [null, true]);
check('the stand-in\'s sentences always pass the check', IM.checkSentences(SUM.standInAnswer(T).sentences, T).length >= 2, true);
check('the prompt carries the counts only: not even the atlas\'s title', !/Bengaluru Secret Title/.test(SUM.promptFor(T, 'Bengaluru Secret Title')) && /never in words/.test(SUM.promptFor(T)), true);
check('one summary job per atlas at a time; a stuck pending flag lets a new one start',
  /if \(INSIGHT_RUNNING\.has\(slug\)\) return 'already writing';/.test(server) && /finally \{\s*INSIGHT_RUNNING\.delete\(slug\);/.test(server) && /!INSIGHT\.isPending\(mode\) && !INSIGHT_RUNNING\.has\(inst\.slug\)/.test(server), true);
check('the visitor page stops asking: a cap, a failed fetch, or the mode gone',
  /if \(tries > MAX_TRIES\) \{ stop\(true\); return; \}/.test(imSrc) && /if \(!m \|\| m\.name !== "insight"\) \{ stop\(true\); return; \}/.test(imSrc) && /\.catch\(function \(\) \{ if \(pollT\) stop\(true\); \}\)/.test(imSrc), true);
check('the prompt carries the tables and asks for numbers copied exactly', /copied exactly from the tables/.test(SUM.promptFor(T, 'x')) && SUM.promptFor(T, 'x').endsWith(JSON.stringify(T)), true);

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
    check('the summary is written after the answer: at least two sentences, every number in the counts', [!!f.mode.summary, f.mode.summary && f.mode.summary.sentences.length >= 2,
      f.mode.summary && IM.checkSentences(f.mode.summary.sentences, IM.summaryTables(fx.layer, fx.features)).length === f.mode.summary.sentences.length], [true, true, true]);
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
