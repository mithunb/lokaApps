/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* What can be built across a region, and what is simply not offered. No network. */
import fs from 'node:fs';

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const cat = JSON.parse(fs.readFileSync(ROOT + '/atlas/setup/catalog.json', 'utf8'));
const LAYERS = Array.isArray(cat) ? cat : (cat.layers || []);

const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  return src.slice(a, src.indexOf(close, a + head.length) + close.length);
};
const { layerSeconds, feasibleAt, feasibleLayers } = new Function('BUILD_BUDGET_S', 'EST_AT_DEG2',
  cut(server, '\nfunction layerSeconds(', '\n}\n') +
  cut(server, '\nfunction feasibleAt(', '\n}\n') +
  cut(server, '\nfunction feasibleLayers(', '\n}\n') +
  '\n return { layerSeconds, feasibleAt, feasibleLayers };')(9 * 60, 2);

const allowed = new Map(LAYERS.map((l) => [l.id, l]));
const at = (area, ids) => feasibleLayers(ids, allowed, area);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the atlas is never refused for being wide');
/* Somebody with sightings across a subcontinent should get their map. What
   cannot be built at that width is left out and named, not used as a reason
   to say no. */
check('the old refusal is gone', /regionTooWide/.test(server), false);
check('and so are the two area thresholds it used',
  /FREE_AREA_DEG2|HARD_AREA_DEG2/.test(server), false);
check('markers and outlines go as wide as the markers do',
  at(618, ['admin']).dropped, []);
check('so do the other fixed-cost layers',
  at(618, ['admin', 'labels', 'roads', 'buildings']).dropped, []);

console.log('\n  what cannot be built at that width is dropped and named');
check('terrain across ten states', at(618, ['admin', 'terrain']).dropped, ['terrain']);
check('and it is named in words, not by id',
  at(618, ['admin', 'terrain']).droppedLabels, ['Terrain & elevation']);
check('several are all named',
  at(618, ['forest', 'terrain', 'lulc']).droppedLabels.length, 3);
check('the answer carries them', /droppedLayers: fit\.droppedLabels\.length \? fit\.droppedLabels : undefined/.test(server), true);
check('and the wizard says so', /Too wide an area for " \+ r\.droppedLayers\.join/.test(setup), true);

console.log('\n  a region the size of every atlas built so far loses nothing');
/* Cubbon Park 0.4, LOKA x Bengaluru 0.4, Deoria 1.9, Tumakuru 2.5. */
[0.4, 1.9, 2.5].forEach((a) => {
  check(a + ' sq deg keeps every layer', at(a, LAYERS.map((l) => l.id)).dropped.length, 0);
});

console.log('\n  feasible means it fits the time a build is given');
check('a layer that does not grow costs the same anywhere',
  layerSeconds(allowed.get('admin'), 618), layerSeconds(allowed.get('admin'), 2));
check('one that does is scaled by how much bigger the region is',
  layerSeconds(allowed.get('terrain'), 20), 900);
check('terrain is feasible across a large cluster of districts', feasibleAt(allowed.get('terrain'), 12), true);
check('and not across ten states', feasibleAt(allowed.get('terrain'), 618), false);
check('an unknown layer is costed, not waved through', layerSeconds(undefined, 618), 30);

console.log('\n  approval follows the work, not the width');
check('a wide atlas of outlines and pins goes straight through',
  /const largeRegion = buildSeconds > BUILD_BUDGET_S \/ 2;/.test(server), true);
check('and the reason given is the time, not the area',
  /a long build: \$\{regionLabel\}, about \$\{Math\.round\(buildSeconds \/ 60\)\} minutes/.test(server), true);

console.log('\n  and the wizard never offers what will be dropped');
check('it asks the catalogue about this width', /catalog\?iso3=" \+ encodeURIComponent\(S\.iso3\) \+\n\s*\(area > 0 \? "&areaDeg2="/.test(setup), true);
check('the catalogue answers per layer', /feasible: feasibleAt\(l, areaDeg2\), estSecondsHere: layerSeconds\(l, areaDeg2\)/.test(server), true);
check('asked without a width it answers as before', /Number\.isFinite\(areaDeg2\) && areaDeg2 > 0/.test(server), true);
check('a layer it cannot build is disabled, not just unticked', /\(cannot \? " disabled" : ""\)/.test(setup), true);
check('and says why', /too wide an area for this one/.test(setup), true);
/* the cache used to key on country alone, so adding a place left the old
   answer on screen */
check('the offer is refreshed when the region changes size',
  /Math\.abs\(\(S\.catalogArea \|\| 0\) - area\) < 0\.001/.test(setup), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
