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
check('it is small enough to read', fs.statSync(ROOT + '/api/atlas-builders/places/index.json').size < 20000, true);
check('no geometry anywhere in it', /"coordinates"/.test(JSON.stringify(idx)), false);
check('every place says where its shape comes from',
  idx.places.every((p) => p.source && p.id && idx.sources[p.source]), true);
check('and carries a box, so a build can choose without fetching',
  idx.places.every((p) => Array.isArray(p.bbox) && p.bbox.length === 4), true);
check('and a credit and a licence', idx.places.every((p) => p.credit && p.licence), true);
/* fetching by NAME is what puts Jeevan Bhima Nagar in Chennai */
check('every id is an id, not a name',
  idx.places.every((p) => p.source !== 'osm' || /^[NWR]\d+$/.test(p.id)), true);

console.log('\n  the five places Mithun named are in it');
['Western Ghats', 'Eastern Ghats', 'BRT Tiger Reserve', 'Jeevan Bhima Nagar', 'Beas Conservation Reserve']
  .forEach((n) => check(n, idx.places.some((p) => p.name === n), true));

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

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
