/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* How wide a region may be depends on what is being built in it. No network. */
import fs from 'node:fs';

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const recipes = fs.readFileSync(ROOT + '/api/atlas-builders/recipes.py', 'utf8');
const cat = JSON.parse(fs.readFileSync(ROOT + '/atlas/setup/catalog.json', 'utf8'));
const LAYERS = Array.isArray(cat) ? cat : (cat.layers || []);

const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  return src.slice(a, src.indexOf(close, a + head.length) + close.length);
};
const { regionTooWide } = new Function('HARD_AREA_DEG2',
  cut(server, '\nfunction regionTooWide(', '\n}\n') + '\n return { regionTooWide };')(40);

const allowed = new Map(LAYERS.map((l) => [l.id, l]));
const wide = (area, ids) => regionTooWide(area, ids, allowed);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* The ten states one survey named span 618 square degrees. The ceiling is 40. */
console.log('\n  under the ceiling nothing is refused, whatever is being built');
check('a district with terrain', wide(2, ['admin', 'terrain']), '');
check('a district with everything', wide(39, LAYERS.map((l) => l.id)), '');

console.log('\n  over it, what is being built decides');
/* This is the whole change: the gate used to run before the layer list was
   read, so an atlas of India holding nothing but boundaries and somebody's own
   places was refused on the same grounds as one holding terrain. */
check('boundaries alone go as wide as they need', wide(618, ['admin']), '');
check('and so do the other fixed-cost layers',
  wide(618, ['admin', 'labels', 'roads', 'buildings']), '');
check('terrain does not', /too wide for terrain/.test(wide(618, ['admin', 'terrain'])), true);
check('and the refusal names it, not the region',
  /terrain & elevation/.test(wide(618, ['admin', 'terrain'])), true);
check('it says how to proceed',
  /leave it out: boundaries and your own places have no such limit/.test(wide(618, ['admin', 'terrain'])), true);
check('several are counted, not listed forever',
  /forest cover & loss, terrain & elevation and 1 more/.test(wide(618, ['forest', 'terrain', 'lulc'])), true);
check('two are both named', /and/.test(wide(618, ['forest', 'terrain'])), true);

console.log('\n  not knowing means gated');
check('a layer nobody recognises is still gated',
  /too wide for something-new/.test(wide(618, ['admin', 'something-new'])), true);

console.log('\n  the catalogue says which layers cost the same however wide the region');
const fixed = LAYERS.filter((l) => l.fixedCost).map((l) => l.id);
check('four of them, named', fixed, ['admin', 'labels', 'buildings', 'roads']);
/* If the compulsory layer were gated, no wide atlas could ever be built and
   the change would be pointless. */
check('and the compulsory one is among them',
  LAYERS.filter((l) => l.required).every((l) => l.fixedCost), true);

console.log('\n  and none of them reads imagery');
/* Drift protection: mark a raster layer fixedCost by mistake and a build that
   reads imagery over a continent slips straight through. */
const bodyOf = (name) => {
  const m = recipes.indexOf('\ndef ' + name + '(');
  if (m < 0) return '';
  const nxt = recipes.indexOf('\ndef ', m + 5);
  return recipes.slice(m, nxt > 0 ? nxt : recipes.length);
};
const readsImagery = (l) => {
  let body = bodyOf(l.recipe);
  for (const h of new Set(body.match(/\b_\w+(?=\()/g) || [])) body += bodyOf(h);
  return /read_cog_window|_read_worldcover|rasterio/.test(body);
};
LAYERS.filter((l) => l.fixedCost).forEach((l) => {
  check(l.id + ' builds no imagery', readsImagery(l), false);
});
/* and the ones that plainly do are plainly not marked */
['terrain', 'forest', 'lulc', 'soil', 'rainfall'].forEach((id) => {
  check(id + ' is gated', !!allowed.get(id) && !allowed.get(id).fixedCost, true);
});

console.log('\n  both gates ask the same question');
check('creating an atlas', (server.match(/const tooWide = regionTooWide\(areaDeg2, layerIds, allowed\);/g) || []).length, 2);
check('and it now comes after the layers are known',
  server.indexOf("if (!layerIds.length) return res.status(400).json({ error: 'no valid layers chosen' });") <
  server.indexOf('const tooWide = regionTooWide(areaDeg2, layerIds, allowed);'), true);
check('the old blind refusal is gone', /larger than a single atlas can cover/.test(server), false);
check('the approval step is untouched', /const largeRegion = areaDeg2 > FREE_AREA_DEG2;/.test(server), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
