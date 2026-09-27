/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* One-row header for everyone, the map's own toolbar, the Owner menu, and
   the two key behaviours in the Map Browser: names wear their key marks (a),
   and a pressed kind narrows list and map together (b). Measured in a browser
   on LOKA x Bengaluru at 1440, 1280, 900 and 375 wide before being written
   down here. No network. */
import fs from 'node:fs';
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const own = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ownCss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the header is one row for everyone');
check('the header row never wraps on an atlas', /\.atlas-full \.nav \{[^}]*flex-wrap:nowrap;/.test(html), true);
check('the title gives way before the acts beside it (wide)', /\.atlas-full \.org-head \{ flex:1 1 auto; min-width:0; \}/.test(html), true);
check('and on a phone', /\.atlas-full \.org-head \{ flex:1 1 auto; min-width:0; max-width:none; \}/.test(html), true);
check('Share and the links sit together at the right', /\.atlas-full \.hero-actions \{ flex:0 0 auto; margin-left:auto;/.test(html), true);
check('nothing is moved into the header any more', /head-tools/.test(html) || /head-tools/.test(js), false);
check('between 721 and 1100px only sign in / sign out stay among the links',
  /@media \(min-width:721px\) and \(max-width:1100px\)\{\s*\.atlas-full \.nav \.links > :not\(#nav-signin\):not\(#nav-signout\) \{ display:none; \}/.test(html), true);
check('and Share is its icon there — Share alone, not every button', /\.atlas-full #share-btn span \{ display:none; \}/.test(html), true);
check('the header sits above the map\'s floating pieces, so a menu hanging from it is never under the search box',
  /\.atlas-full header\.site \{ z-index:10; \}/.test(html), true);

console.log('\n  search and Map/Satellite are one floating toolbar on the map');
check('the strip never leaves the stage', /if \(strip\.parentNode !== stage\) stage\.insertBefore\(strip, stage\.firstChild\);/.test(js), true);
check('it floats just right of the drawer, whose width is measured',
  /\.atlas-strip \{ position:absolute; top:8px; left:calc\(var\(--panel-w, 19\.5rem\) \+ 16px\);/.test(html), true);
check('the drawer\'s width is written by the same watcher that measures the phone sheet',
  /stage\.style\.setProperty\("--panel-w", \(onPhone \? 0 : panel\.offsetWidth\) \+ "px"\);/.test(js), true);
check('it wears the drawer\'s materials: hairline edge, corner radius, the panel-lift shadow',
  /\.atlas-strip \{[^}]*border:1px solid var\(--color-border\); border-radius:var\(--radius-md\); box-shadow:var\(--shadow-md\); \}/.test(html), true);
check('Map/Satellite follows search inside it on a wide screen', /else \{\s*\/\/ strip order: search \(already there\), then Map\/Satellite[^]*?if \(bm\) strip\.appendChild\(bm\);/.test(js), true);
check('on a phone Map/Satellite still lives in the sheet\'s foot', /if \(phone && foot\) \{[^}]*foot\.insertBefore\(bm, foot\.firstChild\);/.test(js), true);
check('and the phone\'s band goes quiet, full width, search alone', /@media \(max-width:720px\)\{[^]*?\.atlas-strip \{ top:0; left:0; right:0; max-width:none; background:none; border:none; box-shadow:none;/.test(html), true);
check('the count line hangs from the toolbar\'s left edge, clear of the drawer', /\.atlas-strip \.ctl-search-count \{ left:-\.3rem; transform:none; text-align:left; \}/.test(html), true);
check('and stays centred under the phone\'s search box', /\.atlas-strip \.ctl-search-count \{ left:50%; transform:translateX\(-50%\); text-align:center; \}/.test(html), true);
check('the drawer no longer waits under a strip', /--strip-h,48px\) \+ 8px/.test(html), false);

console.log('\n  the owner\'s tools fold into one Owner menu');
check('one button, outlined in Sindoor, that says Owner', /class="own-btn" id="own-btn"[^>]*aria-haspopup="true"[^>]*aria-controls="own-panel"/.test(own) && /\.own-btn \{[^}]*border:1px solid var\(--color-sindoor\);/.test(ownCss), true);
check('it is named for a screen reader', /aria-label="Owner menu — live status, region, add data, settings"/.test(own), true);
check('line 1: live status and the switch for it', /class="own-status" id="own-status"[^]*?id="own-live"/.test(own), true);
check('line 2: the region line, placed there by owner.js itself', /var slot = \$\("#own-panel-region"\);\s*if \(slot\) slot\.appendChild\(wrap\);/.test(own), true);
check('line 3: Your data · + Add data — the page\'s own link, moved in', /\$\("#own-panel-data"\)\.appendChild\(add\);/.test(own), true);
check('line 4: Title, logo, about · Settings', /Title, logo, about<\/span>[^]*?id="own-settings"[^>]*>Settings<\/button>/.test(own), true);
check('the buttons keep their ids, so toggleLive and openSettings are untouched', /\$\("#own-live"\)\.onclick = toggleLive;\s*\$\("#own-settings"\)\.onclick = function \(\) \{ openSettings\(\); \};/.test(own), true);
check('a press outside or Esc shuts it', /function away\(e\) \{ if \(!panel\.contains\(e\.target\) && !btn\.contains\(e\.target\)\) shut\(\); \}\s*function onKey\(e\) \{ if \(e\.key === "Escape"\) \{ shut\(\); btn\.focus\(\); \} \}/.test(own), true);
check('a line that opens something else puts the menu away first', /closest\("#own-settings, #own-region, #add-data-btn"\);\s*if \(t\) shut\(\);/.test(own), true);
check('the button\'s dot says live before the menu opens', /ob\.classList\.toggle\("live", live\)/.test(own) && /\.own-btn\.live \.own-dot \{ background:var\(--color-leaf\); \}/.test(ownCss), true);
check('on a phone the button is its dot and the menu a sheet under the header', /@media \(max-width:720px\)\{\s*\.own-btn-word, \.own-btn-chev \{ display:none; \}[^]*?\.own-panel \{ position:fixed; top:calc\(52px \+ 6px\); left:8px; right:8px;/.test(ownCss), true);
check('and the region line stacks there, after the rule it overrides', ownCss.indexOf('.own-region-k { flex:1 1 100%; }') > ownCss.indexOf('.own-region-k, .own-region-v { flex:0 1 auto; }'), true);
check('atlas.js no longer moves the region row around the page', /if \(region\) strip\.appendChild\(region\);/.test(js) || /foot\.appendChild\(region\)/.test(js), false);
check('the per-layer "⋯" stays: it is a layer\'s own menu, not the atlas\'s', /more\.className = "own-more";/.test(own), true);
check('the undeclared base group is called "Boundaries & places" — a declared one keeps its manifest\'s name',
  /base: "Boundaries & places"/.test(js) && /GROUP_LABELS\[gid\] \|\|/.test(js), true);

console.log('\n  (a) with a key on, each name in the Map Browser wears its marks');
check('one builder gives the pin and the list their marks', /function keyMarkRows\(L, f, act\)/.test(js) && /var rows = keyMarkRows\(L, entry\.f, act\);/.test(js), true);
check('the list row asks it instead of drawing a plain dot', /b\.appendChild\(collMarkEl\(L, it\)\);/.test(js), true);
check('no key on: the dot as before', /if \(!act\.length\) \{\s*var d = el\("span", "coll-dot" \+ \(L\.type === "marker" \? " pin" : ""\)\);/.test(js), true);
check('no answer under any key: the grey the key\'s own row uses', /none\.style\.setProperty\("--c", KEY_OTHER\);/.test(js), true);
check('the marks are the map\'s own rows', /rows\.forEach\(function \(r\) \{ box\.appendChild\(rowSvg\(r\.shape, r\.colors\)\); \}\);/.test(js), true);
check('toggling a key redraws the list', /syncCollection\(L\);   \/\/ the names in the list wear the marks the pins now wear/.test(js), true);
check('the chosen name\'s Sindoor ring survives on the marks', /\.coll-item\.sel \.coll-marks \{[^}]*var\(--color-sindoor\)/.test(html), true);

console.log('\n  (b) a pressed kind narrows the list and the map together');
check('a kind is a button that narrows', /var r = el\("button", "leg-item key-kind"/.test(js) && /r\.onclick = function \(\) \{ filterByKind\(L, opt, which, it\.label\); \};/.test(js), true);
check('it says which layer, key and kind it is', /r\.setAttribute\("data-layer", L\.id\);\s*r\.setAttribute\("data-col", opt\.col\);/.test(js), true);
check('the line reads "12 of 66 places are Market"', /shown \+ " of " \+ total \+ " " \+ noun \+ \(shown === 1 \? " is " : " are "\) \+ lead\.ofAll/.test(js), true);
check('one place says "is"', /shown === 1 \? " is " : " are "/.test(js), true);
check('and "other" and "no answer" are said in plain words', /if \(which === "silent"\) return "without an answer";\s*if \(which === "other"\) return "something else";/.test(js), true);
check('pressing the lit kind again comes back', /if \(kindFilterIs\(L, opt, which, label\)\) \{ clearSearch\(\); return; \}/.test(js), true);
check('it gates the rows the way a tag does and re-draws map and list through the same door', /e\.hidden = !has;[^]*?applyRowVisibility\(L\);\s*updateSearchCount\(shown, total, pts, \{ ofAll: kindWords\(label, which\) \}/.test(js), true);
check('the words behind a kind open from their own chevron, so the row is free to narrow', /var open = el\("button", "leg-open", ICONS\.chevron\);/.test(js), true);
check('one filter at a time: a kind empties the box and orphans a search in flight', /var box = \$\("\.ctl-search-input"\);\s*if \(box\) box\.value = "";[^\n]*\n\s*searchWord = "";\s*searchSeq\+\+;/.test(js), true);
check('typing replaces a pressed kind', /if \(KINDFILTER\) \{ KINDFILTER = null; markLitKinds\(\); \}   \/\/ a pressed kind, likewise/.test(js), true);
check('a tag replaces a pressed kind', /TAGFILTER_LAYER = layerId \|\| null;\s*if \(KINDFILTER\) \{ KINDFILTER = null; markLitKinds\(\); \}/.test(js), true);
check('"show all" clears it with everything else', /function clearSearch\(\) \{[^}]*KINDFILTER = null;\s*markLitKinds\(\);/.test(js), true);
check('a key going off drops a filter that was on it', /if \(KINDFILTER && KINDFILTER\.layer === L\.id &&\s*!act\.some\(function \(o\) \{ return o\.col === KINDFILTER\.col; \}\)\) clearSearch\(\);/.test(js), true);
check('the pressed kind is filled with Leaf Tint on a Leaf edge', /button\.key-kind\.on \{ background:var\(--color-leaf-tint\); border-color:var\(--color-leaf\); \}/.test(html), true);
// (reworded in the viewer-ux batch: the hint now says what a second tap does)
check('the hint under "Mark each place by" says so', /Tap a kind to show only those places; tap it again, or Show all, to bring the rest back\./.test(js), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
