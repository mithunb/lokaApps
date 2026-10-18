/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The viewer redesign (October 2026, from the approved phone mock-up):
 *   1. one round map button on the stage opens "Map or satellite";
 *   2. the "Mark each place by" caption and hint leave the layer's body and
 *      are said once behind the layer's ⓘ, with the count and who added it;
 *   3. the count sits beside the layer's name;
 *   4. one credit pill bottom-left — ⓘ plus the base map's credit, linking
 *      OpenStreetMap's copyright page — folds to the ⓘ on a phone;
 *   5. the phone sheet has three heights (peek · half · full), a visible
 *      44px chevron, a grabber, a swipe, and the map as the way out; tabs
 *      only with two or more groups; LOKA's badge in the head;
 *   6. touch targets: 48px questions, 44px answers and carets, 36px word
 *      chips 6px apart, a 44px ⓘ, a 22px grabber;
 *   7. the "27 of 134 places are … · show all" line sits in the sheet's
 *      head on a phone.
 * No network, no browser: these read the source. The browser checks are in
 * the report that shipped the change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
const caps = fs.readFileSync(ROOT + '/LOKA-ATLAS-CAPABILITIES.md', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
// the phone's block of rules, and the touch block
const phone = html.slice(html.indexOf('/* ---- the sheet ----\n         The shelf docks at the foot of the stage as a bottom sheet with three'), html.indexOf('/* Motion is intentional but never mandatory */'));
const touchAt = html.indexOf('@media (pointer:coarse), (max-width:720px){');
const touch = html.slice(touchAt, html.indexOf('@media (pointer:coarse){', touchAt));

console.log('\n  1. the map button: Map or satellite');
check('one round 44px button on the stage, top-right', /\.map-style-btn \{ position:absolute; top:8px; right:8px; z-index:6; width:44px; height:44px; padding:0; border-radius:50%;/.test(html), true);
check('wearing the layers-stack mark', /function buildMapButton\(stage\) \{[\s\S]*?<path d="m12 3 9 5-9 5-9-5 9-5z"\/><path d="m3 13 9 5 9-5"\/>/.test(js), true);
check('named for what it does', /btn\.setAttribute\("aria-label", "Map or satellite"\);/.test(js), true);
check('on a phone it sits under the search box', /\.map-style-btn \{ top:calc\(var\(--strip-h, 60px\) \+ 2px\); right:12px; \}/.test(phone), true);
check('it opens a small sheet of swatches that calls switchBasemap', /c\.onclick = function \(\) \{\s*switchBasemap\(b\.id\);/.test(js), true);
check('which shows the showing map\'s credit beneath the choice', /credit\.id = "map-style-credit";/.test(js) && /var inPop = \$\("#map-style-credit"\);\s*if \(inPop\) inPop\.innerHTML = basemapCreditHTML\(\);/.test(js), true);
check('Leaf while the satellite is showing, so the button says which', /btn\.classList\.toggle\("on", activeBasemap !== usual\);/.test(js) && /\.map-style-btn\.on \{ background:var\(--color-leaf\);/.test(html), true);
check('not drawn for an atlas with one base map', /if \(maps\.length < 2\) return null;/.test(js), true);
check('the old Map/Satellite segment is gone from the code and the styles', /ctl-basemaps|bm-btn/.test(js) || /\.ctl-basemaps|\.bm-btn/.test(html), false);
check('the sheet steps left of a docked card on a wide screen', /\.atlas-stage\.card-docked \.map-style-btn \{ right:356px; \}/.test(html), true);
check('the sheet has no foot any more (markup, styles, code)', /sheet-foot/.test(html) || /sheet-foot/.test(js), false);

console.log('\n  2. the hint lives in the ⓘ');
check('nothing is built over the rows', /el\("span", "key-chips-lbl"|el\("span", "key-hint"/.test(js), false);
check('and no style is left for it', /\.key-chips-lbl|\.key-hint/.test(html), false);
check('the ⓘ exists for every contributed layer, not only one with a note', /if \(L\.info \|\| collectionLayer\(L\)\) \{/.test(js), true);
check('its note leads with the name and the count', /if \(L\._countN != null\) head \+= " — " \+ countWords\(L\._countN, keyNoun\(L\)\);/.test(js), true);
check('then who added it (L.info), then the how-to only when questions are offered', /if \(L\.info\) parts\.push\(String\(L\.info\)\.replace\(\/\\\.\\s\*\$\/, ""\)\);\s*if \(keysOffered\(L\)\) parts\.push\(HOW_TO/.test(js), true);
check('the how-to, word for word', /var HOW_TO = "Mark each place by one of the questions below\. Open a question to colour the map by its answers; tap an answer to show only those places\.";/.test(js), true);
check('a line about LOKA\'s short names only when the layer has them', /if \(L\.lokaNames && L\.lokaNames\.from\) parts\.push\(LOKA_NAMES_NOTE/.test(js) && /var LOKA_NAMES_NOTE = "Short names are written by LOKA from the tagger’s own words\.";/.test(js), true);
check('the note is drawn again when the count lands and when the questions are built', /renderLayerCount\(L, shown, total\) \{[\s\S]*?renderLayerNote\(L\);\s*\}/.test(js) && /renderLayerNote\(L\);   \/\/ the ⓘ says how to use the questions only once there are some/.test(js), true);
check('questions sit flush with the layer: no strip indent on the body or the note', /\.ctl-extra \{ margin:\.05rem 0 \.35rem; padding-left:0; border-left:0; \}/.test(html) && !/\.ctl-said \{[^}]*padding-left:var\(--panel-strip\)/.test(html), true);
check('an open question\'s answers sit behind a 3px Leaf rule', /\.key-entry\.open > \.key-body \{[^}]*border-left:3px solid var\(--color-leaf\); \}/.test(html), true);
check('and the open row is Leaf, caret turned', /\.key-entry\.open > \.key-toggle \{ color:var\(--color-leaf-deep\); \}/.test(html) && /\.key-entry\.open > \.key-toggle \.key-caret \{ transform:rotate\(-135deg\)/.test(html), true);

console.log('\n  3. the count beside the name');
check('built into the row after the name, hidden until the file is in', /var name = el\("span", "ctl-name", esc\(L\.label\)\);[\s\S]*?var count = el\("span", "ctl-count"\);\s*count\.hidden = true;\s*top\.appendChild\(count\);/.test(js), true);
check('filled from the same number the phone\'s tab reads', /if \(L\._row\) L\._row\.setAttribute\("data-count", String\(shown\)\);[\s\S]*?renderLayerCount\(L, shown, items\.length\);/.test(js), true);
check('"134 places" on a phone — the layer\'s own noun', /\.ctl-count \.ctl-count-noun \{ display:inline; \}/.test(phone) && /nounOne\(keyNoun\(L\)\) : keyNoun\(L\)/.test(js), true);
check('"· 134" in the drawer', /\.ctl-count::before \{ content:'· '; color:var\(--color-text-muted\); \}/.test(html) && /\.ctl-count \.ctl-count-noun \{ display:none; \}/.test(html), true);
check('one count over both halves of a split file', /var parts = \[L\]\.concat\(pairedTwin\(L\) \? \[pairedTwin\(L\)\] : \[\]\);[\s\S]*?renderLayerCount\(L, shown, items\.length\);/.test(js), true);
check('the old count line under the row is gone', /coll-head|coll-count/.test(js), false);

console.log('\n  4. the credit pill');
check('one pill: the ⓘ (#sources-btn) and the words, no separate chip', /<div class="map-attrib" id="map-attrib">\s*<button id="sources-btn" class="map-attrib-i"[^>]*aria-controls="atlas-sources"[^>]*>i<\/button>\s*<span class="map-attrib-words" id="map-attrib-words"><\/span>\s*<\/div>/.test(html) && !/map-chip|map-foot/.test(html), true);
check('bottom-left, 32px tall, on a pill', /\.map-attrib \{ position:absolute; left:8px; bottom:8px; z-index:4; display:flex; align-items:center;\s*height:32px;[^}]*border-radius:var\(--radius-pill\);/.test(html), true);
check('the ⓘ\'s tap box is 44px', /\.map-attrib-i \{ flex:0 0 auto; width:44px; height:44px;/.test(html), true);
check('OpenStreetMap links to its copyright page', /href="https:\/\/www\.openstreetmap\.org\/copyright"/.test(js), true);
check('"© OpenStreetMap contributors · OpenFreeMap" on arrival', /\.replace\(\/,\\s\*©\\s\*OpenFreeMap\/, " · OpenFreeMap"\)/.test(js) && /attribution: "© OpenStreetMap contributors, © OpenFreeMap",/.test(js), true);
check('the satellite credit shows on Satellite (renderMapAttrib on every switch)', /function switchBasemap\(id\) \{[\s\S]*?renderMapAttrib\(\);/.test(js), true);
check('it folds on the map\'s first move by the reader, or after five seconds', /creditFoldT = setTimeout\(fold, 5000\);/.test(js) && /var onMove = function \(e\) \{ if \(e && e\.originalEvent\) \{ map\.off\("movestart", onMove\); fold\(\); \} \};/.test(js), true);
check('only on a phone: a wide screen keeps the line', /if \(!window\.matchMedia\("\(max-width: 720px\)"\)\.matches\) return;\s*pill\.classList\.add\("folded"\);/.test(js), true);
check('folded, it is the 32px ⓘ alone', /\.map-attrib\.folded \{ max-width:32px; \}/.test(html), true);
check('tapping it opens About & sources (the dialog is unchanged)', /if \(pill\) pill\.addEventListener\("click"/.test(html) && /<dialog class="atlas-sources" id="atlas-sources"/.test(html) && /function buildCredits\(\) \{/.test(js), true);
check('watched from start(), beside the first credit', /renderMapAttrib\(\);\s*watchCredit\(\);/.test(js), true);
check('above the phone\'s sheet', /\.map-attrib \{ left:8px; bottom:calc\(var\(--sheet-h, 0px\) \+ 8px\);/.test(html), true);

console.log('\n  5. the phone sheet: peek · half · full');
check('the markup opens at half, so the first frame is the final layout', /<aside class="atlas-panel" id="atlas-panel" data-h="half">/.test(html), true);
check('three heights: 84px, 52%, 90%', /\.atlas-panel\[data-h="peek"\] \{ height:calc\(84px \+ env\(safe-area-inset-bottom\)\); \}/.test(phone) && /\.atlas-panel\[data-h="half"\] \{ height:52%; \}/.test(phone) && /\.atlas-panel\[data-h="full"\] \{ height:90%; \}/.test(phone), true);
check('the height moves in the sheet\'s own ease', /transition:height \.28s cubic-bezier\(\.22,1,\.36,1\);/.test(phone), true);
check('setSheet owns the state and writes data-h', /function setSheet\(h\) \{[\s\S]*?panel\.setAttribute\("data-h", h\);/.test(js), true);
check('the peek shows the grabber, "LAYERS / <layer> <count>" and the badge', /<div class="sheet-grip" aria-hidden="true"><i><\/i><\/div>/.test(html) && /<span class="sheet-layer" id="sheet-layer"><\/span>/.test(html) && /<a class="loka-badge loka-badge-head"/.test(html), true);
check('the head names the showing layer and its number', /function syncSheetHead\(\) \{[\s\S]*?var cnt = rows\[0\]\.querySelector\("\.ctl-count b"\);/.test(js), true);
check('tapping the peeked head opens half', /if \(who\) who\.addEventListener\("click", function \(e\) \{[\s\S]*?setSheet\(SHEET === "peek" \? "half" : "full"\);/.test(js), true);
check('with the first layer\'s first question open', /if \(open && was === "peek"\) ensureFirstQuestionOpen\(\);/.test(js) && /function ensureFirstQuestionOpen\(\) \{[\s\S]*?var first = row\.querySelector\("\.key-entry \.key-toggle"\);\s*if \(first\) first\.click\(\);/.test(js), true);
check('the tabs-only state and the "LAYERS" chip are gone', /\.atlas-full \.atlas-panel\.collapsed \{ left:8px; right:auto;/.test(html) || /grid-template-rows:0fr/.test(html), false);
check('on a phone the wide screen\'s fold is never kept', /if \(mq\.matches\) return;   \/\/ the phone's sheet is atlas\.js's/.test(html) && /if \(mq\.matches\) \{ panel\.classList\.remove\("collapsed"\); sync\(\); \}/.test(html), true);
check('group tabs only with two or more groups, 40px tall', /if \(secs\.length < 2\) \{ bar\.hidden = true; return; \}/.test(js) && /\.atlas-tab \{\s*flex:0 0 auto; scroll-snap-align:start; height:40px;/.test(phone), true);
check('the chevron is a visible 44px button at the head\'s right', /\.panel-collapse \{ display:inline-flex; flex:0 0 auto; width:44px; height:44px;/.test(phone), true);
check('down when open, up when peeked', /\.atlas-panel\[data-h="peek"\] \.panel-collapse \{ transform:rotate\(180deg\); \}/.test(phone) && /chev\.setAttribute\("aria-expanded", String\(open\)\);/.test(js), true);
check('the chevron: peeked → half, open → peek', /if \(chev\) chev\.addEventListener\("click", function \(e\) \{[\s\S]*?setSheet\(SHEET === "peek" \? "half" : "peek"\);/.test(js), true);
check('the grabber cycles the heights', /if \(grip\) grip\.addEventListener\("click", function \(e\) \{[\s\S]*?setSheet\(SHEET_HEIGHTS\[\(SHEET_HEIGHTS\.indexOf\(SHEET\) \+ 1\) % SHEET_HEIGHTS\.length\]\);/.test(js), true);
check('a swipe on the head moves one step', /head\.addEventListener\("touchend", function \(e\) \{[\s\S]*?if \(dy > 40 && i > 0\) setSheet\(SHEET_HEIGHTS\[i - 1\]\);\s*else if \(dy < -40 && i < SHEET_HEIGHTS\.length - 1\) setSheet\(SHEET_HEIGHTS\[i \+ 1\]\);/.test(js), true);
check('a tap on the map lowers it to peek', /map\.on\("click", function \(\) \{ if \(onPhone\(\) && SHEET !== "peek"\) setSheet\("peek"\); \}\);/.test(js), true);
check('Esc too, unless something is already over the map', /if \(document\.querySelector\("\.atlas-sources\[open\], \.map-style-pop:not\(\[hidden\]\)"\)\) return;\s*if \(e\.key === "Escape" && onPhone\(\) && SHEET !== "peek"\)/.test(js), true);
check('--sheet-h is still measured from the panel', /function watchSheetHeight\(stage\) \{[\s\S]*?stage\.style\.setProperty\("--sheet-h", h \+ "px"\);/.test(js), true);
check('LOKA\'s badge is in the head on a phone and never floats over the map there', /\.loka-badge\.loka-badge-head \{ display:inline-flex; height:30px;/.test(phone) && /\.loka-badge-float \{ display:none; \}/.test(html) && !/\.atlas-panel\.collapsed ~ \.loka-badge-float/.test(html), true);
check('a reboot opens the next draw at half', /SHEET = "half";               \/\/ the next draw opens as a first visit does/.test(js), true);
check('the place card is untouched: still the floating card over the foot of the map', /\.atlas-stage \.atlas-popup\.maplibregl-popup \{\s*position:absolute; inset:auto 8px calc\(var\(--sheet-h, 0px\) \+ 8px\) 8px;/.test(html), true);

console.log('\n  6. touch targets');
check('questions 48px', /\.key-toggle \{ min-height:48px; \}/.test(touch), true);
check('answers 44px', /\.key-body \.key-kind \{ min-height:44px; \}/.test(touch), true);
check('the "words" caret in a 44px box', /\.leg-open \{ width:44px; height:44px; \}/.test(touch), true);
check('word chips 36px, 6px apart', /\.leg-why \{ gap:6px; \}/.test(touch) && /\.leg-why-w \{ min-height:36px;/.test(touch), true);
check('the ⓘ in a 44px box', /\.ctl-info \{ width:44px; height:44px; \}/.test(touch), true);
check('the grabber band 22px', /\.sheet-grip \{ display:flex; align-items:center; justify-content:center; height:22px;/.test(phone), true);
check('the sizes hold on any touch screen and on any phone-width screen', /@media \(pointer:coarse\), \(max-width:720px\)\{/.test(html), true);

console.log('\n  7. the filter line in the sheet');
check('the line is written to the sheet\'s head as well as under the search box', /var sf = \$\("#sheet-filter"\);\s*if \(sf\) fillCountLine\(sf, shown, total, pts, lead, word, noun\);/.test(js), true);
check('in the head\'s markup, a status line', /<div class="sheet-filter" id="sheet-filter" role="status" hidden><\/div>/.test(html), true);
check('on a Leaf Tint band, hidden while peeked', /\.sheet-filter \{[^}]*background:var\(--color-leaf-tint\);/.test(phone) && /\.sheet-filter\[hidden\], \.atlas-panel\[data-h="peek"\] \.sheet-filter \{ display:none; \}/.test(phone), true);
check('the line under the search box shows on a phone only while the sheet is peeked', /\.atlas-strip \.ctl-search-count \{ display:none; \}\s*\.atlas-stage\.sheet-peek \.atlas-strip \.ctl-search-count \{ display:block; \}/.test(phone), true);
check('the drawer keeps its own line under the kinds on a wide screen; the phone drops it (the head says it)', /\.key-only \{ display:flex;/.test(html) && /\.key-only \{ display:none; \}/.test(phone), true);
check('not there on a wide screen', /\.sheet-grip, \.sheet-layer, \.loka-badge\.loka-badge-head, \.sheet-filter \{ display:none; \}/.test(html), true);

console.log('\n  the notes say so');
check('DESIGN.md describes the three-height sheet', /peek/.test(design) && /Map or satellite/.test(design), true);
check('and the capabilities note the map button and the ⓘ', /Map or satellite/.test(caps) && /behind the layer/.test(caps), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
