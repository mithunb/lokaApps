/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The pictures in a value, however that value arrived. No network. */
import fs from 'node:fs';
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const m = src.match(/\n  function linksIn\(v\) \{[\s\S]*?\n  \}\n/);
if (!m) { console.log('  FAIL  linksIn could not be found in atlas.js'); process.exit(1); }
const linksIn = new Function(m[0] + '; return linksIn;')();

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const A = 'https://loka.place/api/images/a.jpg';
const B = 'https://loka.place/api/images/b.jpg';

console.log('\n  the shape every Cubbon Park place is stored in');
check('a list of wrappers, each holding its address',
  linksIn('[{"id" : "a7a42a0e", "image_url" : "' + A + '"}]'), [A]);
check('two of them', linksIn('[{"id":"x","image_url":"' + A + '"}, {"id":"y","image_url":"' + B + '"}]'), [A, B]);

console.log('\n  the shapes that already worked, still working');
check('one bare address', linksIn(A), [A]);
check('two separated by a semicolon', linksIn(A + '; ' + B), [A, B]);
check('two separated by a bar', linksIn(A + '|' + B), [A, B]);

console.log('\n  the shapes the ingest can produce');
check('a real list', linksIn([A, B]), [A, B]);
check('a list written as text', linksIn(JSON.stringify([A, B])), [A, B]);
check('a lone wrapper', linksIn({ id: 'x', image_url: A }), [A]);

console.log('\n  and nothing where there is nothing');
check('empty', linksIn(''), []);
check('missing', linksIn(null), []);
check('words that are not addresses', linksIn('a photograph of a tree'), []);
check('http, not https, is not served', linksIn('http://loka.place/a.jpg'), []);
check('the same address twice counts once', linksIn(A + '; ' + A), [A]);

console.log('\n  cut off at five hundred characters, which is what the map stores');
/* Every value is capped on its way onto the map. A place with several
   photographs ends mid-address, the list stops being readable, and until now
   that meant no photograph at all rather than the ones that survived. */
const cut = ('[{"id" : "1ac538d4", "image_url" : "' + A + '"}, ' +
             '{"id" : "2bd649e5", "image_url" : "' + B + '"}, ' +
             '{"id" : "3ce75af6", "image_url').slice(0, 500);
check('the whole thing no longer reads as a list', (() => { try { JSON.parse(cut); return true; } catch { return false; } })(), false);
check('and the ones that survived are still shown', linksIn(cut), [A, B]);
check('a quoted address is not mistaken for words', linksIn('"' + A + '"'), [A]);
check('one inside brackets too', linksIn('[' + A + ']'), [A]);

console.log('\n  a picture is drawn once, not twice');
check('the column the card led with is skipped below it',
  /fld\.property === \(\(L\.spec && L\.spec\.imageColumn\) \|\| ""\)/.test(src), true);
/* inside popupHTML, `spec` is the card (L.popup) — the picture column lives on
   the layer, and reading it off the card silently skipped nothing at all. */
check('read off the layer, not off the card',
  /var spec = L\.popup;/.test(src) && !/\(\(spec && spec\.imageColumn\)/.test(src), true);

console.log('\n  several photographs become a carousel');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
check('one photograph gets no arrows and no counter',
  /if \(shots\.length === 1\) return '<div class="pop-shots">' \+ imgs/.test(src), true);
check('several get a strip that snaps',
  /scroll-snap-type:x mandatory/.test(html) && /scroll-snap-align:center/.test(html), true);
check('and each fills the card rather than sharing it',
  /\.pop-strip \.pop-img \{ flex:0 0 100%/.test(html), true);
/* scoped to the photographs: a legend and a credits list use two columns too */
check('the old two-across thumbnails are gone',
  /\.pop-shots\.many \{ grid-template-columns/.test(html) || /\.pop-shots\.many \.pop-img \{ max-height:120px/.test(html), false);
check('the arrows say what they do', /aria-label="Previous photograph"/.test(src), true);
check('the counter announces itself when it changes', /aria-live="polite"/.test(src), true);
check('a finger gets the strip instead of arrows', /@media \(hover:none\) \{ \.pop-shot-go \{ display:none/.test(html), true);
check('and motion is not forced on anybody',
  /reducedMotion\(\) \? "auto" : "smooth"/.test(src), true);
check('both cards show photographs the same way',
  (src.match(/shotsHTML\(/g) || []).length, 3);
check('more than four are kept now', /SHOTS_MAX = 12/.test(src), true);

console.log('\n  the banded overlays are drawn crisp, not smoothed');
check('forest and elevation keep their edges', /"raster-resampling": "nearest"/.test(src), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
