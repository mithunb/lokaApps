/* Run me with: node test/run.mjs — or on my own with node.
 *
 * KEYS OVER BOTH HALVES (Mithun, October 2026: "keys should cover both — why
 * wouldn't it?"). One uploaded file goes on as two layers — its outlines and
 * "<name> · as points" (sameFileAs) — and the Map Browser shows them as one
 * row. The keys under that row used to come from the outlines alone: the
 * points' places wore no mark, were not counted, could not be filtered. Now
 * every key is worked out over both halves' places together, opening one marks
 * both, tapping an answer narrows both, and the questions a reading wrote on
 * the pins are offered under the row and mark the outlines too.
 *
 * Underneath, the halves hold DIFFERENT rows (a row goes on as a point only
 * when no outline placed it), so the server reads a split file as one file —
 * both halves' rows together — and writes each half its own share. The road
 * on a real server runs in area-questions-test.mjs; here the viewer's rules
 * run on made-up layers lifted out of atlas.js, and the server's slicing is
 * lifted and run on its own. No network. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const rules = fs.readFileSync(ROOT + '/atlas/reading-rules.js', 'utf8');
const script = fs.readFileSync(ROOT + '/deploy/queue-question-readings.mjs', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
const LokaLabelRules = createRequire(import.meta.url)(path.join(ROOT, 'atlas', 'label-rules.js'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// lift the key machinery out of atlas.js as it stands, so the check follows the source
function fn(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = js.indexOf('\n  }\n', i);
  const k = js.indexOf('\n', i + 1);
  return /\}\s*$/.test(js.slice(i, k)) && js.slice(i, k).split('{').length === js.slice(i, k).split('}').length
    ? js.slice(i, k) + '\n' : js.slice(i, j + 4) + '\n';
}
function constant(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^;]*;'));
  if (!m) throw new Error('no var ' + name);
  return m[0] + '\n';
}
const body =
  ['KEY_COLORS', 'KEY_OTHER', 'KEY_MAX', 'KEY_CAP', 'KEY_DOMINANCE', 'QUESTION_MIN_REACH', 'KEY_LOPSIDED_MIN_KINDS',
    'KEY_MIN_SHARED', 'DATEY', 'MONTHS', 'PIN_ONE', 'ROW_SHAPES', 'ROW_WORDS'].map(constant).join('') +
  ['prettyCol', 'colLabel', 'dateKeyName', 'looksLikeDates', 'dateBucket', 'dateGrain',
    'unbrace', 'unquotePiece', 'cellText', 'skipSearchValue', 'sharedShare',
    'computeKeyOptions', 'optValuesOf', 'activeKeyOptions', 'keyKindColor', 'oneColorOf',
    'keyMarkRows', 'keyLegendRows', 'kindWords', 'hasPins',
    'layerById', 'looksLikeTwin', 'pairedTwin', 'pairedPrimary', 'layerNoun',
    'keyHost', 'keyHalves', 'keyEntries', 'keyFeatures', 'halfOfEntry', 'keyFace', 'keyNoun',
    'kindFilterIs', 'filterByKind', 'fitAnswer', 'answerNamesOn', 'unpickAnswer'].map(fn).join('');
/* The state the lifted functions read: the manifest, the data, the markers,
   the key state, and the search machinery a pressed answer goes through. */
const make = new Function('LokaLabelRules', 'MANIFEST', 'DATA', 'markersByLayer', 'keyState', 'searchRows',
  'applyRowVisibility', 'updateSearchCount', 'markLitKinds', 'clearSearch', '$',
  'var KINDFILTER = null, searchWord = "", searchSeq = 0, searchTimer = null, map = null, ANSWER_MAX_ZOOM = 16;\n' +
  'function clearTimeout() {}\n' +
  body +
  'return { computeKeyOptions, keyLegendRows, keyMarkRows, activeKeyOptions, keyHost, keyHalves, keyEntries, keyFeatures, ' +
  'halfOfEntry, keyFace, keyNoun, filterByKind, kindFilter: function () { return KINDFILTER; } };');

/* One file: six rows matched outlines, five only had a point. Every row has
   notes and a Kind; a reading answered "Does it mention water?" on seven of
   the eleven — four areas and three points — three of them "Mentions water"
   (two areas, one point) and four "No water". */
