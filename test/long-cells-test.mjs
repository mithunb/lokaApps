/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* NOTHING shortens a cell between somebody's file and the stored layer.

   It was five hundred characters, in two places that did not know about each
   other, and a file of wildlife recordings came in with a list of 77 creatures
   heard at one place: the map was given 26 of them, the 26th halfway through
   its name, while the column counting them still said 77. Then it was a
   twenty-thousand-character ceiling. Now it is nothing at all (Mithun,
   24 Nov 2026) — a cell of any length is stored word for word, and the only
   thing that can still stop an upload is the size of the request, which is
   refused WHOLE, in plain words.

   Driven on the real road: the /layers/ingest route and the commit behind it,
   on a throwaway atlas in a temporary folder, with a 60,000-character
   paragraph, a 5,000-item list and a cell of a megabyte. Then the budgets
   downstream, each on its OWN copy, with that megabyte. */
import { sanitizeFeatures } from '../api/lib/fragment.js';
import { featureSearchText, layerVocabTerms } from '../api/lib/atlas/search-text.js';
import { buildDigest } from '../api/lib/atlas/enrich.js';
import { wanting, PROMPT_TEXT_MAX } from '../api/lib/atlas/place-names.js';
import { lay, toRow } from '../api/lib/atlas/loka-sync.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- the three cells ---------------- */
const NAMES = Array.from({ length: 77 }, (_, i) => 'Creature number ' + (i + 1) + ' of the night');
const LIST77 = NAMES.join('; ');
// a 5,000-item list and a 60,000-character paragraph: both far past every ceiling there ever was
const LIST5000 = Array.from({ length: 5000 }, (_, i) => 'Creature number ' + (i + 1)).join('; ');
const PROSE60K = Array.from({ length: 9000 }, (_, i) => 'word' + i).join(' ').slice(0, 60000);
// and one megabyte in a single cell
const MEGABYTE = ('A pond by the old school, dry by March, and the long walk around it. ').repeat(15700).slice(0, 1024 * 1024);
check('the list cell is five thousand items', LIST5000.split('; ').length, 5000);
check('the paragraph is sixty thousand characters', PROSE60K.length, 60000);
check('and the big one is a megabyte', MEGABYTE.length, 1024 * 1024);

console.log('\n  the one shared rule keeps a cell whole, at any length');
const feats = [{ type: 'Feature',
  properties: { name: 'A pond', animals_heard: LIST5000, note: PROSE60K, saga: MEGABYTE, likes: 7 },
  geometry: { type: 'Point', coordinates: [73.9, 19.45] } }];
const clean = sanitizeFeatures(feats, ['name', 'animals_heard', 'note', 'saga', 'likes'], null, 'keep');
check('one feature survives', clean.features.length, 1);
check('the list cell on the map equals the one uploaded', clean.features[0].properties.animals_heard, LIST5000);
check('the paragraph too', clean.features[0].properties.note, PROSE60K);
check('and the megabyte, byte for byte', clean.features[0].properties.saga.length, MEGABYTE.length);
check('every one of the 5,000 items is there', clean.features[0].properties.animals_heard.split('; ').length, 5000);
check('a number is still a number', clean.features[0].properties.likes, 7);
check('nothing is stored at exactly five hundred, or at twenty thousand',
  Object.values(clean.features[0].properties).some((v) => String(v).length === 500 || String(v).length === 20000), false);
check('and the module exports no ceiling for anyone to reach for',
  Object.keys(await import('../api/lib/fragment.js')).some((k) => /MAX_CELL|keepWholeCell/.test(k)), false);

/* ---------------- the real road: the ingest route and the commit ---------------- */
const PORT = 9100 + Math.floor(Math.random() * 200);
const ADMIN = 'long-cells-admin-' + Math.random().toString(36).slice(2);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-long-cells-'));
const PRIV = path.join(DATA, 'private-datasets');
const SLUG = 'long-cells-check';
fs.mkdirSync(path.join(PRIV, SLUG), { recursive: true });
fs.writeFileSync(path.join(PRIV, SLUG, 'manifest.json'), JSON.stringify({
  title: 'Long cells check', center: [77.6, 12.95], zoom: 10,
  groups: [{ id: 'userdata', label: 'Your data', open: true }],
  basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [] }));
