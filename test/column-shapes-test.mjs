/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* What SHAPE a column is decides what a reading may do with it (Mithun, 28 Nov
   2026: "Ensure that lessons learned from generating this Atlas are
   incorporated into as systemic changes"). The atlas was a plain sheet of
   recording sites with no prose: its "state" column became a question, a list
   of animals was answered with one of them and then counted, two lists were
   shown as "their own words", and "Read from" printed West, Bengal.

   Nine rules, each checked here on a made-up sheet of the same shape
   (fixtures/sound-sites.mjs), and beside it a LOKA-shaped atlas with real
   prose, which must read exactly as it did. No network, no model. */
import * as E from '../api/lib/atlas/enrich.js';
import { soundSites, soundModel, ASKED, STATES, HABITATS } from './fixtures/sound-sites.mjs';
const require = createRequire(import.meta.url);
const RULES = require(ROOT + '/atlas/reading-rules.js');
const LABELS = require(ROOT + '/atlas/label-rules.js');
const IM = require(ROOT + '/atlas/insight-mode.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const rows = soundSites();
const fields = RULES.wordColumns(rows);
// the names the atlas's own boundaries carry, as the server hands them to a reading
const KNOWN = new Set(STATES.map((s) => s.toLowerCase()));
const read = (opts = {}) => E.enrichRows(Object.assign({
  rows, fields, title: 'Sound sites', mode: 'questions', keepQuestions: [], seedSet: [], nameCol: 'name', callBudget: 24, placeNames: KNOWN,
  models: { flash: 'stub', flashLite: 'stub' }, callJSON: soundModel({}),
}, opts));
const out = await read();
const lineOf = (o, column) => ((o.columns || []).find((l) => l.column === column) || {}).line || '';
const habitatQ = (out.questions || []).find((q) => q.question === ASKED.habitat) || { columns: [], counts: [], why: [], categories: [] };

console.log('\n  the sheet, read whole: one question is left, and it is the one that was worth asking');
check('the reading keeps exactly the habitat question', (out.questions || []).map((q) => q.question), [ASKED.habitat]);

console.log('\n  1. where a place is, is never a question');
const tc = E.textColumns(rows, fields, { nameCol: 'name', places: KNOWN });
const passed = (c) => tc.passed.find((p) => p.column === c) || {};
check('a column whose values are names the atlas\'s own boundaries carry is a location, on a strong signal',
  [passed('state').location, passed('state').strong, passed('state').by, passed('state').why], [true, true, 'known names', LABELS.LOCATION_WHY]);
check('and the owner is told so on its line', lineOf(out, 'state'), 'State: not asked — says where each place is, and the map already shows that');
const states = rows.map((r) => r.state);
check('whatever the column is called', LABELS.locationSignal('col_7', states, { places: KNOWN }), { why: 'location', strong: true, by: 'known names' });
check('a name that can only mean a place needs only place-name values — but the name alone is not strong', LABELS.locationSignal('District name', states, {}), { why: 'location', strong: false, by: 'name and values' });
check('a pin code column is a location, and by its shape it IS strong', LABELS.locationSignal('Pin code', rows.map((_, i) => String(560001 + i % 40)), {}), { why: 'location', strong: true, by: 'name and values' });
/* …because a sure-sounding name and tidy capitalised words is also what a
   district of hospital wards, a city of team names and a country of species
   origins look like. Such a column is passed over when questions are looked
   for; it never takes a settled question off the map. */
for (const [name, list] of [['district', ['Maternity', 'Cardiology', 'Paediatrics']], ['city', ['Red Hawks', 'Blue Lions', 'Green Owls']], ['country', ['Native', 'Introduced', 'Naturalised']]])
  check('a "' + name + '" of ' + list[0] + ' … is passed over, never retires a question', [LABELS.locationSignal(name, rows.map((_, i) => list[i % list.length]), {}).strong,
    LABELS.locationSignal(name, rows.map((_, i) => list[i % list.length]), {}).why], [false, 'location']);
check('"State of repair" and "Village type" are not place names', [LABELS.locationName('State of repair'), LABELS.locationName('Village type'), LABELS.locationName('Home state')], ['', '', 'maybe']);
check('with no boundary names behind it, a "state" column is asked — a name that only may mean a place decides nothing', LABELS.locationSignal('state', states, {}).why, '');
check('a habitat column is not a location', LABELS.locationSignal('habitat', rows.map((r) => r.habitat), { places: KNOWN }).why, '');
/* Seven columns with a place-ish name, tidy capitalised values, and sites that
   sit together on the map exactly as the states do (same clusters) — none of
   them a place. Never a location, with or without boundary names to ask. */
const NOT_PLACES = {
  region: ['Left arm', 'Right leg', 'Lower back', 'Left shoulder'], block: ['Rose Block', 'Lily Block', 'Neem Block'],
  zone: ['Core', 'Buffer', 'Tourism'], ward: ['Maternity', 'Cardiology', 'Paediatrics'], division: ['Water Works', 'Roads', 'Parks'],
  locality: ['Dense Urban', 'Peri Urban', 'Rural'], state: ['Under repair', 'Collapsed', 'Rebuilt', 'Silted'],
};
const clustered = (list) => rows.map((_, i) => list[(i % STATES.length) % list.length]);
for (const [name, list] of Object.entries(NOT_PLACES)) {
  const asked = E.textColumns(rows.map((r, i) => ({ name: r.name, latitude: r.latitude, longitude: r.longitude, [name]: clustered(list)[i] })), [name], { places: KNOWN });
  check('a "' + name + '" of ' + list.slice(0, 2).join(' / ') + ' … is no location: not by name, shape or the map',
    [LABELS.locationSignal(name, clustered(list), {}).why, LABELS.locationSignal(name, clustered(list), { places: KNOWN }).why, asked.passed.some((p) => p.location)], ['', '', false]);
}
// an earlier reading's question, recorded against the whole group it was found in
const stateQ = { col: 'pattern_1', question: ASKED.state, kinds: STATES.slice(0, 7).concat(['Other States']).map((name) => ({ name, definition: '' })), columns: ['habitat', 'state', 'animal_groups'] };
const oldHabitatQ = { col: 'pattern_3', question: ASKED.habitat, kinds: Object.keys(HABITATS).map((name) => ({ name, definition: '' })), columns: ['habitat'] };
const again = await read({ keepQuestions: [stateQ, oldHabitatQ] });
check('the question an earlier reading took from it is retired, leaving a gap in the numbering',
  [(again.retired || []).map((x) => [x.col, x.columns]), (again.questions || []).map((q) => q.col)], [[['pattern_1', ['state']]], ['pattern_3']]);
check('and its line names the question that went', /“Which state is this place in\?”, which an earlier reading took from it, is now off the map/.test(lineOf(again, 'state')), true);
const unknown = await read({ placeNames: null, keepQuestions: [Object.assign({}, stateQ, { columns: ['state'] }), oldHabitatQ] });
check('with no boundary names to go by, nothing is taken off the map', [(unknown.retired || []).length, (unknown.questions || []).map((q) => q.col)], [0, ['pattern_1', 'pattern_3']]);
const repair = rows.map((r, i) => Object.assign({}, r, { state: clustered(NOT_PLACES.state)[i] }));
const repairQ = { col: 'pattern_1', question: 'What state of repair is it in?', kinds: NOT_PLACES.state.map((name) => ({ name, definition: '' })), columns: ['state'] };
const kept = await read({ rows: repair, keepQuestions: [repairQ, oldHabitatQ] });
check('a settled question read from a "state" of repair is never retired', [(kept.retired || []).length, (kept.questions || []).map((q) => q.col)], [0, ['pattern_1', 'pattern_3']]);
/* …and neither is one read from a "district" of hospital wards: the name
   says place and the values are shaped like place names, which is enough to
   leave a new question unasked, never enough to take a settled one away. */
const WARDS = ['Maternity', 'Cardiology', 'Paediatrics'];
const wardRows = rows.map((r, i) => Object.assign({}, r, { district: WARDS[i % WARDS.length] }));
const wardQ = { col: 'pattern_1', question: 'Which ward is this?', kinds: WARDS.map((name) => ({ name, definition: '' })), columns: ['district'] };
const wards = await read({ rows: wardRows, fields: RULES.wordColumns(wardRows), placeNames: null, keepQuestions: [wardQ, oldHabitatQ] });
check('a settled question read from a "district" of hospital wards is not retired on the name alone',
  [(wards.retired || []).length, (wards.questions || []).map((q) => q.col)], [0, ['pattern_1', 'pattern_3']]);
/* A question read from DESCRIPTIONS whose answers happen to be a district column's
   values must never be brought down onto that column and retired with it. */
const DISTRICTS = ['North Vale', 'Reedland', 'Stonemoor'];
const town = Array.from({ length: 24 }, (_, i) => ({ name: 'Stall ' + (i + 1), district: DISTRICTS[i % 3],
  description: 'Stall ' + (i + 1) + ' is where the weavers of ' + DISTRICTS[i % 3] + ' sell cloth every Sunday morning by the old well.' }));
const partQ = { col: 'pattern_1', question: 'Whose weavers sell here?', kinds: DISTRICTS.map((name) => ({ name, definition: '' })), columns: ['description', 'district'] };
const townOut = await E.enrichRows({ rows: town, fields: RULES.wordColumns(town), title: 'Stalls', mode: 'questions', keepQuestions: [partQ], seedSet: [], nameCol: 'name',
  callBudget: 24, models: { flash: 'stub', flashLite: 'stub' }, callJSON: soundModel({}) });
check('a description-read question is not narrowed onto a location column and retired: it lets go of the district and keeps the description',
  [(townOut.retired || []).length, (townOut.questions || []).map((q) => [q.col, q.columns])], [0, [['pattern_1', ['description']]]]);

// where those names come from: the atlas's own boundary file, read by the server and handed to every reading
check('a boundary file\'s names: each outline\'s name and what it sits in — never its codes or bookkeeping words',
  [...E.boundaryNamesOf({ features: [{ properties: { name: 'North Vale', kind: 'admin', dist_lgd: '551', state: 'Reedland', shapeID: 'B77' } }] })].sort(), ['north vale', 'reedland']);
check('a file with no names gives nothing to ask', [E.boundaryNamesOf({ features: [] }), E.boundaryNamesOf(null)], [null, null]);
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('the server reads them once per version of the file and hands them to the reading',
  [/placeNames: boundaryNamesFor\(m\.dir\),/.test(server), /enrich\.boundaryNamesOf\(JSON\.parse\(fs\.readFileSync\(file, 'utf8'\)\)\)/.test(server), /boundaryNameCache\.has\(key\)/.test(server)], [true, true, true]);

console.log('\n  2. a question that only repeats one plain column adds nothing');
check('a sibling column that already states the group is preferred to reading the list: here the animal_groups list',
  /“Which group of animals is this place known for\?” — it sorted the places the same way the animal_groups column already does/.test(lineOf(out, 'animals_heard')), true);
// without that list, only the PLAIN column states the group — which the older test (closed lists only) could not see
const noList = await read({ rows: rows.map(({ animal_groups, ...r }) => r), fields: fields.filter((f) => f !== 'animal_groups') });
check('a plain column asked again in other words, two of its groups merged, is dropped too',
  /“Which group of animals is this place known for\?” — it sorted the places the same way the main_animal_group column already does/.test(lineOf(noList, 'animals_heard')), true);
check('grouping thirty spellings of habitat into kinds is real reading, and is kept', habitatQ.counts.map((c) => c.name).sort(), ['Forest', 'Open country', 'Wetland']);

console.log('\n  3. a list is not a single answer');
check('"Sunbird" for a place that lists many animals: dropped, and the line says the list is tags',
  /“What kind of animal is heard here\?” — each answer is one item of the Animals heard list, and \d+ of the \d+ places it answered hold more than one of them — the list is shown as tags instead/.test(lineOf(out, 'animals_heard')), true);

console.log('\n  4. counting is arithmetic, not reading');
check('a number column is never sent to the reader as words', fields.filter((f) => /count|recordings/.test(f)), []);
check('the word columns the reading starts from', fields, ['name', 'state', 'habitat', 'gear', 'animal_groups', 'main_animal_group', 'animals_heard', 'source']);
check('and, named by a caller, it is passed over with its reason',
  E.textColumns(rows, ['species_count'], {}).passed[0].why, 'a number — it is counted, not read as words');
check('numbers by their values, whatever the column is called', [LABELS.isNumberColumn(['12', '1,204', '3.5', '40%', '']), LABELS.isNumberColumn(['12 trees', '3']), LABELS.isNumberColumn(['9845012345', '9845012346'])], [true, false, false]);
check('"How many …" asked of a list is dropped', /“How many different species are heard here\?” — it only counts what the Animals heard column holds — a count is worked out, not read/.test(lineOf(out, 'animals_heard')), true);
check('and so is a count in other words: answers that simply follow the list\'s length', /“How rich is the soundscape here\?” — it only counts what the Animals heard column holds/.test(lineOf(out, 'animals_heard')), true);

console.log('\n  5. "Other …" must not hide the place\'s own value');
check('a leftover is known by its name', ['Other States', 'Others', 'Miscellaneous', 'Everything else', 'Otherworldly', 'Rest house'].map(LABELS.isLeftoverName), [true, true, true, true, false, false]);
check('"Other habitats" is never kept as a kind', habitatQ.counts.some((c) => /other/i.test(c.name)), false);
check('a settled question keeps every kind it has, a leftover too: only new questions are held to this',
  E.settledForAnswering([stateQ], ['habitat', 'state', 'animal_groups'])[0].kinds.map((k) => k.name), STATES.slice(0, 7).concat(['Other States']));
check('an old leftover answer on a card says whose words these are', IM.fromHTML('Other States', 'West Barrow'), '<div class="in-from">This place says: <q>West Barrow</q></div>');
check('any other answer reads as before', IM.fromHTML('Forest', 'Dry forest'), '<div class="in-from">Read from: <q>Dry forest</q></div>');

console.log('\n  6. "Read from" shows the place\'s words as written');
check('words side by side are one phrase', LABELS.phrasesAsWritten(['West', 'Bengal'], ['Western Ghats forest', 'West Bengal']), ['West Bengal']);
/* Only words the reading cited. A short item used to be widened to its whole
   self the moment one of its words was cited, so two cited words came back as
   "KR PURAM DEVASANDRA MARKET" — words the model never said. */
check('a list\'s item gives back the cited words, in the list\'s order', LABELS.phrasesAsWritten(['Brown', 'Hawk', 'Sunbird'], ['Sunbird; Drongo; Brown Hawk Owl; Koel']), ['Sunbird', 'Brown Hawk']);
check('…and the whole item when every word of it was cited', LABELS.phrasesAsWritten(['Brown', 'Hawk', 'Owl'], ['Sunbird; Brown Hawk Owl']), ['Brown Hawk Owl']);
check('never words the reading did not cite', LABELS.phrasesAsWritten(['PURAM', 'DEVASANDRA'], ['KR PURAM DEVASANDRA MARKET, Bengaluru']), ['PURAM DEVASANDRA']);
check('prose keeps its words, joined only where they stand together', LABELS.phrasesAsWritten(['shade', 'big', 'old'], ['A big old banyan tree by the bus stop, with lots of shade.']), ['big old', 'shade']);
check('a word no cell holds any more is kept as it was', LABELS.phrasesAsWritten(['gone', 'forest'], ['Dry forest']), ['Dry forest', 'gone']);
const evidenced = habitatQ.why.map((w, i) => [w, i]).filter(([w]) => w.length);
/* The checks that decide WHICH answers stand run on the words as cited, exactly
   as before: 24 prose places, "nature" cited for Nature on half and for Culture
   on the other half. A word arguing for two answers is thrown out everywhere —
   joined into "quiet nature" first, it would have slipped through. */
{
  const prose24 = Array.from({ length: 24 }, (_, i) => ({ description: i % 2
    ? 'A small stage where quiet nature talks are held on weekends by the river, stage ' + i
    : 'A long walk through quiet nature beside the old canal bank, walk ' + i }));
  const filed = await E.answerQuestions({ digest: E.buildDigest(prose24, ['description']), title: '', model: 'stub',
    questions: [{ question: 'What is it for?', kinds: [{ name: 'Nature', definition: '' }, { name: 'Culture', definition: '' }] }],
    callJSON: async (model, prompt) => ({ rows: prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b)).map((b) => {
      const i = Number(b.match(/^(\d+)\./)[1]);
      return i % 2 ? { i, q0: 'Culture', w0: ['nature'] } : { i, q0: 'Nature', w0: ['quiet', 'nature'] };
    }) }) });
  check('a word cited for two different answers still takes both away: 12 of 24 answered, as before the phrases',
    [filed.answers[0].filter(Boolean).length, filed.why[0][0], filed.why[0][1], filed.answers[0][1]], [12, ['quiet'], [], '']);
}
check('the reading stores each answer\'s words exactly as the cell has them', evidenced.every(([w, i]) => w.length === 1 && w[0] === rows[i].habitat), true);
const shaped = RULES.shapeReading(rows, out.questions || []);
check('and so does the place', evidenced.every(([, i]) => shaped.rows[i].pattern_1_why === rows[i].habitat), true);
const oldCard = { habitat: 'Dry forest', state: 'West Barrow', animals_heard: 'Sunbird; Brown Hawk Owl', pattern_1: 'Other States', pattern_1_why: 'West, Barrow', pattern_2: 'Sunbird', pattern_2_why: 'Brown, Hawk' };
check('a value stored the old way is shown as the cell has it — the cited words, never more',
  [IM.whyShown({ keyColumns: { pattern_1: ['habitat', 'state'] } }, oldCard, 'pattern_1'), IM.whyShown({}, oldCard, 'pattern_2')], ['West Barrow', 'Brown Hawk']);