const AREAS = ['Nature', 'Civic', 'Nature', 'Civic', 'Nature', 'Civic'];
const POINTS = ['Nature', 'Civic', 'Nature', 'Nature', 'Civic'];
const WATER = 'Mentions water', DRY = 'No water';
const areaRows = AREAS.map((k, i) => ({ name: 'Zone ' + (i + 1), notes: 'notes ' + i, Kind: k,
  pattern_1: i < 2 ? WATER : i < 4 ? DRY : '', pattern_1_why: i < 2 ? 'pond' : i < 4 ? 'dust' : '' }));
const pointRows = POINTS.map((k, i) => ({ name: 'Village ' + (i + 1), notes: 'more ' + i, Kind: k, latitude: 1, longitude: 2,
  pattern_1: i < 1 ? WATER : i < 3 ? DRY : '', pattern_1_why: i < 1 ? 'pond' : i < 3 ? 'dust' : '' }));
const ring = [[77, 12], [77.1, 12], [77.1, 12.1], [77, 12.1], [77, 12]];
const areaFeats = areaRows.map((p, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: p, _row: i }));
const pointFeats = pointRows.map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77 + i, 12] }, properties: p, _row: i }));
const LABELS = { pattern_1: 'Does it mention water?' };

function world(opts) {
  const host = Object.assign({ id: 'zones', type: 'fill', userLayer: true, centreMarks: true, label: 'Zones', sameFileAs: 'zones-as-points',
    popup: { title: 'name' } }, opts.host || {});
  const twin = Object.assign({ id: 'zones-as-points', type: 'marker', userLayer: true, label: 'Zones · as points', sameFileAs: 'zones',
    popup: { title: 'name' } }, opts.twin || {});
  const lone = { id: 'lone', type: 'marker', userLayer: true, label: 'On its own', popup: { title: 'name' } };
  const MANIFEST = { layers: [host, twin, lone] };
  const DATA = { zones: { features: areaFeats }, 'zones-as-points': { features: pointFeats }, lone: { features: pointFeats } };
  const markersByLayer = {
    zones: areaFeats.map((f) => ({ f: { type: 'Feature', geometry: { type: 'Point', coordinates: [77.05, 12.05] }, properties: f.properties, _row: f._row }, shape: f })),
    'zones-as-points': pointFeats.map((f) => ({ f })),
    lone: pointFeats.map((f) => ({ f })),
  };
  const keyState = {};
  const counted = [];
  const redrawn = [];
  const lib = make(LokaLabelRules, MANIFEST, DATA, markersByLayer, keyState,
    (L) => markersByLayer[L.id] || [],
    (L) => { redrawn.push(L.id); },
    (shown, total, pts, lead, word, noun) => { counted.push({ shown, total, pts: pts.length, lead, noun }); },
    () => {}, () => {}, () => ({}));
  return { host, twin, lone, lib, keyState, markersByLayer, counted, redrawn };
}

console.log('\n  the two halves are one for the keys');
{
  const w = world({ twin: { keyLabels: LABELS } });
  check('the outlines layer is the host of both halves', [w.lib.keyHost(w.host).id, w.lib.keyHost(w.twin).id], ['zones', 'zones']);
  check('asked from either half, the halves are the same two, outlines first',
    [w.lib.keyHalves(w.host).map((l) => l.id), w.lib.keyHalves(w.twin).map((l) => l.id)], [['zones', 'zones-as-points'], ['zones', 'zones-as-points']]);
  check('every place of both halves is counted: 6 as areas, 5 as points', [w.lib.keyFeatures(w.host).length, w.lib.keyEntries(w.host).length], [11, 11]);
  check('a marker is known by its own half', [w.lib.halfOfEntry(w.host, w.markersByLayer['zones-as-points'][2]).id,
    w.lib.halfOfEntry(w.host, w.markersByLayer.zones[1]).id], ['zones-as-points', 'zones']);
  check('a split file\'s places are "places", not "areas"', w.lib.keyNoun(w.host), 'places');
  check('unless the manifest names them', world({ host: { noun: 'people' } }).lib.keyNoun(world({ host: { noun: 'people' } }).host), 'people');
}