fs.writeFileSync(path.join(PRIV, SLUG, 'manifest.local.json'), JSON.stringify({ layers: [] }));
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [SLUG]: { slug: SLUG, title: 'Long cells check', visibility: 'private', status: 'published',
    email: 'owner@example.test', tier: 'india', layers: [], createdAt: 1 } },
  accounts: { 'owner@example.test': { email: 'owner@example.test', instances: [SLUG], verifiedAt: 1 } }, drafts: {} }));

let child = null, out = '';
function cleanup() {
  if (child && child.exitCode == null) { try { child.kill('SIGKILL'); } catch {} }
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
const localLayers = () => JSON.parse(fs.readFileSync(path.join(PRIV, SLUG, 'manifest.local.json'), 'utf8')).layers || [];

async function road() {
  console.log('\n  the real road: the ingest route, the commit, and the file on disk');
  if (!fs.existsSync(path.join(ROOT, 'api', 'node_modules'))) {
    for (const w of ['the server started', 'the upload is accepted', 'the stored cells are the uploaded cells',
      'an upload too big to send is refused whole']) {
      check(w + ' (api/node_modules is missing, so this could not run)', false, true);
    }
    return;
  }
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', NODE_ENV: 'test', ATLAS_ADMIN_TOKEN: ADMIN },
    stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) { check('the server started', out.slice(-600), 'listening'); return; }
    await sleep(100);
  }
  check('the server started', true, true);

  const API = 'http://127.0.0.1:' + PORT + '/api/atlas';
  const post = async (p, bodyText) => {
    const r = await fetch(API + p, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN }, body: bodyText });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };
  const rows = [
    { name: 'A pond', animals_heard: LIST5000, note: PROSE60K, saga: MEGABYTE },
    { name: 'A quieter pond', animals_heard: NAMES.slice(0, 40).join('; '), note: 'a quieter pond by the road', saga: 'short' },
    { name: 'A third pond', animals_heard: NAMES.slice(10, 25).join('; '), note: 'a third pond behind the school', saga: 'also short' },
  ];
  const cols = ['name', 'animals_heard', 'note', 'saga'];
  const body = {
    dataset: SLUG, filename: 'Ponds.csv',
    schema: cols.map((c) => ({ name: c, type: 'string' })), rows,
    geoms: rows.map((_, i) => ({ type: 'Point', coordinates: [77.6 + i / 100, 12.95 + i / 100] })),
    geomIdx: rows.map((_, i) => i),
    meta: { sourceType: 'csv', geometry: { class: 'point', count: rows.length, vertices: rows.length } },
  };
  const ing = await post('/layers/ingest', JSON.stringify(body));
  check('the upload is accepted', [ing.status, !!ing.j.importId], [200, true]);
  check('and nothing on the way back says a cell was shortened', ing.j.matchReport && ing.j.matchReport.shortened, undefined);
  check('the peek of a row keeps its own small budget (120 characters)',
    Math.max(...Object.values((ing.j.peekRows || [{}])[0]).map((v) => String(v).length)) <= 120, true);
  const done = await post('/layers/commit', JSON.stringify({ importId: ing.j.importId, dataset: SLUG }));
  check('the commit writes the layer', [done.status, !!done.j.layerId], [200, true]);
  const L = localLayers().find((l) => l.id === done.j.layerId);
  const gj = JSON.parse(fs.readFileSync(path.join(PRIV, SLUG, L.source), 'utf8'));
  const stored = gj.features.find((f) => f.properties.name === 'A pond').properties;
  check('the stored cells are the uploaded cells, byte for byte',
    [stored.animals_heard === LIST5000, stored.note === PROSE60K, stored.saga === MEGABYTE], [true, true, true]);
  check('all 5,000 items, all 60,000 characters, all 1,048,576 bytes',
    [stored.animals_heard.split('; ').length, stored.note.length, stored.saga.length], [5000, 60000, 1024 * 1024]);

  console.log('\n  an upload too big to send is refused whole, in plain words');
  const layersBefore = localLayers().length;
  const huge = JSON.stringify({ dataset: SLUG, filename: 'Huge.csv',
    schema: [{ name: 'name', type: 'string' }, { name: 'saga', type: 'string' }],
    rows: [{ name: 'Too much', saga: 'x'.repeat(11 * 1024 * 1024) }] });
  const refused = await post('/layers/ingest', huge);
  check('it is refused', refused.status, 413);
  check('in plain words, saying nothing was saved and what to do',
    [/too much to send/.test(refused.j.error || ''), /Nothing was saved/.test(refused.j.error || ''),
     /stack|Error|entity\.too\.large|<html/i.test(refused.j.error || '')], [true, true, false]);
  check('no part of it was stored: no new layer, no new file', localLayers().length, layersBefore);
  check('and the layer already there is untouched',
    JSON.parse(fs.readFileSync(path.join(PRIV, SLUG, L.source), 'utf8')).features.length, 3);
}

