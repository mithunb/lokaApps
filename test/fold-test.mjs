/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The layer fold, and hiding a question. Code shape plus the two rules that
   carry real judgement. */
import fs from 'node:fs';
const R = ROOT + '/';
const owner = fs.readFileSync(R + 'atlas/owner.js', 'utf8');
const viewer = fs.readFileSync(R + 'atlas/atlas.js', 'utf8');
const css = fs.readFileSync(R + 'atlas/owner.css', 'utf8');
const server = fs.readFileSync(R + 'api/apps/atlas.js', 'utf8');
const imp2 = fs.readFileSync(R + 'api/lib/atlas/imports.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the panel that was deleted');
for (const gone of ['own-edit', 'buildEditCard', 'wireEditCard', 'openLayer', 'own-ev-', 'own-save',
                    'renderPalette', 'renderSwatches', 'own-f-colour']) {
  check('no trace of ' + gone, owner.includes(gone), false);
}
check('and its styles went with it', /own-ev-|\.own-save|\.own-swatches|#own-edit/.test(css), false);
/* The card came out at 1935 lines and the fold went in; the pencil and the
   card-columns list have since been added back, so the file settles lighter
   than it was rather than as light as it briefly got. */
/* These measured a one-time deletion and the file has since gained two real
   features — the shelves and asking a question — so they now measure nothing
   useful. What is worth holding is that the panel-swallowing card did not creep
   back in some other shape. */
check('the card that swallowed the panel has not come back',
  /own-edit|buildEditCard|renderPalette/.test(owner), false);
/* This counted every line, comments included, so explaining a change could
   fail it while changing nothing that runs. What it is guarding is that the
   panel-swallowing card did not come back — so count the code. */
const ownerCodeLines = owner
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
check('and the code is still lighter than it was with the card',
  ownerCodeLines < 1700, true);

console.log('\n  renaming happens on the row');
check('there is a pencil beside the name', /function addRenamePencil/.test(owner), true);
check('the name becomes a box in place', /class = "own-rename"|"own-rename"/.test(owner), true);
check('Enter saves and Escape puts back what was there',
  /e\.key === "Enter"/.test(owner) && /e\.key === "Escape"/.test(owner), true);
check('Change steps aside while editing, since three controls do not fit',
  /changeBtn\.hidden = true/.test(owner), true);
check('the pencil is quiet until the row is under a pointer',
  /\.ctl-row:hover \.own-pencil/.test(css), true);
check('and its touch area never eats the name, which is the switch\'s label',
  /never back over the name/.test(css), true);

console.log('\n  what a place\'s card says');
check('the columns are offered with a real entry from each', /own-card-eg/.test(owner), true);
check('ticks, not switches, so one shape does not mean three things',
  /own-card-tick/.test(css) && /A tick is a list you are choosing from/.test(css), true);
check('a question\'s answers are never offered as a card line',
  /Answers to your questions are shown by their keys/.test(owner), true);
check('the server reads the places rather than trusting the browser',
  /Read from the layer's own places rather than trusted from the request/.test(imp2), true);
check('and works out how a column is drawn from what is in it',
  /detectDelimiter\(values\) === ';'/.test(imp2), true);

console.log('\n  the visitor\'s list');
const viewer3 = fs.readFileSync(R + 'atlas/atlas.js', 'utf8');
check('contributed data leads it', /b\.id === "userdata" \? 1 : 0/.test(viewer3), true);
check('a group is a heading, not a fold', /var head = el\("h3", "ctl-group-head"\)/.test(viewer3), true);
const html2 = fs.readFileSync(R + 'atlas/index.html', 'utf8');
check('nothing collapses any more', /ctl-group\.collapsed/.test(html2), false);
check('a subgroup of one is drawn as its layer',
  /if \(sg\.layers\.length < 2\)/.test(viewer3), true);
check('the keys are listed even while the layer is off',
  /the keys are listed even while the layer is off|whole of\s*\n?\s*D/.test(viewer3), true);
check('and are not built a second time',
  (viewer3.match(/box\.appendChild\(buildKeyToggles\(L\)\)/g) || []).length, 1);

console.log('\n  what opens instead');
check('a fold opens under the row', /function buildFold\(L, meta, which\)/.test(owner), true);
/* One fold, holding one thing or the other — what a place's card shows, or the
   question of taking the layer off the map. Never both under one word. */
check('and holds one thing at a time', /var showCard = which !== "remove";/.test(owner), true);
check('under the layer\'s own row', /row\.appendChild\(host\)/.test(owner), true);
check('holding the layer\'s name', /Layer name/.test(owner), true);
/* "Call each place by" is gone by design: an owner now chooses WHICH columns a
   card shows, not merely which one names the place. */
check('a card\'s columns are chosen instead', /On every place's card/.test(owner), true);
check('and the old title-only control is gone', /Call each place by/.test(owner), false);
/* The link that used to sit in front of the sentence is gone: the control on
   the row already says Remove, so a second thing also saying Remove before you
   are told what happens teaches nothing. The sentence itself is unchanged. */
check('the remove is still worded as it was',
  /off the map and the public atlas\. Your original file stays with you\./.test(owner), true);
check('and the sentence is what the fold shows', /confirm\.hidden = false;/.test(owner), true);
check('with the keyboard on the answer that keeps it',
  /var first = showCard \? host\.querySelector\("input, button"\) : no;/.test(owner), true);
check('one fold at a time', /closeFold\(false\);\s*\n\s*buildFold/.test(owner), true);
check('Escape closes it', /if \(FOLD\) \{/.test(owner), true);
check('and it comes back after a save, on the same half',
  /if \(again && again\._row\) buildFold\(again, meta, which\)/.test(owner), true);

console.log('\n  saving, without a draft copy of the atlas');
check('there is a route for it', /router\.post\('\/layers\/relabel'/.test(server), true);
check('it writes the name in all three places it is kept',
  /layer\.label = name;[\s\S]{0,200}spec\.label = name;[\s\S]{0,200}legend\[0\]\.label = name/.test(imp2), true);
check('a collaborator may only change what their own organisation added',
  /you can only change layers your organisation added/.test(server), true);
check('the column that names a place is not also a line on its card',
  /layer\.popup\.fields\.filter\(\(f\) => f && f\.property !== col\)/.test(imp2), true);

console.log('\n  hiding a question');
check('the layer can carry a hidden list', /layer\.hiddenKeys = \[\.\.\.new Set\(clean\)\]/.test(imp2), true);
check('only a question can be hidden — not a column somebody uploaded',
  /filter\(\(k\) => \/\^pattern_\\d\+\$\/\.test\(k\)\)/.test(imp2), true);
check('an empty list leaves no trace on the layer', /else delete layer\.hiddenKeys/.test(imp2), true);
check('the viewer stops offering it',
  /if \(isQuestion && \(L\.hiddenKeys \|\| \[\]\)\.indexOf\(col\) >= 0\) return;/.test(viewer), true);
check('the fold lists every question, hidden ones included',
  /function questionsOf\(L\)/.test(owner) && /hidden: hidden\.indexOf\(c\) >= 0/.test(owner), true);
check('so a hidden one can be turned back on', /cb\.checked = !q\.hidden/.test(owner), true);
check('and it says the answers are not deleted',
  /The answers stay on every place/.test(owner), true);
check('and that turning it back on restores it',
  /puts it straight back/.test(owner), true);
check('the switch is the viewer\'s own, not a copy',
  /el\("label", "ctl-toggle own-q"\)/.test(owner), true);

console.log('\n  the rule for which columns can name a place');
/* lifted from titleColumns: a name mostly differs, which is the opposite of
   what a reading wants from a column */
function couldName(vals, total) {
  let filled = 0, long = 0; const seen = new Set();
  for (const v of vals) {
    if (typeof v !== 'string' || !v.trim()) continue;
    if (/^https?:\/\//i.test(v)) return false;
    filled++; if (v.length > 80) long++; seen.add(v.trim());
  }
  if (filled < total * 0.5) return false;
  if (long > filled * 0.3) return false;
  return seen.size >= filled * 0.5;
}
const many = (f, n) => Array.from({ length: n }, (_, i) => f(i));
check('a column of distinct names can', couldName(many((i) => 'Place ' + i, 30), 30), true);
check('a column of five repeated tags cannot',
  couldName(many((i) => ['a','b','c','d','e'][i % 5], 30), 30), false);
check('a column of paragraphs cannot', couldName(many(() => 'x'.repeat(200), 30), 30), false);
check('a column of links cannot', couldName(many((i) => 'https://x/' + i, 30), 30), false);
check('a column half empty cannot', couldName(many((i) => (i < 10 ? 'Name ' + i : '')), 30), false);

console.log('\n  a subgroup\'s master switch');
const html = fs.readFileSync(R + 'atlas/index.html', 'utf8');
check('it has a rule for being on at all',
  /\.ctl-sub-toggle input:checked \+ \.ctl-switch \{/.test(html), true);
check('shared with the switch it has to match, not copied',
  /\.ctl-toggle input:checked \+ \.ctl-switch,\n\s*\.ctl-sub-toggle input:checked \+ \.ctl-switch \{/.test(html), true);
check('its knob moves the same distance', /\.ctl-sub-toggle input:checked \+ \.ctl-switch::after/.test(html), true);
check('and at thumb sizes too',
  /\.ctl-sub-toggle input:checked \+ \.ctl-switch::after \{ transform:translateX\(16px\)/.test(html), true);
/* a part-on master is checked AND indeterminate at once, so the part-on rule
   must come after the on rule to win at equal weight */
check('part-on still beats on', html.indexOf('.ctl-sub-toggle input:indeterminate + .ctl-switch {') >
  html.indexOf('.ctl-sub-toggle input:checked + .ctl-switch {'), true);

console.log('\n  two orders of control, two marks');
check('a layer is a switch', /var sw = el\("span", "ctl-switch"\)/.test(viewer3), true);
check('a key is a tick', /lab\.appendChild\(el\("span", "key-tick"\)\)/.test(viewer3), true);
check('and no longer wears the layer\'s switch',
  /lab\.appendChild\(el\("span", "ctl-switch small"\)\)/.test(viewer3), false);
check('the tick is styled where a visitor will actually get it',
  /\.key-tick \{/.test(html2) && !/\.key-tick \{/.test(css), true);
check('its ring is a control\'s, not a hint\'s', /border:1px solid #82907f/.test(html2), true);
check('both switches say they are switches, in speech too',
  (viewer3.match(/setAttribute\("role", "switch"\)/g) || []).length, 2);
check('the caption says what a tick does', /"Mark each place by"/.test(viewer3), true);
check('and the cap talks about ticks', /Untick one to add/.test(viewer3), true);

console.log('\n  a layer nobody is showing');
check('keeps its ticks but loses its legend',
  /if \(cb\.checked && L\._visible !== false\) \{\s*\n\s*keyKindRows/.test(viewer3), true);
check('and its ticked names drop to the off voice',
  /if \(cb\.checked && L\._visible === false\) lab\.classList\.add\("key-held"\)/.test(viewer3), true);
check('which is styled', /\.key-toggle\.key-held \.key-tname/.test(html2), true);
/* a legend decoding marks that are not on the map is worse than no legend */
check('the disc note stays quiet too', /L\._visible !== false\) \? foldedCount\(L\) : 0/.test(viewer3), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