console.log('\n  the questions a reading wrote on the pins are offered under the row');
{
  // an atlas read before the server read both halves: the question's name is on the pins alone
  const w = world({ twin: { keyLabels: LABELS, hiddenKeys: ['pattern_9'] }, host: { hiddenKeys: ['pattern_8'] } });
  const face = w.lib.keyFace(w.host);
  check('the face reads the question\'s name off the pins', face.keyLabels, LABELS);
  check('and the hidden list off both halves', face.hiddenKeys, ['pattern_8', 'pattern_9']);
  check('and answers for the host in everything else', [face.id, face.type, face.popup.title], ['zones', 'fill', 'name']);
  const opts = w.lib.computeKeyOptions(face, w.lib.keyFeatures(w.host));
  const q = opts.find((o) => o.col === 'pattern_1');
  check('the question is offered, first, by its name', [opts[0] && opts[0].col, q && q.label, q && q.isQuestion], ['pattern_1', 'Does it mention water?', true]);
  check('its reach is counted over all eleven places: seven answered', [q.answered, Math.round(q.reach * 100)], [7, 64]);
  check('the plain column is offered too, over both halves', opts.find((o) => o.col === 'Kind').answered, 11);
  check('the reason column is not a key, and the lookup\'s coordinates are not', opts.map((o) => o.col).filter((c) => /why|latitude|longitude/.test(c)), []);
  // without the twin's name the question would not be offered at all
  const bare = w.lib.computeKeyOptions(w.host, w.lib.keyFeatures(w.host));
  check('(read off the outlines alone, the question has no name and is not offered)', bare.some((o) => o.col === 'pattern_1'), false);
}

console.log('\n  counts, marks and the answers\' words reach both halves');
{
  const w = world({ host: { keyLabels: LABELS }, twin: { keyLabels: LABELS } });
  w.host._keyOptions = w.lib.computeKeyOptions(w.lib.keyFace(w.host), w.lib.keyFeatures(w.host));
  w.keyState.zones = { active: ['pattern_1', 'Kind'], note: null, noteCol: null };
  const act = w.lib.activeKeyOptions(w.host);
  check('two keys open on the host', act.map((o) => o.col), ['pattern_1', 'Kind']);
  const rows = w.lib.keyLegendRows(w.host, act);
  const water = rows.find((r) => r.label === WATER);
  check('the question\'s answers count both halves: 2 areas + 1 point wet, 2 + 2 dry', [water.n, rows.find((r) => r.label === DRY).n], [3, 4]);
  check('the plain column\'s kinds count both halves: 6 Nature, 5 Civic',
    [rows.find((r) => r.label === 'Nature').n, rows.find((r) => r.label === 'Civic').n], [6, 5]);
  check('the words under an answer lead to places in either half',
    water.why.map((x) => [x.w, x.es.map((e) => w.lib.halfOfEntry(w.host, e).id)]),
    [['pond', ['zones', 'zones', 'zones-as-points']]]);
  check('a point wears the marks: a row for each key it answers', w.lib.keyMarkRows(w.host, pointFeats[0], act).map((r) => r.shape), ['circle', 'square']);
  check('an area\'s mark wears them the same way', w.lib.keyMarkRows(w.host, w.markersByLayer.zones[0].f, act).map((r) => r.shape), ['circle', 'square']);
  check('a point the question is silent on wears only the column\'s mark', w.lib.keyMarkRows(w.host, pointFeats[4], act).map((r) => r.shape), ['square']);
  check('the twin has no key state of its own: the row\'s one switch finds one state', [w.keyState['zones-as-points'], w.lib.activeKeyOptions(w.twin)], [undefined, []]);
}

