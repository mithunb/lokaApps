/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The layer that used to be called "Named places": it is named for what it
 * shows, drawn quietly, and every outline says its own name. The builder
 * (recipes.py) and the one-off patch for built atlases must agree, so both are
 * checked against the same expected wording. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { placesLabel, patchLayer } from '../deploy/patch-named-places.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const CASES = [
  [['sanctuary', 'mountain range', 'national park', 'ward'], 'Protected areas, mountain ranges & wards', 'Protected area, mountain range or ward'],
  [['ward'], 'Wards', 'Ward'],
  [['mountain range'], 'Mountain ranges', 'Mountain range'],
  [['wetland', 'community reserve'], 'Protected areas & wetlands', 'Protected area or wetland'],
  [[], 'Named places', 'Named place'],
];

console.log('\n  the layer is named for what it shows');
for (const [k, many, one] of CASES) {
  check(`${JSON.stringify(k)} → "${many}"`, placesLabel(k), many);
  check(`  and its key says "${one}"`, placesLabel(k, true), one);
}

console.log('\n  the builder says the same thing');
const src = fs.readFileSync(ROOT + '/api/atlas-builders/recipes.py', 'utf8');
const start = src.indexOf('PLACE_GROUPS = ['), end = src.indexOf('def places_named(ctx):');
let py = null;
try {
  py = JSON.parse(execFileSync('python3', ['-c', src.slice(start, end) +
    '\nimport json,sys\nc=json.loads(sys.argv[1])\nprint(json.dumps([[places_label(k), places_label(k, one=True)] for k in c]))',
    JSON.stringify(CASES.map((c) => c[0]))], { encoding: 'utf8' }));
} catch (e) { py = 'python3 unavailable: ' + e.message; }
check('recipes.py places_label gives the same words', py, CASES.map((c) => [c[1], c[2]]));
check('the builder no longer calls it "Named places"', /"label": "Named places"/.test(src), false);

console.log('\n  it is drawn quietly and every outline is named');
const L = patchLayer({ id: 'places', source: 'places.geojson', attribution: 'GMBA; NTCA', label: 'Named places', label_text: { property: 'name', minzoom: 6 } }, ['mountain range']);
check('a dashed ink outline, not a green fill', [L.paint.outlineColor, L.paint.outlineDash, L.paint.fillOpacity], ['#5A5751', [3, 2], 0.08]);
check('names show at every zoom (no minzoom)', 'minzoom' in L.label_text, false);
check('names are in ordinary case, unlike a layer\'s own area names', L.label_text.transform, 'none');
check('the biggest places win a crowded map', L.label_text.biggestFirst, true);
check('the viewer sorts names by the size of their place', /if \(t\.biggestFirst\) layout\["symbol-sort-key"\]/.test(fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8')), true);
check('the key is dashed like the line', L.legend[0].shape, 'dashed');
check('a tap says what it is', L.popup.fields.map((f) => f.property), ['kind', 'state']);
check('the info line keeps the credits', /GMBA; NTCA$/.test(L.info), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
