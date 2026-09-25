/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Places that are not administrative units: the index, and the names that
 * reach them. No network — the index is text and the join runs here. */
import fs from 'node:fs';
import { joinByName } from '../api/lib/matching.js';

const idx = JSON.parse(fs.readFileSync(ROOT + '/api/atlas-builders/places/index.json', 'utf8'));
const py = fs.readFileSync(ROOT + '/api/atlas-builders/places.py', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const matching = fs.readFileSync(ROOT + '/api/lib/matching.js', 'utf8');
const ranges = JSON.parse(fs.readFileSync(ROOT + '/api/atlas-builders/places/ranges-IND.geojson', 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the index holds names and ids, never shapes');
/* The point is not that the index is tiny, it is that it is text: 709 places
   in 388 KB of names against 2.5 MB of the shapes it points at, and the shapes
   are fetched only when a region reaches them. */
const idxBytes = fs.statSync(ROOT + '/api/atlas-builders/places/index.json').size;
const shapeBytes = fs.statSync(ROOT + '/api/atlas-builders/places/ranges-IND.geojson').size +
                   fs.statSync(ROOT + '/api/atlas-builders/places/reserves-IND.geojson').size;
check('the index is a fraction of the shapes it points at', idxBytes < shapeBytes / 3, true);
check('no geometry anywhere in it', /"coordinates"/.test(JSON.stringify(idx)), false);
check('every place says where its shape comes from',
  idx.places.every((p) => p.source && p.id && idx.sources[p.source]), true);
check('and carries a box, so a build can choose without fetching',
  idx.places.every((p) => Array.isArray(p.bbox) && p.bbox.length === 4), true);
check('and a credit and a licence', idx.places.every((p) => p.credit && p.licence), true);
/* fetching by NAME is what puts Jeevan Bhima Nagar in Chennai */
check('every id is an id, not a name',
  idx.places.every((p) => p.source !== 'osm' || /^[NWR]\d+$/.test(p.id)), true);

console.log('\n  the five places Mithun named are reachable by the name he wrote');
/* Reachable by NAME OR ALIAS, which is the point: the official name of BRT is
   four words longer than anything anybody writes, and the index carries both. */
const reaches = (n) => idx.places.some((p) => p.name === n || (p.aliases || []).includes(n));
['Western Ghats', 'Eastern Ghats', 'BRT Tiger Reserve', 'Jeevan Bhima Nagar', 'Beas Conservation Reserve']
  .forEach((n) => check(n, reaches(n), true));
check('and BRT is filed under its official name', idx.places.some((p) =>
  p.name === 'Biligiri Rangaswami Temple Wildlife Sanctuary'), true);

console.log('\n  and the index is now the whole national list');
check('705 protected areas plus the rest', idx.places.length > 700, true);
check('still no geometry in it', /"coordinates"/.test(JSON.stringify(idx)), false);
/* every reserve gets the names its own designation earns, never the bare stem —
   "Bor" alone finds a sanctuary in the wrong state */
const bor = idx.places.find((p) => p.name === 'Bor Wildlife Sanctuary');
check('a reserve carries its designation variants', !!bor && bor.aliases.includes('Bor WLS'), true);
check('and never its bare stem', !!bor && !bor.aliases.includes('Bor'), true);

console.log('\n  and the names a rule could never derive are written by hand');
/* "BRT" cannot be generated from "Biligiri Rangaswami Temple", and nobody
   writes the official name. */
const brt = idx.places.find((p) => p.name === 'Biligiri Rangaswami Temple Wildlife Sanctuary');
check('BRT reaches the sanctuary', !!brt && brt.aliases.includes('BRT Tiger Reserve'), true);
check('so does the dotted spelling', !!brt && brt.aliases.includes('B.R.T. Wildlife Sanctuary'), true);
/* deliberately not the bare initialism: BRT is also bus rapid transit */
check('but the bare initialism is not an alias', !!brt && !brt.aliases.includes('BRT'), true);
const extra = JSON.parse(fs.readFileSync(ROOT + '/api/atlas-builders/places/aliases-extra.json', 'utf8'));
check('the hand-written ones are kept apart from the generated ones',
  Object.keys(extra.aliases).length > 5, true);

console.log('\n  the ranges ship with the atlas, because there is no per-range service');
check('India’s ranges are one committed file', ranges.features.length > 100, true);
check('the Ghats are in it', ['Western Ghats', 'Eastern Ghats']
  .every((n) => ranges.features.some((f) => f.properties.name === n)), true);
/* "Countries contains India" also matches Central Asia and the Tibetan
   Plateau; a continent is not a range anybody writes in a survey */
check('and continents are not', ranges.features.some((f) => /Asia|Tibetan Plateau/.test(f.properties.name)), false);
check('small enough to commit', fs.statSync(ROOT + '/api/atlas-builders/places/ranges-IND.geojson').size < 2000000, true);

console.log('\n  only what a region reaches is fetched, and only by id');
check('the build filters on the box first', /def within\(bbox\)/.test(py) && /Reads no geometry at all/.test(py), true);
check('a point is never drawn as an area', /g if g and g\.get\("type"\) in \("Polygon", "MultiPolygon"\) else None/.test(py), true);
check('every fetch is cached', /if not \(os\.path\.exists\(dest\) and os\.path\.getsize\(dest\) > 0\):/.test(py), true);
check('and paced, because the service asks for that', /POLITE_GAP_S = 1\.1/.test(py), true);
check('a place that cannot be fetched is not a build that fails',
  /Never raises: a place that cannot be\n    fetched is a place the atlas does without/.test(py), true);

console.log('\n  and the names people write reach the shapes');
const targets = [
  { code: '0', name: 'Biligiri Ranganatha Swamy Temple Wildlife Sanctuary',
    aliases: ['BRT Tiger Reserve', 'B.R.T. Wildlife Sanctuary'], parent: 'Karnataka' },
  { code: '1', name: 'Western Ghats', aliases: ['Sahyadri'], parent: '' },
];
const hit = (s) => {
  const r = joinByName([{ p: s }], 'p', null, targets)[0];
  return r.match == null ? null : targets[Number(r.match)].name;
};
check('the name everybody writes finds the official one',
  hit('BRT Tiger Reserve'), 'Biligiri Ranganatha Swamy Temple Wildlife Sanctuary');
check('so does the abbreviated spelling', hit('B.R.T. Wildlife Sanctuary'),
  'Biligiri Ranganatha Swamy Temple Wildlife Sanctuary');
check('and the local name of a range', hit('Sahyadri'), 'Western Ghats');
check('something not in the index still matches nothing', hit('Somewhere Else Entirely'), null);
check('the join indexes aliases as exact keys', /for \(const alt of \[t\.name, \.\.\.\(Array\.isArray\(t\.aliases\) \? t\.aliases : \[\]\)\]\)/.test(matching), true);
check('the sentence scan sees them too', /for \(const nm of \[t\.name, \.\.\.\(t\.aliases \|\| \[\]\)\]\)/.test(server), true);
check('and targets carry them off the feature', /aliases: Array\.isArray\(f\.properties\.aliases\)/.test(server), true);

console.log('\n  a row finds the most specific boundary that knows its name');
/* One survey, measured: ten state outlines placed 8 of 12, two hundred named
   places placed 5 of 12, and they were not the same rows. Joining to one
   layer loses whichever half you did not pick. */
check('every boundary layer goes on the ladder', /for \(const opt of \(boundaryOptions\(session\.dataset\)\.options \|\| \[\]\)\)/.test(server), true);
check('ordered by how small its shapes are', /ladder\.sort\(\(a, b\) => a\._size - b\._size\);/.test(server), true);
check('a layer somebody chose by hand still leads', /if \(session\.joinLayerExplicit\) \{/.test(server), true);
check('and choosing one is recorded as a choice', /session\.joinLayerExplicit = true;/.test(server), true);
check('a miss falls to the next layer', /const other = elsewhere\(res\.name\);/.test(server), true);
/* a name meaning several places on a rung is a question, not an answer */
check('but only when that layer is sure', /const c = rungs\[i\]\.index\.get\(sp\);\s*\n\s*if \(c && c\.length === 1\)/.test(server), true);
check('and it is counted and named', /report\.fromOtherLayer = \(report\.fromOtherLayer \|\| 0\) \+ 1;/.test(server), true);

console.log('\n  and OpenStreetMap boundaries say what licence they carry');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
/* ODbL is share-alike: attribution alone does not satisfy it. */
check('the notice exists', /Open Database Licence/.test(viewer), true);
check('it says the files are covered too', /as are the files it is served from/.test(viewer), true);
check('shown only on an atlas that carries such a layer',
  /\/openstreetmap\/i\.test\(String\(L\.attribution \|\| ""\)\)/.test(viewer), true);
check('and it has somewhere to go', /id="odbl-note"/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
