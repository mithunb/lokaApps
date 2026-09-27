/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Map Browser. A contributed layer's row used to be a switch and a swatch
 * repeating the layer's name; now it says what the layer holds ("11 people"),
 * opens into the names, and each name is a way in. Twins — two rows drawn as
 * the same shape — get a chooser in the card and share one written name on
 * the map. A first visitor gets one line and one pulse, once per device.
 * These checks lift the pure functions out of atlas.js and read the rest of
 * the source statically. No network, no browser.
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
// lift top-level-of-the-IIFE functions out of atlas.js by name; the last
// named one is returned, and may call the ones lifted before it
function lift(src, names) {
  let body = '';
  for (const name of names) {
    const i = src.indexOf('\n  function ' + name + '(');
    if (i < 0) throw new Error('no function ' + name);
    const j = src.indexOf('\n  }\n', i);
    body += src.slice(i, j + 4) + '\n';
  }
  return new Function(body + 'return ' + names[names.length - 1] + ';')();
}

const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
const collectionLayer = lift(js, ['shapeSearchable', 'collectionLayer']);
const layerNoun = lift(js, ['layerNoun']);
const countWords = lift(js, ['nounOne', 'countWords']);
const geomKey = lift(js, ['walkCoords', 'geomKey']);
const findTwins = lift(js, ['walkCoords', 'geomKey', 'findTwins']);
const joinNames = lift(js, ['joinNames']);
const cueText = lift(js, ['layerNoun', 'cueText']);

console.log('\n  Map Browser: which layers get the counted, listable row');
check('a contributed shape layer', collectionLayer({ type: 'fill', userLayer: true, group: 'userdata' }), true);
check('a contributed pin layer', collectionLayer({ type: 'marker', userLayer: true }), true);
check('a curated shape the manifest opted into search', collectionLayer({ type: 'fill', group: 'eco', searchable: true }), true);
check('never a base layer, whatever it says', collectionLayer({ type: 'fill', group: 'base', userLayer: true }), false);
check('a curated pin layer with a popup is not (it is the ground, not the data)', collectionLayer({ type: 'marker', group: 'base', popup: { title: 'name' } }), false);
check('nothing at all is not', collectionLayer(null), false);
const deoria = JSON.parse(fs.readFileSync(ROOT + '/atlas/datasets/deoria-bioregion/manifest.json', 'utf8'));
check('Deoria: no forest, ward, village or mill row changes', deoria.layers.filter(collectionLayer).map((L) => L.id), []);
check('the row is drawn for a collection layer once its data is in', /if \(collectionLayer\(L\) && DATA\[L\.id\]\) box\.appendChild\(collectionEl\(L\)\);/.test(js), true);

console.log('\n  Map Browser: what the rows are called');
check('what the manifest says wins', layerNoun({ type: 'fill', noun: 'people' }), 'people');
check('pins are places', layerNoun({ type: 'marker' }), 'places');
check('shapes are areas', layerNoun({ type: 'fill' }), 'areas');
check('eleven people', countWords(11, 'people'), '11 people');
check('one person, not one people', countWords(1, 'people'), '1 person');
check('one place, one area', [countWords(1, 'places'), countWords(1, 'areas')], ['1 place', '1 area']);
check('the search line reads the same noun', /var n = L\.noun \|\| \(markersByLayer\[L\.id\] \? "places" : "areas"\);/.test(js), true);

