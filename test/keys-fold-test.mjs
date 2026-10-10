/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Keys unfold (Mithun, October 2026). Under "Mark each place by" every key
 * the layer offers — a question found in the data and a spreadsheet column
 * alike — is a row showing its name and a caret. Opening a row marks the map
 * by it and shows its reach, any "mostly one answer" note and its kinds;
 * closing it takes the marks off. The rows are ordered by reach (the share of
 * the layer's places with an answer), widest first, and the first row starts
 * open so the map is marked from the start. Up to five open at once; the
 * sixth is refused with a note under the row that was pressed. No network. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const LokaLabelRules = createRequire(import.meta.url)(path.join(ROOT, 'atlas', 'label-rules.js'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function section(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return js.slice(i, js.indexOf('\n  }\n', i) + 4);
}

// the key machinery as it stands in atlas.js (the same lift shared-answers-key-test uses)
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
  ['KEY_MAX', 'KEY_CAP', 'KEY_DOMINANCE', 'QUESTION_MIN_REACH', 'KEY_LOPSIDED_MIN_KINDS',
    'KEY_MIN_SHARED', 'DATEY', 'MONTHS'].map(constant).join('') +
  ['prettyCol', 'colLabel', 'dateKeyName', 'looksLikeDates', 'dateBucket', 'dateGrain',
    'unbrace', 'unquotePiece', 'cellText', 'skipSearchValue', 'sharedShare',
    'computeKeyOptions'].map(fn).join('');
const lib = new Function('LokaLabelRules', body + 'return { computeKeyOptions: computeKeyOptions };')(LokaLabelRules);
const pins = (rows) => rows.map((p) => ({ type: 'Feature', properties: p, geometry: null }));
const offered = (opts) => opts.filter((o) => !o.tooFew && !o.scattered).map((o) => o.col);

console.log('\n  the order: questions first, then columns, each widest reach first');
// 20 places. "Use" is a question answered by 18; "Kind" is the column the
// owner colours by, answered by 14; "Zone" is a plain column answered by 16.
const rows = [];
for (let i = 0; i < 20; i++) {
  rows.push({
    pattern_1: i < 18 ? ['Shelter', 'Rest', 'Food'][i % 3] : '',
    Kind: i < 14 ? ['Nature', 'Civic'][i % 2] : '',
    Zone: i < 16 ? ['North', 'South', 'East', 'West'][i % 4] : ''
  });
}
const L = { id: 't', type: 'marker', userLayer: true, markerBy: 'Kind',
  spec: { categoryColumn: 'Kind' }, markers: { Nature: { color: '#117733' }, Civic: { color: '#332288' } },
  keyLabels: { pattern_1: 'What is this place used for?' } };
let o = lib.computeKeyOptions(L, pins(rows));
check('reach is the share of places with an answer', o.map((x) => [x.col, Math.round(x.reach * 100)]),
  [['pattern_1', 90], ['Zone', 80], ['Kind', 70]]);
check('the question with the widest reach leads; the owner\'s own column sorts like any other', offered(o), ['pattern_1', 'Zone', 'Kind']);
check('the committed column still colours in its own colours', o.find((x) => x.col === 'Kind').committed, true);
check('…wherever it sits in the list', /if \(opt\.committed\) \{\s*\n\s*var m = L\.markers && L\.markers\[opt\.kept\[slot\]\];/.test(js), true);
// a tie keeps the older order: committed first
const tied = rows.map((r) => ({ pattern_1: r.pattern_1 || 'Food', Kind: r.Kind || 'Civic' }));
o = lib.computeKeyOptions(L, pins(tied));
check('a question leads even when a column reaches as far', offered(o), ['pattern_1', 'Kind']);
// a date every row has (100%) does not jump ahead of a question answered by 90%
const dated = rows.map((r, i) => Object.assign({}, r, { created_at: '2026-0' + (1 + (i % 6)) + '-15' }));
o = lib.computeKeyOptions(L, pins(dated));
check('a date every row has comes after the questions', offered(o)[0], 'pattern_1');
// with no questions, the widest column opens; a tie keeps the committed column first
const cols = rows.map((r) => ({ Kind: r.Kind || 'Civic', Zone: r.Zone || 'North' }));
o = lib.computeKeyOptions(L, pins(cols));
check('no questions: a tie on reach keeps the committed column first', offered(o), ['Kind', 'Zone']);
check('the sort is written as questions first, then reach, then the older order',
  /opts\.sort\(function \(a, b\) \{\s*\n\s*return \(b\.isQuestion \? 1 : 0\) - \(a\.isQuestion \? 1 : 0\)\s*\n\s*\|\| \(b\.reach - a\.reach\)\s*\n\s*\|\| \(b\.committed \? 1 : 0\) - \(a\.committed \? 1 : 0\)\s*\n\s*\|\| \(a\.flat \? 1 : 0\) - \(b\.flat \? 1 : 0\);/.test(js), true);

console.log('\n  the first row starts open, marking the map');
const init = section('initLayerKeys');
check('the first key offered (not one that is on cards only) is open from the start',
  /opts\.forEach\(function \(o\) \{ if \(!first && !o\.tooFew && !o\.scattered\) first = o; \}\);\s*\n\s*keyState\[L\.id\] = \{ active: first \? \[first\.col\] : \[\], note: null, noteCol: null \};/.test(init), true);
check('and the marks and legend are drawn for it, not for nothing',
  /var act = activeKeyOptions\(L\);\s*\n\s*\(markersByLayer\[L\.id\] \|\| \[\]\)\.forEach\(function \(e\) \{ renderMarks\(L, e, act\); \}\);\s*\n\s*L\._legend = keyLegendRows\(L, act\);/.test(init), true);
check('the discs read the rows\' footprint from the start', /if \(act\.length\) applyMarkerVisibility\(L\);/.test(init), true);
check('nothing is left that opens the map with every key off', /renderMarks\(L, e, \[\]\)/.test(init), false);

console.log('\n  a row that unfolds');
const build = section('buildKeyToggles');
check('every offered key is a row — questions and columns through the same loop',
  /L\._keyOptions\.forEach\(function \(opt\) \{\s*\n\s*if \(opt\.tooFew\) return;[^\n]*\n\s*if \(opt\.scattered\) return;/.test(build), true);
check('the row is a button that says whether it is open', /btn\.setAttribute\("aria-expanded", open \? "true" : "false"\)/.test(build), true);
check('folded, it shows only the name and a caret', /btn\.appendChild\(el\("span", "key-caret"\)\)/.test(build) && /var tname = el\("span", "key-tname", esc\(opt\.label\)\);/.test(build), true);
check('the reach line, the note and the kinds live in the open body only',
  /if \(open\) \{\s*\n\s*var body = el\("div", "key-body"\);/.test(build) &&
  /body\.appendChild\(reach\)/.test(build) && /body\.appendChild\(why\)/.test(build) &&
  /keyKindRows\(L, opt\)\.forEach\(function \(r\) \{ body\.appendChild\(r\); \}\)/.test(build), true);
check('the reach line is a plain sentence', /"Answers come from " \+ pct \+ "% of the " \+ nounK/.test(build), true);
check('the hint is one line', /"Open one to colour the map by its answers\."/.test(build), true);
check('and the old six-line hint is gone', /Keys colour the map — each wears its own shape/.test(js), false);
check('no tick box is built for a key (the layer\'s own switch is still a checkbox)', /cb\.type = "checkbox"|key-tick/.test(build), false);

console.log('\n  opening marks the map; closing takes the marks off');
check('a press on a closed row adds its key and redraws', /if \(i < 0\) \{[\s\S]*?st\.active\.push\(opt\.col\);[\s\S]*?\} else \{\s*\n\s*st\.active\.splice\(i, 1\);\s*\n\s*\}\s*\n\s*st\.note = null;\s*\n\s*st\.noteCol = null;\s*\n\s*st\._focus = opt\.col;[^\n]*\n\s*applyLayerKeys\(L\);/.test(build), true);
check('applyLayerKeys draws the marks of exactly the open keys', /function applyLayerKeys\(L\) \{\s*\n\s*var act = activeKeyOptions\(L\);\s*\n\s*\(markersByLayer\[L\.id\] \|\| \[\]\)\.forEach\(function \(e\) \{ renderMarks\(L, e, act\); \}\);/.test(js), true);
check('open keys keep the offered order, so each keeps its shape', /st\.active = L\._keyOptions\.filter\(function \(o\) \{ return st\.active\.indexOf\(o\.col\) >= 0; \}\)/.test(build), true);
check('opening a key turns its layer on with it', /if \(L\._visible === false\) \{\s*\n\s*setLayerVisible\(L, true\);/.test(build), true);
check('the keyboard lands back on the row that was pressed', /var btns = wrap\.querySelectorAll\("\.key-toggle"\);/.test(build), true);

console.log('\n  up to five at once');
check('the cap is five', /var KEY_STACK_CAP = 5;/.test(js), true);
check('the sixth is refused with a note under the row that was pressed',
  /if \(st\.active\.length >= KEY_STACK_CAP\) \{[\s\S]*?st\.note = KEY_STACK_NOTE;\s*\n\s*st\.noteCol = opt\.col;\s*\n\s*note\.textContent = st\.note;\s*\n\s*note\.hidden = false;\s*\n\s*return;/.test(build), true);
check('the note is in plain words', /var KEY_STACK_NOTE = "Up to five at once — close one to open this\.";/.test(js), true);
check('every row has its own status line, shown only for the refused one',
  /var refused = !!st\.note && st\.noteCol === opt\.col;\s*\n\s*note\.hidden = !refused;/.test(build), true);
check('closing any row clears the note', /st\.active\.splice\(i, 1\);\s*\n\s*\}\s*\n\s*st\.note = null;\s*\n\s*st\.noteCol = null;/.test(build), true);

console.log('\n  the styles');
check('rows are separated by a hairline, not by margins on the kinds', /\.key-entry \{ border-top:1px solid var\(--color-divider\); \}/.test(html) && !/\.key-list \.key-kind \+ \.key-toggle/.test(html), true);
check('the caret turns when the row is open', /\.key-entry\.open > \.key-toggle \.key-caret \{ transform:rotate\(-135deg\)/.test(html), true);
check('the refused note is in Sindoor', /\.key-note \{[^}]*color:var\(--color-sindoor-deep\)/.test(html), true);
check('on a touch screen a row is at least 44px tall', /@media \(pointer:coarse\)\{[\s\S]*?\.key-toggle \{ min-height:44px; \}/.test(html), true);
check('and the ⓘ still sits at the row\'s end', /\.key-toggle \.lbl-info \{ margin-left:auto; flex:0 0 auto; \}/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
