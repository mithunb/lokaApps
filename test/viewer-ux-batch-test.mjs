/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The viewer UX batch (late September 2026): the place card docks at the
 * right on a wide screen; a pressed kind in a key says so where it was
 * pressed; counted discs are ink, not Leaf; discs and pins that would land
 * on each other are drawn once; a pin layer's names are drawn by the map;
 * and five wordings a visitor met were put into plain words. Measured in a
 * browser on LOKA x Bengaluru, Cubbon Park and the Multispecies atlas at
 * 1280, 900 and 375 wide before being written down here. These checks lift
 * the pure functions out of atlas.js and read the rest of the source
 * statically. No network, no browser.
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
// WCAG contrast of two hex colours
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }

const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');

console.log('\n  1. the place card docks at the right on a wide screen');
const desk = html.slice(html.indexOf('the place card, docked at the right'), html.indexOf('.atlas-full .atlas-stage.card-docked .maplibregl-ctrl-bottom-right') + 120);
check('inside the wide-screen block, the card sits top-right of the map, 340 wide',
  /\.atlas-stage \.atlas-popup\.maplibregl-popup \{\s*position:absolute; top:var\(--card-top, 8px\); right:8px; bottom:auto; left:auto;\s*width:340px;/.test(desk), true);
check('loudly enough to beat the width and transform the map library writes on it', /max-width:none !important; transform:none !important;/.test(desk), true);
check('as tall as it needs up to the badge, then it scrolls', /max-height:calc\(100% - var\(--card-top, 8px\) - 44px\)/.test(desk) && /\.maplibregl-popup-content \{ width:100%; flex:0 1 auto; min-height:0; overflow-y:auto;/.test(desk), true);
check('on a narrow desktop the card starts below the toolbar instead of covering it (measured at 900: toolbar ends at 669, card starts at 552)',
  /if \(strip && strip\.offsetHeight && strip\.getBoundingClientRect\(\)\.right > mr\.right - 340 - 8 - 8\) \{\s*top = Math\.round\(strip\.getBoundingClientRect\(\)\.bottom - mr\.top\) \+ 8;/.test(js) &&
  /stage\.style\.setProperty\("--card-top", top \+ "px"\);/.test(js), true);
check('the card body no longer scrolls on its own (the whole card does)', /\.atlas-stage \.atlas-popup \.pop \{ max-height:none; overflow:visible; \}/.test(desk), true);
check('and it drops the tip, which points at nothing once docked', /\.atlas-stage \.atlas-popup \.maplibregl-popup-tip \{ display:none; \}/.test(desk), true);
check('the zoom buttons step left of the card while it is open', /\.atlas-stage\.card-docked \.maplibregl-ctrl-bottom-right \{ right:348px; \}/.test(desk), true);
check('the rule lives in the wide-screen block, so the phone card is untouched',
  html.indexOf('@media (min-width:721px){') < html.indexOf('the place card, docked at the right') &&
  html.indexOf('the place card, docked at the right') < html.indexOf('@media (max-width:720px){', html.indexOf('the place card, docked at the right')), true);
check('the phone card keeps its bottom rule with the same !important, as before',
  /\.atlas-stage \.atlas-popup\.maplibregl-popup \{\s*\n\s*position:absolute; inset:auto 8px calc\(var\(--sheet-h, 0px\) \+ 8px\) 8px;/.test(html) &&
  /width:auto; max-width:none !important; transform:none !important;/.test(html), true);
check('atlas.js knows when the card is docked', /function cardDocked\(\) \{\s*try \{ return window\.matchMedia\("\(min-width: 721px\)"\)\.matches;/.test(js), true);
check('a docked card ignores the pin offset and anchor', /if \(offsetPx && !docked\) \{/.test(js), true);
check('the stage is told, and told again when the card closes', /stage\.classList\.add\("card-docked"\);[\s\S]*?pop\.on\("close", function \(\) \{[\s\S]*?stage\.classList\.remove\("card-docked"\);/.test(js), true);
check('the pin is panned clear of the card and the toolbar', /function keepClearOfCard\(lngLat, offsetPx\) \{[\s\S]*?map\.panBy\(\[dx, dy\], \{ duration: 250 \}\);/.test(js), true);
check('framing leaves room for the card while one is open', /if \(LAST_POP && cardDocked\(\)\) pad\.right = Math\.min\(mr\.width \* 0\.45, 340 \+ 8 \+ 24\);/.test(js), true);
check('Esc puts the card away', /if \(e\.key === "Escape" && LAST_POP\) \{ try \{ LAST_POP\.remove\(\); \}/.test(js), true);
check('a tapped pin is the chosen one, ring and list alike', /function spiderClick\(L, entry\) \{[\s\S]*?selectRow\(L, entry\.f\._row, null\);/.test(js), true);
check('the chosen pin wears the Sindoor ring', /\.atlas-mnode\.sel \.atlas-pin\.loc::before \{[^}]*border:2px solid var\(--color-sindoor\);/.test(html) && /function markSelPin\(\) \{/.test(js), true);

console.log('\n  2. a pressed kind says so where it was pressed');
check('the pressed chip wears a small × (tap again to clear)', (js.includes('var x = el("span", "key-x", "\\u00d7");') || js.includes('var x = el("span", "key-x", "×");')) && /button\.key-kind\.on \.key-x \{ display:inline-flex; \}/.test(html), true);
check('the other kinds of that key step back but stay tappable', /b\.classList\.toggle\("dim", sameKey && !on\);/.test(js) && /button\.key-kind\.dim \{ opacity:\.55; \}/.test(html) && /button\.key-kind\.dim:hover \{ opacity:1; \}/.test(html), true);
check('under the key: "Showing only Culture (32) · Show all"', /t\.textContent = "Showing only " \+ what \+ \(litN \? " \(" \+ litN \+ "\)" : ""\);/.test(js) && /var all = el\("button", "key-only-all", "Show all"\);/.test(js), true);
check('the line sits after that key\'s kinds', /out\.push\(keyOnlyLine\(L, opt\)\);\s*return out;/.test(js), true);
check('Show all clears the filter the way the count line does', /all\.onclick = function \(\) \{ clearSearch\(\); \};/.test(js), true);
check('the line is hidden when nothing is pressed', /line\.hidden = !mine;/.test(js) && /\.key-only\[hidden\] \{ display:none; \}/.test(html), true);
check('the hint says what a tap does, and what a second tap does', /Tap a kind to show only those places; tap it again, or Show all, to bring the rest back\. Tap a word on a place to see who else said it\./.test(js), true);
check('(a) and (b) from dadd121 stand: list colours, list narrows', /function collMarkEl\(/.test(js) && /r\.onclick = function \(\) \{ filterByKind\(L, opt, which, it\.label\); \};/.test(js), true);

console.log('\n  3. counted discs are ink, not Leaf');
const inks = js.match(/var DISC_INK = \[("#[0-9A-F]{6}"), ("#[0-9A-F]{6}"), ("#[0-9A-F]{6}")\];/);
check('three steps of ink by count', !!inks, true);
const steps = inks ? [inks[1], inks[2], inks[3]].map((s) => s.replace(/"/g, '')) : [];
check('the palest is Ink Soft, the darkest is Ink', [steps[0], steps[2]], ['#5A5751', '#24211D']);
check('the white count clears 4.5:1 on every step (measured here)', steps.map((c) => contrast(c, '#FFFFFF') >= 4.5), [true, true, true]);
check('and the steps get darker, never lighter', steps.map(lum).every((l, i, a) => i === 0 || l < a[i - 1]), true);
check('no Leaf left on a disc or its hover footprint', /"#4F8161"|"#2A6B41", 50|fill-color": "#2A6B41"/.test(js), false);
check('the disc and its count draw from one paint and one layout', /paint: discPaint\(\)/.test(js) && /layout: countLayout\(\)/.test(js), true);
check('the zoom badge (a manifest\'s own cluster stanza) went ink with them', /\.atlas-cluster \{[^}]*border:1\.5px solid var\(--color-text-secondary\);/.test(html) && /\.cl-count \{[^}]*background:var\(--color-text-secondary\);/.test(html), true);

console.log('\n  4. discs and pins that would land on each other are drawn once');
check('the merge runs after every verdict', /\(MANIFEST\.layers \|\| \[\]\)\.forEach\(function \(L\) \{ if \(L\._foldEl\) updateFoldNote\(L\); \}\);\s*mergeOverlaps\(\);/.test(js), true);
check('it reads the source, not the drawn layer (which is missing what it hid)', /map\.querySourceFeatures\(CLUSTER_SRC, \{ filter: \["has", "point_count"\] \}\)/.test(js), true);
check('discs and pins are measured in screen pixels, with a 3px gap', /var MERGE_GAP = 3;/.test(js) && /var lim = items\[i\]\.r \+ items\[j\]\.r \+ MERGE_GAP;/.test(js), true);
check('two pins alone are the engine\'s business, not the merge\'s', /if \(items\[i\]\.pin && items\[j\]\.pin\) continue;/.test(js), true);
check('a keyed pin\'s rows count in its footprint', /r: 12 \+ rw \/ 2/.test(js), true);
check('the merged disc counts every member', /n \+= m\.n; sx \+= m\.x \* m\.n; sy \+= m\.y \* m\.n;/.test(js), true);
check('its parts are filtered out (discs) or hidden (pins)', /map\.setFilter\(CLUSTER_LAYER, keep\);/.test(js) && /m\.pin\.e\._absorbed = true;/.test(js) && /\(\(!e\._clustered && !e\._absorbed\) \|\| e\._fanned\)/.test(js), true);
check('a click zooms where a zoom would part them, and fans where it would not', /function mergedClick\(f\) \{[\s\S]*?map\.easeTo\(\{ center: m\.at, zoom: Math\.min\(z \+ 0\.25, maxZ\)[\s\S]*?spiderfyLeaves\("m" \+ f\.properties\.mid, m\.at, leaves\.slice\(0, FAN_MAX\)\);/.test(js), true);
check('a fresh index clears the merge before re-reading', /clearMerged\(true\);   \/\/ a fresh index means fresh verdicts/.test(js), true);
check('a hover names the count, as on any disc', /showHint\(f\.properties\.point_count \+ " places here", \{ x: p\.x, y: p\.y - DISC_R\[discBracket\(f\.properties\.point_count\)\] \}, "cl\|m" \+ f\.properties\.mid\);/.test(js), true);
check('the merged layers are torn down with the engine', /"atlas-cluster-merged-count", MERGED_LAYER\]\.forEach/.test(js) && /if \(map\.getSource\(MERGED_SRC\)\) map\.removeSource\(MERGED_SRC\);/.test(js), true);

console.log('\n  5. a pin layer\'s names are drawn by the map');
check('the span under the pin is gone', /node\.appendChild\(el\("span", "atlas-mlabel"/.test(js), false);
check('a pin layer with label_text gets a names source and two symbol layers', /function ensurePinNames\(L\) \{/.test(js) && /id: L\.id \+ "-pinname", type: "symbol"/.test(js) && /id: L\.id \+ "-pinbox", type: "symbol"/.test(js), true);
check('names collide and drop; alwaysShow keeps them all', /"text-allow-overlap": !!t\.alwaysShow,\s*"text-ignore-placement": !!t\.alwaysShow,\s*"text-optional": true/.test(js), true);
check('every pin claims its ground with an invisible box, so no name sits on a pin', /"icon-image": PIN_NAME_BOX, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": false/.test(js), true);
check('the names go under the counted discs, whose counts now claim their ground', /var before = map\.getLayer\(CLUSTER_LAYER\) \? CLUSTER_LAYER : undefined;/.test(js) && /"text-ignore-placement": false\n/.test(js), true);
check('only pins standing alone are named — not folded, hidden, merged or fanned', /if \(e\.hidden \|\| e\._clustered \|\| e\._absorbed \|\| e\._fanned\) return;/.test(js), true);
check('the names follow every change of display', /function paintMarkerDisplay\(L\) \{[\s\S]*?syncPinNames\(L\);\s*\}/.test(js), true);
const shortName = lift(js, ['shortName']);
check('a short name is itself', shortName('Tree stump seats for weary humans', 40), 'Tree stump seats for weary humans');
check('a sentence is cut at a word with an ellipsis', shortName('Cubbon Park - Established in 1870, this vibrant city park', 28), 'Cubbon Park - Established…');
check('a word too long to cut at is cut anyway', shortName('Supercalifragilisticexpialidocious-and-then-some', 20), 'Supercalifragilisti…');
check('the cut is set by the manifest (maxChars), 32 unless told', /var max = t\.maxChars \|\| 32;/.test(js), true);

console.log('\n  6. plain words');
const uploadKind = lift(js, ['uploadKind']);
check('(i) a spreadsheet is "a spreadsheet", never its filename', uploadKind('Multispecies Landscape Assessment Timeline 2026.xlsx'), 'a spreadsheet');
check('a GeoJSON is "a map file"', uploadKind('wards.geojson'), 'a map file');
check('nothing recorded says nothing', uploadKind(''), '');
check('the info note reads "Added by Socratus, from a spreadsheet"', /var by = "Added by " \+ \(L\.addedBy\.org \|\| L\.addedBy\.name\) \+ \(kind \? ", from " \+ kind : ""\);/.test(js), true);
check('and with nobody named, "From a spreadsheet someone shared"', /var from = "From " \+ kind \+ " someone shared";/.test(js), true);
check('the filename never reaches the note', /"From " \+ L\.uploadedAs/.test(js), false);
const dateKeyName = lift(js, ['prettyCol', 'dateKeyName']);
check('(ii) created_at is "When it was added"', dateKeyName('created_at'), 'When it was added');
check('updated_at is "When it was last changed"', dateKeyName('updated_at'), 'When it was last changed');
check('any other date keeps its own name', dateKeyName('date_of_visit'), 'Date of visit');
check('the grouping is said in brackets: "(by month)"', /if \(grain\) shown \+= " \(by " \+ grain \+ "\)";/.test(js), true);
check('(iii) the share beside a question says what it counts: "88% answered"', /var reach = el\("span", "key-reach", pct \+ "% answered"\);/.test(js), true);
check('with the long form one hover away', /reach\.title = pct \+ " of every 100 places have an answer to this";/.test(js), true);
check('(iv) a one-colour layer\'s legend row that only repeats its name is dropped', /if \(collectionLayer\(L\) \|\| \(data\.length === 1 && repeats\(data\[0\]\)\)\) \{/.test(js), true);
const plainName = lift(js, ['plainName']);
check('(v) the gallery prints "Maharashtra · Bihar · Delhi"', plainName('Mah\u0101r\u0101shtra \u00b7 Bih\u0101r \u00b7 Delhi'), 'Maharashtra \u00b7 Bihar \u00b7 Delhi');
check('and leaves a plain name alone', plainName('Karnataka'), 'Karnataka');
check('the gallery line goes through it', /\[i\.org, plainName\(i\.regionLabel\)\]\.filter\(Boolean\)\.join/.test(js), true);

console.log('\n  the design notes');
check('DESIGN.md says the card docks at the right', /docked at the right/i.test(design), true);
check('and that discs are ink', /counted disc[^\n]*ink/i.test(design), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
