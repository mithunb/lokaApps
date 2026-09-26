/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Where an atlas opens. No network. */
import fs from 'node:fs';
const atlas = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  an atlas opens on the places it holds');
check('the owner\'s own layers are what gets framed',
  /L\.userLayer && L\.default !== false/.test(atlas), true);
check('a draft preview still asks for its one layer',
  /if \(MANIFEST\.focusLayer\) return \[MANIFEST\.focusLayer\];/.test(atlas), true);
check('and with none of their own, the region is still the answer',
  /if \(!focusFit\(\)\) fitToData\(false\)/.test(atlas), true);

console.log('\n  room is only given to what has none');
check('the old rule padded anything under a kilometre', /0\.01\) \{ w -= 0\.02/.test(atlas), false);
check('now it is one point, or several on one spot',
  /NOTHING = 1e-7, ROOM = 0\.002/.test(atlas), true);

console.log('\n  and the cap lets a park fill the screen');
check('thirteen was about five kilometres', /maxZoom: 13 \}\);/.test(atlas), false);
check('sixteen still stops a rooftop', /maxZoom: 16/.test(atlas), true);

console.log('\n  the panel is not sat under');
check('framing shares the padding that knows where the panel is',
  /padding: viewPadding\(\)/.test(atlas), true);
check('and it is written once', (atlas.match(/pad\.left = Math\.min/g) || []).length, 1);

console.log('\n  how far in a map will let you go');
const builder = fs.readFileSync(ROOT + '/api/atlas-builders/build_dataset.py', 'utf8');
check('one number no longer serves every atlas', /"maxzoom": 15,/.test(builder), false);
check('the ceiling follows the region', /"maxzoom": max_zoom_for\(final_bounds, center\)/.test(builder), true);
/* A park-sized atlas usually sits inside a city-sized region, so the region
   alone would keep it shut out — the floor is the part that matters. */
check('and never drops below seventeen', /return 17\b/.test(builder) && !/return 1[0-6]\b[\s\S]*return 1[0-6]\b[\s\S]*return 1[0-6]\b/.test(builder), true);
check('and never asks for more than the basemaps have', /return 19\b/.test(builder) && !/return 2\d\b/.test(builder), true);

console.log('\n  an atlas can show its own region on a phone');
/* Measured on the multispecies atlas before this was fixed: the atlas covers
   70.7°E to 99.4°E, a phone showed 77.7°E to 92.3°E, and fitting the region on
   a 333-pixel-wide map needs zoom 2.63 against a floor of 4 set at build time.
   Half the width was off the screen with nothing to say so. */
check('the zoom floor gives way to the region before framing it',
  /function fitToData\(animate\) \{[\s\S]{0,160}floorFitsTheRegion\(\);/.test(atlas), true);
/* And on the path actually taken. The first version of this check proved the
   function existed and was called from fitToData — but every load runs
   `if (!focusFit()) fitToData(false)`, and focusFit succeeds whenever there is
   a layer to frame, so on the one atlas that needed it the fix never ran. It
   was reported fixed on the strength of the file being served. Measured live
   afterwards: a phone showed 82.1°E to 87.9°E of an atlas covering 70.7 to
   99.4. A check that a function is present is not a check that it runs. */
check('and on the path a load actually takes, not only the other one',
  /function focusFit\(animate\) \{[\s\S]{0,900}?floorFitsTheRegion\(\);/.test(atlas), true);
check('every framing path reaches it',
  (atlas.match(/floorFitsTheRegion\(\);/g) || []).length >= 2 &&
  /if \(!focusFit\(\)\) fitToData\(false\);/.test(atlas), true);
check('and it is lowered only as far as the region needs',
  /Math\.min\(built, cam\.zoom\)/.test(atlas), true);
check('measured against what the build asked for, not against last time',
  /var built = MANIFEST\.minzoom \|\| 5;/.test(atlas), true);
check('so a wide screen is left exactly where the build put it',
  /map\.setMinZoom\(cam && typeof cam\.zoom === "number" \? Math\.min\(built, cam\.zoom\) : built\);/.test(atlas), true);
check('and the floor is re-worked when the layout flips to the phone one',
  /max-width: 720px[\s\S]{0,200}fitToData\(true\)/.test(atlas), true);
check('a map with no bounds is left alone rather than guessed at',
  /if \(!MANIFEST\.bounds \|\| !map \|\| !map\.cameraForBounds\) return;/.test(atlas), true);

console.log('\n  every shape is findable, however small it draws');
/* Measured on the multispecies atlas before this: at the view it opens on, a
   neighbourhood in Bengaluru came out 0 by 0 pixels and a tiger reserve 6 by
   10, so two of the eleven people on that map were not on it. The nine that
   were showed as unnamed blobs. A pin instead of a shape is not the answer —
   a pin in the middle of the Western Ghats says the person works at a point.
   So both: the shape for the extent, a dot for the fact somebody is there. */
const fragment = fs.readFileSync(ROOT + '/api/lib/fragment.js', 'utf8');
check('a shape layer asks for a dot at each middle', /centreMarks: true,/.test(fragment), true);
check('and for the name beside it', /label_text: \{\s*\n\s*property: nameProp,/.test(fragment), true);
check('the name and the popup title agree about which column names a row',
  /const nameProp = popup\.title \|\| 'name';/.test(fragment) &&
  /popup: \{ title: nameProp, fields: popup\.fields \},/.test(fragment), true);

check('the dots ride on the same anchors the names use',
  /function addCentreMarks\(L\) \{[\s\S]{0,120}labelPointSource\(L\)/.test(atlas), true);
check('they are drawn for shape layers, under the names',
  /addCentreMarks\(L\);\n      addLabel\(L\);/.test(atlas), true);
check('only when the layer asks — a boundary file does not want 700 dots',
  /if \(!L\.centreMarks\) return;/.test(atlas), true);
check('clicking a dot opens the same card as clicking the shape',
  /L\._ids\.push\(L\.id \+ "-mark"\);/.test(atlas), true);
/* The dot never yields and the name may: a dropped name costs you something
   you can click for, a dropped dot costs you the person. */
check('a name can be held back when the map is crowded',
  /"text-optional": !t\.alwaysShow/.test(atlas), true);
check('a name sits clear of its own dot rather than on top of it',
  /layout\["text-offset"\] = t\.offset; layout\["text-anchor"\] = t\.anchor \|\| "top";/.test(atlas), true);
check('the dot takes the layer\u2019s own colour, with a ring so it reads on either ground',
  /"circle-color": fill,[\s\S]{0,200}"circle-stroke-color": "#ffffff"/.test(atlas), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
