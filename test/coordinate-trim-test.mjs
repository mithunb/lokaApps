/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Uploaded layers are trimmed to six decimals, as the map builder trims its
   own: the rounding, the repeated points it creates, rings that stay closed
   and never shrink below a triangle, the commit path using it, and the one-off
   trim of files already on the server. The file checks write only into a
   temporary folder they remove. */
const { trimGeometry, trimFeatureCollection, COORD_DP } = await import(ROOT + '/api/lib/atlas/coords.js');
const trim = await import(ROOT + '/deploy/trim-uploaded-coordinates.mjs');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const decimals = (n) => { const s = String(n); return s.includes('.') ? s.split('.')[1].length : 0; };

console.log('\n  rounding');
check('six decimals, the same as the map builder', COORD_DP, 6);
check('a point loses its fifteen decimals',
  trimGeometry({ type: 'Point', coordinates: [83.78123456789012, 26.50198765432109] }).coordinates,
  [83.781235, 26.501988]);
check('negative coordinates round the same way',
  trimGeometry({ type: 'Point', coordinates: [-0.1234567891, -51.9876543219] }).coordinates, [-0.123457, -51.987654]);
check('a tiny negative does not become -0', Object.is(trimGeometry({ type: 'Point', coordinates: [-0.0000001, 1] }).coordinates[0], 0), true);
check('a height, if there is one, is rounded too',
  trimGeometry({ type: 'Point', coordinates: [1.12345678, 2.12345678, 30.123456789] }).coordinates, [1.123457, 2.123457, 30.123457]);
check('short numbers are left as they are',
  trimGeometry({ type: 'Point', coordinates: [77.5, 12.97] }).coordinates, [77.5, 12.97]);
const mp = trimGeometry({ type: 'MultiPoint', coordinates: [[1.1234567, 2.1234567], [1.1234567, 2.1234567]] });
check('separate points of a multipoint are all kept, even when equal', mp.coordinates.length, 2);

console.log('\n  lines');
const ln = trimGeometry({ type: 'LineString', coordinates: [[1, 1], [1.0000001, 1.0000001], [1.0000002, 1.0000002], [2, 2]] });
check('points the rounding makes equal are dropped', ln.coordinates, [[1, 1], [2, 2]]);
const ln2 = trimGeometry({ type: 'LineString', coordinates: [[1, 1], [1.0000001, 1.0000001]] });
check('a line never drops below two points', ln2.coordinates, [[1, 1], [1, 1]]);
const mls = trimGeometry({ type: 'MultiLineString', coordinates: [[[0, 0], [0.0000001, 0], [1, 1]], [[5, 5], [6, 6]]] });
check('each part of a multi-line is cleaned on its own', mls.coordinates, [[[0, 0], [1, 1]], [[5, 5], [6, 6]]]);

console.log('\n  outlines');
const sq = [[0, 0], [1, 0], [1.0000001, 0], [1, 1], [0, 1], [0.0000000001, 0.0000000001]];
const poly = trimGeometry({ type: 'Polygon', coordinates: [sq] }).coordinates[0];
check('a square with a near-repeat loses the repeat', poly, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
check('and stays closed', JSON.stringify(poly[0]) === JSON.stringify(poly[poly.length - 1]), true);
const tri = [[0, 0], [1, 0], [1.0000001, 0.0000001], [0, 0]];
const tr = trimGeometry({ type: 'Polygon', coordinates: [tri] }).coordinates[0];
check('a ring that would fall below four points keeps them all', tr.length, 4);
check('still rounded, and still closed', [tr[2], tr[0], tr[3]], [[1, 0], [0, 0], [0, 0]]);
const holed = trimGeometry({ type: 'Polygon', coordinates: [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[2, 2], [3, 2], [3.00000001, 2], [3, 3], [2, 2]],
] }).coordinates;
check('a hole is cleaned like the outline', holed[1], [[2, 2], [3, 2], [3, 3], [2, 2]]);
const mpoly = trimGeometry({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5.123456789, 5], [6, 5], [6, 6], [5.123456789, 5]]]] });
check('every polygon of a multipolygon is rounded', mpoly.coordinates[1][0][0], [5.123457, 5]);
const gc = trimGeometry({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1.23456789, 1] }] });
check('a geometry collection is walked', gc.geometries[0].coordinates, [1.234568, 1]);

