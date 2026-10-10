/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* LOKA finds questions for areas too (October 2026). Until then only a layer
   of pins was read; a layer of areas with rich answers on every row got no
   questions at all. Now one rule decides for every atlas: a contributed layer
   is read when its places wear a marker (pins, and areas since they wear the
   same one) and it carries words of its own — not just the names of the
   outlines it was joined by.

   Three parts. The rule, run for real. The router, read from its source: an
   area's shapes travel with its rows when a reading writes, the layer comes
   back as it was, and a layer put back keeps its twin. And the whole road,
   on a real server with the stand-in reading, on two throwaway atlases of
   areas kept in a throwaway data folder: the shapes survive, the answers
   land, the bare outlines are left alone. The last part needs
   api/node_modules; where that is missing it says so and counts those checks
   as failed rather than quietly skipping them. */
const RULES = createRequire(import.meta.url)(ROOT + '/atlas/reading-rules.js');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const script = fs.readFileSync(ROOT + '/deploy/queue-question-readings.mjs', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the rule: places that wear a marker');
check('a layer of pins', RULES.wearsMarks({ type: 'marker' }), true);
check('a layer of areas with the mark at its middle', RULES.wearsMarks({ type: 'fill', centreMarks: true }), true);
check('a polygon layer the same', RULES.wearsMarks({ type: 'polygon', centreMarks: true }), true);
check('areas without the mark: the viewer gives them no marker, so no key could show', RULES.wearsMarks({ type: 'fill' }), false);
check('a line has no marker yet', RULES.wearsMarks({ type: 'line', centreMarks: true }), false);
check('nothing is nothing', RULES.wearsMarks(null), false);

console.log('\n  the rule: words of its own');
const notes = [{ name: 'North Ward', notes: 'a pond by the old school' }, { name: 'South Ward', notes: 'busy market by the river' }];
const bare = [{ name: 'North Ward' }, { name: 'South Ward' }];
check('names with spaces alone pass the word test (that is the trap)', RULES.wordColumns(bare), ['name']);
check('so bare outlines joined by name are not worth reading', RULES.worthReading({ popup: { title: 'name' } }, bare), false);
check('nor are bare pins', RULES.worthReading({ type: 'marker' }, bare), false);
check('a column of notes beside the name is', RULES.worthReading({ popup: { title: 'name' } }, notes), true);
check('the card\'s title column is the name column, whatever it is called',
  RULES.worthReading({ popup: { title: 'Ward' } }, [{ Ward: 'North Ward' }, { Ward: 'South Ward' }]), false);
check('and "name" is assumed when the layer says nothing', RULES.worthReading({}, bare), false);

console.log('\n  the router reads by the shared rule');
check('considerReading asks the rule, not the type', /if \(!RULES\.wearsMarks\(layer\)\) return 'no marks';/.test(server), true);
check('and asks for words of the layer\'s own', /if \(!rows\.length \|\| !RULES\.worthReading\(layer, rows\)\) return 'no words';/.test(server), true);
check('the owner\'s door opens by the same rule', /if \(!L \|\| !RULES\.wearsMarks\(L\) \|\| !L\.userLayer\) return;/.test(owner), true);
check('so does the one-off for atlases read before this',
  /if \(!RULES\.wearsMarks\(L\)\) continue;/.test(script) && /if \(!RULES\.worthReading\(L, rows\)\) continue;/.test(script), true);

console.log('\n  an area\'s shapes travel with its rows when a reading writes');
check('a pin\'s rows carry their own coordinates and keep the path they had', /if \(!layer \|\| layer\.type === 'marker'\) return \{\};/.test(server), true);
for (const fn of ['writeReading', 'restoreAnswers', 'writeNothingHere']) {
  const at = server.indexOf('async function ' + fn + '(');
  const body = server.slice(at, server.indexOf('\n}\n', at));
  check(fn + ' hands the shapes to ingest, row for row',
    /const shapes = shapesFor\(/.test(body) && /geoms: shapes\.geoms, geomIdx: shapes\.geomIdx,/.test(body) &&
    /geometry: shapes\.geometry/.test(body), true);
}
check('runReading tells the write which layer it read', /dataset, layer, layerId, rows, questions: out\.questions,/.test(server), true);
check('on the shapes path a replaced layer keeps its own choices, as it does on the joined path',
  /const kept = session\.replacingSpec \|\|\n\s*\(replacing \? specOfLayer\(replacing\.prior, replacing\.id, rows, columns\) : null\);\n\s*session\.spec = kept \? Object\.assign\(\{\}, fresh, kept\) : fresh;/.test(server), true);
check('the owner\'s "edit this layer" starts from the same answer', /const spec = specOfLayer\(layer, layerId, rows, columns\);/.test(server), true);
check('a replaced layer\'s credits travel with it, for the stanza to keep where it has none',
  /credits: Array\.isArray\(prior\.credits\) && prior\.credits\.length \? prior\.credits : null,\n\s*attribution: prior\.attribution \|\| '' \};/.test(server), true);
check('a layer put back keeps its twin',
  /const twinBefore = session\.replacingLayerId && !session\.pointRows && !session\.pointsLayerId/.test(server) &&
  /imports\.pairLayers\(session\.dataset, layerId, pointsLayerId \|\| twinBefore\);/.test(server), true);

/* ---------------- the whole road, on a real server ---------------- */

/* Ten squares a few kilometres across, near Bengaluru. Every row has a name
   and a line of notes; some of the notes mention water, which is the one
   thing the stand-in reading looks for. */
function squares(n, dx) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = 77.5 + dx + (i % 5) * 0.05, y = 12.9 + Math.floor(i / 5) * 0.05;
    out.push([[x, y], [x + 0.04, y], [x + 0.04, y + 0.04], [x, y + 0.04], [x, y]]);
  }
  return out;
}
const NOTES = [
  'a pond by the old school, dry by March', 'busy market square at dawn', 'the lake path is walked every evening',
  'a row of old houses and a temple', 'the well is shared by six families', 'new flats, no trees left',
  'a stream runs under the main road', 'the bus stand and a tea shop', 'a tank that fills in the monsoon', 'quiet lanes, two schools',
];
const fc = (rings, props) => ({ type: 'FeatureCollection',
  features: rings.map((r, i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [r] }, properties: props[i] })) });
