/* Run me with: node test/run.mjs — or on my own with node.
 *
 * One mark for every place (October 2026). Every row of a contributed file
 * wears the same teardrop marker: a pin at its coordinates, an area at the
 * point of its shape furthest from any edge, with its shading and outline
 * still drawn beneath. Area markers go through the pin pipeline
 * (markersByLayer), so names, the card, keys, folding, search and the
 * Sindoor ring are one set of code. The Map Browser counts every layer as
 * plain text, and a file that split into outlines and "· as points" is one
 * row. These checks lift the pure functions out of atlas.js and read the
 * rest of the source statically. No network, no browser.
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
function lift(src, names, prelude) {
  let body = prelude || '';
  for (const name of names) {
    const i = src.indexOf('\n  function ' + name + '(');
    if (i < 0) throw new Error('no function ' + name);
    const j = src.indexOf('\n  }\n', i);
    body += src.slice(i, j + 4) + '\n';
  }
  return new Function(body + '\nreturn ' + names[names.length - 1] + ';')();
}

const js = fs.readFileSync(path.join(ROOT, 'atlas/atlas.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'atlas/index.html'), 'utf8');
const design = fs.readFileSync(path.join(ROOT, 'DESIGN.md'), 'utf8');

console.log('\n  the mark is the teardrop, for pins and areas alike');
check('one builder makes every marker, pin or area', /function makePinEntry\(L, f, shape\)/.test(js) && /makePinEntry\(L, f, null\);/.test(js) && /makePinEntry\(L, shadow, f\);/.test(js), true);
check('it is the standard location marker, not a dot', /var pin = locPinEl\(\(perKind && cfg\.color\) \? cfg\.color : PIN_ONE, cfg\.icon, perKind \? cfg\.shape : null\);/.test(js), true);
check('an area layer that is contributed and asks for marks gets them', /function areaPins\(L\) \{\s*return !!\(L && L\.userLayer && L\.centreMarks && \(L\.type === "fill" \|\| L\.type === "polygon"\)\);/.test(js), true);
check('the base map never does', (() => { const areaPins = lift(js, ['areaPins']); return [areaPins({ type: 'fill', centreMarks: true }), areaPins({ type: 'fill', userLayer: true }), areaPins({ type: 'fill', userLayer: true, centreMarks: true }), areaPins({ type: 'marker', userLayer: true, centreMarks: true })]; })(), [false, false, true, false]);
check('the area\'s marker is registered with the pins, so pin code serves it', /function addAreaMarkers\(L\) \{\s*markersByLayer\[L\.id\] = \[\];/.test(js), true);
check('its feature is a point at the pole sharing the shape\'s properties and row', /var shadow = \{ type: "Feature", geometry: \{ type: "Point", coordinates: at \}, properties: f\.properties, _row: f\._row, _twins: f\._twins \};/.test(js), true);
check('the shape itself stays on the entry', /var entry = \{ mk: mk, f: f, shape: shape \|\| null, color: cfg\.color \|\| "", node: node \};/.test(js), true);
check('such a layer draws no round centre dot and no separate area label', /if \(areaPins\(L\)\) \{ addAreaMarkers\(L\); return; \}\s*addCentreMarks\(L\);\s*addLabel\(L\);/.test(js), true);
check('its names are the pins\' names', /function addAreaMarkers\(L\) \{[\s\S]*?ensurePinNames\(L\);\s*applyMarkerVisibility\(L\);\s*initLayerKeys\(L\);/.test(js), true);

console.log('\n  the marker stands at the pole of inaccessibility');
const pole = lift(js, ['labelAnchorPoint', 'ringArea', 'poleOfInaccessibility']);
const square = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
const sq = pole(square);
check('a square\'s pole is its middle', [Math.round(sq[0] * 10) / 10, Math.round(sq[1] * 10) / 10], [5, 5]);
// a thick C: the centre of mass of a crescent sits in the gap; the pole sits in the ink
const cee = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10], [0, 0]]] };
const centroid = lift(js, ['labelAnchorPoint'])(cee);
const inside = (p) => p[0] < 3 || (p[1] < 3) || (p[1] > 7);
check('a C-shape\'s centre of mass is in the gap', inside(centroid), false);
check('its pole is on the C', inside(pole(cee)), true);
// every arm of that C is 3 wide, so the furthest a point can be from an edge is 1.5
const edgeDist = (p, ringPts) => { let best = Infinity; for (let i = 0, j = ringPts.length - 1; i < ringPts.length; j = i++) { const a = ringPts[j], b = ringPts[i]; const dx = b[0] - a[0], dy = b[1] - a[1]; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1); t = Math.max(0, Math.min(1, t)); const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); if (d < best) best = d; } return best; };
check('the pole is as far from every edge as the C allows (about 1.5)', Math.round(edgeDist(pole(cee), cee.coordinates[0]) * 10) / 10 >= 1.4, true);
// a ring: the hole is not a place
const ring = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]] };
const rp = pole(ring);
check('a ring\'s pole is on the ring, not in its hole', (rp[0] > 3 && rp[0] < 7 && rp[1] > 3 && rp[1] < 7), false);
check('a MultiPolygon takes its largest part', (() => { const p = pole({ type: 'MultiPolygon', coordinates: [[[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]], square.coordinates] }); return p[0] < 10 && p[1] < 10; })(), true);
check('a point is itself; a line has no pole', [pole({ type: 'Point', coordinates: [1, 2] }), pole({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })], [null, null]);
check('the dot that used to sit at the centre of mass is kept only for a curated layer that asks', /Superseded for contributed layers by ONE MARK FOR EVERY PLACE/.test(js), true);

console.log('\n  one set of behaviours');
check('keys are offered to any contributed layer that wears markers, areas included', /function initLayerKeys\(L\) \{\s*if \(!L\.userLayer \|\| !hasPins\(L\) \|\| L\._keyOptions\) return;/.test(js), true);
check('the 30% rule for a question stands unchanged', /var QUESTION_MIN_REACH = 0\.30;/.test(js), true);
check('a search hides an area\'s marker and pales its shading, both', /if \(hasPins\(L\)\) applyMarkerVisibility\(L\);\s*if \(!hasPins\(L\) \|\| areaPins\(L\)\) applyShapeFade\(L\);/.test(js), true);
check('a matching area is framed by its whole outline, not its marker', /walkCoords\(\(e\.shape \|\| e\.f\)\.geometry, function \(c\)/.test(js) && /if \(!hasPins\(L\) \|\| areaPins\(L\)\) \{\s*shapes = true;/.test(js), true);
check('a tap on an area\'s marker rings the marker and the outline', /selectRow\(L, entry\.f\._row, entry\.shape \? shapeRef\(L, entry\.shape, entry\.f\._row\) : null\);/.test(js) && /function shapeRef\(L, f, row\) \{\s*return \{ source: srcId\(L\), id: f && f\.id != null \? f\.id : row \};/.test(js), true);
check('the chosen marker wears its ring whichever layer it is on', /if \(!SEL\.L \|\| !hasPins\(SEL\.L\) \|\| SEL\.row == null\) return;/.test(js), true);
check('a tap on the shading still opens the card with the twins\' chooser', /openPopup\(top\.L, top\.f, e\.lngLat, null, null, rowsUnder\(e\.point, top\)\);/.test(js), true);
check('a kind\'s word goes to an area framed whole, and the card still opens on a map that did not move', /if \(e\.shape\) \{[\s\S]*?setTimeout\(open, 900\); try \{ map\.fitBounds\(b, \{ padding: viewPadding\(\), maxZoom: 10/.test(js), true);
check('the first-visit pulse sits on the marker\'s head for any layer with markers', /offset: hasPins\(L\) \? \[0, -18\] : \[0, 0\]/.test(js), true);

console.log('\n  the Map Browser counts, and a split file is one row');
check('a count as plain text, with the place mark before it', /var head = el\("div", "coll-head"\);\s*var dot = el\("span", "coll-dot pin"\);/.test(js), true);
check('no chevron, no list, no "Show all"', !/coll-chev/.test(js) && !/coll-list/.test(js) && !/coll-more/.test(js) && !/\.coll-chev/.test(html), true);
check('the count is not a button in the sheet either', /\.coll-head \{ display:flex; align-items:center; gap:\.5rem; min-height:24px;/.test(html) && !/\.coll-head:hover/.test(html), true);
const pairs = lift(js, ['layerById', 'looksLikeTwin', 'pairedTwin', 'pairedPrimary'], 'var MANIFEST = { layers: [] };\n');
check('the "· as points" half is known by its name', (() => { const f = lift(js, ['looksLikeTwin']); return [f({ id: 'a-as-points', sameFileAs: 'a' }), f({ id: 'x', sameFileAs: 'a', label: 'Water · as points' }), f({ id: 'a', sameFileAs: 'a-as-points', label: 'Water' })]; })(), [true, true, false]);
check('the twin has no row of its own in the drawer', /!isBaseMapRow\(L\) && !pairedPrimary\(L\)/.test(js), true);
check('one switch moves both halves', /var twin = pairedTwin\(L\);\s*if \(twin\) setLayerVisible\(twin, show\);/.test(js), true);
check('one count, over both halves, and the phone\'s tab reads it', /var parts = \[L\]\.concat\(pairedTwin\(L\) \? \[pairedTwin\(L\)\] : \[\]\);/.test(js) && /L\._row\.setAttribute\("data-count", String\(shown\)\)/.test(js), true);
check('a search on either half narrows the one row', /syncCollection\(pairedPrimary\(L\) \|\| L\);/.test(js), true);
const splitWords = lift(js, ['splitWords']);
check('"6 as areas · 5 as points" when the first half kept its outlines', [splitWords(6, { type: 'fill' }, false), splitWords(5, { type: 'fill' }, true), splitWords(1, { type: 'fill' }, false)], ['6 as areas', '5 as points', '1 as area']);
check('"6 by region · 5 looked up" when the first half was placed at its regions\' middles', [splitWords(6, { type: 'marker' }, false), splitWords(5, { type: 'marker' }, true)], ['6 by region', '5 looked up']);
check('the second line is Muted, Meta type, under the count', /\.coll-split \{ margin:0 0 0 calc\(11px \+ 3px \+ \.5rem\); padding:0; font-size:var\(--t-meta\); color:var\(--color-text-muted\);/.test(html), true);
check('a split file\'s rows are "places" unless the manifest names them', /var noun = L\.noun \|\| \(parts\.length > 1 \? "places" : layerNoun\(L\)\);/.test(js), true);

console.log('\n  the design notes say it');
check('one mark for every place', /### One mark for every place \(October 2026\)/.test(design) && /pole of inaccessibility/.test(design), true);
check('the Map Browser counts, and one file is one row', /### Map Browser \(October 2026\)/.test(design) && /One file, one row/.test(design) && /6 as areas · 5 as points/.test(design), true);

check('an area layer\'s joined region name is never offered as a key', /if \(col === "name" && L\.type !== "marker"\) return;/.test(js), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