console.log('\n  Map Browser: the list');
check('long lists show the first thirty and offer the rest', /var COLL_CAP = 30;/.test(js) && /"Show all " \+ shown\.length/.test(js), true);
check('a search narrows the list with the map', /function applyRowVisibility\(L\) \{[\s\S]*?syncCollection\(L\);/.test(js), true);
check('and the line says how many matched', /shown\.length \+ " of " \+ items\.length \+ " " \+ noun \+ " match"/.test(js), true);
check('a name is a button that goes there and opens the card', /b\.onclick = function \(\) \{ goToItem\(L, it\); \};/.test(js) && /function goToItem\(L, it\) \{/.test(js), true);
check('the chosen name and the ring on the map read from one selection', /function selectRow\(L, row, ref\) \{[\s\S]*?syncCollection\(L\);/.test(js) && /selectRow\(top\.L, row != null \? row : null/.test(js), true);
check('the chosen name wears Sindoor', /\.coll-item\.sel \{ color:var\(--color-sindoor\);/.test(html), true);
// (widened in the viewer-ux batch: any one-colour layer drops its repeating row, not only a collection)
check('the legend row that only repeated the layer\'s name is gone from such a layer', /if \(collectionLayer\(L\) \|\| \(data\.length === 1 && repeats\(data\[0\]\)\)\) \{[\s\S]*?return !repeats\(it\)/.test(js), true);
check('a name without a title still has one ("person 4")', /if \(!it\.name\) it\.name = nounOne\(layerNoun\(L\)\) \+ " " \+ \(it\.row \+ 1\);/.test(js), true);
check('on a phone the sheet folds so the card can be seen', /function goToItem\(L, it\) \{[\s\S]*?if \(TRAY\) openTray\(null\);/.test(js), true);
check('the phone\'s tab counts the people, not the one layer', /function tabCount\(sec\) \{[\s\S]*?rows\[0\]\.hasAttribute\("data-count"\)/.test(js) && /L\._row\.setAttribute\("data-count", String\(shown\.length\)\)/.test(js), true);
check('thumb-sized rows on a phone', /\.coll-head, \.coll-item \{ min-height:44px;/.test(html), true);
check('the design notes name it', /### Map Browser/.test(design), true);

console.log('\n  Map Browser: twins — two rows drawn as one shape');
const ghats = { type: 'MultiPolygon', coordinates: [[[[73, 10], [77, 10], [77, 20], [73, 20], [73, 10]]], [[[80, 15], [81, 15], [81, 16], [80, 15]]]] };
const ghats2 = JSON.parse(JSON.stringify(ghats));
const coorg = { type: 'Polygon', coordinates: [[[75, 12], [76, 12], [76, 13], [75, 12]]] };
check('the same shape twice has one signature', geomKey(ghats) === geomKey(ghats2), true);
check('a different shape has another', geomKey(ghats) === geomKey(coorg), false);
check('a missing shape does not throw', geomKey(null), '');
const gj = { features: [
  { _row: 0, geometry: ghats, properties: { Name: 'Gijs Spoor' } },
  { _row: 1, geometry: coorg, properties: { Name: 'Ojasvi' } },
  { _row: 2, geometry: ghats2, properties: { Name: 'Vijay Ramesh' } },
] };
findTwins({}, gj);
check('twins know each other by row', gj.features.map((f) => f._twins), [[0, 2], null, [0, 2]]);
check('two names: "A & B"', joinNames(['Gijs Spoor', 'Vijay Ramesh']), 'Gijs Spoor & Vijay Ramesh');
check('three names: "A, B & C"', joinNames(['A', 'B', 'C']), 'A, B & C');
check('one name is itself', joinNames(['Paddy']), 'Paddy');
check('twins are found as the data lands', /if \(shape\) findTwins\(L, gj\);/.test(js), true);
check('on the map each twin\'s label carries both names, so the survivor says the whole truth', /props\[t\.property\] = joinNames\(f\._twins\.map/.test(js), true);
check('a tap that lands on several rows opens the card with a chooser', /openPopup\(top\.L, top\.f, e\.lngLat, null, null, rowsUnder\(e\.point, top\)\);/.test(js), true);
check('the chooser says how many are here and names each', /countWords\(rows\.length, layerNoun\(L\)\)\) \+ " here<\/span>"/.test(js) && /class="pop-twin" data-row=/.test(js), true);
check('pressing a name swaps the card and moves the ring', /function wireChooser\(pop, L, rows\) \{[\s\S]*?selectRow\(L, r,[\s\S]*?pop\.setHTML\(chooserHTML\(L, rows, r\) \+ popupHTML\(L, f\.properties\)\);/.test(js), true);
check('a name in the list opens its twins\' chooser too', /openPopup\(L, f, at \|\| map\.getCenter\(\), null, null, twinRowsOf\(L, f\)\);/.test(js), true);
check('the chip the card is showing is lit Sindoor', /\.pop-twin\[aria-pressed="true"\] \{ background:var\(--color-sindoor-tint\); border-color:var\(--color-sindoor\);/.test(html), true);
check('only a contributed shape layer gets a chooser; pins fan out as before', /if \(!collectionLayer\(L\) \|\| L\.type === "marker"\) return null;/.test(js), true);
check('while a search is on, the matching twin\'s name is the one written', /"symbol-sort-key", any \? \["\+", \["case", hit, 0, 1e9\], base\] : L\._searchSort/.test(js), true);

console.log('\n  the first-visit cue');
check('people drawn as areas: "Tap an area to read who works there"', cueText({ type: 'fill', noun: 'people' }), 'Tap an area to read who works there');
check('other areas: "Tap an area to read about it"', cueText({ type: 'fill' }), 'Tap an area to read about it');
check('pins: "Tap a pin to read about the place"', cueText({ type: 'marker', userLayer: true }), 'Tap a pin to read about the place');
check('a manifest can say it its own way', cueText({ type: 'fill', noun: 'people', hint: 'Tap a region to meet its people' }), 'Tap a region to meet its people');
check('not in an embed, not twice on one device', /if \(EMBED \|\| CUE\.seen \|\| cueSeen\(\) \|\| CUE\.el\) return;/.test(js), true);
check('the device remembers behind a try/catch', /try \{ return localStorage\.getItem\("atlas-cue-seen"\) === "1"; \} catch \(e\) \{ return false; \}/.test(js) && /try \{ localStorage\.setItem\("atlas-cue-seen", "1"\); \} catch \(e\) \{\}/.test(js), true);
check('no pulse for anyone who asked for less motion', /stage\.appendChild\(CUE\.el\);\n\s*if \(reducedMotion\(\)\) return;/.test(js) && /prefers-reduced-motion:reduce\) \{ \.atlas-pulse \{ animation:none;/.test(html), true);
check('gone at the first tap on the map, on a name, or when any card opens', /map\.on\("click", function \(e\) \{[\s\S]*?dismissCue\(\);/.test(js) && /function goToItem\(L, it\) \{\n\s*dismissCue\(\);/.test(js) && /function openPopup\([\s\S]*?dismissCue\(\);/.test(js), true);
check('the ring that grows lives under the element the map positions', /var ring = el\("div", "atlas-pulse-wrap"\);[\s\S]*?ring\.appendChild\(el\("div", "atlas-pulse"\)\);/.test(js), true);
check('the line sits above the phone\'s sheet', /\.atlas-cue \{ position:absolute; left:50%; bottom:calc\(var\(--sheet-h, 0px\) \+ 52px\);/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