const stanza = (id, label, extra) => Object.assign({
  id, group: 'userdata', type: 'fill', source: 'user-' + id + '.geojson', label, default: true,
  paint: { fillColor: '#3A7FA1', fillOpacity: 0.45, outlineColor: '#5c544a', outlineWidth: 0.8 },
  centreMarks: true, legend: [{ color: '#3A7FA1', label }],
  popup: { title: 'name', fields: [{ label: 'Notes', property: 'notes' }] }, userLayer: true,
}, extra || {});
const manifest = (title) => ({ title, center: [77.6, 12.95], zoom: 10, groups: [{ id: 'userdata', label: 'Your data', open: true }],
  basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [] });

const PORT = 8600 + Math.floor(Math.random() * 300);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-area-questions-'));
const PRIV = path.join(DATA, 'private-datasets');
const ONE = 'area-check-one', TWO = 'area-check-two';
function mkAtlas(slug, title, layers, files) {
  const d = path.join(PRIV, slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify(manifest(title)));
  fs.writeFileSync(path.join(d, 'manifest.local.json'), JSON.stringify({ layers }, null, 1));
  for (const [f, gj] of Object.entries(files)) fs.writeFileSync(path.join(d, f), JSON.stringify(gj));
}
// one: ten areas with notes; and the same ten without the mark at their middle (an old layer)
const names = (dx) => NOTES.map((_, i) => 'Ward ' + (dx ? 'B' : 'A') + (i + 1));
mkAtlas(ONE, 'Area check one',
  [stanza('wards', 'Wards'), stanza('old-wards', 'Old wards', { centreMarks: undefined })],
  { 'user-wards.geojson': fc(squares(10, 0), NOTES.map((n, i) => ({ name: names(0)[i], notes: n }))),
    'user-old-wards.geojson': fc(squares(10, 0.3), NOTES.map((n, i) => ({ name: names(1)[i], notes: n }))) });
// two: outlines joined by name carrying nothing else; and areas with notes that have a twin of points
mkAtlas(TWO, 'Area check two',
  [stanza('bare', 'Bare outlines', { popup: { title: 'name', fields: [] } }),
   stanza('zones', 'Zones', { sameFileAs: 'zones-points',
     credits: [{ name: 'geoBoundaries', url: 'https://www.geoboundaries.org', license: 'CC BY 4.0' }], attribution: 'geoBoundaries' }),
   { id: 'zones-points', group: 'userdata', type: 'marker', source: 'user-zones-points.geojson', label: 'Zones · as points',
     default: true, userLayer: true, sameFileAs: 'zones', popup: { title: 'name', fields: [{ label: 'Notes', property: 'notes' }] } }],
  { 'user-bare.geojson': fc(squares(6, 0), [0, 1, 2, 3, 4, 5].map((i) => ({ name: 'Ward ' + ['North', 'South', 'East', 'West', 'Old', 'New'][i] }))),
    'user-zones.geojson': fc(squares(10, 0.3), NOTES.map((n, i) => ({ name: 'Zone ' + (i + 1), notes: n }))),
    'user-zones-points.geojson': { type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [77.9, 12.9] }, properties: { name: 'Zone 11', notes: 'a pond on the edge of town', latitude: 12.9, longitude: 77.9 } }] } });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [ONE]: { slug: ONE, title: 'Area check one', visibility: 'private', status: 'published', email: 'owner@example.test', tier: 'india', layers: [], createdAt: 1 },
               [TWO]: { slug: TWO, title: 'Area check two', visibility: 'private', status: 'published', email: 'owner@example.test', tier: 'india', layers: [], createdAt: 1 } },
  accounts: { 'owner@example.test': { email: 'owner@example.test', instances: [ONE, TWO], verifiedAt: 1 } }, drafts: {},
}));

