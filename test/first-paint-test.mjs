/* An atlas looks like itself from the first frame.
 *
 * Mithun saw "the notebook version of Atlas" flash before an atlas drew. The
 * shape had already been fixed (025e5af set .atlas-full in the head), and the
 * live site confirmed the shape was right from the first frame; what still
 * flashed were the gallery's WORDS inside that shape — "LOKA Atlas" where the
 * atlas's title goes, an empty Layers drawer — for as long as the manifest
 * took, which on a private atlas is two round trips.
 *
 * So the head marks an atlas address .atlas-pending as well, the title slot
 * says nothing and the drawer is not drawn until there is something in it,
 * and atlas.js lifts the mark once the manifest has named the atlas (or when
 * it has to say why it could not open). These checks pin each half, and that
 * every way into an atlas lands on the one address the head can recognise.
 *
 *   node test/first-paint-test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const html = read('atlas/index.html');
const js = read('atlas/atlas.js');
const share = read('atlas/share.js');
const setup = read('atlas/setup/setup.js');
const apache = read('deploy/lokaApps.conf');
const server = read('api/server.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
}

console.log('\n  the decision is made in the head, before anything is drawn');
const headEnd = html.indexOf('</head>');
const headScript = /<script>(if \(\/\[\?&\]dataset=\[\^&\]\/\.test\(location\.search\)\) \{[^<]*\})<\/script>/.exec(html);
check('one inline script in the head looks at the address', !!headScript && html.indexOf(headScript[0]) < headEnd, true);
check('it comes before every stylesheet, so no style is ever applied without it',
  !!headScript && html.indexOf(headScript[0]) < html.indexOf('<link rel="stylesheet"'), true);
check('an atlas address gets the full-page shape', /classList\.add\("atlas-full"\)/.test(headScript ? headScript[1] : ''), true);
check('and the "not yet" mark, in the same breath', /classList\.add\("atlas-pending"\)/.test(headScript ? headScript[1] : ''), true);

// The same test the head runs, applied to every way in. Each must land on an
// address the head recognises; the gallery's own address must not.
const HEAD_RE = /[?&]dataset=[^&]/;
const routes = {
  'the plain address': '?dataset=cubbon-park',
  'a gallery card': '?dataset=deoria-bioregion',
  'the Share link': '?dataset=cubbon-park',
  'a private link, key and all': '?dataset=cubbon-park&key=abc123',
  'the owner, back from a build': '?dataset=cubbon-park&built=1',
  'the owner, signed in on a private atlas': '?dataset=cubbon-park&via=api',
  'an embed': '?embed=1&dataset=cubbon-park',
  'a map-only embed': '?dataset=cubbon-park&embed=map',
  'the pretty address after its redirect': '?dataset=cubbon-park',
};
for (const [name, search] of Object.entries(routes)) check(name + ' is recognised', HEAD_RE.test(search), true);
check('the gallery (no dataset) is not', HEAD_RE.test(''), false);
check('nor an empty dataset', HEAD_RE.test('?dataset=&embed=1'), false);

console.log('\n  every way in lands on that address');
check('the gallery\'s cards link to ?dataset=', /row\("\.\/\?dataset=/.test(js), true);
check('the sign-in return comes back to ?dataset=', /location\.replace\("\.\.\/\?dataset=" \+ encodeURIComponent\(back\[2\]\)\)/.test(setup), true);
check('the Share link keeps the address and only adds the key', /u\.searchParams\.delete\("key"\)[\s\S]*if \(key\) u\.searchParams\.set\("key", key\)/.test(share), true);
check('Apache turns /a/<slug> into ?dataset=<slug>', /RedirectMatch 302 \^\/apps\/atlas\/a\/\(\[a-z0-9-\]\+\)\/\?\$ \/apps\/atlas\/\?dataset=\$1/.test(apache), true);
check('and the dev server does the same', /res\.redirect\(302, `\/apps\/atlas\/\?dataset=\$\{a\[1\]\}`\)/.test(server), true);
check('the private atlas is read by the viewer from the same address — nothing in it decides the shape',
  /var VIA_API = !!KEY \|\| QS\.get\("via"\) === "api";/.test(js), true);

console.log('\n  nothing later takes the shape away');
check('no script removes the full-page class', /classList\.remove\(["']atlas-full["']\)/.test(js + html), false);
check('no stylesheet of ours is loaded late (owner.css is the owner\'s tools, after the atlas has drawn)',
  (html.match(/<link rel="stylesheet"/g) || []).length, 2);
check('the only late stylesheet is the owner\'s', /css\.href = "\.\/owner\.css\?v="/.test(js), true);
check('the shape does not wait for the manifest: atlas.js only repeats the head\'s decision',
  /if \(DATASET\) document\.documentElement\.classList\.add\("atlas-full"\);/.test(js), true);

console.log('\n  while the manifest is on its way, none of the gallery\'s words are said');
check('the title slot keeps its height and says nothing', /\.atlas-pending #atlas-title \{ visibility:hidden; \}/.test(html), true);
check('"Loading the map" is in the markup unhidden, so it is in the first frame',
  /<div class="atlas-loading" id="atlas-loading" aria-live="polite">/.test(html), true);
check('and the gallery never shows it', /html:not\(\.atlas-full\) \.atlas-loading \{ display:none; \}/.test(html), true);
check('a drawer with nothing in it is not drawn', /\.atlas-full \.atlas-panel:has\(#atlas-controls:empty\) \{ display:none; \}/.test(html), true);
check('a built drawer always holds something, so the rule only ever hides an unbuilt one',
  /panel\.appendChild\(el\("p", "ctl-empty", "This atlas has no layers yet\."\)\)/.test(js), true);
check('the drawer\'s markup starts empty (no whitespace, or :empty would not match)', /<div id="atlas-controls"><\/div>/.test(html), true);

console.log('\n  the mark comes off exactly when the atlas\'s own words are in place');
const startAt = js.indexOf('function start(manifest, styleDoc) {');
const startBody = js.slice(startAt, js.indexOf('\n  }\n', startAt));
check('start() names the atlas in the header', /setText\("#atlas-title", manifest\.title\);/.test(startBody), true);
check('then lifts the mark, after the title and Share are set',
  startBody.indexOf('classList.remove("atlas-pending")') > startBody.indexOf('wireShare(manifest);'), true);
const catchAt = js.indexOf('.catch(function (err) {\n        showLoading(false);');
const catchBody = js.slice(catchAt, js.indexOf('return false;', catchAt));
check('and when the atlas cannot open, the mark comes off before the reason is painted',
  catchBody.indexOf('classList.remove("atlas-pending")') > 0 && catchBody.indexOf('classList.remove("atlas-pending")') < catchBody.indexOf('$("#atlas-map").innerHTML'), true);
check('nowhere else', (js.match(/classList\.(add|remove|toggle)\("atlas-pending"\)/g) || []).length, 2);
check('and never put back by atlas.js', /classList\.(add|toggle)\("atlas-pending"\)/.test(js), false);
check('the home gallery never carries the mark, so its heading is untouched',
  !/renderHome[\s\S]*atlas-pending/.test(js.slice(js.indexOf('function renderHome'), js.indexOf('function renderHome') + 3000)), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