console.log('\n  7. a list of names is not somebody\'s words');
check('lists, by their shape', ['Sunbird; Drongo; Brown Hawk Owl', 'Birds, Mammals, Frogs and toads, Insects', 'Birds; Mammals'].map(LABELS.isListCell), [true, true, true]);
check('sentences are not lists', ['We came at dawn, saw two herons, and left.', 'A quiet lake where the herons are nesting, and the path is flooded after rain', 'Old temple, rebuilt in 1920'].map(LABELS.isListCell), [false, false, false]);
const soundLayer = { id: 'sites', type: 'marker', keyLabels: shaped.keyLabels, keyKinds: shaped.keyKinds, keyColumns: shaped.keyColumns };
const soundFeatures = shaped.rows.map((properties) => ({ type: 'Feature', properties }));
const soundDigest = IM.storyDigest(soundLayer, soundFeatures, {});
check('an atlas with no prose offers no quote at all, so it has no story', [soundDigest.candidates.length, soundDigest.offered.length], [0, 0]);
check('and a quote an earlier story took from a list is no longer shown',
  IM.storyToShow({ story: { ownWords: true, quotes: [0, 1].map((i) => ({ id: 'at:' + i, text: rows[i].animals_heard })) } }, soundLayer, soundFeatures, null), null);

