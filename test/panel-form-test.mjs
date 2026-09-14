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

console.log('\n  the panel is docked, not floating');
check('it reaches both edges of the map', /\.atlas-panel \{ position:absolute; top:0; left:0; bottom:0;/.test(html), true);
check('no corner of map is trapped behind a rounded card', /border-radius:0;/.test(html), true);
check('and there is no shadow to read past', /box-shadow:none; overflow:hidden/.test(html), true);
/* --border over a white road is 1.32:1, and this map draws white roads */
check('its edge stays visible where a road runs under it', /border-right:1px solid #767060/.test(html), true);

console.log('\n  the phone gets a bar, and only the phone');
check('the bar is absent on a wide screen', /\.atlas-bar \{ display:none; \}/.test(html), true);
check('and appears only once it has marks', /\.atlas-bar:not\(\[hidden\]\) \{/.test(html), true);
check('it clears the phone\'s own strip at the bottom',
  /padding:\.2rem \.25rem calc\(\.2rem \+ env\(safe-area-inset-bottom\)\)/.test(html), true);
check('the tray rises to meet it and never covers it',
  /bottom:calc\(46px \+ \.4rem \+ env\(safe-area-inset-bottom\)\)/.test(html), true);
check('and never takes more than half the screen', /max-height:50%/.test(html), true);

console.log('\n  the bar is built from what the panel actually drew');
check('every group says its name on the outside', /sec\.setAttribute\("data-group", g\.id\)/.test(js), true);
check('the marks come from the rendered groups',
  /querySelectorAll\("#atlas-controls \.ctl-group\[data-group\]"\)/.test(js), true);
check('a mark counts the switches that are on in its group',
  /\.ctl-toggle input\[type="checkbox"\]:checked/.test(js), true);
check('past four groups the rest go behind More', /BAR_SLOTS = 4/.test(js), true);
check('a label that runs out of room ellipsises rather than being chopped',
  /\.slice\(0, 9\)/.test(js), false);

console.log('\n  and the tray cannot outlive what it was showing');
check('a reboot closes it', /TRAY = null;\s*\/\/ the tray cannot outlive/.test(js), true);
check('Escape closes it and gives the mark back its focus',
  /e\.key === "Escape" && TRAY/.test(js), true);

const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ocss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');

console.log('\n  one strip holds the controls, and every word starts where it ends');
check('the strip is the switch plus the gap beside it',
  /--panel-strip: calc\(32px \+ \.55rem\)/.test(html), true);
check('and it grows with the switch on a touch screen',
  /--panel-strip: calc\(38px \+ \.55rem\)/.test(html), true);
check('a subgroup no longer pushes its children right',
  /\.ctl-sub-body \{ padding-left:0; \}/.test(html), true);
check('a layer\'s keys hang under its name, not behind a hairline',
  /\.ctl-extra \{ margin:\.05rem 0 \.35rem; padding-left:var\(--panel-strip\); border-left:0; \}/.test(html), true);
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

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
