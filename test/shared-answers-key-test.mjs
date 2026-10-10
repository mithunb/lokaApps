/* Run me with: node test/run.mjs — or on my own with node.
 *
 * A spreadsheet column only becomes a key if at least half of the places that
 * answered share their answer with at least one other place (Mithun, October
 * 2026). The Multispecies atlas had 11 answers to "organisation", 9 of them
 * different names: few enough kinds to pass every other rule, and a key that
 * grouped nothing. The column the owner chose to colour by is never hidden,
 * discovered questions keep their own rules, and a hidden column still shows
 * its answer on every place's card. No network. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const LokaLabelRules = createRequire(import.meta.url)(path.join(ROOT, 'atlas', 'label-rules.js'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// lift the key machinery out of atlas.js as it stands: the functions by name,
// the constants by their own lines, so the test follows the source
function fn(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = js.indexOf('\n  }\n', i);
  const k = js.indexOf('\n', i + 1);
  // a one-line function ends on its own line
  return /\}\s*$/.test(js.slice(i, k)) && js.slice(i, k).split('{').length === js.slice(i, k).split('}').length
    ? js.slice(i, k) + '\n' : js.slice(i, j + 4) + '\n';
}
function constant(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^;]*;'));
  if (!m) throw new Error('no var ' + name);
  return m[0] + '\n';
}
const body =
  ['KEY_MAX', 'KEY_CAP', 'KEY_DOMINANCE', 'QUESTION_MIN_REACH', 'KEY_LOPSIDED_MIN_KINDS',
    'KEY_MIN_SHARED', 'DATEY', 'MONTHS'].map(constant).join('') +
  ['prettyCol', 'colLabel', 'dateKeyName', 'looksLikeDates', 'dateBucket', 'dateGrain',
    'unbrace', 'unquotePiece', 'cellText', 'skipSearchValue', 'sharedShare',
    'computeKeyOptions', 'optValuesOf'].map(fn).join('');
const lib = new Function('LokaLabelRules',
  body + 'return { computeKeyOptions: computeKeyOptions, optValuesOf: optValuesOf, KEY_MIN_SHARED: KEY_MIN_SHARED };')(LokaLabelRules);

const pins = (rows) => rows.map((p) => ({ type: 'Feature', properties: p, geometry: null }));
const layer = (extra) => Object.assign({ id: 't', type: 'marker', userLayer: true }, extra || {});
const offered = (opts) => opts.filter((o) => !o.tooFew && !o.scattered).map((o) => o.col);
const find = (opts, col) => opts.find((o) => o.col === col);

console.log('\n  the rule itself');
check('one constant, a half', lib.KEY_MIN_SHARED, 0.5);

// 11 places answered, 9 kinds: two pairs and seven names said once
const orgs = ['Forest Trust', 'River Watch', 'Bird Count', 'Seed Bank', 'Tree Walkers',
  'Moth Club', 'Frog Patrol', 'Lake Friends', 'Bee Keepers', 'Forest Trust', 'Bee Keepers'];
// 11 places answered, 9 kinds: one name three times and eight said once
const orgs9 = ['Forest Trust', 'River Watch', 'Bird Count', 'Seed Bank', 'Tree Walkers',
  'Moth Club', 'Frog Patrol', 'Lake Friends', 'Bee Keepers', 'Forest Trust', 'Forest Trust'];
let o = lib.computeKeyOptions(layer(), pins(orgs9.map((v) => ({ Organisation: v }))));
check('9 kinds from 11 answers (only 3 places share) is not offered as a key', offered(o), []);
check('but it stays on the list, marked scattered, so cards keep it', find(o, 'Organisation') && find(o, 'Organisation').scattered, true);
o = lib.computeKeyOptions(layer(), pins(orgs.map((v) => ({ Organisation: v }))));
check('9 kinds from 11 with two pairs (4 of 11 share) is not offered either', offered(o), []);

const three = ['Wetland', 'Wetland', 'Wetland', 'Forest', 'Forest', 'Forest', 'Forest', 'Grassland', 'Grassland', 'Grassland', 'Grassland'];
o = lib.computeKeyOptions(layer(), pins(three.map((v) => ({ Habitat: v }))));
check('a column with three groups is a key', offered(o), ['Habitat']);
check('and is not marked scattered', find(o, 'Habitat').scattered, false);

// 10 answers: 5 share (2 + 3), 5 one of a kind — exactly half
const half = ['A one', 'A one', 'B two', 'B two', 'B two', 'C three', 'D four', 'E five', 'F six', 'G seven'];
o = lib.computeKeyOptions(layer(), pins(half.map((v) => ({ Group: v }))));
check('exactly half sharing is a key', offered(o), ['Group']);
// one more name said once tips it under: 5 of 11
o = lib.computeKeyOptions(layer(), pins(half.concat(['H eight']).map((v) => ({ Group: v }))));
check('just under half is not', offered(o), []);

console.log('\n  only the places that answered count');
// 4 answered, all in 2 groups; 2 left blank — blanks do not count against it
o = lib.computeKeyOptions(layer(), pins(['Yes', 'Yes', 'No', 'No', 'Yes', '', 'No'].map((v) => ({ Visited: v }))));
check('a blank is not a one-of-a-kind answer', offered(o), ['Visited']);

console.log('\n  a list column shares if any of its answers is shared');
const lists = ['Culture; Nature', 'Heritage; Nature', 'Culture', 'Food; Heritage', 'Music', 'Craft', 'Culture; Craft', 'Nature'];
o = lib.computeKeyOptions(layer(), pins(lists.map((v) => ({ Themes: v }))));
// counted by first answer only, 3 of 8 would share; by every answer, 7 of 8 do
check('Themes (first answers mostly differ, but most places share an answer) is a key', offered(o), ['Themes']);

console.log('\n  the owner\'s choice is never second-guessed');
const L = layer({ markerBy: 'Organisation', spec: { categoryColumn: 'Organisation' },
  markers: Object.fromEntries([...new Set(orgs9)].map((k) => [k, { color: '#000' }])) });
o = lib.computeKeyOptions(L, pins(orgs9.map((v) => ({ Organisation: v }))));
check('the column the owner chose to colour by is still offered', offered(o), ['Organisation']);
check('and is the committed key', find(o, 'Organisation').committed, true);

console.log('\n  discovered questions keep their own rules');
const qL = layer({ keyLabels: { pattern_1: 'Who looks after it?' } });
o = lib.computeKeyOptions(qL, pins(orgs9.map((v) => ({ pattern_1: v }))));
check('a question with scattered answers is not marked scattered', find(o, 'pattern_1').scattered, false);

console.log('\n  a hidden key still shows on the place\'s card');
o = lib.computeKeyOptions(layer(), pins(orgs9.map((v) => ({ Organisation: v }))));
const opt = find(o, 'Organisation');
check('the card reads the place\'s own answer through it', lib.optValuesOf(layer(), opt, { properties: { Organisation: 'Moth Club' } }), ['Moth Club']);
const rows = js.slice(js.indexOf('\n  function keyRowsEl('), js.indexOf('\n  }\n', js.indexOf('\n  function keyRowsEl(')));
check('card rows walk every key the layer has, scattered or not', /var act = all \? \(L\._keyOptions \|\| \[\]\) : activeKeyOptions\(L\);/.test(rows) && !/scattered/.test(rows), true);
check('the panel leaves the tick out', /if \(opt\.scattered\) return;/.test(js), true);
check('and a layer with nothing left to offer shows no "Mark each place by" at all',
  /L\._keyOptions\.some\(function \(o\) \{ return !o\.tooFew && !o\.scattered; \}\)\) \{\s*box\.appendChild\(buildKeyToggles\(L\)\);/.test(js), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