console.log('\n  8. a question keeps only the columns it was really read from');
check('found while gear and habitat were read together, it is the habitat column\'s alone', habitatQ.columns, ['habitat']);
check('gear\'s line does not claim it', lineOf(out, 'gear'),
  'Gear: no question of its own — “What kind of habitat is this place?” was read from Habitat (read with Habitat — it holds only a word or two)');
check('habitat\'s line does', /^Habitat: 1 question kept: “What kind of habitat is this place\?” \(reaches 55 of 120 places\)/.test(lineOf(out, 'habitat')), true);

console.log('\n  9. an upload is told what it lacks, before the owner builds');
const prose = [{ name: 'Tank bund', note: 'We walk here every evening because the breeze off the water is lovely.' }, { name: 'Old gate', note: '' }];
check('a sheet of categories, lists and numbers has nothing written', LABELS.hasWrittenWords(rows), false);
check('one column of sentences is enough', LABELS.hasWrittenWords(prose), true);
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const cut = (src, head, close) => { const a = src.indexOf(head); if (a < 0) throw new Error('not found: ' + head); return src.slice(a, src.indexOf(close, a) + close.length); };
const noWordsSays = (state) => new Function('BENCH', 'LokaLabelRules',
  cut(setup, '  var NO_WORDS = ', '\n') + cut(setup, '  function noWordsSays() {', '\n  }\n') + ' return noWordsSays();')({ state }, LABELS);