console.log('\n  tapping an answer narrows both halves, and the line counts both');
{
  const w = world({ host: { keyLabels: LABELS }, twin: { keyLabels: LABELS } });
  w.host._keyOptions = w.lib.computeKeyOptions(w.lib.keyFace(w.host), w.lib.keyFeatures(w.host));
  w.keyState.zones = { active: ['pattern_1'], note: null, noteCol: null };
  const q = w.host._keyOptions.find((o) => o.col === 'pattern_1');
  w.lib.filterByKind(w.host, q, 'kind', WATER);
  const hidden = (id) => w.markersByLayer[id].map((e) => !!e.hidden);
  check('areas without the answer are hidden, the two with it stay', hidden('zones'), [false, false, true, true, true, true]);
  check('points too: one stays, four go', hidden('zones-as-points'), [false, true, true, true, true]);
  check('a layer on its own is not touched', hidden('lone'), [false, false, false, false, false]);
  check('both halves are re-drawn through the same door', w.redrawn, ['zones', 'zones-as-points']);
  check('the line says "3 of 11 places are Mentions water"', w.counted[0], { shown: 3, total: 11, pts: 3, lead: { ofAll: WATER }, noun: 'places' });
  check('the pressed answer is remembered on the host', w.lib.kindFilter(), { layer: 'zones', col: 'pattern_1', which: 'kind', label: WATER });
  const k = w.host._keyOptions.find((o) => o.col === 'Kind');
  w.keyState.zones.active = ['Kind'];
  w.lib.filterByKind(w.host, k, 'kind', 'Civic');
  check('a plain column narrows both halves the same way', [hidden('zones'), hidden('zones-as-points')],
    [[true, false, true, false, true, false], [true, false, true, true, false]]);
}

console.log('\n  a layer with no twin is exactly as it was');
{
  const w = world({});
  check('it is its own host and only half', [w.lib.keyHost(w.lone).id, w.lib.keyHalves(w.lone).map((l) => l.id)], ['lone', ['lone']]);
  check('its face is itself', w.lib.keyFace(w.lone) === w.lone, true);
  check('its places are its own', [w.lib.keyFeatures(w.lone).length, w.lib.keyEntries(w.lone).length], [5, 5]);
  check('its noun is its own', w.lib.keyNoun(w.lone), 'places');
}

console.log('\n  the viewer wires it through, read from the source');
const init = js.slice(js.indexOf('\n  function initLayerKeys('), js.indexOf('\n  }\n', js.indexOf('\n  function initLayerKeys(')) + 4);
check('the keys are built on the host over every half that has landed', /var H = keyHost\(L\);[^]*?var halves = keyHalves\(H\)\.filter\(hasPins\);[^]*?computeKeyOptions\(keyFace\(H\), feats\)/.test(init), true);
check('the second half to land rebuilds them over both, and an open key stays open', /if \(H\._keyOptions && H\._keyHalves === halves\.length\) return;/.test(init) &&
  /had\.active\.filter\(function \(c\) \{ return opts\.some\(function \(o\) \{ return o\.col === c && !o\.tooFew && !o\.scattered; \}\); \}\)/.test(init), true);
