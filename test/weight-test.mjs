/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* What an atlas weighs, and what it refuses to drop quietly. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const common = fs.readFileSync(ROOT + '/api/atlas-builders/common.py', 'utf8');
const conf = fs.readFileSync(ROOT + '/deploy/lokaApps.conf', 'utf8');
const install = fs.readFileSync(ROOT + '/deploy/install.sh', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  places are never dropped without saying so');
/* .slice(0, 100) in three routes silently built a different atlas from the
   one somebody asked for: 150 districts in, 100 out, no word about the 50. */
check('the silent truncation is gone everywhere',
  (server.match(/shapeIDs.*\.slice\(0, 100\)/g) || []).length, 0);
check('there is one named limit instead', /const MAX_REGION_UNITS = 100;/.test(server), true);
check('and it refuses with the number the person picked',
  /'That is ' \+ ids\.length \+ ' places, and an atlas can cover ' \+ MAX_REGION_UNITS/.test(server), true);
check('it says what to do about it', /pick a coarser level/.test(server), true);
const guards = (server.match(/const tooMany\w* = tooManyUnits\(/g) || []).length;
check('all three routes ask: create, rebuild, and a file sent before the atlas exists', guards, 3);
check('the count rides along so a page can use it', /tooManyUnits: \w+\.(length|shapeIDs\.length)/.test(server), true);

console.log('\n  the builder writes coordinates a reader could conceivably see, and no more');
/* 7 decimals is centimetre precision, written onto outlines already simplified
   at 0.0007 degrees — about 78 metres. */
check('six decimals', /^COORD_DP = 6$/m.test(common), true);
check('applied to geometry on the way out', /g\["coordinates"\] = _round_coords\(g\["coordinates"\]\)/.test(common), true);
/* the default json.dump writes ", " between every number */
check('and the separators stop being a megabyte of spaces',
  /separators=\(",", ":"\)\)/.test(common), true);
check('the reasoning is written down, including why not five',
  common.includes('one pixel is 28 cm on the ground') &&
  common.includes('arguable rather than') && common.includes('provable'), true);

console.log('\n  and what is served is compressed');
/* Measured before this: the reference atlas sent 4.4 MB per visitor. */
check('geo+json by name — Apache does not compress it by default',
  /AddOutputFilterByType DEFLATE application\/geo\+json/.test(conf), true);
check('with the ordinary text types', /AddOutputFilterByType DEFLATE application\/json application\/javascript/.test(conf), true);
check('guarded, so the config still loads without the module',
  /<IfModule mod_deflate\.c>[\s\S]*?<\/IfModule>/.test(conf), true);
check('and the module is enabled on install', /a2enmod proxy proxy_http deflate/.test(install), true);
/* PNG tiles, pmtiles and images are already compressed; deflating them costs
   CPU and returns nothing. */
check('images are left alone', /DEFLATE image\/png|DEFLATE application\/octet-stream/.test(conf), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