check('the wizard\'s check line says so in plain words', noWordsSays({ canonical: { rows } }),
  ' These places have no written descriptions, so there will be no story — only questions from their categories.');
check('and says nothing when there are descriptions, or no rows to ask', [noWordsSays({ canonical: { rows: prose } }), noWordsSays({})], ['', '']);
check('it follows whatever else the check line says', /return bits\.join\(" "\) \+ noWordsSays\(\);/.test(setup), true);

/* ---------- the other atlas: LOKA-shaped, with real prose. Nothing here may change. ---------- */
console.log('\n  a LOKA-shaped atlas with prose reads exactly as before');
const DRAWS = ['shade', 'water', 'swings'];
const loka = [];
for (let i = 0; i < 24; i++) {
  const draw = DRAWS[i % 3];
  loka.push({
    loka_name: 'Corner ' + (i + 1),
    description: 'Corner ' + (i + 1) + ' is where we come most evenings because the ' + draw + ' is lovely but the lane floods after rain.',
    labels: 'kerb-' + i + '; ' + (i % 2 ? 'stone-bench' : 'play-frame') + '; lamp-post-' + (i % 7),
    categories: ['Nature', 'Culture', 'Learning'][Math.floor(i / 8)] + (i % 2 ? '; Heritage' : ''),
    likes: String(i % 6), comments: String(i % 4),
    latitude: 12.9 + i / 1000, longitude: 77.5 + i / 1000,
  });
}
const lokaFields = RULES.wordColumns(loka);
check('its counts of likes and comments are no longer words to read (schema audit #12)', lokaFields, ['description', 'labels', 'categories']);
const lokaModel = async (model, prompt, schema, o) => {
  if (schema && schema.properties && schema.properties.checks) return { checks: [] };
  const kinds = (names) => names.map((name, k) => ({ name, definition: 'Places that', examples: [k + 1, k + 4, k + 7] }));
  if (o && o.think) {
    const one = (prompt.match(/ONE column of its data, called "([^"]+)"/) || [])[1];
    if (one === 'description') return { verdict: 'questions', reading: 'r', facts: ['f'], questions: [{ question: 'What draws people here?', kinds: kinds(['Shade', 'Water', 'Play']) }] };
    if (one === 'labels') return { verdict: 'questions', reading: 'r', facts: ['f'], questions: [{ question: 'What is there to use?', kinds: kinds(['Seating', 'Play equipment']) }] };
    return { verdict: 'no_clear_questions', note: '' };
  }
  const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
  return { rows: blocks.map((b) => {
    const draw = DRAWS.find((d) => b.includes('the ' + d + ' is'));
    return { i: Number(b.match(/^(\d+)\./)[1]),
      q0: { shade: 'Shade', water: 'Water', swings: 'Play' }[draw], w0: [draw, 'evenings'],
      q1: b.includes('stone-bench') ? 'Seating' : 'Play equipment', w1: [b.includes('stone-bench') ? 'stone-bench' : 'play-frame'] };
  }) };
};
const lokaOut = await E.enrichRows({ rows: loka, fields: lokaFields, title: 'Corners', mode: 'questions', keepQuestions: [], seedSet: [],
  nameCol: 'loka_name', callBudget: 24, models: { flash: 'stub', flashLite: 'stub' }, callJSON: lokaModel });
