/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Adding a place source should be a row, not a function.
 *
 * It was three functions: one for files that ship with us, one for the
 * geocoder, one for the wetlands register. They differed in only two ways that
 * matter — where the answer comes from, and where the shape sits inside it —
 * and a fourth source meant writing a fifth function.
 *
 * Both of those are written down in the source row now. These checks prove it
 * by handing the reader answers shaped the way real services shape them,
 * INCLUDING a shape no source in the product uses, and watching it find the
 * geometry with nothing added to the code.
 *
 * Runs Python because the reader is Python. No network: every answer here is
 * made up on the spot.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDERS = ROOT + '/api/atlas-builders';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* A square, so a geometry that came back is recognisable. */
const SQUARE = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const DOT = { type: 'Point', coordinates: [0.5, 0.5] };

/* Hand the reader a document and a declaration; get back what it found. */
function read(doc, entry, declaration) {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(BUILDERS)})
import places
doc, entry, read = json.loads(sys.argv[1]), json.loads(sys.argv[2]), json.loads(sys.argv[3])
print(json.dumps(places._shape_in(doc, entry, read)))
`;
  const out = execFileSync('python3', ['-c', script,
    JSON.stringify(doc), JSON.stringify(entry), JSON.stringify(declaration)],
    { encoding: 'utf8' });
  return JSON.parse(out);
}

console.log('\n  the three shapes of answer the product already meets');

check('a collection, first one wins — the wetlands register',
  read({ type: 'FeatureCollection', features: [{ properties: {}, geometry: SQUARE }] },
    { name: 'anywhere' }, { in: 'features' }),
  SQUARE);

check('a collection matched by name — a file that ships with us',
  read({ features: [
    { properties: { name: 'Elsewhere' }, geometry: DOT },
    { properties: { name: 'Here' }, geometry: SQUARE }] },
    { name: 'Here' }, { in: 'features', match: 'name' }),
  SQUARE);

check('a plain list with the shape on a named key — the geocoder',
  read([{ osm_id: 1, geojson: SQUARE }], { name: 'x' },
    { in: 'list', geometry_at: 'geojson' }),
  SQUARE);

console.log('\n  and shapes no source in the product uses, added by declaring them');

check('the answer IS the geometry',
  read(SQUARE, { name: 'x' }, { in: 'geometry' }), SQUARE);

check('a list under a key of its own',
  read({ results: [{ shape: SQUARE }] }, { name: 'x' },
    { in: 'list', at: 'results', geometry_at: 'shape' }),
  SQUARE);

check('a shape buried two levels down',
  read([{ data: { outline: SQUARE } }], { name: 'x' },
    { in: 'list', geometry_at: 'data.outline' }),
  SQUARE);

console.log('\n  the things that used to be written into one fetcher each');

check('the position is used when the list knows it',
  read({ features: [
    { properties: { name: 'Twice' }, geometry: DOT },
    { properties: { name: 'Twice' }, geometry: SQUARE }] },
    { name: 'Twice', at: 1 }, { in: 'features', match: 'name' }),
  SQUARE);

check('a position that no longer matches falls back to searching',
  read({ features: [
    { properties: { name: 'Moved' }, geometry: SQUARE },
    { properties: { name: 'Other' }, geometry: DOT }] },
    { name: 'Moved', at: 1 }, { in: 'features', match: 'name' }),
  SQUARE);

check('nothing found is nothing returned, not a crash',
  read({ features: [] }, { name: 'x' }, { in: 'features' }), null);

/* areas_only is applied by geometry_for, not by the reader, so it is checked
   on the real thing — with a source row invented here and no code touched. */
function fetchWith(sources, entry) {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(BUILDERS)})
import places
sources, entry = json.loads(sys.argv[1]), json.loads(sys.argv[2])
print(json.dumps(places.geometry_for(entry, sources, sys.argv[3])))
`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-src-'));
  const out = execFileSync('python3', ['-c', script,
    JSON.stringify(sources), JSON.stringify(entry), tmp], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  /* A refusal says why before it answers — "no source called 'nosuchthing'" —
     and that line is the point of the check below, not noise to suppress. The
     answer is the last line. */
  const lines = out.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

console.log('\n  a source invented in this file, with nothing added to the code');

/* Points at a file that ships with us, but under a source name the product has
   never heard of and with its own way of reading the answer. If this resolves,
   a new source really is a row. */
const INVENTED = {
  madeup: {
    label: 'invented for this check',
    fetch: 'ranges-IND.geojson',
    read: { in: 'features', match: 'name' },
    credit: 'nobody',
    licence: 'none',
  },
};
const got = fetchWith(INVENTED, { name: 'Aravalli Range', source: 'madeup', id: 'ranges-IND.geojson' });
check('it fetched a real shape through a source that did not exist before',
  got && got.type, 'MultiPolygon');

console.log('\n  a point offered where an outline was wanted');
const FUSSY = { ...INVENTED, madeup: { ...INVENTED.madeup, read: { in: 'features', match: 'name', areas_only: true } } };
check('an outline still comes through when areas_only is asked for',
  (fetchWith(FUSSY, { name: 'Aravalli Range', source: 'madeup', id: 'ranges-IND.geojson' }) || {}).type,
  'MultiPolygon');
check('a source nobody declared is refused rather than guessed at',
  fetchWith({}, { name: 'x', source: 'nosuchthing', id: 'y' }), null);

console.log('\n  the wetlands register, which the new arrangement made reachable');
const builder = fs.readFileSync(BUILDERS + '/build_places_index.py', 'utf8');
check('it is pulled by a script that is kept',
  fs.existsSync(BUILDERS + '/pull_ramsar.py'), true);
check('from the layer that carries the site number, not the one called boundaries',
  /typeName=ramsar_sdi:features_published/.test(builder), true);
const puller = fs.readFileSync(BUILDERS + '/pull_ramsar.py', 'utf8');
check('and why the obvious layer was wrong is written down',
  /features_bnd, is the one\ncalled "boundaries"/.test(puller), true);
const idx = JSON.parse(fs.readFileSync(BUILDERS + '/places/index.json', 'utf8'));
const wet = idx.places.filter((p) => p.kind === 'wetland');
check('the wetlands are in the list', wet.length > 60, true);
check('every one of them says who to credit',
  wet.every((p) => p.credit === 'Ramsar Sites Information Service'), true);
for (const n of ['Hirakud Reservoir', 'Beas Conservation Reserve',
                 'Gulf of Mannar Marine Biosphere Reserve', 'Pichavaram Mangrove']) {
  check('“' + n + '” can be found', idx.places.some((p) => p.name === n), true);
}

/* What this register does NOT give us. India has around ninety designated
   wetlands and the service publishes outlines for seventy-five; the ones it
   leaves out include the most famous. Checking that they are still absent
   would only enshrine the gap — checking that the gap is WRITTEN DOWN is
   what stops somebody hunting for a bug that is really a missing source. */
check('the wetlands this register cannot give us are named in the puller',
  ['Chilika', 'Loktak', 'Keoladeo', 'Vembanad'].every((n) => puller.includes(n)), true);

console.log('\n  a place two registers both describe is listed once');
check('the rule is written down',
  /first register to carry a name keeps it/.test(builder), true);
const names = idx.places.map((p) => p.name.toLowerCase());
check('and no name is in the list twice',
  names.filter((n, i) => names.indexOf(n) !== i), []);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