let child = null, out = '';
function cleanup() {
  if (child && child.exitCode == null) { try { child.kill('SIGTERM'); } catch {} }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
const readLocal = (slug) => JSON.parse(fs.readFileSync(path.join(PRIV, slug, 'manifest.local.json'), 'utf8')).layers;
const readFile = (slug, f) => JSON.parse(fs.readFileSync(path.join(PRIV, slug, f), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function road() {
  console.log('\n  the one-off lists the areas, and the bare outlines are left alone');
  const qf = path.join(DATA, 'question-readings.json');
  const run = (...extra) => spawnSync(process.execPath,
    [ROOT + '/deploy/queue-question-readings.mjs', PRIV, '--registry', path.join(DATA, 'registry.json'), '--queue', qf, ...extra], { encoding: 'utf8' });
  const dry = run();
  check('one: the wards with the mark, as areas', new RegExp(ONE + '/wards — Wards — 10 areas, reading ').test(dry.stdout), true);
  check('two: the zones, and their twin of points', new RegExp(TWO + '/zones — Zones — 10 areas').test(dry.stdout) &&
    new RegExp(TWO + '/zones-points — ').test(dry.stdout), true);
  check('not the old wards, not the bare outlines', /old-wards|\/bare /.test(dry.stdout), false);
  const wet = run('--apply');
  check('--apply puts the three on the list', /3 added/.test(wet.stdout), true);

  console.log('\n  the server reads them with the stand-in, and the shapes survive');
  if (!fs.existsSync(path.join(ROOT, 'api', 'node_modules'))) {
    for (const w of ['the server started', 'the wards were read', 'the shapes are still polygons', 'the zones kept their twin']) {
      check(w + ' (api/node_modules is missing, so this could not run)', false, true);
    }
    return;
  }
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', ATLAS_FAKE_READING_MS: '0', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) { check('the server started', out.slice(-600), 'listening'); return; }
    await sleep(100);
  }
  check('the server started, with three readings waiting', /\[questions\] 3 readings waiting/.test(out), true);
  const done = () => { try { const q = JSON.parse(fs.readFileSync(qf, 'utf8')); return Object.values(q).every((r) => r.state !== 'queued' && r.state !== 'running'); } catch { return false; } };
  const t1 = Date.now();
  while (!done() && Date.now() - t1 < 30000) await sleep(200);
  const q = JSON.parse(fs.readFileSync(qf, 'utf8'));
  check('all three were read', Object.values(q).map((r) => r.state), ['done', 'done', 'done']);
  if (Object.values(q).some((r) => r.state !== 'done')) console.log(out.split('\n').filter((l) => /questions|atlas\]/.test(l)).slice(-12).join('\n'));

  const wards = readLocal(ONE).find((l) => l.id === 'wards');
  const wardsGJ = readFile(ONE, wards.source);
  check('the wards carry questions', Object.keys(wards.keyLabels || {}).filter((k) => /^pattern_\d+$/.test(k)).length > 0, true);
  check('every area answered', wardsGJ.features.every((f) => typeof f.properties.pattern_1 === 'string'), true);
  check('the shapes are still polygons, all ten, in the same order',
    [wardsGJ.features.length, wardsGJ.features.every((f) => f.geometry && f.geometry.type === 'Polygon'),
     wardsGJ.features.map((f) => f.properties.name).join()], [10, true, names(0).join()]);
  check('and the same polygons', wardsGJ.features[3].geometry.coordinates[0][0], squares(10, 0)[3][0]);
  check('the layer came back as it was: areas, with the mark, its colour, its card',
    [wards.type, wards.centreMarks, wards.paint && wards.paint.fillColor, wards.popup && wards.popup.title, wards.label],
    ['fill', true, '#3A7FA1', 'name', 'Wards']);
  const old = readLocal(ONE).find((l) => l.id === 'old-wards');
  check('the old wards were left exactly alone', [old.keyLabels, old.patternsNone, Object.keys(readFile(ONE, old.source).features[0].properties)],
    [undefined, undefined, ['name', 'notes']]);

  const zones = readLocal(TWO).find((l) => l.id === 'zones');
  const twin = readLocal(TWO).find((l) => l.id === 'zones-points');
  check('the zones were read and are still polygons', [Object.keys(zones.keyLabels || {}).length > 0,
    readFile(TWO, zones.source).features.every((f) => f.geometry.type === 'Polygon')], [true, true]);
  check('the zones kept their twin, and the twin kept them', [zones.sameFileAs, twin.sameFileAs], ['zones-points', 'zones']);
  check('and kept the credit for whose outlines these are', [(zones.credits || []).map((c) => c.name), zones.attribution], [['geoBoundaries'], 'geoBoundaries']);
  const bareL = readLocal(TWO).find((l) => l.id === 'bare');
  check('the bare outlines were not read, not even to find nothing', [bareL.keyLabels, bareL.patternsNone, q[TWO + '|bare']], [undefined, undefined, undefined]);
}

await road();
cleanup();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