check('both its questions are kept, each against its own column',
  (lokaOut.questions || []).map((q) => [q.question, q.columns]), [['What draws people here?', ['description']], ['What is there to use?', ['labels']]]);
check('the words under an answer are the words cited; one cited for every answer alike ("evenings") is still thrown out', ((lokaOut.questions || [])[0] || { why: [] }).why[0], ['shade']);
check('a tag is still a tag', ((lokaOut.questions || [])[1] || { why: [] }).why[1], ['stone-bench']);
check('no column of it is called a location or a number', (lokaOut.columns || []).filter((l) => /where each place is|a number/.test(l.line)).length, 0);
const lokaShaped = RULES.shapeReading(loka, lokaOut.questions || []);
const lokaLayer = { id: 'corners', type: 'marker', _loka: true, keyLabels: lokaShaped.keyLabels, keyKinds: lokaShaped.keyKinds, keyColumns: lokaShaped.keyColumns };
const digest = IM.storyDigest(lokaLayer, lokaShaped.rows.map((properties) => ({ type: 'Feature', properties })), {});
check('its sentences are still offered as quotes', [digest.candidates.length > 0, digest.candidates.every((c) => /^Corner \d+ is where we come most evenings/.test(c.text))], [true, true]);

console.log('\n  a question read from descriptions is real reading, even when it agrees with a plain column (an Event or Explore atlas)');
{
  const DOING = { Talk: ['Listening', 'sit listening to a speaker', 'listening'], Walk: ['On foot', 'set off on foot together', 'foot'], Film: ['Watching', 'sit watching a screen', 'watching'] };
  const venues = Array.from({ length: 24 }, (_, i) => { const type = Object.keys(DOING)[i % 3]; return { name: 'Venue ' + (i + 1), type,
    description: 'Venue ' + (i + 1) + ' is where people ' + DOING[type][1] + ' on festival evenings near the gate.' }; });
  const model = async (m, prompt, schema, o) => {
    if (schema && schema.properties && schema.properties.checks) return { checks: [] };
    if (o && o.think) return /called "description"/.test(prompt)
      ? { verdict: 'questions', reading: 'r', facts: ['f'], questions: [{ question: 'What do people do here?',
          kinds: Object.values(DOING).map((d, k) => ({ name: d[0], definition: 'Places that', examples: [k + 1, k + 4, k + 7] })) }] }
      : { verdict: 'no_clear_questions', note: '' };
    return { rows: prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b)).map((b) => {
      const d = Object.values(DOING).find((x) => b.includes(x[1]));
      return { i: Number(b.match(/^(\d+)\./)[1]), q0: d[0], w0: [d[2]] };
    }) };
  };
  const event = await E.enrichRows({ rows: venues, fields: RULES.wordColumns(venues), title: 'Festival', mode: 'questions', keepQuestions: [], seedSet: [],
    nameCol: 'name', callBudget: 24, models: { flash: 'stub', flashLite: 'stub' }, callJSON: model });
  check('it follows the plain "type" column place for place, and is kept: the echo rule is for lists and short columns only',
    (event.questions || []).map((q) => [q.question, q.columns, q.answered]), [['What do people do here?', ['description'], 24]]);
}