console.log('\n  whole layers');
const layer = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Well', note: 'keeps 1.23456789 in its text' }, geometry: { type: 'Point', coordinates: [83.123456789, 26.987654321] } },
    { type: 'Feature', properties: { name: 'No place' }, geometry: null },
  ],
};
const snapshot = JSON.stringify(layer);
const out = trimFeatureCollection(layer);
check('the layer handed in is not changed', JSON.stringify(layer), snapshot);
check('properties are untouched, numbers in text too', out.features[0].properties, layer.features[0].properties);
check('a feature with no place stays, in its place', [out.features.length, out.features[1].geometry], [2, null]);
check('no coordinate keeps more than six decimals', out.features[0].geometry.coordinates.every((n) => decimals(n) <= 6), true);
check('trimming twice is the same as trimming once', JSON.stringify(trimFeatureCollection(out)), JSON.stringify(out));
check('an unknown shape is passed through', trimGeometry({ type: 'Circle', r: 1.23456789 }), { type: 'Circle', r: 1.23456789 });

console.log('\n  the upload path uses it');
const src = fs.readFileSync(ROOT + '/api/lib/atlas/imports.js', 'utf8');
check('the commit writes a trimmed layer',
  /JSON\.stringify\(trimFeatureCollection\(geojson\)\)/.test(src.slice(src.indexOf('export function commitLayer'), src.indexOf('export function dropSearchIndex'))), true);
check('the preview writes a trimmed layer too',
  /JSON\.stringify\(trimFeatureCollection\(geojson\)\)/.test(src.slice(src.indexOf('export function writeDraft'), src.indexOf('export function commitLayer'))), true);
check('no layer geojson is written untrimmed', /JSON\.stringify\(geojson\)/.test(src), false);

console.log('\n  the one-off trim of files already committed');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-trim-'));
try {
  const root = path.join(tmp, 'datasets');
  const big = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'a' }, geometry: { type: 'Point', coordinates: [83.78123456789012, 26.50198765432109] } },
    { type: 'Feature', properties: { name: 'b' }, geometry: { type: 'LineString', coordinates: [[1, 1], [1.00000001, 1.00000001], [2.123456789, 2]] } },
  ] });
  for (const slug of ['kolar', 'deoria-bioregion', 'deoria-bioregion--draft-abc']) {
    fs.mkdirSync(path.join(root, slug), { recursive: true });
    fs.writeFileSync(path.join(root, slug, 'user-finds.geojson'), big);
    fs.writeFileSync(path.join(root, slug, 'manifest.json'), '{"layers":[]}');
  }
  fs.mkdirSync(path.join(root, '.history'));
  const kolar = path.join(root, 'kolar', 'user-finds.geojson');

  const dry = trim.trimRoots([root, path.join(tmp, 'absent')]);
  check('a missing root is reported, not an error', dry.some((r) => r.missing), true);
  check('dry run finds the one file it may touch', dry.filter((r) => r.file).map((r) => r.slug), ['kolar']);
  check('dry run says it is smaller', dry.find((r) => r.slug === 'kolar').after < big.length, true);
  check('dry run writes nothing', [fs.readFileSync(kolar, 'utf8') === big, fs.existsSync(kolar + '.pre-trim.bak')], [true, false]);
  check('deoria and its previews are listed as skipped',
    dry.filter((r) => r.skipped).map((r) => r.slug), ['deoria-bioregion', 'deoria-bioregion--draft-abc']);

  trim.trimRoots([root], { apply: true });
  check('apply keeps the original beside it', fs.readFileSync(kolar + '.pre-trim.bak', 'utf8'), big);
  const done = JSON.parse(fs.readFileSync(kolar, 'utf8'));
  check('apply trims the file', done.features.map((f) => f.geometry.coordinates),
    [[83.781235, 26.501988], [[1, 1], [2.123457, 2]]]);
  check('names come through', done.features.map((f) => f.properties.name), ['a', 'b']);
  check('deoria is byte for byte what it was',
    ['deoria-bioregion', 'deoria-bioregion--draft-abc'].map((s) => fs.readFileSync(path.join(root, s, 'user-finds.geojson'), 'utf8') === big), [true, true]);
  check('deoria gets no backup file either', fs.existsSync(path.join(root, 'deoria-bioregion', 'user-finds.geojson.pre-trim.bak')), false);
  check('the manifest is not touched', fs.readFileSync(path.join(root, 'kolar', 'manifest.json'), 'utf8'), '{"layers":[]}');

  const again = trim.trimRoots([root], { apply: true }).find((r) => r.slug === 'kolar');
  check('running it again changes nothing', again.changed, false);
  check('and leaves no temporary file', fs.readdirSync(path.join(root, 'kolar')).sort(),
    ['manifest.json', 'user-finds.geojson', 'user-finds.geojson.pre-trim.bak']);
  fs.writeFileSync(kolar, '{broken');
  check('a broken file is an error for that file, not a crash', !!trim.trimRoots([root]).find((r) => r.error), true);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
