/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The atlas page's tab icon, chosen while building (docs/design-style-from-
   website.md §14.2; Mithun's answers of 4 Nov 2026: D7, P3 (a), P4). What
   these hold: one optional line in the wizard's "Name it" step with a drawing
   of a browser tab; PNG, JPG, WebP or SVG, trimmed, padded to a square and
   drawn at 192 × 192 in the browser (logo-tools.js, one file for logo and
   icon); a wait line while it is made; a warning under 32 px that still lets
   it be used; nothing taken from the logo or the name; the same field in
   Settings; the viewer sets <link rel="icon"> from branding.icon; a rebuild
   carries the file (jobs.js CONTRIBUTED), and the previous logo too so Undo
   still works after one. Regex checks on source, like look-sheet-test.mjs;
   the server's routes are in look-routes-test.mjs. */

const wizard = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const tools = fs.readFileSync(ROOT + '/atlas/logo-tools.js', 'utf8');
const look = fs.readFileSync(ROOT + '/atlas/owner-look.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const css = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const { CONTRIBUTED } = await import(ROOT + '/api/lib/atlas/jobs.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the wizard: no tab icon, an optional logo (Mithun, 4 Nov 2026: styling only after the build)');
const nameStep = wizard.slice(wizard.indexOf('<h2>Name it</h2>'), wizard.indexOf('<!-- 4 · build -->'));
check('no tab icon in the wizard', /id="f-icon|Tab icon|iconData|S\.icon/.test(nameStep + setup), false);
check('the logo line sits under the two names, above “How should visitors explore it?”', nameStep.indexOf('id="f-logo"') > nameStep.indexOf('id="f-org"') && nameStep.indexOf('id="f-logo"') < nameStep.indexOf('How should visitors explore it?'), true);
check('marked optional, with “Choose a picture”, and where to change it later', /Logo <span>· optional<\/span>/.test(nameStep) && /id="f-logo-add">Choose a picture</.test(nameStep) && /under Owner ▾ → Settings/.test(nameStep), true);
check('nothing about a website’s look in the wizard', /website|look of/i.test(nameStep.replace(/<!--[\s\S]*?-->/g, '')), false);
check('a wait line shows at once while the logo is made ready', /LokaWait\.start\(waitEl, "Getting your logo ready…", \{ delay: 0 \}\)/.test(setup), true);
check('made by logo-tools.js as in Settings (an SVG is redrawn, never put in the page)', /T\.logoFromFile\(f, function \(e, png\)/.test(setup), true);
check('a picture that cannot be read is said plainly, and what was there is kept', /if \(e\) \{ stop\(\); err\.textContent = e; err\.hidden = false; return; \}/.test(setup), true);
check('an empty picture is refused in words', /That picture looks empty\. Choose another\./.test(setup), true);
check('a light logo is shown on a dark tile, as the atlas shows it', /paintLogo\(tone && tone\.light\);/.test(setup) && /\.ti-pic\.dark \{ background:#24211D; \}/.test(wizard), true);
check('Take it off clears it', /\$\("#f-logo-remove"\)\.onclick = function \(\) \{ S\.logo = "";/.test(setup), true);
check('it rides with the build as branding.logoData, only when chosen', /branding: Object\.assign\(\{ orgName: \$\("#f-org"\)\.value\.trim\(\) \}, S\.logo \? \{ logoData: S\.logo \} : \{\}\)/.test(setup), true);
check('logo-tools.js is loaded when first needed, at the wizard’s own version stamp', /s\.src = "\.\.\/logo-tools\.js\?v=" \+ v;/.test(setup), true);
check('the wizard’s controls are not pill-shaped', /\.ti[^{]*\{[^}]*border-radius:\s*(9+px|50%|[2-9]\d+px)/.test(wizard), false);

console.log('\n  one file makes the icon (logo-tools.js)');
check('trimmed of empty edges, padded to a square, drawn at 192 × 192', /var ICON_SIZE = 192, ICON_SMALL = 32;/.test(tools) && /var box = drawnBox\(fg, size\.w, size\.h\)/.test(tools) && /c\.width = ICON_SIZE; c\.height = ICON_SIZE;/.test(tools) && /Math\.round\(\(ICON_SIZE - dw\) \/ 2\)/.test(tools), true);
check('never cropped: the longer side sets the scale', /var side = Math\.max\(box\.w, box\.h\);/.test(tools), true);
check('the caller is told when the drawn part is under 32 px', /small: Math\.max\(drawnW, drawnH\) < ICON_SMALL \? \{ w: drawnW, h: drawnH \} : null/.test(tools), true);
check('the same 200 KB rule as the logo; an SVG is given a size first, as the logo is', /dataUrlBytes\(url\) > LOGO_BYTES\) return null;/.test(tools) && /function iconFromFile[\s\S]*svgWithSize\(String\(rd\.result/.test(tools), true);
check('a picture given as bytes (the site’s icon) goes through the same redraw', /function iconFromDataUrl\(dataUrl, cb\)/.test(tools) && /iconFromFile\(new File\(\[bytes\]/.test(tools), true);

console.log('\n  the same field in Settings, beside the logo');
check('owner.js leaves a slot after the logo (it is at its size ceiling); owner-look.js draws into it', /"<\/div>" \+ '<div id="own-icon"><\/div>' \+/.test(owner) && /var host = scrim\.querySelector\("#own-icon"\);/.test(look), true);
check('Choose a picture / Change / Take it off, the tab drawing, and the same words as the wizard', /id="own-icon-add">Choose a picture</.test(look) && /id="own-icon-change" hidden>Change</.test(look) && /id="own-icon-remove" hidden>Take it off</.test(look) && /<div class="own-tab" id="own-icon-tab">/.test(look) && /Without one, the tab shows LOKA’s icon\./.test(look), true);
check('saved at once through /details, as iconData or removeIcon; the page redraws from its own files', /saveIcon\(scrim, \{ iconData: png \}, "Tab icon set"/.test(look) && /saveIcon\(scrim, \{ removeIcon: true \}, "The tab icon is off"\)/.test(look) && /\/details", \{ method: "POST", body: \{ branding: branding \} \}/.test(look) && /window\.LokaAtlas\.dataChanged\(\)/.test(look), true);
check('the wait line while the picture is made ready; under 32 px it says so and still saves', /LokaWait\.start\(waitEl, "Getting your picture ready…", \{ delay: 0 \}\)/.test(look) && /so it may look blurred on the tab\./.test(look), true);
check('after a look brings or takes the icon, the block shows it as it now is', /function syncIconBlock\(scrim\)/.test(look) && /syncLogoBlock\(scrim\);\n\s*syncIconBlock\(scrim\);/.test(look), true);
check('square-cornered, no pill', /\.own-icon-now img \{[^}]*border-radius:0;/.test(css) && !/own-icon[^{]*\{[^}]*border-radius:\s*(9+px|50%|[2-9]\d+px)/.test(css), true);

console.log('\n  the server');
check('/details takes iconData and removeIcon the way it takes the logo, and forgets a look’s kept copy', /if \(bb\.removeIcon\) \{\n\s*removeBrandFile\(inst, 'icon'\);/.test(api) && /saveBrandFile\(inst, 'icon', bb\.iconData\)/.test(api) && /if \(bb\.removeIcon \|\| bb\.iconData\) forgetLookFile\(inst, 'icon'\);/.test(api), true);
check('a new atlas takes no tab icon; a logo the browser made badly is refused in words, not dropped', !/iconData/.test(api.slice(api.indexOf("router.post('/instances', "), api.indexOf("reg.createInstance({"))) && /if \(b\.branding && b\.branding\.logoData && !branding\.logoData\) \{\n\s*return res\.status\(400\)/.test(api), true);
check('after any build the manifest is told of an icon set in Settings or by a look', /setImmediate\(\(\) => \{ try \{ iconAfterBuild\(job\); \}/.test(api) && /function iconAfterBuild\(job\)/.test(api) && /if \(hasIcon\) rewriteManifest\(fresh\);/.test(api), true);
check('the public manifest names the icon file', /if \(b\.hasIcon\) bset\.icon = 'branding-icon\.png';/.test(api), true);
check('one rule for logo and icon files: a PNG under 200 KB, one function', /function saveBrandFile\(inst, kind, dataUrl\)/.test(api) && /function saveLogoFile\(inst, dataUrl\) \{ return saveBrandFile\(inst, 'logo', dataUrl\); \}/.test(api), true);
check('a rebuild carries the icon, and the previous logo so Undo still works after one', ['branding-icon.png', 'branding-icon.previous.png', 'branding-logo.previous.png', 'branding-logo.png'].every((n) => CONTRIBUTED.some((re) => re.test(n))), true);
check('…and nothing that is not the atlas’s own', ['branding-icon.png.swap', 'icon.png', 'branding-other.png'].some((n) => CONTRIBUTED.some((re) => re.test(n))), false);

console.log('\n  the viewer');
check('the page sets <link rel="icon"> from branding.icon, a PNG name only, and never from the logo', /function renderTabIcon\(b\)/.test(viewer) && /if \(!b \|\| !b\.icon \|\| !\/\^\[a-z0-9.-\]\+\\\.png\$\/i\.test\(b\.icon\)\) return;/.test(viewer) && /link\.rel = "icon"; link\.type = "image\/png"; link\.sizes = "192x192";/.test(viewer) && !/b\.logo[^\n]*rel = "icon"/.test(viewer), true);
check('…beside the logo, from the atlas’s own files (key and all)', /renderBranding\(manifest\.branding\);\n\s*renderTabIcon\(manifest\.branding\);/.test(viewer) && /link\.href = dataUrl\(b\.icon\);/.test(viewer), true);
check('with no icon nothing is added: the tab keeps LOKA’s', /var old = document\.querySelector\('link\[rel="icon"\]\[data-atlas-icon\]'\);/.test(viewer), true);

console.log('\n  words');
const banned = /\b(favicon|theme|palette|hex|render|rendered|fetch|fetched|upload)\b/i;
const strings = (setup.slice(setup.indexOf('the logo (step'), setup.indexOf('})();', setup.indexOf('wireLogo'))).match(/"(?:[^"\\\n]|\\.)*"/g) || []).map((s) => s.slice(1, -1));
check('the creator never reads favicon, upload, render or fetch', strings.filter((s) => /\s/.test(s) && banned.test(s)), []);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
