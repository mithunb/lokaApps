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
const phoneHead = html.slice(html.indexOf('/* one row: the kicker and the title at the left, the ☰ at the right */'), html.indexOf('/* ---- the sheet ----\n         The shelf docks at the foot of the stage as a bottom sheet with three'));
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
check('the how-to, word for word', /var HOW_TO = "Mark each place by one of the questions below\. Open a question to colour the map by its answers\. Tap an answer to show those places and the words people used for it; tap it again to see everything\.";/.test(js), true);
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
check('on every screen now (Mithun, 23 Oct 2026): the credit is seen as the map opens, then folds', /var fold = function \(\) \{\s*clearTimeout\(creditFoldT\);\s*pill\.classList\.add\("folded"\);/.test(js), true);
check('…and stays under "Built with" in the ☰ menu, linking the copyright page (the OSMF guideline: never only in a menu)',
  /<div class="nav-builtwith" id="nav-builtwith" hidden>\s*<h3>Built with<\/h3>/.test(html) && /inMenu\.innerHTML = "Map data " \+ basemapCreditHTML\(\)/.test(js), true);
check('folded, it is the 32px ⓘ alone', /\.map-attrib\.folded \{ max-width:32px; \}/.test(html), true);
check('tapping it opens About & sources (the dialog is unchanged)', /if \(pill\) pill\.addEventListener\("click"/.test(html) && /<dialog class="atlas-sources" id="atlas-sources"/.test(html) && /function buildCredits\(\) \{/.test(js), true);
check('the five seconds start once the map has drawn, not when it was made', /showLoading\(false\);\s*\/\*[\s\S]*?\*\/\s*watchCredit\(\);/.test(js) && !/renderMapAttrib\(\);\s*watchCredit\(\);/.test(js), true);
check('one Esc shuts one thing: the credits, the map sheet, the card and the menu take theirs, the layers sheet steps back', /if \(e\.key === "Escape" && dlg\.open\) \{ e\.preventDefault\(\); shut\(\);/.test(html) && /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); shut\(\); btn\.focus\(\); return; \}/.test(js) && /if \(e\.defaultPrevented\) return;   \/\/ something over the map took this Esc/.test(js), true);
check('About & sources leads with the map\'s own credit and its copyright link', /<p class="sources-map" id="sources-map"><\/p>/.test(html) && /if \(inSources\) inSources\.innerHTML = "Map: " \+ basemapCreditHTML\(\);/.test(js), true);
check('the pill does not clip its 44px ⓘ, and the folded words cannot be tabbed onto', !/\.map-attrib \{[^}]*overflow:hidden/.test(html) && /\.map-attrib-words \{[^}]*overflow:hidden/.test(html) && /\.map-attrib\.folded \.map-attrib-words \{ opacity:0; visibility:hidden; \}/.test(html), true);
check('Tab stays inside the open map sheet', /if \(e\.key !== "Tab"\) return;[\s\S]*?if \(e\.shiftKey && document\.activeElement === first\) \{ e\.preventDefault\(\); last\.focus\(\); \}/.test(js), true);
check('the card\'s stand-in popup tells its listeners when it closes', /on: function \(name, fn\) \{ if \(name === "close" && typeof fn === "function"\) pop\._closers\.push\(fn\); return pop; \}/.test(js) && /if \(closing\) closing\._closers\.forEach/.test(js), true);
check('the chevron says "Hide the layers" / "Show the layers"; a group head says "showing"', /open \? "Hide the layers" : "Show the layers"/.test(js) && /" of " \+ rows\.length \+ " showing"/.test(js), true);
check('above the phone\'s sheet', /\.map-attrib \{ left:8px; bottom:calc\(var\(--sheet-h, 0px\) \+ 8px\);/.test(html), true);

console.log('\n  5. the phone sheet: peek · half · full');
check('the markup opens peeked (two heights, 23 Oct 2026), so the first frame is the final layout and the map comes first', /<aside class="atlas-panel" id="atlas-panel" data-h="peek">/.test(html) && /var SHEET_HEIGHTS = \["peek", "full"\];\s*var SHEET = "peek";/.test(js), true);
check('three heights: 84px, 52%, 90%', /\.atlas-panel\[data-h="peek"\] \{ height:calc\(84px \+ env\(safe-area-inset-bottom\)\); \}/.test(phone) && /\.atlas-panel\[data-h="half"\] \{ height:52%; \}/.test(phone) && /\.atlas-panel\[data-h="full"\] \{ height:90%; \}/.test(phone), true);
check('the height moves in the sheet\'s own ease', /transition:height \.28s cubic-bezier\(\.22,1,\.36,1\);/.test(phone), true);
check('setSheet owns the state and writes data-h', /function setSheet\(h\) \{[\s\S]*?panel\.setAttribute\("data-h", h\);/.test(js), true);
check('the peek shows the grabber, "LAYERS / <layer> <count>" and the badge', /<div class="sheet-grip" aria-hidden="true"><i><\/i><\/div>/.test(html) && /<span class="sheet-layer" id="sheet-layer"><\/span>/.test(html) && /<a class="loka-badge loka-badge-head"/.test(html), true);
check('the head names the showing layer and its number', /function syncSheetHead\(\) \{[\s\S]*?var cnt = rows\[0\]\.querySelector\("\.ctl-count b"\);/.test(js), true);
check('one tap rule: the grabber, the words and the chevron all swap peeked and full', /setSheet\(curH\(\) === "peek" \? "full" : "peek"\);/.test(js) && /if \(grip\) grip\.addEventListener\("click", flip\);/.test(js) && /if \(who\) who\.addEventListener\("click", flip\);/.test(js), true);
check('with the first layer\'s first question open', /if \(open && was === "peek" && !CARD\.open\) ensureFirstQuestionOpen\(\);/.test(js) && /function ensureFirstQuestionOpen\(\) \{[\s\S]*?var first = row\.querySelector\("\.key-entry \.key-toggle"\);\s*if \(first\) first\.click\(\);/.test(js), true);
check('the tabs-only state and the "LAYERS" chip are gone', /\.atlas-full \.atlas-panel\.collapsed \{ left:8px; right:auto;/.test(html) || /grid-template-rows:0fr/.test(html), false);
check('on a phone the wide screen\'s fold is never kept', /if \(mq\.matches\) return;   \/\/ the phone's sheet is atlas\.js's/.test(html) && /if \(mq\.matches\) \{ panel\.classList\.remove\("collapsed"\); sync\(\); \}/.test(html), true);
check('group tabs only with two or more groups, 40px tall', /if \(secs\.length < 2\) \{ bar\.hidden = true; return; \}/.test(js) && /\.atlas-tab \{\s*flex:0 0 auto; scroll-snap-align:start; height:40px;/.test(phone), true);
check('the chevron is a visible 44px button at the head\'s right', /\.panel-collapse \{ display:inline-flex; flex:0 0 auto; width:44px; height:44px;/.test(phone), true);
check('down when open, up when peeked', /\.atlas-panel\[data-h="peek"\] \.panel-collapse \{ transform:rotate\(180deg\); \}/.test(phone) && /chev\.setAttribute\("aria-expanded", String\(open\)\);/.test(js), true);
check('the chevron is not drawn on a phone', /\.panel-collapse \{ display:none !important; \}/.test(phone), true);
check('the end of a drag is not taken for a tap', /if \(Date\.now\(\) - \(panel\._dragEnd \|\| 0\) < 350\) return;/.test(js), true);
check('the sheet follows the finger on the head and the list, and settles at the nearer height or the way it was flung', /function dragSheet\(elm, scroller\) \{/.test(js) && /panel\.style\.height = Math\.max\(low, Math\.min\(full, h0 - dy\)\) \+ "px";/.test(js) && /var to = v > 0\.5 \? "peek" : v < -0\.5 \? "full"/.test(js) && /dragSheet\(head, null\);/.test(js) && /dragSheet\(list, list\);/.test(js), true);
check('on the list, a drag moves the sheet only when peeked, or full at the top going down; else the list scrolls', /var ok = !scroller \|\| peeked \|\| \(atTop && dy > 0\);/.test(js) && /\.atlas-panel\.dragging \{ transition:none; \}/.test(phone), true);
check('Esc too, unless something is already over the map', /if \(document\.querySelector\("\.atlas-sources\[open\], \.map-style-pop:not\(\[hidden\]\)"\)\) return;\s*if \(CARD\.open\) return;[^\n]*\n\s*if \(e\.key === "Escape" && onPhone\(\) && SHEET !== "peek"\)/.test(js), true);
check('--sheet-h is still measured from the panel', /function watchSheetHeight\(stage\) \{[\s\S]*?stage\.style\.setProperty\("--sheet-h", h \+ "px"\);/.test(js), true);
check('LOKA\'s badge is in the ☰ menu on a phone (in the head only for an embed) and never floats over the map there', /\.loka-badge\.loka-badge-head \{ display:none; height:30px;/.test(phone) && /\.atlas-embed \.loka-badge\.loka-badge-head \{ display:inline-flex; \}/.test(phone) && /\.nav-menu \.loka-badge\.loka-badge-menu \{ display:inline-flex;/.test(phoneHead) && /\.loka-badge-float \{ display:none; \}/.test(html) && !/\.atlas-panel\.collapsed ~ \.loka-badge-float/.test(html), true);
check('full, the map\'s own buttons and the credit wait until the sheet is down', /\.atlas-stage:has\(> #atlas-panel\[data-h="full"\]\) \.map-style-btn \{ visibility:hidden; \}/.test(phone), true);
check('search: the top of the side panel on a wide screen, a button that opens into the box on a phone', /function placeSearch\(\) \{[\s\S]*?if \(onPhone\(\)\) \{ if \(sc\.parentNode !== strip\)[\s\S]*?else if \(sc\.parentNode !== panel\) panel\.insertBefore\(sc, panel\.firstChild\);/.test(js) && /\.ctl-search\.collapsed \.ctl-search-box/.test(html), true);
check('a reboot opens the next draw peeked', /SHEET = "peek";               \/\/ the next draw opens as a first visit does/.test(js), true);
check('the head\'s name gives way before its number ("bengaluru-t… 134")', /\.sheet-layer-name \{ flex:0 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; \}/.test(phone) && /\.sheet-layer small \{ flex:0 0 auto;/.test(phone), true);
check('and the badge stays whole on a phone — "Powered by LOKA Atlas" — with a 44px tap box', /<span class="loka-badge-by">Powered by<\/span> <img src="\.\/loka-logo\.png" alt="LOKA"> <em>Atlas<\/em>/.test(html) && !/\.loka-badge-by \{ display:none/.test(html) && /\.loka-badge-head::after \{ content:''; position:absolute; left:0; right:0; top:-7px; bottom:-7px; \}/.test(phone), true);

console.log('\n  8. a place\'s card in the sheet (phones)');
check('on a phone openPopup routes the card into the sheet, same HTML, chooser and all', /if \(onPhone\(\)\) \{\s*var cpop = openCardInSheet\(L, feature, lngLat, html\);\s*if \(cpop && rows && rows\.length > 1\) wireChooser\(cpop, L, rows\);\s*return cpop;\s*\}/.test(js), true);
check('and not before the chooser is put on it', /if \(rows && rows\.length > 1\) html = chooserHTML\(L, rows, at != null \? at : feature\._row\) \+ html;\s*\/\*[\s\S]*?\*\/\s*if \(onPhone\(\)\) \{/.test(js), true);
check('the wide screen still makes a maplibre popup, docked as before', /var pop = new maplibregl\.Popup\(opts\)\.setLngLat\(lngLat\)\.setHTML\(html\)\.addTo\(map\);/.test(js) && /function cardDocked\(\) \{/.test(js) && /stage\.classList\.add\("card-docked"\);/.test(js), true);
check('the card lives in the sheet\'s markup, hidden, with "‹ Layers" and a ✕', /<div class="sheet-card" id="sheet-card" hidden>[\s\S]*?<button class="sheet-card-back" id="sheet-card-back"[\s\S]*?Layers<\/button>\s*<button class="sheet-card-close" id="sheet-card-close" type="button" aria-label="Close the card">/.test(html), true);
check('never shown on a wide screen', /\.sheet-grip, \.sheet-layer, \.loka-badge\.loka-badge-head, \.sheet-filter, \.sheet-card \{ display:none; \}/.test(html), true);
check('a card opens full from the list, peeked over the map from a pin', /setSheet\(CARD\.prev && CARD\.prev\.h === "full" \? "full" : "peek"\);\s*keepPlaceAboveSheet\(lngLat\);/.test(js) && /\.atlas-panel\.card-mode\[data-h="peek"\] \{ height:calc\(140px/.test(phone), true);
check('peeked, the card shows its name; a tap on it shows the whole card', /\.atlas-panel\.card-mode\[data-h="peek"\] \.sheet-card-body \{ overflow:hidden; cursor:pointer; \}/.test(phone) && /if \(!CARD\.open \|\| CARD\.h !== "peek"\) return;/.test(js), true);
check('the card\'s heights are the list\'s two; the layers\' height waits untouched', /var CARD_HEIGHTS = \["peek", "full"\];/.test(js) && /if \(CARD\.open\) CARD\.h = h; else SHEET = h;/.test(js), true);
check('"Layers" goes back as it was: the same height and scroll, the place kept', /CARD\.prev = \{ h: SHEET, scroll: controls \? controls\.scrollTop : 0 \};/.test(js) && /if \(back\) back\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); closeCard\(true\); \}\);/.test(js) && /setSheet\(prev\.h\);\s*var controls = document\.getElementById\("atlas-controls"\);\s*if \(controls\) controls\.scrollTop = prev\.scroll;/.test(js), true);
check('the ✕ closes the card and lets the place go', /if \(close\) close\.addEventListener\("click", function \(e\) \{ e\.stopPropagation\(\); closeCard\(false\); \}\);/.test(js) && /if \(!keepSelection\) clearSelection\(\);/.test(js), true);
check('a tap on the map lowers a full card to its name, and puts a peeked one away; Esc too', /if \(CARD\.open\) \{ if \(CARD\.h === "full"\) setSheet\("peek"\); else closeCard\(true\); return; \}/.test(js) && /if \(LAST_POP\._card\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); closeCard\(true\); return; \}/.test(js), true);
check('the map eases the place into the open above the low card', /function keepPlaceAboveSheet\(lngLat\) \{[\s\S]*?var sheetH = Math\.round\(H \* 0\.4\);[\s\S]*?if \(dx \|\| dy\) map\.panBy\(\[dx, dy\], \{ duration: 300 \}\);/.test(js), true);
check('and the sheet\'s size change does not re-frame the map meanwhile', /if \(CARD\.open \|\| Date\.now\(\) < CARD\.quietUntil\) return;/.test(js), true);
check('the "N here" chooser works on the card through the same stand-in popup', /setHTML: function \(h\) \{ body\.innerHTML = h; return pop; \}/.test(js) && /getElement: function \(\) \{ return body; \}/.test(js), true);
check('clusters and fans are untouched: they never went through openPopup', /if \(clusterAt\(e\.point\)\) return;             \/\/ the disc owns this click/.test(js) && /SPIDER\.pop = openPopup\(it\.L, it\.e\.f, it\.e\.mk\.getLngLat\(\), it\.off, fanAnchor\(it\.foot\)\);/.test(js), true);
check('a redraw or a reboot puts a card away', /if \(CARD\.open\) closeCard\(true\);   \/\/ a redraw replaces the places a card was about/.test(js) && /CARD\.open = false; CARD\.prev = null; CARD\.h = "peek";/.test(js), true);
check('the back and close buttons are 44px', /\.sheet-card-back \{ display:inline-flex; align-items:center; gap:4px; height:44px;/.test(phone) && /\.sheet-card-close \{ margin-left:auto; flex:0 0 auto; width:44px; height:44px;/.test(phone), true);
check('the card title is set in the display face at 1.25rem', /\.sheet-card-body \.pop-title \{ font-size:1\.25rem; padding-right:0; \}/.test(phone) && /\.pop-title \{ font-family:var\(--font-display\);/.test(html), true);

console.log('\n  6. touch targets');
check('questions 48px', /\.key-toggle \{ min-height:48px; \}/.test(touch), true);
check('answers 44px', /\.key-body \.key-kind \{ min-height:44px; \}/.test(touch), true);
check('answer buttons 44px on touch, and no "words" caret left', /\.key-body button\.key-answer \{ min-height:44px; \}/.test(touch) && !/\.leg-open/.test(touch), true);
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
check('not there on a wide screen', /\.sheet-grip, \.sheet-layer, \.loka-badge\.loka-badge-head, \.sheet-filter, \.sheet-card \{ display:none; \}/.test(html), true);

console.log('\n  9. the phone\'s header navigation is behind one ☰');
check('the ☰ is in the markup, 44px, named "Menu", and says whether it is open', /<button class="nav-burger" id="nav-burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu">/.test(html) && /\.nav-burger \{ display:inline-flex;[^}]*width:44px; height:44px;/.test(phoneHead), true);
check('the menu wraps Share and the links; on a wide screen it is display:contents, so the row is as it was', /<div class="nav-menu" id="nav-menu">[\s\S]*?<div class="hero-actions">[\s\S]*?<div class="links">/.test(html) && /\.nav-menu \{ display:contents; \}/.test(html), true);
check('and the ☰, the menu\'s head, the scrim and the long words are not drawn there', /\.nav-burger, \.nav-menu-head, \.nav-menu-scrim, \.nav-menu-more, \.loka-badge-menu, \.nav-builtwith \{ display:none; \}/.test(html), true);
check('on a phone the menu is a panel under the header, shown by html.nav-open', /\.nav-menu \{ display:none; position:fixed; left:0; right:0; top:var\(--nav-h, 52px\); z-index:30;/.test(phoneHead) && /html\.nav-open \.nav-menu \{ display:flex; \}/.test(phoneHead), true);
check('its rows are 48px, plain words, first letter up ("All atlases", "Sign in")', /padding:14px \.25rem; line-height:20px;/.test(phoneHead) && /\.nav-menu \.links a::first-letter, \.nav-menu \.links button::first-letter \{ text-transform:uppercase; \}/.test(phoneHead) && /a\[href\^="https:\/\/discoverloka"\]::first-letter \{ text-transform:none; \}/.test(phoneHead), true);
check('Share reads "Share this atlas" in the menu', /<span>Share<span class="nav-menu-more"> this atlas<\/span><\/span>/.test(html) && /\.nav-menu-more \{ display:inline; \}/.test(phoneHead), true);
check('every link is in the menu on a phone, all apps and discoverloka.org too', /\.atlas-full \.nav-menu \.links a\[href="\.\.\/"\], \.atlas-full \.nav-menu \.links a\[href\^="https:\/\/discoverloka"\] \{ display:block; \}/.test(phoneHead), true);
check('the owner\'s button keeps its word in the menu, and its panel opens over it', /\.nav-menu \.own-btn-word \{ display:inline; \}/.test(phoneHead) && /\.nav-menu \.own-btn \{ display:flex; align-items:center; width:100%; min-height:48px;/.test(phoneHead), true);
check('the ✕ is 44px; a tap outside (the scrim) and Esc shut it too', /\.nav-menu-close \{ margin-left:auto; flex:0 0 auto; width:44px; height:44px;/.test(phoneHead) && /if \(scrim\) scrim\.addEventListener\("click", shut\);/.test(html) && /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); shut\(\); burger\.focus\(\); return; \}/.test(html), true);
check('a row that goes somewhere puts the menu away', /e\.target\.closest\("a, #share-btn, #nav-signout"\);\s*if \(t\) shut\(\);/.test(html), true);
check('the header paints in its final form: no script moves anything into the menu', /appendChild\(.*hero-actions|nav-menu\.appendChild/.test(html), false);
check('an embed has no ☰ (its nav is not there at all)', /\.atlas-embed \.nav-burger \{ display:none; \}/.test(html), true);
check('the owner\'s tools still find Share and the actions row by the same ids', /document\.querySelector\("\.hero-actions"\)/.test(fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8')) && /id="share-btn"/.test(html), true);

console.log('\n  10. the last review');
check('the card\'s Esc steps back when something above it took the key', /if \(e\.key !== "Escape" \|\| !LAST_POP \|\| e\.defaultPrevented\) return;/.test(js), true);
check('the owner\'s panel takes its Esc, so nothing under it hears it', /function onKey\(e\) \{ if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); shut\(\); btn\.focus\(\); \} \}/.test(fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8')), true);
check('an embed is known in the head, before paint, so the ☰ never flashes', /if \(\/\[\?&\]embed=\(1\|map\)\(&\|\$\)\/\.test\(location\.search\)\) document\.documentElement\.classList\.add\("atlas-embed"\);/.test(html.slice(0, html.indexOf('</head>'))), true);
check('the card hands focus to its way back, and back to the chevron when it closes', /var back = document\.getElementById\("sheet-card-back"\);\s*if \(back\) \{ try \{ back\.focus\(\{ preventScroll: true \}\);/.test(js) && /var chev = panel && panel\.querySelector\("\.panel-collapse"\);\s*if \(chev\) \{ try \{ chev\.focus\(\{ preventScroll: true \}\);/.test(js), true);
check('Tab stays inside the open ☰ menu', /if \(e\.key !== "Tab"\) return;\s*\/\/ Tab stays inside the open menu/.test(html) || /\/\/ Tab stays inside the open menu\s*if \(e\.key !== "Tab"\) return;/.test(html), true);
check('every menu row is the same: 48px (14 + 20 + 14), text centred, no icons', /padding:14px \.25rem; line-height:20px; min-height:0; box-sizing:border-box; text-align:left;/.test(phoneHead) && /\.nav-menu \.share-btn svg \{ display:none; \}/.test(phoneHead) && /\.nav-menu \.own-btn \.own-dot \{ order:3; margin-left:auto; \}/.test(phoneHead), true);
check('the low card is never under 250px, its photo band shrinks with a short screen, the caption waits, and a fade says there is more', /\.atlas-panel\[data-h="low"\] \{ height:max\(40%, 250px\); \}/.test(phone) && /\.pop-img \{ max-height:clamp\(56px, 12vh, 110px\); \}/.test(phone) && /\.pop-caption \{ display:none; \}/.test(phone) && /\.atlas-panel\[data-h="low"\] \.sheet-card::after \{ content:'';/.test(phone), true);

console.log('\n  the notes say so');
check('DESIGN.md describes the three-height sheet', /peek/.test(design) && /Map or satellite/.test(design), true);
check('and the capabilities note the map button and the ⓘ', /Map or satellite/.test(caps) && /behind the layer/.test(caps), true);

check('the low card fades at its foot, so more is plainly below', /\.atlas-panel\[data-h="low"\] \.sheet-card-body \{ overflow:hidden; cursor:pointer;[\s\S]{0,120}mask-image:linear-gradient\(to bottom, #000 calc\(100% - 28px\), transparent\)/.test(html), true);

check('the menu\'s badge reads "Powered by LOKA Atlas" whole, and is hidden on a wide screen', /<a class="loka-badge loka-badge-menu" href="\.\/setup\/" title="Build your own atlas"><span class="loka-badge-by">Powered by<\/span> <img src="\.\/loka-logo\.png" alt="LOKA"> <em>Atlas<\/em><\/a>/.test(html) && /\.nav-menu-more, \.loka-badge-menu, \.nav-builtwith \{ display:none; \}/.test(html), true);

check('the menu\'s badge outranks the general badge rule, so a wide screen never shows it', /\.loka-badge\.loka-badge-menu \{ display:none; \}/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