try { await road(); } catch (e) {
  check('the road itself ran', String((e && e.message) || e), 'no fault');
  console.log(out.slice(-800));
}
cleanup();

/* ---------------- every budget downstream, on its own copy ---------------- */
console.log('\n  downstream, each budget holds on its own copy of a megabyte');
const props = { name: 'A pond', animals_heard: LIST5000, note: PROSE60K, saga: MEGABYTE };
const t = (f) => { const t0 = Date.now(); const v = f(); return { v, ms: Date.now() - t0 }; };

const blob = t(() => featureSearchText(props, null));
check('the search blob keeps its 4,000 characters', blob.v.length <= 4000, true);
check('and still holds the words it is searched by', blob.v.indexOf('creature number 1;') >= 0, true);
const vocab = t(() => layerVocabTerms({ popup: { fields: [] } }, [{ properties: props }], 300));
check('the layer\'s vocabulary keeps its 300 terms', vocab.v.length <= 300, true);

const digest = buildDigest([props,
  { animals_heard: NAMES.slice(0, 40).join('; '), note: 'a quieter pond' },
  { animals_heard: NAMES.slice(10, 25).join('; '), note: 'a third pond' }], ['animals_heard', 'note', 'saga']);
check('the reading\'s prompt line stays within its budget', digest.entries[0].text.length < 900, true);
check('while the place itself still counts every one of its 5,000 words', digest.entries[0].tags.length, 5000);

const items = wanting([{ note: MEGABYTE }], 'note', {});
check('the place-name prompt\'s copy of an entry is budgeted', items[0].text.length, PROMPT_TEXT_MAX);
check('and the place keeps its own words (only the prompt copy is cut)', MEGABYTE.startsWith(items[0].text), true);

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('the schema reading is shown a budgeted copy of each cell, not the rows themselves',
  /o\[k\] = typeof r\[k\] === 'string' \? r\[k\]\.slice\(0, PROMPT_CELL\) : r\[k\];/.test(server), true);
check('the peek of a row is still short', /String\(v\)\.slice\(0, 120\)/.test(server), true);
check('the caption under a photo (link previews, the emails) is a line, not a description',
  /previewTrim\(p\.description \|\| p\.name \|\| p\.title \|\| '', PREVIEW_NAME_CHARS\)/.test(server), true);
check('and no cell-length ceiling is left anywhere on the way in',
  /keepWholeCell|MAX_CELL/.test(server), false);

console.log('\n  the hot passes over a cell stay quick with a megabyte in it');
const timings = {
  'search blob': blob.ms, 'search vocabulary': vocab.ms,
  'the reading digest': t(() => buildDigest([props], ['animals_heard', 'note', 'saga'])).ms,
  'the place-name pass': t(() => wanting([{ note: MEGABYTE }], 'note', {})).ms,
  'the LOKA comparison': t(() => lay([Object.assign(toRow({ id: '00000000-0000-4000-8000-000000000001',
      latitude: 12.9, longitude: 77.5, description: MEGABYTE }, 'S'))],
    [toRow({ id: '00000000-0000-4000-8000-000000000001', latitude: 12.9, longitude: 77.5, description: MEGABYTE + '!' }, 'S')])).ms,
};
for (const [what, ms] of Object.entries(timings)) check(what + ' is quick (' + ms + ' ms)', ms < 2000, true);

console.log('\n  a long list of initials does not stall the quote reader');
{
  const { createRequire } = await import('node:module');
  const IMQ = createRequire(import.meta.url)(ROOT + '/atlas/insight-mode.js');
  const big = Array.from({ length: 60000 }, (_, i) => 'A. cinerea' + i).join(', ');
  const t0 = Date.now(); const got = IMQ.splitSentences(big); const ms = Date.now() - t0;
  check('a 1 MB list of initials is split in well under a second', ms < 1000, true);
  check('and stays one sentence', got.length, 1);
  check('abbreviations and initials still hold a sentence together',
    IMQ.splitSentences("St. John's is old. J. H. Furneaux took it. It rains etc. here! Yes"),
    ["St. John's is old.", 'J. H. Furneaux took it.', 'It rains etc. here!', 'Yes']);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