console.log('\n  at the next reading, a settled count or one-item-of-a-list question is retired too (Mithun: "Retire them too")');
const kindsNamed = (names) => names.map((name) => ({ name, definition: '' }));
const animalQ = { col: 'pattern_2', question: ASKED.animal, kinds: kindsNamed(['Sunbird', 'Drongo', 'Koel', 'Barbet']), columns: ['animals_heard'] };
const countQ = { col: 'pattern_4', question: ASKED.howMany, kinds: kindsNamed(['One species', 'Two to four', 'Five to ten']), columns: ['animals_heard'] };
const richQ = { col: 'pattern_5', question: ASKED.rich, kinds: kindsNamed(['Sparse', 'Moderate', 'Rich']), columns: ['animals_heard'] };
const busyQ = { col: 'pattern_6', question: 'How busy is this site?', kinds: kindsNamed(['Quiet', 'Busy']), columns: ['recordings'] };
// the places still wear the answers to "How rich…": they follow the length of the list
const worn = rows.map((r) => Object.assign({}, r, { pattern_5: Number(r.species_count) === 1 ? 'Sparse' : Number(r.species_count) <= 4 ? 'Moderate' : 'Rich' }));
const later = await read({ rows: worn, keepQuestions: [animalQ, oldHabitatQ, countQ, richQ, busyQ] });
check('one item of a list, "how many" of a list, answers that follow the list\'s length, and a question read from numbers: all four go, the numbering keeps its gaps',
  [(later.retired || []).map((x) => x.col).sort(), (later.questions || []).map((q) => q.col)], [['pattern_2', 'pattern_4', 'pattern_5', 'pattern_6'], ['pattern_3']]);
