/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Search used to work only where a layer was drawn as pins. An atlas whose
 * people are drawn as the regions they work in (the multispecies atlas) had
 * no search box at all. These checks pin down the rule for which shape layers
 * a search may touch, the way a non-match fades rather than vanishes, the
 * line under the box, and that the server's row numbers are the ones the
 * viewer gives its features. Static reads of the source plus the two pure
 * functions lifted out of it. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
// lift one top-level-of-the-IIFE function out of atlas.js by name
function lift(src, name) {
  const i = src.indexOf('\n  function ' + name + '(');
  if (i < 0) return null;
  let j = src.indexOf('\n  }\n', i);
  return new Function(src.slice(i, j + 4) + '\nreturn ' + name + ';')();
}

const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const shapeSearchable = lift(js, 'shapeSearchable');
const walkCoords = lift(js, 'walkCoords');

console.log('\n  which shape layers a search may touch');
check('a contributed polygon layer is searchable', shapeSearchable({ type: 'fill', userLayer: true, group: 'userdata' }), true);
check('a contributed line layer too', shapeSearchable({ type: 'line', userLayer: true }), true);
check('a curated shape with a popup is not — the ground the data sits on', shapeSearchable({ type: 'fill', group: 'eco', popup: { title: 'name' } }), false);
check('the manifest can opt a curated shape in', shapeSearchable({ type: 'fill', group: 'eco', searchable: true }), true);
check('but never a base layer, whatever it says', shapeSearchable({ type: 'fill', group: 'base', searchable: true, userLayer: true }), false);
check('a pin layer answers to the older rule, not this one', shapeSearchable({ type: 'marker', userLayer: true }), false);
const deoria = JSON.parse(fs.readFileSync(ROOT + '/atlas/datasets/deoria-bioregion/manifest.json', 'utf8'));
check('Deoria: none of its forests, wards or boundaries become searchable', deoria.layers.filter(shapeSearchable).map((L) => L.id), []);
check('the rule is written down beside the code', /a shape layer is searchable when it was contributed[\s\S]*searchable: true/.test(js), true);
check('the search box is built for a shape layer that qualifies', /function manifestSearchable\(\) \{[\s\S]*?if \(shapeSearchable\(L\)\) return true;/.test(js), true);

console.log('\n  rows are numbered as they load, so the server and the viewer agree');
check('every feature learns its row as its data arrives', /DATA\[L\.id\] = d; numberRows\(L, d\);/.test(js), true);
check('a searchable shape carries the number where the map paint can read it', /if \(shape && f\.properties\) f\.properties\._srow = i;/.test(js), true);
check('the server numbers rows in feature order, the same way', /\.map\(\(f, i\) => \{[\s\S]*?return \{ i, title, text \};/.test(api), true);
check('and reports hits by layer and row', /features: found\.slice\(0, 50\)\.map\(\(f\) => \(f\.score == null/.test(api), true);
check('the viewer reads those rows back', /\(rows\[h\.layer\] = rows\[h\.layer\] \|\| \{\}\)\[f\.i\] = 1/.test(js), true);
check('a row found by meaning matches even when no word does', /var match = !!\(q && text\.indexOf\(q\) >= 0\) \|\| !!byRow\[e\.f\._row\];/.test(js), true);
check('with nothing from the server, the words alone decide (no crash, no change)', /if \(!searchTags\.length && !anyRow\) return;/.test(js), true);

console.log('\n  a non-match fades, it does not vanish');
check('the fade wraps each sub-layer\'s own opacity in "did this row match"', /\["case", hit, orig, \["\*", orig, SEARCH_FADE\[p\]\]\]/.test(js), true);
check('fill, outline, centre dot and name all fade', /\/-\(fill\|line\|mark\|label\)\$\//.test(js), true);
check('the fill goes faint, the outline stays readable', (() => { const m = js.match(/SEARCH_FADE = (\{[^}]+\})/); const f = m && new Function('return ' + m[1])(); return f && f['fill-opacity'] < 0.2 && f['line-opacity'] >= 0.3; })(), true);
const fadeRe = (() => { const m = js.match(/L\._ids\.filter\(function \(id\) \{ return (\/[^/]+\/)\.test\(id\); \}\)/); return m && new Function('return ' + m[1])(); })();
check('the hover and selection rings are left alone (a faded area still answers a tap)', fadeRe && ['x-hl', 'x-hl-ring', 'x-img'].map((id) => fadeRe.test(id)), [false, false, false]);
check('while the drawn parts are faded', fadeRe && ['x-fill', 'x-line', 'x-mark', 'x-label'].map((id) => fadeRe.test(id)), [true, true, true, true]);
check('the original paint is kept so clearing puts it back', /L\._searchPaint\[id \+ "\|" \+ p\] = v == null \? 1 : v;/.test(js) && /var v = any \? \["case"[^\n]*: orig;/.test(js), true);
check('clearing restores every row on every layer', /function clearSearch\(\) \{[\s\S]*?searchRows\(L\)\.forEach\(function \(e\) \{ e\.hidden = false; \}\); applyRowVisibility\(L\);/.test(js), true);
check('pins still re-draw the old way, shapes re-paint', /if \(markersByLayer\[L\.id\]\) applyMarkerVisibility\(L\); else applyShapeFade\(L\);/.test(js), true);

console.log('\n  the map goes to what matched');
const seen = [];
walkCoords({ type: 'MultiPolygon', coordinates: [[[[77, 12], [78, 12], [78, 13], [77, 12]]], [[[80, 15], [81, 15], [81, 16], [80, 15]]]] }, (c) => seen.push(c));
check('every point of a multipolygon outline is walked', seen.length, 8);
const seen2 = [];
walkCoords({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[3, 4], [5, 6]] }] }, (c) => seen2.push(c));
check('a collection walks each of its parts', seen2, [[1, 2], [3, 4], [5, 6]]);
check('the fit makes room for the drawer and the phone sheet', /map\.fitBounds\(b, \{ padding: viewPadding\(\), maxZoom: 13, duration: 600 \}\)/.test(js), true);
check('and only when the set of matches has changed', /if \(key === lastFitKey\) return;/.test(js), true);

console.log('\n  the line under the box');
check('it says how many matched what, and names the way back', /\+ " match ‘" \+ word \+ "’"/.test(js) && /if \(lead \|\| word\) \{/.test(js), true);
check('nothing matched says so plainly, with the same way back', /"nothing matched ‘" \+ word \+ "’ — try another word"/.test(js), true);
check('the word is shown as typed, matching lowercases its own copy', /searchWord = \(raw \|\| ""\)\.trim\(\);\n\s*var q = searchWord\.toLowerCase\(\);/.test(js), true);
check('"show all" empties the box as well as the map', /all\.onclick = function \(\) \{ var box = \$\("\.ctl-search-input"\); if \(box\) box\.value = ""; clearSearch\(\); \};/.test(js), true);
check('a pin-only atlas keeps its old line and its "Show me" offer', /if \(!shapes\) \{ updateSearchCount\(shown, total, matchPts\); return; \}/.test(js), true);
check('what the rows are called: places for pins, areas for shapes, or what the manifest says', /var n = L\.noun \|\| \(markersByLayer\[L\.id\] \? "places" : "areas"\);/.test(js), true);
check('the old pin wording is untouched', /c\.textContent = shown \? \(shown \+ " of " \+ total \+ " shown"\) : "nothing matched — try another word";/.test(js), true);

console.log('\n  a search by meaning keeps only answers close to the best one');
check('a paraphrase must sit within a band of the top score', /const bar = Math\.max\(ROW_MIN_COSINE, top - ROW_BAND\);/.test(api), true);
check('when the words typed are in some rows, those rows are the answer', /const found = anyLex \? scored\.filter\(\(f\) => f\.lex\)/.test(api), true);
check('meaning is used only when no row has the words, and only on a clear signal', /: \(top >= ROW_STRONG \? scored\.filter\(\(f\) => f\.score != null && f\.score >= bar\) : \[\]\);/.test(api), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
