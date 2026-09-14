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

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
