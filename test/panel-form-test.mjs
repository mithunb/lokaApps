/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The panel's two forms: a rail on a wide screen, a bar on a phone. No network. */
import fs from 'node:fs';
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  on a wide screen the drawer is docked at the map\'s left edge (25 Oct 2026)');
check('it is flush to the frame, full height, 400px on a laptop', /\.atlas-panel \{ position:absolute; top:0; left:0; bottom:0; z-index:5; width:clamp\(19\.5rem, 36%, 400px\);/.test(html), true);
check('solid Surface, a hairline on its inner edge, no corners, no shadow',
  /background:var\(--color-surface\);\s*border:0; border-right:1px solid var\(--color-divider\); border-radius:0; box-shadow:none;/.test(html), true);
/* an atlas fills the page (html.atlas-full): the drawer runs from under the
   header to the foot, and the credits chip moves to the right of it */
check('on an atlas it runs to the foot of the map', /\n\s+\.atlas-full \.atlas-panel \{ bottom:0; \}/.test(html), true);
check('and the credits chip sits to the right of the open drawer, never under it',
  /\.atlas-full \.atlas-stage:has\(> #atlas-panel:not\(\.collapsed\)\) \.map-attrib \{ left:calc\(var\(--panel-w, 400px\) \+ 8px\); \}/.test(html), true);
check('folded, its head alone is the "Layers · N" button', /\.atlas-full \.atlas-panel\.collapsed \{ bottom:auto; width:auto; \}/.test(html), true);
check('and those two are wide-screen rules, not the phone sheet\'s',
  /@media \(min-width:721px\)\{\n\s+\.atlas-full \.atlas-stage\.has-strip \.atlas-panel \{ top:0; \}\n\s+\.atlas-full \.atlas-panel \{ bottom:0; \}/.test(html), true);
check('and it is open when the page loads, at either width', /panel\.classList\.toggle\("collapsed", mq\.matches\)/.test(html), false);
const openDrawer = (html.match(/\n    \.atlas-panel \{[^}]*\}/) || [''])[0];
check('no corner of map is trapped behind a rounded drawer', /border-radius:0;/.test(openDrawer), true);
check('it is solid paper, so the map never shows through the words', /background:var\(--color-surface\);/.test(openDrawer) && !/rgba\(/.test(openDrawer.replace(/border-right:[^;]*;/, '')), true);
/* the phone sheet's top edge is the Block hairline, which reads on the cream ground */
check('the phone sheet keeps an edge where it meets the map', /border-top:1px solid var\(--map-block\)/.test(html), true);

console.log('\n  the phone gets a tab row, and only the phone');
check('the bar is absent on a wide screen', /\.atlas-bar \{ display:none; \}/.test(html), true);
check('and appears only once it has marks', /\.atlas-bar:not\(\[hidden\]\) \{/.test(html), true);
check('the sheet\'s list clears the phone\'s own strip at the bottom (there is no foot)',
  /#atlas-controls \{ overflow-y:auto; flex:1 1 auto; min-height:0; padding:0 14px calc\(20px \+ env\(safe-area-inset-bottom\)\)/.test(html) && !/sheet-foot/.test(html), true);
check('the tabs scroll sideways rather than cutting names short',
  /\.atlas-bar:not\(\[hidden\]\) \{[^}]*overflow-x:auto/.test(html), true);
check('its three heights: peek about 84px, half 52%, full 90% (a sliver of map kept)',
  /\.atlas-panel\[data-h="peek"\] \{ height:calc\(84px \+ env\(safe-area-inset-bottom\)\); \}/.test(html) &&
  /\.atlas-panel\[data-h="half"\] \{ height:52%; \}/.test(html) && /\.atlas-panel\[data-h="full"\] \{ height:90%; \}/.test(html), true);

console.log('\n  the bar is built from what the panel actually drew');
check('every group says its name on the outside', /sec\.setAttribute\("data-group", g\.id\)/.test(js), true);
check('the marks come from the rendered groups',
  /querySelectorAll\("#atlas-controls \.ctl-group\[data-group\]"\)/.test(js), true);
check('a mark counts the switches that are on in its group',
  /\.ctl-toggle input\[type="checkbox"\]:checked/.test(js), true);
check('every group gets its own tab, with no More to hide behind', /BAR_SLOTS|"More"/.test(js), false);
check('each tab carries the group\'s whole name', /b\.className = "atlas-tab";/.test(js), true);
check('a label that runs out of room ellipsises rather than being chopped',
  /\.slice\(0, 9\)/.test(js), false);

console.log('\n  and the tray cannot outlive what it was showing');
check('a reboot closes it', /TRAY = null;\s*\/\/ the tray cannot outlive/.test(js), true);
check('Escape lowers it to its peek and hands focus to the chevron',
  /e\.key === "Escape" && onPhone\(\) && SHEET !== "peek"/.test(js) && /setSheet\("peek"\);\s*var chev = document\.querySelector\("#atlas-panel \.panel-collapse"\);\s*if \(chev\) chev\.focus\(\);/.test(js), true);

const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ocss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');

console.log('\n  one strip holds the controls, and every word starts where it ends');
check('the strip is the switch plus the gap beside it',
  /--panel-strip: calc\(32px \+ \.55rem\)/.test(html), true);
check('and it grows with the switch on a touch screen',
  /--panel-strip: calc\(38px \+ \.55rem\)/.test(html), true);
check('a subgroup no longer pushes its children right',
  /\.ctl-sub-body \{ padding-left:0; \}/.test(html), true);
check('a layer\'s questions sit flush with its name, full width, not behind a hairline',
  /\.ctl-extra \{ margin:\.05rem 0 \.35rem; padding-left:0; border-left:0; \}/.test(html), true);
check('and no depth keeps its own left edge',
  /padding-left:\.85rem|padding-left:1\.55rem|padding-left:2\.125rem|padding-left:2\.375rem/.test(html), false);

console.log('\n  the name is what you click to change the name');
check('there is no pencil', /own-pencil|ICON_PENCIL/.test(owner), false);
check('and no tick to hand anything back', /ICON_TICK/.test(owner), false);
check('the name is a button carrying the layer\'s name',
  /el\("button", "ctl-name own-nameable", null\)/.test(owner), true);
check('a click on it cannot flip the layer\'s visibility',
  /e\.preventDefault\(\); e\.stopPropagation\(\);\s*startRename/.test(owner), true);
check('it looks like a name until it is reached for',
  /\.own-nameable:hover \{ border-bottom-color/.test(ocss), true);
check('Enter saves, Escape puts back what was there',
  /e\.key === "Enter".*finish\(true\)[\s\S]{0,120}e\.key === "Escape".*finish\(false\)/.test(owner), true);

console.log('\n  a phone can still sign in from an atlas');
check('the header keeps sign in and sign out on a phone',
  /\.atlas-full \.nav \.links > :not\(#nav-signin\):not\(#nav-signout\) \{ display:none; \}/.test(html), true);
check('and on a phone sign in is a 48px row in the ☰ menu', /html \.nav \.nav-menu \.links a, html \.nav \.nav-menu \.links button, html \.nav \.nav-menu #nav-user \{\s*display:block; width:100%; margin:0; padding:14px \.25rem; line-height:20px; min-height:0; box-sizing:border-box;/.test(html), true);
check('only one script measures the sheet', /function sheetH\(\)/.test(html), false);

/* the red top edge went (25 Oct 2026): a hairline all round, 6px corners, a deeper lift */
check('the card has no red edge, at either width', /border-top(-width)?:[^;]*(1\.5px|var\(--color-sindoor\))/.test(html.match(/\.atlas-popup \.maplibregl-popup-content \{[^}]*\}/g).join('')), false);
check('a hairline all round, 6px corners, a deeper lift',
  /\.atlas-popup \.maplibregl-popup-content \{ border-radius:var\(--radius-lg\); padding:0; box-shadow:0 10px 28px rgba\(36,33,29,\.18\);\s*background:var\(--color-surface\); border:1px solid var\(--color-border\);/.test(html), true);

console.log('\n  a resized window frames the region again');
check('a resize re-frames while nobody has moved the map',
  /refitT = setTimeout\(function \(\) \{ if \(map && !userMoved && !focusFit\(true\)\) fitToData\(true\); \}/.test(js), true);
check('and a person\'s own pan or zoom is left alone', /if \(e && e\.originalEvent\) userMoved = true;/.test(js), true);

console.log('\n  the header is one row between a phone and a wide screen');
check('in the middle sizes only sign in stays among the links',
  /@media \(min-width:721px\) and \(max-width:1100px\)\{\s*\.atlas-full \.nav \.links > :not\(#nav-signin\):not\(#nav-signout\) \{ display:none; \}/.test(html), true);
/* search left the header for the map's own toolbar (see header-and-keys-test),
   so nothing in the header has to shrink: the row never wraps and the title
   shortens with "…" instead */
check('and the header row never wraps', /\.atlas-full \.nav \{ width:100%; min-height:44px; padding:\.3rem \.75rem; gap:\.6rem 1rem; flex-wrap:nowrap;/.test(html), true);
check('search is not in the header any more', /head-tools/.test(html), false);

console.log('\n  a phone sheet that grows makes room on the map');
check('the map is framed again, or nudged, when the sheet grows or shrinks',
  /if \(!userMoved\) \{ if \(!focusFit\(true\)\) fitToData\(true\); \}\s*else map\.panBy\(\[0, \(h - was\) \/ 2\]/.test(js), true);
check('the About panel\'s line under the title lines up on a phone', /\.sources-head, \.sources-sub, \.sources-lead, \.sources-foot \{ padding-left:1rem;/.test(html), true);
check('an old CARTO basemap credit is shown as OpenFreeMap', /name: "OpenStreetMap contributors & OpenFreeMap", url: "https:\/\/openfreemap\.org"/.test(js), true);

console.log('\n  an atlas is drawn in its own shape from the first paint');
const headEnd = html.indexOf('</head>');
const early = html.indexOf('document.documentElement.classList.add("atlas-full")');
check('the full-page class is set in the head, before anything is drawn', early > 0 && early < headEnd, true);
check('and only for an atlas address, so the gallery keeps its shape', /if \(\/\[\?&\]dataset=\[\^&\]\/\.test\(location\.search\)\)/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
