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
import { fileSignatureOf } from '../api/lib/atlas/questions-queue.js';
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
  /if \(!RULES\.wearsMarks\(L\)\) continue;/.test(script) && /if \(!halves\.some\(\(h\) => RULES\.worthReading\(h\.layer, h\.rows\)\)\) continue;/.test(script), true);

console.log('\n  an area\'s shapes travel with its rows when a reading writes');
check('a pin\'s rows carry their own coordinates and keep the path they had', /if \(!layer \|\| layer\.type === 'marker'\) return \{\};/.test(server), true);
for (const fn of ['writeReading', 'restoreAnswers', 'writeNothingHere']) {
  const at = server.indexOf('async function ' + fn + '(');
  const body = server.slice(at, server.indexOf('\n}\n', at));
  check(fn + ' hands the shapes to ingest, row for row',
    /const shapes = shapesFor\(/.test(body) && /geoms: shapes\.geoms, geomIdx: shapes\.geomIdx,/.test(body) &&
    /geometry: shapes\.geometry/.test(body), true);
}
check('runReading writes each half of the file it read its own share', /writeReadingToHalves\(\{\s*dataset, halves, questions: out\.questions,/.test(server) &&
  /dataset, layer: h\.layer, layerId: h\.layer\.id, rows: h\.rows, questions: mine,/.test(server), true);
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
const ADMIN = 'check-admin-' + Math.random().toString(36).slice(2);
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
  [stanza('wards', 'Wards', { credits: [{ name: 'geoBoundaries', url: 'https://www.geoboundaries.org', license: 'CC BY 4.0' }], attribution: 'geoBoundaries' }),
   stanza('old-wards', 'Old wards', { centreMarks: undefined })],
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
  check('two: the zones are read once, through their twin of points', new RegExp(TWO + '/zones — ').test(dry.stdout) === false &&
    new RegExp(TWO + '/zones-points — ').test(dry.stdout), true);
  check('not the old wards, not the bare outlines', /old-wards|\/bare /.test(dry.stdout), false);
  const wet = run('--apply');
  check('--apply puts the two on the list', /2 added/.test(wet.stdout), true);

  console.log('\n  the server reads them with the stand-in, and the shapes survive');
  if (!fs.existsSync(path.join(ROOT, 'api', 'node_modules'))) {
    for (const w of ['the server started', 'the wards were read', 'the shapes are still polygons', 'the zones kept their twin']) {
      check(w + ' (api/node_modules is missing, so this could not run)', false, true);
    }
    return;
  }
  // the stand-in takes a moment over each reading, so a change can land while one runs (below)
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', ATLAS_FAKE_READING_MS: '1200', NODE_ENV: 'test', ATLAS_ADMIN_TOKEN: ADMIN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) { check('the server started', out.slice(-600), 'listening'); return; }
    await sleep(100);
  }
  check('the server started, with two readings waiting', /\[questions\] 2 readings waiting/.test(out), true);
  const done = () => { try { const q = JSON.parse(fs.readFileSync(qf, 'utf8')); return Object.values(q).every((r) => r.state !== 'queued' && r.state !== 'running'); } catch { return false; } };
  const t1 = Date.now();
  while (!done() && Date.now() - t1 < 30000) await sleep(200);
  const q = JSON.parse(fs.readFileSync(qf, 'utf8'));
  // the two on the list, and the zones' outlines noted as done by their pins' reading
  check('both were read', [ONE + '|wards', TWO + '|zones-points', TWO + '|zones'].map((k) => q[k] && q[k].state), ['done', 'done', 'done']);
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
  check('and kept the credit for whose outlines these are', [(wards.credits || []).map((c) => c.name), wards.attribution], [['geoBoundaries'], 'geoBoundaries']);
  const old = readLocal(ONE).find((l) => l.id === 'old-wards');
  check('the old wards were left exactly alone', [old.keyLabels, old.patternsNone, Object.keys(readFile(ONE, old.source).features[0].properties)],
    [undefined, undefined, ['name', 'notes']]);

  const zones = readLocal(TWO).find((l) => l.id === 'zones');
  const twin = readLocal(TWO).find((l) => l.id === 'zones-points');
  /* The file was read ONCE, through its pins, and both halves got their share:
     the halves hold different rows (ten zones, one point), so the outlines are
     answered by the same reading rather than copied or read again. */
  const zonesGJ = readFile(TWO, zones.source);
  check('the zones were read with their pins, once: the same questions on both halves, still polygons',
    [Object.keys(zones.keyLabels || {}).length > 0, zones.keyLabels, q[TWO + '|zones'] && q[TWO + '|zones'].state,
     zonesGJ.features.every((f) => f.geometry.type === 'Polygon')], [true, twin.keyLabels, 'done', true]);
  check('every zone answered the first question, and the point did too',
    [zonesGJ.features.every((f) => typeof f.properties.pattern_1 === 'string' && f.properties.pattern_1),
     readFile(TWO, twin.source).features[0].properties.pattern_1], [true, 'A short note']);
  check('the pond on the edge of town mentions water; the zones answer that question for themselves',
    [readFile(TWO, twin.source).features[0].properties.pattern_2, zonesGJ.features.filter((f) => f.properties.pattern_2 === 'Mentions water').length],
    ['Mentions water', NOTES.filter((n) => /water|river|lake|pond|well|stream|tank/i.test(n)).length]);
  check('their twin of points carries the questions', Object.keys(twin.keyLabels || {}).length > 0, true);
  check('the zones kept their twin, and the twin kept them', [zones.sameFileAs, twin.sameFileAs], ['zones-points', 'zones']);
  check('and the zones kept their credit', [(zones.credits || []).map((c) => c.name), zones.attribution], [['geoBoundaries'], 'geoBoundaries']);
  const bareL = readLocal(TWO).find((l) => l.id === 'bare');
  check('the bare outlines were not read, not even to find nothing', [bareL.keyLabels, bareL.patternsNone, q[TWO + '|bare']], [undefined, undefined, undefined]);

  /* ONE FILE, ONE VERSION. The outlines half of a split file is never on the
     list under its own name, so until this was fixed a change to the outlines
     alone was never read: the pins had not changed, nothing offered them, and
     the new places counted as unanswered for ever. Now the file's version is
     both halves' rows together, and a change to either half offers the file
     through its pins. Played out on the zones: the same rows put back (no
     reading, answers restored), one new zone on the outlines alone (read
     once, both halves answered), and a second change landing while that
     reading runs (dropped as changed, offered again, the newest rows read). */
  console.log('\n  one file, one version: a change to either half is read; the same rows back are not');
  const API = 'http://127.0.0.1:' + PORT + '/api/atlas';
  const admin = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN };
  const post = async (p, body) => {
    const r = await fetch(API + p, { method: 'POST', headers: admin, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  const readQ = () => JSON.parse(fs.readFileSync(qf, 'utf8'));
  const rec = (id) => readQ()[TWO + '|' + id] || {};
  const readings = () => (out.match(/\[questions\] reading /g) || []).length;
  const until = async (f, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(100); } return f(); };
  const settled = (ms) => until(done, ms);
  const busy = (s) => s === 'queued' || s === 'running';
  // the outlines put back the way a repair or "edit this layer" puts them: the
  // rows without their answers, the shapes row for row, the same layer id
  const putOutlines = async (rows, rings) => {
    const ing = await post('/layers/ingest', { dataset: TWO, replaceLayerId: 'zones', filename: 'Zones',
      schema: RULES.schemaFor(rows), rows, geoms: rings.map((r) => ({ type: 'Polygon', coordinates: [r] })), geomIdx: rows.map((_, i) => i),
      meta: { sourceName: 'user-zones.geojson', rowCount: rows.length, geometry: { class: 'polygon', count: rows.length, vertices: 0 } } });
    if (!ing.j.importId) return ing;
    return post('/layers/commit', { importId: ing.j.importId, dataset: TWO });
  };
  const zonesNow = () => readLocal(TWO).find((l) => l.id === 'zones');
  const twinNow = () => readLocal(TWO).find((l) => l.id === 'zones-points');
  const zoneFeats = () => readFile(TWO, zonesNow().source).features;
  const labelsBefore = JSON.stringify(zones.keyLabels);
  const rows0 = RULES.withoutAnswers(zoneFeats().map((f) => Object.assign({}, f.properties)));
  const rings0 = zoneFeats().map((f) => f.geometry.coordinates[0]);
  const allRings = squares(13, 0.3);

  // the same rows back
  let before = readings();
  let r = await putOutlines(rows0, rings0);
  check('the outlines put back with the same rows are accepted', r.status, 200);
  check('the list settles', await settled(10000), true);
  check('nothing was read: the answers were put back from the copy', [readings() - before, /zones — the same places again: answers put back, nothing read/.test(out)], [0, true]);
  check('the outlines carry their answers again, under the same questions', [zoneFeats().every((f) => typeof f.properties.pattern_1 === 'string' && f.properties.pattern_1),
    JSON.stringify(zonesNow().keyLabels) === labelsBefore], [true, true]);
  check('both halves\' records say done, under one fingerprint for the file', [rec('zones').state, rec('zones-points').state, rec('zones').sig === rec('zones-points').sig], ['done', 'done', true]);

  // a change to the outlines alone
  before = readings();
  const rows1 = rows0.concat([{ name: 'Zone 12', notes: 'a new tank by the lake, full after rain' }]);
  const rings1 = rings0.concat([allRings[10]]);
  r = await putOutlines(rows1, rings1);
  check('one new zone on the outlines alone is accepted', r.status, 200);
  check('the FILE is offered through its pins, not under the outlines\' own name', [busy(rec('zones-points').state), busy(rec('zones').state)], [true, false]);
  const list = await (await fetch(API + '/layers/list?dataset=' + TWO, { headers: admin })).json();
  check('and the owner\'s page says the outlines are being read too', [busy((((list.layers || []).find((l) => l.id === 'zones') || {}).questions || {}).state),
    busy((((list.layers || []).find((l) => l.id === 'zones-points') || {}).questions || {}).state)], [true, true]);
  check('the list settles', await settled(15000), true);
  check('the file was read once, through its pins', [readings() - before, (out.match(new RegExp('\\[questions\\] reading ' + TWO + '/zones-points', 'g')) || []).length - 1], [1, 1]);
  check('both halves got answers, the new zone too', [zoneFeats().length, zoneFeats().every((f) => typeof f.properties.pattern_1 === 'string' && f.properties.pattern_1),
    (zoneFeats().find((f) => f.properties.name === 'Zone 12') || { properties: {} }).properties.pattern_2,
    readFile(TWO, twinNow().source).features[0].properties.pattern_1], [11, true, 'Mentions water', 'A short note']);
  check('the same questions as before, on both halves', [JSON.stringify(zonesNow().keyLabels) === labelsBefore, JSON.stringify(twinNow().keyLabels) === labelsBefore], [true, true]);
  check('both records show the new version of the file', [rec('zones').state, rec('zones-points').state, rec('zones').sig === rec('zones-points').sig,
    rec('zones').sig === fileSignatureOf([{ layer: zonesNow(), rows: zoneFeats().map((f) => f.properties) },
      { layer: twinNow(), rows: readFile(TWO, twinNow().source).features.map((f) => f.properties) }], RULES.isAnswerColumn)], ['done', 'done', true, true]);
  check('the twin is kept through all of it', [zonesNow().sameFileAs, twinNow().sameFileAs], ['zones-points', 'zones']);

  // a change landing while the file is being read
  before = readings();
  const rows2 = rows1.map((x) => x.name === 'Zone 12' ? Object.assign({}, x, { notes: x.notes + ', and a well' }) : x);
  r = await putOutlines(rows2, rings1);
  check('a changed note on the outlines is accepted', r.status, 200);
  check('the reading starts', await until(() => rec('zones-points').state === 'running', 5000), true);
  const rows3 = rows2.concat([{ name: 'Zone 13', notes: 'dry scrub, nothing grows' }]);
  const rings3 = rings1.concat([allRings[11]]);
  r = await putOutlines(rows3, rings3);
  check('another zone added while that reading runs is accepted', r.status, 200);
  check('the list settles', await settled(20000), true);
  check('the first reading was dropped as changed, and the file offered again: two readings, both through the pins',
    [/zones-points — the places changed while they were being read|changed while they were being read/.test(out), readings() - before], [true, 2]);
  check('what was read is what is on disk now: twelve zones, every one answered, the dry one dry', [zoneFeats().length,
    zoneFeats().every((f) => typeof f.properties.pattern_1 === 'string' && f.properties.pattern_1),
    (zoneFeats().find((f) => f.properties.name === 'Zone 13') || { properties: {} }).properties.pattern_2 || ''], [12, true, '']);
  check('both records say done under the newest version, and no reading is owed', [rec('zones').state, rec('zones-points').state, rec('zones').sig === rec('zones-points').sig,
    Object.keys((() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'owed.json'), 'utf8')); } catch { return {}; } })()).length], ['done', 'done', true, 0]);
}

console.log('\n  one file added as two layers is read once, through its pins');
{
  const outlines = { id: 'wards', type: 'fill', centreMarks: true, sameFileAs: 'wards-pts' };
  const pins = { id: 'wards-pts', type: 'marker', sameFileAs: 'wards' };
  const both = [outlines, pins];
  check('the outlines twin is left to its pins', RULES.readByItsTwin(outlines, both), true);
  check('the pins twin is read', RULES.readByItsTwin(pins, both), false);
  check('an area layer with no twin is read', RULES.readByItsTwin({ id: 'a', type: 'fill', centreMarks: true }, [{ id: 'a' }]), false);
  check('a twin record pointing nowhere does not stop a reading', RULES.readByItsTwin({ id: 'a', type: 'fill', sameFileAs: 'gone' }, [{ id: 'a' }]), false);
  check('the server and the one-off script both ask it',
    /RULES\.readByItsTwin\(layer, layers\)/.test(fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8')) &&
    /RULES\.readByItsTwin\(L, local\.layers\)/.test(fs.readFileSync(ROOT + '/deploy/queue-question-readings.mjs', 'utf8')), true);
}

await road();
cleanup();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