check('the list\'s line names what went and why', /“What kind of animal is heard here\?”.*which an earlier reading took from it, are now off the map — /.test(lineOf(later, 'animals_heard')), true);
check('and so does the number column\'s, which is no longer read at all', lineOf(later, 'recordings'),
  'Recordings: not read — a number is counted, not read as words; “How busy is this site?”, which an earlier reading took from it, is now off the map — a number is counted, not read');
const unworn = await read({ keepQuestions: [richQ, oldHabitatQ] });
check('never on a wording or a hunch: with no answers on the places to count and no "how many" asked, the question stays', [(unworn.retired || []).length, (unworn.questions || []).map((q) => q.col)], [0, ['pattern_5', 'pattern_3']]);
const familiesQ = { col: 'pattern_1', question: 'How many families live here?', kinds: kindsNamed(['One family', 'Several families']), columns: ['description'] };
const families = await E.enrichRows({ rows: town, fields: RULES.wordColumns(town), title: 'Stalls', mode: 'questions', keepQuestions: [familiesQ], seedSet: [], nameCol: 'name',
  callBudget: 24, models: { flash: 'stub', flashLite: 'stub' }, callJSON: soundModel({}) });
check('"How many families live here?" read from descriptions is reading, and is not retired', [(families.retired || []).length, (families.questions || []).map((q) => q.col)], [0, ['pattern_1']]);
const useQ = { col: 'pattern_2', question: 'What is there to use?', kinds: kindsNamed(['Seating', 'Play equipment']), columns: ['labels'] };
const labelsAgain = await E.enrichRows({ rows: loka, fields: lokaFields, title: 'Corners', mode: 'questions', keepQuestions: [useQ], seedSet: [],
  nameCol: 'loka_name', callBudget: 24, models: { flash: 'stub', flashLite: 'stub' }, callJSON: lokaModel });
check('a grouping question read from LOKA\'s labels is not retired', [(labelsAgain.retired || []).length, (labelsAgain.questions || []).map((q) => q.col)], [0, ['pattern_2']]);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
