/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Explore buttons from the atlas's own analysis ("smart buttons") and "Odds &
 * ends" (Mithun, 24 Oct 2026). These checks hold:
 *   - the rule that picks the question and folds its answers into at most four
 *     buttons (atlas/explore-mode.js pickQuestion / smartButtons), on stripped
 *     copies of two real atlases: the numbers the mock-up showed;
 *   - questions copied from a column, and "Who …" questions, are never chosen;
 *     nothing qualifies → null (LOKA categories, as before);
 *   - "Odds & ends": the places under no other button, for both groupings;
 *   - cleanButtons: four and Odds & ends, never five topics;
 *   - the names (api/lib/atlas/button-names.js): checked, plain names when the
 *     model fails, kept when the same answers make the same buttons;
 *   - when a rebuild works them out again (shouldRework), and the hook's place;
 *   - the route POST /instances/:slug/mode {groupBy}: owner only, public and
 *     private alike, against a real server with the stand-in model;
 *   - a reading written by the server reworks an analysis Explore and never
 *     touches one the owner edited. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const XM = require(ROOT + '/atlas/explore-mode.js');
const BN = await import(ROOT + '/api/lib/atlas/button-names.js');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const exploreSrc = fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8');
const FIX = ROOT + '/test/fixtures/smart-buttons/';
const BLR = JSON.parse(fs.readFileSync(FIX + 'bengaluru.json', 'utf8'));
const CUB = JSON.parse(fs.readFileSync(FIX + 'cubbon.json', 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
const counted = (s, feats) => {
  const c = XM.countButtons(feats, { tagColumn: s.tagColumn, buttonsFrom: 'analysis', buttons: s.buttons });
  return s.buttons.map((b) => [b.words.join('+'), c[b.id]]).concat([['none', c.none]]);
};

/* ---------------- the rule, on two real atlases ---------------- */
console.log('\n  the rule (explore-mode.js), on Bengaluru on LOKA and the Cubbon Park walk');
const sb = XM.smartButtons(BLR.layer, BLR.features);
check('Bengaluru: "What is its primary function?" (pattern_4), 92% of places', [sb.tagColumn, Math.round(sb.question.coverage * 100)], ['pattern_4', 92]);
check('Bengaluru: five answers become four — the smallest joins the one sharing most categories; then Odds & ends',
  counted(sb, BLR.features),
  [['Cultural or spiritual+Education or learning', 38], ['Observation or habitat', 35], ['Recreation or leisure', 26], ['Commerce or services', 24], ['', 11], ['none', 0]]);
check('Bengaluru: the plain names, pictures and their colours (a landmark red, a leaf green), Odds & ends last with its dots',
  sb.buttons.map((b) => [b.id, b.label, b.icon, b.color]),
  [['a1', 'Art & heritage', 'landmark', XM.PALETTE[1]], ['a2', 'Nature & wildlife', 'leaf', XM.PALETTE[0]], ['a3', 'Fun & leisure', 'ticket', XM.PALETTE[2]],
    ['a4', 'Shops & services', 'store', XM.PALETTE[3]], ['odds', 'Odds & ends', 'dots', XM.PALETTE[4]]]);
const sc = XM.smartButtons(CUB.layer, CUB.features);
check('Cubbon: "What is this place\'s main feature?" (pattern_1), 61%', [sc.tagColumn, Math.round(sc.question.coverage * 100)], ['pattern_1', 61]);
check('Cubbon: Tree 13, Water 4, Ground 3, and 13 with no answer under Odds & ends', counted(sc, CUB.features),
  [['Tree or bark', 13], ['Water body', 4], ['Ground or path', 3], ['', 13], ['none', 0]]);
check('Cubbon: plain names Trees · Water · Paths & grass; leaf · droplet · footprints', sc.buttons.map((b) => b.label + ' ' + b.icon),
  ['Trees leaf', 'Water droplet', 'Paths & grass footprints', 'Odds & ends dots']);
check('Cubbon: green for the leaf, blue for the drop; footprints would be green too, so the next free colour', sc.buttons.map((b) => b.color),
  [XM.PALETTE[0], XM.PALETTE[3], XM.PALETTE[2], XM.PALETTE[4]]);
check('Cubbon: "What is it used for?" rates higher but answers only 39% — not chosen',
  [XM.lookAt(CUB.layer, CUB.features, 'pattern_2').rating, XM.lookAt(CUB.layer, CUB.features, 'pattern_2').qualifies], [3, false]);
check('the "Group by" words, plain: what a place is for; what you\'ll find there; else the noun',
  [XM.groupByLabel(sb.question), XM.groupByLabel(sc.question), XM.groupByLabel({ question: 'What kind of place is it?', noun: 'kind of place' }), XM.groupByLabel({ question: 'What is its status?' })],
  ['What the place is for', 'What you\u2019ll find there', 'Kind of place', 'What is its status?']);
console.log('\n  colours follow pictures');
const live = JSON.parse(fs.readFileSync(ROOT + '/deploy/explores/bengaluru-on-loka.json', 'utf8')).mode.buttons;
check('Bengaluru\'s live category buttons keep their colours: Nature green, Art & history red, Things to do orange, Street life blue',
  XM.cleanButtons(live).buttons.map((b) => b.color), ['#2A6B41', '#C9402B', '#B5541B', '#3A7FA1']);
check('two leaves: the second takes its place\'s colour; a picture with no colour of its own goes by its place',
  XM.colourOf([{ icon: 'leaf' }, { icon: 'leaf' }, { icon: 'music' }, { icon: 'droplet' }, { rest: true }]), [XM.PALETTE[0], XM.PALETTE[1], XM.PALETTE[2], XM.PALETTE[3], XM.PALETTE[4]]);
check('a drop first: blue; then a book in second place: red', XM.colourOf([{ icon: 'droplet' }, { icon: 'book' }]), [XM.PALETTE[3], XM.PALETTE[1]]);
check('plain names for common answers; a folded button joins two when they fit',
  ['Observation or habitat', 'Cultural or spiritual', 'Commerce or services', 'Tree or bark', 'Something else entirely'].map(XM.plainName).concat(XM.fallbackNames([{ names: ['Tree or bark', 'Water body'] }]).map((n) => n.label)),
  ['Nature & wildlife', 'Art & heritage', 'Shops & services', 'Trees', 'Something else', 'Trees & Water']);
check('ratings: for/use/kind → 3; feature/species → 2; anything else → 1',
  ['What is it used for?', 'What kind of place?', 'Main feature?', 'what species can be seen?', 'What is its current status?'].map((q) => XM.questionRating(q)), [3, 3, 2, 2, 1]);

console.log('\n  never chosen: copied questions, "Who …", too few answers; nothing qualifies → null');
check('Bengaluru: the copied questions (pattern_5, pattern_6) are not even looked at', [XM.lookAt(BLR.layer, BLR.features, 'pattern_5'), XM.lookAt(BLR.layer, BLR.features, 'pattern_6')], [null, null]);
const pt = (p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.6, 12.97] }, properties: p });
const many = [];
for (let i = 0; i < 12; i++) many.push(pt({ categories: i % 2 ? 'Nature' : 'Culture', pattern_1: ['Park', 'Temple', 'Shop'][i % 3], pattern_2: ['Ana', 'Ravi', 'Meera'][i % 3], pattern_3: ['Old', 'New'][i % 2] }));
const synth = (extra) => Object.assign({ keyLabels: { pattern_1: 'What kind of place is it?', pattern_2: 'Who tagged this place?', pattern_3: 'What age is it?' } }, extra || {});
check('a qualifying question is chosen', XM.pickQuestion(synth(), many).column, 'pattern_1');
check('…but not when it was copied from a column (keyColumns): then nothing qualifies', XM.pickQuestion(synth({ keyColumns: { pattern_1: ['spaces'] } }), many), null);
check('a "Who …" question is never chosen, whatever its answers', XM.lookAt(synth(), many, 'pattern_2'), null);
check('a question rated 1 never qualifies', XM.lookAt(synth(), many, 'pattern_3').qualifies, false);
check('one answer only: not a question to sort by', XM.lookAt({ keyLabels: { pattern_1: 'What is it for?' } }, many.map((f) => pt({ pattern_1: 'Park' })), 'pattern_1'), null);
const thin = CUB.features.map((f, i) => i < 3 && f.properties.pattern_1 ? pt({ ...f.properties, pattern_1: '' }) : f);
check('under 60% answered: nothing qualifies, smartButtons is null (LOKA categories)', [XM.pickQuestion(CUB.layer, thin), XM.smartButtons(CUB.layer, thin)], [null, null]);
check('no questions at all: null', XM.smartButtons({}, BLR.features), null);
const tiny = [];
['A', 'A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'E', 'E', 'E'].forEach((a, i) => tiny.push(pt({ categories: a === 'D' ? 'Nature' : 'Civic', pattern_1: a })));
tiny[9].properties.categories = 'Culture'; tiny[0].properties.categories = 'Culture';
const fq = XM.lookAt({ keyLabels: { pattern_1: 'What is it for?' } }, tiny, 'pattern_1');
check('folding: answers under three places join the answer sharing most categories (ties → the larger)',
  fq.groups.map((g) => [g.names.join('+'), g.count]), [['A+D', 5], ['B+C', 5], ['E', 3]]);

/* ---------------- Odds & ends ---------------- */
console.log('\n  Odds & ends');
const blrCats = { tagColumn: 'categories', buttons: [
  { id: 'nature', label: 'Nature', icon: 'leaf', words: ['Nature'] }, { id: 'art', label: 'Art & history', icon: 'landmark', words: ['Culture', 'Heritage'] },
  { id: 'do', label: 'Things to do', icon: 'ticket', words: ['Activities', 'Social', 'Food and Drink', 'Market'] }, { id: 'street', label: 'Street life', icon: 'users', words: ['Civic', 'Learning'] }] };
const withOdds = XM.withRest(blrCats.buttons, BLR.features, blrCats);
const cc = XM.countButtons(BLR.features, { ...blrCats, buttons: withOdds });
check('LOKA categories too: Bengaluru\'s four buttons leave 15 places (only "Others") under Odds & ends', [withOdds.map((b) => b.id), cc.odds, cc.none], [['nature', 'art', 'do', 'street', 'odds'], 15, 0]);
check('a place under any other button is never under Odds & ends', XM.placeButtons({ categories: 'Nature; Others' }, { ...blrCats, buttons: withOdds }), ['nature']);
check('every place under a button: no Odds & ends', XM.withRest([{ id: 'a', label: 'All', icon: 'leaf', words: ['Nature', 'Culture'] }], many, { tagColumn: 'categories' }).map((b) => b.id), ['a']);
check('no other button: no Odds & ends on its own', XM.withRest([], BLR.features, { tagColumn: 'categories' }), []);
check('the owner\'s name for it is kept', XM.withRest(withOdds.map((b) => b.rest ? { ...b, label: 'Everything else' } : b), BLR.features, blrCats).pop().label, 'Everything else');
check('an analysis place is read whole: "Cultural or spiritual" is one answer', XM.placeWords({ pattern_4: 'Cultural or spiritual; x' }, { tagColumn: 'pattern_4', buttonsFrom: 'analysis' }), ['cultural or spiritual; x']);

console.log('\n  cleanButtons: four, and Odds & ends');
const four = [1, 2, 3, 4].map((i) => ({ label: 'B' + i, icon: 'leaf', words: ['Nature'] }));
const c5 = XM.cleanButtons(four.concat([{ id: 'x', label: ' Leftovers ', icon: 'camera', words: ['y'], rest: true }]));
check('four and Odds & ends are kept: its id, picture and colour fixed, no words, the owner\'s name', [c5.error, c5.buttons.length, c5.buttons[4]],
  [undefined, 5, { id: 'odds', label: 'Leftovers', icon: 'dots', color: XM.PALETTE[4], rest: true, words: [] }]);
check('five topic buttons are refused', /Four buttons is the most/.test(XM.cleanButtons(four.concat([{ label: 'B5', icon: 'leaf', words: [] }])).error || ''), true);
check('two Odds & ends are refused', !!XM.cleanButtons([{ label: 'A', rest: true }, { label: 'B', rest: true }]).error, true);
check('Odds & ends sent first still stands last', XM.cleanButtons([{ label: 'Odds', rest: true }, { label: 'A', icon: 'leaf', words: [] }]).buttons.map((b) => b.id), ['b1', 'odds']);
check('Odds & ends needs a name of at most 20 letters', [!!XM.cleanButtons([{ label: ' ', rest: true }]).error, !!XM.cleanButtons([{ label: 'x'.repeat(21), rest: true }]).error], [true, true]);
check('an answer of a few words up to 60 letters is a word; 61 is not', [
  !!XM.cleanButtons([{ label: 'A', icon: 'leaf', words: ['Places for ' + 'x'.repeat(49)] }]).error,
  !!XM.cleanButtons([{ label: 'A', icon: 'leaf', words: ['Places for ' + 'x'.repeat(50)] }]).error], [false, true]);
check('the new pictures can be chosen: store, droplet, footprints', ['store', 'droplet', 'footprints'].map((k) => !XM.cleanButtons([{ label: 'A', icon: k, words: [] }]).error), [true, true, true]);
check('a button cannot take the id "odds"', XM.cleanButtons([{ id: 'odds', label: 'A', icon: 'leaf', words: [] }]).buttons[0].id, 'b1');

/* ---------------- the names ---------------- */
console.log('\n  the names (api/lib/atlas/button-names.js)');
check('plain names: the first answer, "or …" dropped, cut at a word to 20 letters',
  ['Observation or habitat', 'Water body', 'Places of great historical importance', 'Supercalifragilisticexpialidocious'].map(XM.fallbackLabel),
  ['Observation', 'Water body', 'Places of great', 'Supercalifragilistic']);
const groups = BN.groupsOf(sb);
check('what is named: four groups, their answers and counts', groups.map((g) => [g.names.length, g.count]), [[2, 38], [1, 35], [1, 26], [1, 24]]);
const good = { buttons: [{ group: 0, label: 'Culture & learning', icon: 'landmark' }, { group: 1, label: 'Nature & wildlife', icon: 'leaf' },
  { group: 2, label: 'Things to do', icon: 'ticket' }, { group: 3, label: 'Shops & services', icon: 'store' }] };
check('a good answer is taken whole', BN.cleanNames(good, groups), { names: good.buttons.map((b) => ({ label: b.label, icon: b.icon })), fromModel: 4 });
const bad = { buttons: [{ group: 0, label: 'A name far too long for a button', icon: 'landmark' }, { group: 1, label: 'Nature 🌳', icon: 'tree' },
  { group: 2, label: '<b>Fun</b>', icon: 'ticket' }, { group: 3, label: 'nature', icon: 'store' }] };
check('too long, an emoji, code, a picture not offered: each gives way to the plain name or picture', BN.cleanNames(bad, groups),
  { names: [{ label: 'Art & heritage', icon: 'landmark' }, { label: 'Nature & wildlife', icon: 'leaf' }, { label: 'Fun & leisure', icon: 'ticket' }, { label: 'nature', icon: 'store' }], fromModel: 1 });
check('two buttons the same name: the second gets its plain one',
  BN.cleanNames({ buttons: [{ group: 0, label: 'Places', icon: 'leaf' }, { group: 1, label: 'places', icon: 'leaf' }] }, groups.slice(0, 2)).names.map((n) => n.label), ['Places', 'Nature & wildlife']);
check('no answer at all: every plain name', BN.cleanNames(null, groups).names.map((n) => n.label), ['Art & heritage', 'Nature & wildlife', 'Fun & leisure', 'Shops & services']);
check('the model may only pick offered pictures (schema)', BN.schemaFor({ OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' }).properties.buttons.items.properties.icon.enum, XM.ICON_CHOICES);
check('the prompt carries the question, each answer\'s meaning and a few place names',
  [/primary function/.test(BN.promptFor(sb.question.question, groups, 'Bengaluru')), /Places primarily for art, heritage/.test(BN.promptFor(sb.question.question, groups, '')), /"examples":\["/.test(BN.promptFor('q', groups, ''))], [true, true, true]);
check('the fingerprint follows the column and the groups', [BN.buttonsSig('pattern_4', groups) === BN.buttonsSig('pattern_4', BN.groupsOf(XM.smartButtons(BLR.layer, BLR.features))),
  BN.buttonsSig('pattern_4', groups) === BN.buttonsSig('pattern_3', groups)], [true, false]);

let calls = 0;
const fails = async () => { calls++; throw new Error('the model is down'); };
const named = await BN.nameSmartButtons({ layer: BLR.layer, features: BLR.features, prev: null, call: fails, model: 'm', Type: { OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' } });
check('the model failing: plain names, never an error', [calls, named.buttons.map((b) => b.label), /^plain/.test(named.by)], [1, ['Art & heritage', 'Nature & wildlife', 'Fun & leisure', 'Shops & services', 'Odds & ends'], true]);
const slow = () => new Promise(() => {});
const late = await BN.nameSmartButtons({ layer: CUB.layer, features: CUB.features, call: slow, model: 'm', Type: { OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' }, timeoutMs: 50 });
check('the model never answering: plain names after the wait', late.buttons.map((b) => b.label), ['Trees', 'Water', 'Paths & grass', 'Odds & ends']);
const answers = async () => { calls++; return good; };
const fromModel = await BN.nameSmartButtons({ layer: BLR.layer, features: BLR.features, call: answers, model: 'm', Type: { OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' } });
check('the model\'s names, when they pass', [fromModel.by, fromModel.buttons.map((b) => b.label)], ['model', ['Culture & learning', 'Nature & wildlife', 'Things to do', 'Shops & services', 'Odds & ends']]);
calls = 0;
const prev = { name: 'explore', buttonsFrom: 'analysis', buttonsSig: fromModel.buttonsSig, buttons: fromModel.buttons.map((b) => b.rest ? { ...b, label: 'The rest' } : b) };
const again = await BN.nameSmartButtons({ layer: BLR.layer, features: BLR.features, prev, call: answers, model: 'm', Type: {} });
check('the same answers again: the names kept, no call; Odds & ends keeps the owner\'s name', [calls, again.by, again.buttons.map((b) => b.label)],
  [0, 'kept', ['Culture & learning', 'Nature & wildlife', 'Things to do', 'Shops & services', 'The rest']]);
calls = 0;
const cache = { analysisNames: { sig: fromModel.buttonsSig, buttons: good.buttons.map((b) => ({ label: b.label, icon: b.icon })) }, buttonsFrom: 'categories' };
const fromCache = await BN.nameSmartButtons({ layer: BLR.layer, features: BLR.features, prev: cache, call: answers, model: 'm', Type: {} });
check('names LOKA gave before (analysisNames), kept while grouped by categories: used again, no call', [calls, fromCache.by, fromCache.buttons[0].label, fromCache.analysisNames.sig], [0, 'kept', 'Culture & learning', fromModel.buttonsSig]);
const edited = await BN.nameSmartButtons({ layer: BLR.layer, features: BLR.features, prev: { ...prev, buttonsEdited: true, analysisNames: undefined }, call: answers, model: 'm', Type: { OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' } });
check('an edited set is never taken for LOKA\'s names', [calls, edited.by], [1, 'model']);
const changedAnswers = BLR.features.map((f) => f.properties.pattern_4 === 'Commerce or services' ? pt({ ...f.properties, pattern_4: 'Trade or business' }) : f);
calls = 0;
const changed = await BN.nameSmartButtons({ layer: BLR.layer, features: changedAnswers, prev: cache, call: answers, model: 'm', Type: { OBJECT: 'o', ARRAY: 'a', STRING: 's', INTEGER: 'i' } });
check('a changed answer set: asked again', [calls, changed.by, changed.analysisNames.sig !== cache.analysisNames.sig], [1, 'model', true]);
calls = 0;
const failedKeep = await BN.nameSmartButtons({ layer: BLR.layer, features: changedAnswers, prev: cache, call: fails, model: 'm', Type: {} });
check('a failed call keeps the old names on file (so the model is tried again next time)', [calls, failedKeep.analysisNames], [1, cache.analysisNames]);
check('no model on the server: the plain names', (await BN.nameSmartButtons({ layer: CUB.layer, features: CUB.features, call: null })).buttons.map((b) => b.label), ['Trees', 'Water', 'Paths & grass', 'Odds & ends']);
calls = 0;
check('no question qualifies: null, and no call', [await BN.nameSmartButtons({ layer: CUB.layer, features: thin, call: fails }), calls], [null, 0]);

/* ---------------- when a rebuild works them out again ---------------- */
console.log('\n  after a rebuild (shouldRework, and where the hook sits)');
const NR = new Set(['deoria-bioregion']);
const L0 = (mode) => ({ layers: [], mode });
const ex = { name: 'explore', layer: 'tags', buttonsFrom: 'analysis' };
check('in Explore, from the analysis, not edited, this layer: yes', BN.shouldRework('x', L0(ex), 'tags', NR), true);
check('edited by the owner: never', BN.shouldRework('x', L0({ ...ex, buttonsEdited: true }), 'tags', NR), 'edited by the owner');
check('LOKA categories: left alone', BN.shouldRework('x', L0({ ...ex, buttonsFrom: 'categories' }), 'tags', NR), 'buttons not from the analysis');
check('not in Explore (Standard, Event): never', [BN.shouldRework('x', L0(undefined), 'tags', NR), BN.shouldRework('x', L0({ name: 'event' }), 'tags', NR)], ['not in Explore', 'not in Explore']);
check('Explore kept aside while in Standard: never', BN.shouldRework('x', { modeKept: { explore: ex } }, 'tags', NR), 'not in Explore');
check('another layer\'s reading: left alone', BN.shouldRework('x', L0(ex), 'other', NR), 'another layer');
check('the operator\'s own atlas: never', BN.shouldRework('deoria-bioregion', L0(ex), 'tags', NR), 'never touched');
check('the hook: after a reading\'s own commit, never holding it up',
  /if \(opts && opts\.fromReading\) \{\s*const ds = session\.dataset;\s*setImmediate\(\(\) => \{\s*reworkSmartButtons\(ds, id\)\.catch/.test(server), true);
check('the rework checks again after the names, then writes the overlay whole',
  /const \{ file, local \} = readOverlay\(inst\);\s*if \(buttonNames\.shouldRework\(dataset, local, layerId, NEVER_READ\) !== true\) return 'changed meanwhile';/.test(server) && /if \(!writeOverlay\(file, local\)\) return 'not written';/.test(server), true);
check('a new Explore re-reads the overlay after naming, before writing', /next = await defaultExplore\(inst, local, req\);\s*\/\*[^]*?\*\/\s*const fresh = readOverlay\(inst\);/.test(server), true);
check('a new Explore tries the analysis first, then the categories', /async function defaultExplore\(inst, local, req\) \{\s*if \(!NEVER_READ\.has\(inst\.slug\)\) \{[^]*?const smart = await smartExplore/.test(server), true);

/* ---------------- the page ---------------- */
console.log('\n  the owner\'s page and the visitor\'s row');
check('Group by: the analysis (only when a question qualifies) or LOKA categories', /if \(!pick && from !== "analysis"\) return "";/.test(owner) && /\["categories", "LOKA categories"\]/.test(owner), true);
check('the wait says what is happening', /Choosing buttons from what the atlas found…/.test(owner) && /own-mode-spin/.test(owner), true);
check('the edited line and its way back', /You\\u2019ve edited these buttons, so rebuilding the atlas won\\u2019t change them\. /.test(owner) && /Let LOKA choose again/.test(owner), true);
check('the Odds & ends card: a name and a count, nothing to remove or tick', /Places under no other button — <b>/.test(owner) && /own-brest/.test(owner), true);
check('a phone with five buttons: one sideways row, its right edge fading', /if \(BUTTONS\.length > MAX_BUTTONS\) bar\.classList\.add\("ex-scroll"\);/.test(exploreSrc) &&
  /\.ev-chips\.ex-scroll\{display:flex;[^"]*flex-wrap:nowrap;overflow-x:auto;[^]*?mask-image:linear-gradient\(to right/.test(exploreSrc), true);
check('Event\'s own row is untouched (event-mode.js keeps its grid of four)', /grid-template-columns:repeat\(var\(--ev-n,4\),minmax\(0,1fr\)\)/.test(fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8')), true);
check('footprints in the icon kit', /\n    footprints: svgIcon\(/.test(fs.readFileSync(ROOT + '/atlas/iconkit.js', 'utf8')), true);

/* ---------------- the route, against a real server ---------------- */
const PORT = 8600 + Math.floor(Math.random() * 300);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const PUBSLUG = 'smart-check-' + TAG, PRIVSLUG = 'smart-private-' + TAG, CUBSLUG = 'smart-cubbon-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-smart-check-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', PUBSLUG);
const PRIV = path.join(DATA, 'private-datasets', PRIVSLUG);
const CUBD = path.join(DATA, 'private-datasets', CUBSLUG);
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test';
const ADMIN = 'admin-' + TAG + '-token-for-checks';

function seed(dir, fx, mode) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Smart check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
  const local = { layers: [{ id: 'tags', label: 'Tags', group: 'userdata', type: 'marker', userLayer: true, source: 'user-tags.geojson',
    keyLabels: fx.layer.keyLabels, keyKinds: fx.layer.keyKinds, keyColumns: fx.layer.keyColumns, keyNouns: fx.layer.keyNouns }] };
  if (mode) local.mode = mode;
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify(local));
  // the rows as an upload has them: a place's own coordinates and words beside its answers (the re-read places and reads them)
  const features = fx.features.map((f) => ({ ...f, properties: { ...f.properties, latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0], description: f.properties.loka_name } }));
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
}
seed(PUB, BLR, null);
seed(PRIV, CUB, null);
seed(CUBD, CUB, null);
const rec = (slug, vis) => ({ slug, title: 'Smart check', visibility: vis, status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
  tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }] });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [PUBSLUG]: rec(PUBSLUG, 'public'), [PRIVSLUG]: rec(PRIVSLUG, 'private'), [CUBSLUG]: rec(CUBSLUG, 'private') },
  accounts: { [OWNER]: { email: OWNER, instances: [PUBSLUG, PRIVSLUG, CUBSLUG], verifiedAt: 1 }, [EDITOR]: { email: EDITOR, instances: [], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
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
    // the stand-in model (FAKE_READING): local only, no key, not production
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '',
      ATLAS_FAKE_READING: '1', NODE_ENV: 'test', ATLAS_ADMIN_TOKEN: ADMIN, ATLAS_OWNER_EMAILS: 'nobody@example.test' },
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
async function call(method, p, { cookie, body, headers } = {}) {
  const r = await fetch(BASEURL + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const fileOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'));
const labelsOf = (m) => m.buttons.map((b) => b.label);

try {
  console.log('\n  the route, on a throwaway server with the stand-in model (' + BASEURL + ')');
  await startServer();
  const ownerC = await signIn(OWNER), editorC = await signIn(EDITOR), otherC = await signIn(OTHER);
  const M = (slug) => `/api/atlas/instances/${slug}/mode`;

  const modelCalls = (slug) => (out.match(new RegExp('\\[buttons\\] ' + slug + ' — names: model', 'g')) || []).length;
  for (const [slug, dir, label, want] of [[PUBSLUG, PUB, 'public · Bengaluru', ['pattern_4', ['Art & heritage', 'Nature & wildlife', 'Fun & leisure', 'Shops & services', 'Odds & ends']]],
    [PRIVSLUG, PRIV, 'private · Cubbon', ['pattern_1', ['Trees', 'Water', 'Paths & grass', 'Odds & ends']]]]) {
    console.log('\n  a ' + label + ' atlas');
    check('Group by is refused while not in Explore', (await call('POST', M(slug), { cookie: ownerC, body: { groupBy: 'analysis' } })).status, 409);
    const sw = await call('POST', M(slug), { cookie: ownerC, body: { name: 'explore' } });
    let f = fileOf(dir);
    check('a first Explore: buttons from the analysis, named by the stand-in, Odds & ends last',
      [sw.status, f.mode.buttonsFrom, f.mode.tagColumn, labelsOf(f.mode), typeof f.mode.buttonsSig, f.mode.buttonsEdited], [200, 'analysis', want[0], want[1], 'string', undefined]);
    const start = JSON.stringify(f);
    check('a stranger may not group the buttons', (await call('POST', M(slug), { cookie: otherC, body: { groupBy: 'categories' } })).status, 403);
    check('nor an editor', (await call('POST', M(slug), { cookie: editorC, body: { groupBy: 'categories' } })).status, 403);
    check('nor anyone signed out', (await call('POST', M(slug), { body: { groupBy: 'categories' } })).status, 403);
    check('a grouping that is neither is refused', (await call('POST', M(slug), { cookie: ownerC, body: { groupBy: 'colour' } })).status, 400);
    check('…and none of those wrote anything', JSON.stringify(fileOf(dir)), start);
    const toCats = await call('POST', M(slug), { cookie: ownerC, body: { groupBy: 'categories' } });
    f = fileOf(dir);
    check('Group by LOKA categories: categories, the four most-used, Odds & ends when places are left over',
      [toCats.status, f.mode.buttonsFrom, f.mode.tagColumn, f.mode.buttonsSig, toCats.j.mode.buttonsFrom], [200, 'categories', 'categories', undefined, 'categories']);
    const back = await call('POST', M(slug), { cookie: ownerC, body: { groupBy: 'analysis' } });
    f = fileOf(dir);
    check('and back to the analysis', [back.status, f.mode.buttonsFrom, f.mode.tagColumn, labelsOf(f.mode)], [200, 'analysis', want[0], want[1]]);
    const edit = f.mode.buttons.map((b) => ({ id: b.id, label: b.rest ? 'Everything else' : b.label, icon: b.icon, words: b.words, rest: b.rest }));
    edit[0].label = 'My own name';
    const saved = await call('POST', M(slug), { cookie: ownerC, body: { buttons: edit } });
    f = fileOf(dir);
    check('saving edits marks them edited; the column and grouping stay', [saved.status, f.mode.buttonsEdited, f.mode.buttonsFrom, f.mode.tagColumn, f.mode.buttons[0].label, f.mode.buttons.slice(-1)[0].label],
      [200, true, 'analysis', want[0], 'My own name', 'Everything else']);
    const choose = await call('POST', M(slug), { cookie: ownerC, body: { groupBy: 'analysis' } });
    f = fileOf(dir);
    check('"Let LOKA choose again": LOKA\'s names afresh, no longer edited', [choose.status, f.mode.buttonsEdited, labelsOf(f.mode)], [200, undefined, want[1]]);
    check('the file is written whole (no .tmp left behind)', fs.readdirSync(dir).filter((x) => x.endsWith('.tmp')), []);
    check('first Explore, categories, analysis, an edit, choose again: the model asked exactly once', modelCalls(slug), 1);
    check('LOKA\'s names are kept in the mode', typeof (fileOf(dir).mode.analysisNames || {}).sig, 'string');
  }
  // the answers change (a new reading): grouping by the analysis again asks once more
  const gf = path.join(PRIV, 'user-tags.geojson'), gj = JSON.parse(fs.readFileSync(gf, 'utf8'));
  gj.features.forEach((f) => { if (f.properties.pattern_1 === 'Water body') f.properties.pattern_1 = 'Pond or pool'; });
  fs.writeFileSync(gf, JSON.stringify(gj));
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { groupBy: 'categories' } });
  const ch = await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { groupBy: 'analysis' } });
  check('a changed answer set: a new model call, then none again', [ch.status, modelCalls(PRIVSLUG)], [200, 2]);
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { groupBy: 'categories' } });
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { groupBy: 'analysis' } });
  check('…and back and forth once more: still two', modelCalls(PRIVSLUG), 2);
  check('the owner\'s Group by is paid from their own allowance; a rebuild from the server\'s',
    /prev, local\.mode\.layer, req\)/.test(server) && /prev\.layer \|\| layerId, 'server'\)/.test(server) && /return aiCaller\(payer \|\| 'server', 1, stub\);/.test(server), true);
  check('a private atlas is written where it lives, never in the public folder', fs.existsSync(path.join(ROOT, 'atlas', 'datasets', PRIVSLUG)), false);

  console.log('\n  no question qualifies');
  const cl = fileOf(CUBD);
  cl.layers[0].keyLabels = { pattern_2: CUB.layer.keyLabels.pattern_2, pattern_4: CUB.layer.keyLabels.pattern_4 };
  fs.writeFileSync(path.join(CUBD, 'manifest.local.json'), JSON.stringify(cl));
  const first = await call('POST', M(CUBSLUG), { cookie: ownerC, body: { name: 'explore' } });
  let c = fileOf(CUBD);
  check('a first Explore falls back to LOKA categories', [first.status, c.mode.buttonsFrom, c.mode.tagColumn], [200, 'categories', 'categories']);
  const before = JSON.stringify(c);
  const no = await call('POST', M(CUBSLUG), { cookie: ownerC, body: { groupBy: 'analysis' } });
  check('Group by the analysis is refused in plain words, nothing written', [no.status, /sorts most of them into a few groups/.test((no.j && no.j.error) || ''), JSON.stringify(fileOf(CUBD))], [409, true, before]);

  /* A reading written by the server (the operator's re-read, with the
     stand-in model) commits the layer fromReading: the analysis Explore is
     worked out again; the one the owner edited is left exactly as it was. */
  console.log('\n  a reading written by the server');
  const A = { Authorization: 'Bearer ' + ADMIN };
  const pv = fileOf(PRIV);
  pv.mode.buttons = pv.mode.buttons.map((b, i) => i === 0 ? { ...b, label: 'Stale name' } : b);
  pv.mode.buttonsSig = 'stale';
  fs.writeFileSync(path.join(PRIV, 'manifest.local.json'), JSON.stringify(pv));
  const pb = fileOf(PUB);
  pb.mode.buttonsEdited = true;
  pb.mode.buttons[0].label = 'Owner wrote this';
  fs.writeFileSync(path.join(PUB, 'manifest.local.json'), JSON.stringify(pb));
  const pubBefore = JSON.stringify(pb.mode);
  const r1 = await call('POST', '/api/atlas/admin/reread', { headers: A, body: { dataset: PRIVSLUG, layerId: 'tags', afresh: true } });
  const r2 = await call('POST', '/api/atlas/admin/reread', { headers: A, body: { dataset: PUBSLUG, layerId: 'tags', afresh: true } });
  if (r1.status !== 200 || r2.status !== 200) console.log('         (re-read answered ' + r1.status + ' ' + JSON.stringify(r1.j).slice(0, 160) + ' / ' + r2.status + ')');
  const t0 = Date.now();
  let p = fileOf(PRIV);
  while (p.mode.buttonsSig === 'stale' && Date.now() - t0 > -1 && Date.now() - t0 < 8000) { await new Promise((r) => setTimeout(r, 150)); p = fileOf(PRIV); }
  check('the analysis Explore is worked out again from the new reading', [r1.status, p.mode.buttonsSig !== 'stale', p.mode.name, p.mode.buttons.some((b) => b.label === 'Stale name')], [200, true, 'explore', false]);
  await new Promise((r) => setTimeout(r, 600));
  check('the edited one is left exactly as it was', [r2.status, JSON.stringify(fileOf(PUB).mode)], [200, pubBefore]);
} catch (e) {
  fail++;
  console.log('  FAIL the route checks stopped: ' + (e && e.message) + '\n' + out.slice(-600));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