check('the marks are drawn on both halves, from the start and on every change', /keyEntries\(H\)\.forEach\(function \(e\) \{ renderMarks\(H, e, act\); \}\);/.test(init) &&
  /function applyLayerKeys\(L\) \{[^]*?keyEntries\(L\)\.forEach\(function \(e\) \{ renderMarks\(L, e, act\); \}\);/.test(js), true);
check('the counts under a key are over both halves', /function keyLegendRows\(L, act\) \{[^]*?var entries = keyEntries\(L\);/.test(js), true);
check('a point\'s hover bubble and card answer under its host\'s keys', /function keyRowsEl\(L, props, all\) \{\s*L = keyHost\(L\);/.test(js), true);
check('a point\'s card leaves out the columns its host\'s keys already say', /\(keyHost\(L\)\._keyOptions \|\| \[\]\)\.forEach\(function \(o\) \{ if \(o\.col\) keyCols\[o\.col\] = 1; \}\);/.test(js), true);
check('"Show all" frees both halves', /var kinded = KINDFILTER \? layerById\(KINDFILTER\.layer\) : null;[^]*?if \(kinded\) keyHalves\(kinded\)\.forEach/.test(js), true);
check('a word under an answer opens the place\'s own card, whichever half it is in', /var own = halfOfEntry\(L, e\);\s*var open = function \(\) \{ if \(opened\) return; opened = true; spiderClick\(own, e\); \};/.test(js), true);
check('the places a question is silent on are looked for in both halves', /function silentPlacesEl\(L, col\) \{\s*var feats = keyFeatures\(L\);/.test(js), true);
check('folding, flipping and the fold note read the host\'s keys for a twin\'s pins',
  /if \(!keyState\[keyHost\(L\)\.id\]\) return;/.test(js) && /var st = keyState\[keyHost\(L\)\.id\];/.test(js) && /function foldedCount\(L\) \{[^]*?keyEntries\(L\)\.forEach/.test(js), true);
check('the reach line says "places" for a split file', /var nounK = keyNoun\(L\);/.test(js), true);
check('the row\'s own count already read both halves, and uses the same noun', /var parts = \[L\]\.concat\(pairedTwin\(L\) \? \[pairedTwin\(L\)\] : \[\]\);[^]*?renderLayerCount\(L, shown, items\.length\);/.test(js) && /function renderLayerCount\(L, shown, total\) \{[^]*?keyNoun\(L\)/.test(js), true);
check('at most five keys open at once, as before', /var KEY_STACK_CAP = 5;/.test(js), true);

console.log('\n  the server reads a split file as one file, and writes each half its share');
check('the halves are gathered, the layer first, its twin after', /function fileHalves\(m, layer\) \{[^]*?for \(const L of partner \? \[layer, partner\] : \[layer\]\)/.test(server), true);
check('a reading reads them together', /const halves = fileHalves\(m, layer\);\s*if \(!halves\) throw refuse\(404[^]*?const rows = rowsOf\(halves\);/.test(server), true);
check('settled questions are taken from whichever half carries them', /const settled = halves\.map\(\(h\) => questionsOn\(h\.layer, rows\)\)\.find\(\(s\) => s\.length\) \|\| \[\];/.test(server), true);
check('the guard against places moving re-reads both halves', /const again = fileHalves\(imports\.readManifest\(dataset\), layer\);\s*now = again \? fileSignatureOf\(again, RULES\.isAnswerColumn\) : null;/.test(server), true);
check('the owner\'s own question is asked of both halves and written to both',
  /router\.post\('\/layers\/ask'[^]*?const halves = fileHalves\(m, layer\);[^]*?await writeReadingToHalves\(\{ dataset, halves, questions: all \}\);/.test(server), true);
check('each half\'s write carries its own layer, so an area layer keeps its shapes', /dataset, layer: h\.layer, layerId: h\.layer\.id, rows: h\.rows, questions: mine,/.test(server), true);
check('a reading\'s write on either half is noted and its answers kept, before the twin rule', server.indexOf("if (opts && opts.fromReading) {") < server.indexOf("if (RULES.readByItsTwin(layer, layers)) {") &&
  server.indexOf("if (!ai && !FAKE_READING) return 'no model';") < server.indexOf("if (RULES.readByItsTwin(layer, layers)) {"), true);
check('a change to the outlines half offers the FILE through its pins, under the file\'s fingerprint',
  /if \(RULES\.readByItsTwin\(layer, layers\)\) \{\s*return QUESTIONS\.offer\(\{ dataset, layerId: layer\.sameFileAs, sig, payer \}\)/.test(server) &&
  /const sig = fileSigOf\(dataset, layerId\);/.test(server), true);
check('one file has one fingerprint, the same from either half: both halves\' rows in a fixed order',
  /export function fileSignatureOf\(halves, isAnswerColumn\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/questions-queue.js', 'utf8')) &&
  /const sigAtStart = fileSignatureOf\(halves, RULES\.isAnswerColumn\);/.test(server) &&
  /now = again \? fileSignatureOf\(again, RULES\.isAnswerColumn\) : null;/.test(server), true);
check('and it is the one the record, the kept answers and the retry compare against',
  (server.match(/fileSigOf\(dataset, layerId\)/g) || []).length >= 4 && /const fileSig = fileSigOf\(o\.dataset, o\.layerId\);/.test(server) &&
  !/signatureOf\(now\.rows/.test(server) && !/signatureOf\(got\.rows/.test(server), true);
check('the one-off script fingerprints the file the same way, and lists it when either half lacks questions',
  /sig: fileSignatureOf\(halves, RULES\.isAnswerColumn\)/.test(script) && /if \(halves\.every\(hasQuestions\)\) continue;/.test(script), true);
check('switching a question off on one half switches it off on the other', /if \(layer\.sameFileAs\) \{[\s\S]{0,400}if \(Array\.isArray\(b\.hiddenKeys\)\) twin\.hiddenKeys = b\.hiddenKeys;[\s\S]{0,300}imports\.relabelLayer\(dataset, layer\.sameFileAs, twin\);/.test(server), true);
check('the rule\'s own note no longer claims the halves hold the same rows', /Both twins hold the same\s*rows/.test(rules), false);
check('the one-off list counts every row the reading will cover', /const places = halves\.reduce\(\(n, h\) => n \+ h\.rows\.length, 0\);/.test(script), true);

// the slicing itself, lifted and run: eleven answers become six and five
{
  const at = server.indexOf('async function writeReadingToHalves(');
  const lifted = server.slice(at, server.indexOf('\n}\n', at) + 3);
  const writes = [];
  const run = new Function('writeReading', lifted + 'return writeReadingToHalves;')(async (x) => { writes.push(x); return x.layerId; });
  const halves = [{ layer: { id: 'zones', label: 'Zones', source: 'a' }, rows: areaRows }, { layer: { id: 'zones-as-points', source: 'b' }, rows: pointRows }];
  const cats = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const whys = cats.map((c) => [c]);
  const last = await run({ dataset: 'd', halves, questions: [{ question: 'Q?', counts: [{ name: 'x' }], categories: cats, why: whys }], reading: 'r', facts: [] });
  check('two writes, one per half, the file\'s order', writes.map((x) => [x.layerId, x.rows.length]), [['zones', 6], ['zones-as-points', 5]]);
  check('each half takes its own slice of the answers and the words', writes.map((x) => [x.questions[0].categories, x.questions[0].why.map((w) => w[0])]),
    [[cats.slice(0, 6), cats.slice(0, 6)], [cats.slice(6), cats.slice(6)]]);
  check('the wording, the kinds and the reading note go on both', writes.map((x) => [x.questions[0].question, x.questions[0].counts[0].name, x.reading]), [['Q?', 'x', 'r'], ['Q?', 'x', 'r']]);
  check('a layer with no twin is one write', [last, (await (async () => { writes.length = 0; await run({ dataset: 'd', halves: halves.slice(1), questions: [{ categories: cats.slice(6), why: whys.slice(6) }] }); return writes.length; })())], ['zones-as-points', 1]);
}

// one file, one fingerprint: the same from either half, different when either half changes
{
  const { fileSignatureOf, signatureOf } = await import('../api/lib/atlas/questions-queue.js');
  const A = { layer: { id: 'zones' }, rows: areaRows }, P = { layer: { id: 'zones-as-points' }, rows: pointRows };
  const fromOutlines = fileSignatureOf([A, P]), fromPins = fileSignatureOf([P, A]);
  check('the file\'s fingerprint is the same whichever half asks', fromOutlines === fromPins, true);
  check('and is not either half\'s own', [fromPins === signatureOf(pointRows), fromPins === signatureOf(areaRows)], [false, false]);
  const changedOutlines = fileSignatureOf([{ layer: A.layer, rows: areaRows.concat([{ name: 'Zone 7', notes: 'new', Kind: 'Nature' }]) }, P]);
  check('a change to the outlines alone changes it', changedOutlines === fromPins, false);
  check('the answers written on do not', fileSignatureOf([{ layer: A.layer, rows: areaRows.map((r) => Object.assign({}, r, { pattern_1: 'x' })) }, P]) === fromPins, true);
  check('a layer with no twin is one half, and its file fingerprint is its own', fileSignatureOf([P]) === signatureOf(pointRows), true);
}

console.log('\n  the owner\'s Questions tab shows one file once');
check('the "· as points" half steps aside when its outlines carry the questions', /if \(primary && keyed\(primary\)\) return false;/.test(owner), true);

console.log('\n  the design notes say it');
check('the keys under a split file\'s row cover both halves', /The keys under that row cover both halves/.test(design) && /fileHalves/.test(design), true);
check('and no longer call it a separate decision', /a key over both halves is a separate decision/.test(design), false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
