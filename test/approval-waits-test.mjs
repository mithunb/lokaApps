/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Approval waits (Mithun, 5 Nov 2026). An atlas of North Goa with nine open-data
   layers was parked for a person's yes because the catalogue priced it at 621
   seconds — over half the budget — and was then built in 54, its sources
   having been downloaded before. Four decisions: the gate is the whole budget
   and the estimates know what is already on the server; the wizard says what
   will wait before Build is pressed; the atlas is built without the waiting
   layers and they are added once the LOKA team says yes; only its maker sees
   it until then. Against a throwaway atlas server with its own catalogue and
   a stand-in builder (test/fixtures/fake-builder.mjs) — nothing on the
   network, nothing under atlas/datasets/ or api/data/. */

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); }
  return null;
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const server = read('api/apps/atlas.js');
const setup = read('atlas/setup/setup.js');
const page = read('atlas/setup/index.html');
const rows = read('atlas/catalog-rows.js');
const viewer = read('atlas/atlas.js');
const owner = read('atlas/owner.js');
const catalog = JSON.parse(read('atlas/setup/catalog.json'));

/* ---------------- one rule, read from the source ---------------- */
console.log('\n  one rule for both gates');
const createRoute = server.slice(server.indexOf("router.post('/instances',"), server.indexOf('/* ================= approval ================='));
const rebuildPart = server.slice(server.indexOf("router.post('/instances/:slug/rebuild'"), server.indexOf("router.delete('/instances/:slug'"));
check('the first build asks approvalFor', /const verdict = approvalFor\(layerIds, allowed, areaDeg2, estCtx\);/.test(createRoute), true);
check('and so does a rebuild (the estimate always; the gate unless the layers were already said yes to)',
  /const verdict = approvalFor\(layerIds, allowed, areaDeg2, estCtx\);\s*const needsApproval = !approved && verdict\.needsApproval;/.test(rebuildPart), true);
check('feasibility is judged on the full estimate — only the gate is told what is saved',
  /function feasibleAt\(l, areaDeg2\) \{\s*return layerSeconds\(l, areaDeg2\) <= BUILD_BUDGET_S;/.test(server) && !/feasibleLayers\([^)]*ctx\)/.test(server), true);
check('the saving is the download, off the first-build figure before the area scaling, never below five seconds',
  /const saved = l && ctx && sourceCached\(l, ctx\) \? Number\(l\.downloadSeconds\) \|\| 0 : 0;\s*const base = Math\.max\(5, full - saved\);/.test(server), true);
check('the split is the one file the wizard loads too', /const APPROVAL = requireScript\(path\.join\(REPO_ROOT, 'atlas', 'approval-rules\.js'\)\);/.test(server) &&
  /return APPROVAL\.split\(items, BUILD_BUDGET_S\);/.test(server) && /<script src="\.\.\/approval-rules\.js\?v=dev"><\/script>/.test(page) && /R\.split\(items, aboveSeconds\)/.test(rows), true);
check('an approved build gets the time its estimate asks for: half as much again plus a minute, ten to thirty minutes',
  /Math\.min\(30 \* 60, Math\.max\(10 \* 60, want\)\) \* 1000/.test(server) && /enqueueBuild\(approved \? \{ \.\.\.spec, timeoutMs: approvedTimeoutMs\(spec\.estSeconds\) \} : spec\)/.test(server) &&
  /timeoutMs: approvedTimeoutMs\(inst\.spec && inst\.spec\.estSeconds\)/.test(server) && /Math\.min\(30 \* 60 \* 1000, Math\.max\(JOB_TIMEOUT_MS, Number\.isFinite\(asked\) \? asked : 0\)\)/.test(read('api/lib/atlas/jobs.js')), true);
check('a yes is claimed before anything waits, and not started while a build runs',
  /reg\.updateInstance\(inst\.slug, \{ pendingLayers: undefined, pendingApproved: undefined \}\);\s*const r = await addPendingLayers\(inst, pending\);/.test(server) &&
  /if \(fresh\.status === 'building' \|\| fresh\.status === 'pending-approval'\) \{\s*reg\.updateInstance\(inst\.slug, \{ pendingLayers: pending, pendingApproved: true \}\);/.test(server), true);
check('the hook waits for a running LOKA update, once per atlas', /if \(LOKA_RUNNING\.has\(slug\)\) \{\s*if \(LAYERS_AFTER_LOKA\.has\(slug\)\) return;/.test(server) &&
  /const pending = inst\.pendingLayers;\s*reg\.updateInstance\(slug, \{ pendingLayers: undefined, pendingApproved: undefined \}\);\s*addPendingLayers\(inst, pending\)/.test(server), true);
check('a first build that stops lets its waiting layers go', /: \{ status: 'failed', failReason: message, wantLoka: undefined, pendingLayers: undefined, pendingApproved: undefined \};/.test(server), true);
check('the cap is the whole budget; the half-budget gate is gone', /BUILD_BUDGET_S \/ 2/.test(server), false);
check('the catalogue answers with the same figure and the cap',
  /estSecondsHere: layerSeconds\(l, areaDeg2, ctx\)/.test(server) && /approvalAboveSeconds: BUILD_BUDGET_S/.test(server), true);
check('a cached source is one the builder would find: present and not empty, under srccache',
  /fs\.statSync\(path\.join\(SRC_CACHE_DIR, f\)\)\.size > 0/.test(server) && /const SRC_CACHE_DIR = path\.join\(reg\.DATA_DIR, 'srccache'\);/.test(server), true);
check('the reference atlas is never split', /!searchText\.isNeverTouched\(slug\);/.test(createRoute), true);
check('the first build keeps applying the LOKA space; the layers added later do not (firstBuild = !builtAt)',
  /const firstBuild = !inst\.builtAt;/.test(server) && /setImmediate\(\(\) => \{ applyWantedLoka\(job\.slug, firstBuild\); \}\);[\s\S]*?setImmediate\(\(\) => \{ addApprovedLayers\(job\.slug\); \}\);/.test(server), true);
check('the rebuild route is the two halves, and the approved layers go down the same one',
  /const plan = await planRebuild\(inst, req\.body \|\| \{\}\);[\s\S]*?res\.json\(await startRebuild\(inst, plan, \{ base: siteBase\(req\) \}\)\);/.test(rebuildPart) &&
  /const plan = await planRebuild\(inst, \{ layers \}\);[\s\S]*?await startRebuild\(fresh, plan, \{ approved: true \}\)/.test(server), true);
check('the catalogue names the files the recipes keep, for the layers that keep one',
  catalog.layers.filter((l) => l.cacheFiles).map((l) => l.id).sort(),
  ['admin', 'agro', 'basins-wris', 'births', 'cleanfuel', 'constituencies', 'education', 'floodplain-ndem', 'forests-soi', 'health', 'literacy', 'rivers-wris', 'stunting', 'subadmin', 'wasteland', 'wetlands-wris']);
check('and the download\'s share beside every one of them, less than the whole',
  catalog.layers.filter((l) => l.cacheFiles).every((l) => Number(l.downloadSeconds) > 0 && l.downloadSeconds < l.estSeconds), true);
const recipes = read('api/atlas-builders/recipes.py');
check('every named file is one a recipe downloads by that name',
  catalog.layers.flatMap((l) => (Array.isArray(l.cacheFiles) ? l.cacheFiles : Object.values(l.cacheFiles || {}).flat()))
    .filter((f) => !recipes.includes(f.replace('{iso3}', '{low}').replace(/^hot-\{low\}-.+\.zip$/, 'hot-{low}-{kind}.zip'))),
  []);

/* ---------------- the viewer, the wizard, the owner's page ---------------- */
console.log('\n  what each page says');
check('the viewer: an atlas that exists and is still building is a wait, not a fault',
  /"This atlas is still being built — it opens by itself when it's ready\."/.test(viewer) &&
  /"There's no atlas at that address — it may have been removed, or it's still being built\."/.test(viewer), true);
check('it asks the API whether the atlas exists, as the owner check does, and only its maker is told',
  /function stillBuilding\(\) \{[\s\S]*?fetch\("\.\/api\/instances\/" \+ encodeURIComponent\(DATASET\), \{ credentials: "same-origin" \}\)[\s\S]*?inst\.canEdit && \(inst\.status === "building" \|\| inst\.status === "pending-approval"\)/.test(viewer), true);
check('the calm wait mark, and it tries again by itself', /window\.LokaWait \? LokaWait\.html\(err\.message\)/.test(viewer) && /setTimeout\(draw, 5000\);/.test(viewer), true);
check('an embed never asks', /if \(EMBED \|\| !DATASET\) return Promise\.resolve\(false\);/.test(viewer), true);
check('the wizard: one sentence beside Build, before it is pressed',
  page.indexOf('<p class="hint" id="build-wait" hidden></p>') > 0 && page.indexOf('id="build-wait"') < page.indexOf('id="build-go"'), true);
check('painted when the step opens and whenever a tick changes',
  /if \(n === 1\) \{ prefillName\(\); paintBuildWait\(\); \}/.test(setup) && /paintBuildWait\(\);\n  \}/.test(setup), true);
check('from the server\'s cap and figures, never a copy of the number',
  /S\.approvalAbove = Number\(r\.approvalAboveSeconds\) \|\| 0;/.test(setup) && /CR\.plan\(S\.catalog \|\| \[\], S\.picked \|\| \{\}, S\.approvalAbove\)/.test(setup) && !/540|270/.test(setup), true);
check('the open-data step says the same thing, not that the whole atlas waits',
  /ask\.textContent = line;/.test(setup) && !/so your atlas waits for a quick OK/.test(setup), true);
check('after "Your atlas is ready", the waiting layers are named in the same words — no wait screen',
  /R\.waitSentence\(waiting\)\.replace\(\/ Everything else\.\*\$\/, ""\)/.test(setup), true);
check('the whole-atlas wait stays for when nothing could be built now', /function waitForApproval\(\)/.test(setup) && /if \(r\.status === "pending-approval"\) \{ waitForApproval\(\); return; \}/.test(setup), true);
check('the owner\'s page names what waits, to owner and editors, in the server\'s sentence',
  /note\.hidden = !\(note\.textContent = INST\.pendingNote \|\| ""\);/.test(owner) && /pendingNote: pendingNote\(inst\)/.test(server), true);
check('publishing and opening to others are refused in the same words while layers wait',
  (server.match(/waitingLine\(inst\) \+ ' — it can be (listed|opened to others) once they have answered\.'/g) || []).length, 2);

// the wizard's split, run as a browser would, against the server's order
console.log('\n  the wizard follows the server\'s split from the server\'s figures');
const win = {};
const ctx = vm.createContext({ window: win, self: win });
vm.runInContext(read('atlas/approval-rules.js'), ctx);
vm.runInContext(rows, ctx);
const CR = win.LokaCatalogRows;
const RULES = win.LokaApprovalRules;
check('the browser and the server run the same file', JSON.stringify(RULES.split([{ id: 'a', seconds: 400 }, { id: 'b', seconds: 300, required: true }, { id: 'c', seconds: 100, heavy: true, label: 'C' }], 540)),
  JSON.stringify((await import('../atlas/approval-rules.js')).default.split([{ id: 'a', seconds: 400 }, { id: 'b', seconds: 300, required: true }, { id: 'c', seconds: 100, heavy: true, label: 'C' }], 540)));
check('short names: a bracket goes, the first of a pair stays', [RULES.shortLabel('Floodplain (observed inundation)'), RULES.shortLabel('Land use / land cover'), RULES.shortLabel('Rivers & canals')], ['Floodplain', 'Land use', 'Rivers & canals']);
const cat = [
  { id: 'admin', label: 'Admin boundaries', required: true, estSecondsHere: 30 },
  { id: 'labels', label: 'Place names', estSecondsHere: 1 },
  { id: 'rivers', label: 'Rivers', estSecondsHere: 90 },
  { id: 'flood', label: 'Floodplain', estSecondsHere: 180, cost: 'approval' },
  { id: 'terrain', label: 'Terrain', estSecondsHere: 300 },
  { id: 'forest', label: 'Forest', estSecondsHere: 200 },
  { id: 'wide', label: 'Too wide', estSecondsHere: 50, feasible: false },
];
check('a heavy layer waits; the rest, under the cap, is built now',
  CR.plan(cat, { rivers: true, flood: true }, 540), { now: ['admin', 'labels', 'rivers'], later: [{ id: 'flood', label: 'Floodplain', why: 'heavy' }], nowSeconds: 121 });
check('over the cap, the dearest optional layer waits (621 s: terrain goes, 321 s fits)',
  CR.plan(cat, { rivers: true, terrain: true, forest: true }, 540), { now: ['admin', 'labels', 'rivers', 'forest'], later: [{ id: 'terrain', label: 'Terrain', why: 'long' }], nowSeconds: 321 });
check('then the next, until the rest fits (cap 300: terrain, then forest)',
  CR.plan(cat, { rivers: true, terrain: true, forest: true }, 300), { now: ['admin', 'labels', 'rivers'], later: [{ id: 'terrain', label: 'Terrain', why: 'long' }, { id: 'forest', label: 'Forest', why: 'long' }], nowSeconds: 121 });
check('the boundaries never wait; a layer the region is too wide for is not counted',
  CR.plan(cat, { wide: true, rivers: true }, 100), { now: ['admin', 'labels'], later: [{ id: 'rivers', label: 'Rivers', why: 'long' }], nowSeconds: 31 });
check('nothing waits, nothing said', CR.waitSentence([]), '');
check('one heavy layer: one sentence for what waits, one for the rest', CR.waitSentence([{ id: 'flood', label: 'Floodplain (observed inundation)', why: 'heavy' }]),
  'Floodplain is added after a yes from the LOKA team. Everything else is built straight away.');
check('three, by their short names', CR.waitSentence([{ id: 'flood', label: 'Floodplain (observed inundation)', why: 'heavy' }, { id: 'lulc', label: 'Land use / land cover', why: 'long' }, { id: 'f', label: 'Reserved & protected forests', why: 'long' }]),
  'Floodplain, Land use and Reserved & protected forests are added after a yes from the LOKA team. Everything else is built straight away.');

/* ---------------- a throwaway atlas server ---------------- */
const OWNER = 'owner@example.test', ADMIN = 'admin@example.test';
function world() {
  const PORT = 9700 + Math.floor(Math.random() * 250);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-approval-check-'));
  const W = { PORT, DATA, out: '', child: null, base: 'http://127.0.0.1:' + PORT };
  const accounts = Object.fromEntries([OWNER, ADMIN].map((e) => [e, { email: e, instances: [], verifiedAt: 1 }]));
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({ instances: {}, accounts, drafts: {}, lokaRequests: {} }));
  /* Its own catalogue: the repo's, with three layers the stand-in builder can
     "build" on a worldwide atlas made to tell the story — roads needs a yes,
     and labels with buildings is more than one build is given. Ids are the
     repo's, so the server and the builder agree on them. */
  const own = JSON.parse(read('atlas/setup/catalog.json'));
  for (const l of own.layers) {
    if (l.id === 'roads') l.cost = 'approval';
    if (l.id === 'buildings') l.estSeconds = 500;
    if (l.id === 'labels') l.estSeconds = 100;
  }
  W.catalog = own;
  fs.writeFileSync(path.join(DATA, 'catalog.json'), JSON.stringify(own));
  // the stand-in builder, as slow as the file says at the moment a build starts
  const msFile = path.join(DATA, 'fake-build-ms');
  const failFile = path.join(DATA, 'fake-build-fail');
  fs.writeFileSync(path.join(DATA, 'fake-python.sh'),
    '#!/bin/sh\nATLAS_FAKE_BUILD_MS="$(cat "' + msFile + '" 2>/dev/null)" ATLAS_FAKE_BUILD_FAIL="$(cat "' + failFile + '" 2>/dev/null)" exec "' + process.execPath + '" "' + path.join(ROOT, 'test', 'fixtures', 'fake-builder.mjs') + '" "$@"\n');
  fs.chmodSync(path.join(DATA, 'fake-python.sh'), 0o755);
  W.buildTakes = (ms) => fs.writeFileSync(msFile, String(ms));
  W.buildFails = (yes) => fs.writeFileSync(failFile, yes ? '1' : '0');
  W.buildTakes(0); W.buildFails(false);
  W.builtWith = (slug) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'private-datasets', slug, 'built-with.json'), 'utf8')); } catch { return null; } };
  // the boundary data for a North Goa atlas, copied from this computer's geocache (never fetched)
  W.geo = fs.existsSync(path.join(ROOT, 'api', 'data', 'atlas', 'geocache', 'IND-ADM2.json'));
  if (W.geo) {
    fs.mkdirSync(path.join(DATA, 'geocache'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'api', 'data', 'atlas', 'geocache', 'IND-ADM2.json'), path.join(DATA, 'geocache', 'IND-ADM2.json'));
    fs.writeFileSync(path.join(DATA, 'geocache', 'IND-levels.json'), JSON.stringify({ iso3: 'IND', levels: [1, 2] }));
  }
  W.start = async () => {
    W.child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
      env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1',
        ATLAS_FAKE_READING_MS: '300', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: ADMIN, ATLAS_ADMIN_EMAIL: ADMIN, ATLAS_ADMIN_TOKEN: '', ATLAS_PER_IP_PER_DAY: '20',
        ATLAS_CATALOG_FILE: path.join(DATA, 'catalog.json'), ATLAS_PYTHON: path.join(DATA, 'fake-python.sh'),
        LOKA_API_BASE: '', LOKA_REFRESH_TOKEN: '', LOKA_API_KEY: '' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    W.child.stdout.on('data', (d) => { W.out += d; });
    W.child.stderr.on('data', (d) => { W.out += d; });
    const t0 = Date.now();
    while (!/listening on/.test(W.out)) {
      if (Date.now() - t0 > 15000 || W.child.exitCode != null) throw new Error('server did not start:\n' + W.out.slice(-800));
      await sleep(100);
    }
  };
  W.cleanup = () => { try { W.child && W.child.kill('SIGKILL'); } catch {} try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} };
  W.signIn = async (email) => {
    const before = W.out.length;
    let r = await fetch(W.base + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!r.ok) throw new Error('request-link ' + r.status);
    const code = await until(() => (/Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(W.out.slice(before)) || [])[1], 5000);
    r = await fetch(W.base + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
    if (!r.ok) throw new Error('verify-code ' + r.status);
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  W.call = async (method, p, { cookie, body } = {}) => {
    const r = await fetch(W.base + '/api/atlas' + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  };
  W.registry = () => JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8'));
  // the record as the API answers its owner (the registry file is written a tick later)
  W.inst = async (slug) => (await W.call('GET', '/instances/' + slug, { cookie: W.cookie })).j;
  // the wizard's request, as setup.js sends it: a worldwide atlas of the given layers
  W.build = (cookie, title, layers, more) => W.call('POST', '/instances', { cookie, body: Object.assign({ title, org: 'Check', region: { worldwide: true }, layers }, more || {}) });
  W.built = (slug) => until(async () => { const i = await W.inst(slug); return i && i.status !== 'building' && i.status !== 'pending-approval' ? i : null; }, 30000);
  // the links in the operator's mail, read from the server's log (MAIL_TRANSPORT=log)
  W.mailAfter = (from, subjectRe) => until(() => { const m = subjectRe.exec(W.out.slice(from)); return m ? W.out.slice(from + m.index) : null; }, 5000);
  W.link = (mail, label) => (new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s+(http\\S+)').exec(mail) || [])[1];
  W.press = async (link) => { const r = await fetch(link.replace(/^http:\/\/[^/]+\/apps\/atlas\/api/, W.base + '/api/atlas')); return (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); };
  // a new atlas starts private, so its files are under the throwaway data folder, never the repo's
  W.datasetFiles = (slug) => { const d = path.join(DATA, 'private-datasets', slug); return fs.existsSync(d) ? fs.readdirSync(d).sort() : null; };
  return W;
}

const W = world();
process.on('exit', () => { W.cleanup(); });

try {
  await W.start();
  const owner = await W.signIn(OWNER);
  W.cookie = owner;

  /* ---------------- honest estimates ---------------- */
  console.log('\n  the estimate knows what is already on the server');
  const divar = ['admin', 'subadmin', 'rivers-wris', 'wetlands-wris', 'basins-wris', 'agro', 'forests-soi', 'constituencies', 'births', 'labels'];
  const ask = async () => (await W.call('GET', '/catalog?iso3=IND&areaDeg2=0.33')).j;
  let c = await ask();
  const secs = (c, ids) => ids.reduce((t, id) => t + c.layers.find((l) => l.id === id).estSecondsHere, 0);
  check('the catalogue says the cap it gates against', c.approvalAboveSeconds, c.budgetSeconds);
  check('nothing downloaded yet: the first-build figures', [c.layers.find((l) => l.id === 'rivers-wris').estSecondsHere, c.layers.find((l) => l.id === 'rivers-wris').sourceCached], [90, false]);
  const before = secs(c, divar);
  check('a Divar-like nine-layer North Goa atlas is over the cap on first-build figures', before > c.approvalAboveSeconds, true);
  // the sources land in srccache, as the builder leaves them
  fs.mkdirSync(path.join(W.DATA, 'srccache'), { recursive: true });
  for (const f of ['LGD_Districts.geojson', 'LGD_Blocks.geojson', 'WRIS_Rivers.parquet', 'WRIS_Canals.geojson', 'Bharatmaps_Parivesh_Wetland_Boundaries.parquet',
    'WRIS_SubBasin.geojson', 'Agro_Ecological_Zones.geojson', 'SOI_Forests.parquet', 'datameet-pc-2019.geojson']) {
    fs.writeFileSync(path.join(W.DATA, 'srccache', f), 'x');
  }
  fs.writeFileSync(path.join(W.DATA, 'srccache', 'hot-ind-health_facilities.zip'), '');   // cut short: not a cached source
  c = await ask();
  check('with the sources saved, the cached figures', [c.layers.find((l) => l.id === 'rivers-wris').estSecondsHere, c.layers.find((l) => l.id === 'rivers-wris').sourceCached], [20, true]);
  check('an empty file is not a saved source', c.layers.find((l) => l.id === 'health').sourceCached, false);
  check('a layer read by the box keeps its full estimate', c.layers.find((l) => l.id === 'terrain').estSecondsHere, 90);
  const wide = (await W.call('GET', '/catalog?iso3=IND&areaDeg2=10')).j.layers.find((l) => l.id === 'forests-soi');
  check('the clip still grows with the area (forests: 120 - 80 download, times five)', wide.estSecondsHere, 200);
  check('but feasibility is judged on the full figure (600 s over 540): not offered', wide.feasible, false);
  check('and the same nine layers now fit under the cap', secs(c, divar) <= c.approvalAboveSeconds, true);
  check('a worldwide (global) atlas does not count India\'s files', (await W.call('GET', '/catalog?iso3=XXX&areaDeg2=1')).j.layers.find((l) => l.id === 'health').sourceCached, false);

  if (W.geo) {
    const r = await W.call('POST', '/instances', { cookie: owner, body: { title: 'Divar check', org: 'Check', region: { iso3: 'IND', level: 2, shapeIDs: ['76128533B1711704044407'] }, layers: divar } });
    check('so the North Goa atlas is built at once, nothing waiting', [r.status, r.j.status, r.j.pendingLayers, !!r.j.jobId], [200, 'building', undefined, true]);
    const i = await W.built(r.j.slug);
    check('and built it is, with every layer', [i.status, i.layers.length, i.pendingLayers], ['built', divar.length, undefined]);
  } else {
    console.log('  (no IND-ADM2 in this computer\'s geocache: the North Goa build is not tried)');
  }

  /* ---------------- basic atlas first ---------------- */
  console.log('\n  a heavy layer waits; the rest is built now');
  W.buildTakes(2500);
  let from = W.out.length;
  let r = await W.build(owner, 'Roads while building', ['labels', 'roads']);
  const slow = r.j.slug;
  check('the answer: building now, and what waits by name', [r.status, r.j.status, !!r.j.jobId, r.j.pendingLayers], [200, 'building', true, ['Roads & streets']]);
  check('the record: the layers built now, and the waiting one with its reason',
    [(await W.inst(slow)).layers, (await W.inst(slow)).pendingLayers], [['labels'], [{ id: 'roads', label: 'Roads & streets', why: 'heavy' }]]);
  let mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Roads while building/);
  check('the LOKA team is mailed, with a link to add them and one to leave them out',
    [!!mail, /approve-layers|token=/.test(W.link(mail, 'Add them') || ''), !!W.link(mail, 'Leave them out'), /is being built now without Roads & streets/.test(mail)], [true, true, true, true]);
  const yesWhileBuilding = await W.press(W.link(mail, 'Add them'));
  check('a yes while the build runs is kept, and says so', /is not built yet — Roads & streets will be added by itself/.test(yesWhileBuilding), true);
  check('the record holds the yes', [(await W.inst(slow)).status, (await W.inst(slow)).pendingApproved], ['building', true]);
  from = W.out.length;
  let done = await until(async () => { const i = await W.inst(slow); return i && i.status === 'built' && i.layers.includes('roads') && !i.pendingLayers ? i : null; }, 30000);
  check('the build done, the layer is added by itself and the wait is over', [done && done.status, done && done.layers, done && done.pendingLayers, done && done.pendingApproved], ['built', ['labels', 'roads'], undefined, undefined]);
  check('the owner is told it is being added', !!(await W.mailAfter(from, /Subject: \[LOKA Atlas\] adding Roads & streets: Roads while building/)), true);
  await until(() => { const f = W.datasetFiles(slow); return f && f.includes('roads.geojson') ? f : null; }, 10000);
  check('and the files on disk have it', (W.datasetFiles(slow) || []).includes('roads.geojson'), true);
  check('a second press of the same link finds nothing waiting', /has no layers waiting/.test(await W.press(W.link(mail, 'Add them'))), true);

  console.log('\n  a yes after the atlas is built');
  W.buildTakes(0);
  from = W.out.length;
  r = await W.build(owner, 'Roads after built', ['labels', 'roads']);
  const later = r.j.slug;
  let i = await W.built(later);
  check('built without the waiting layer', [i.status, i.layers, i.pendingLayers.map((p) => p.id)], ['built', ['labels'], ['roads']]);
  r = await W.call('POST', '/instances/' + later + '/publish', { cookie: owner });
  check('listing is refused while it waits, in plain words',
    [r.status, r.j.error, r.j.pendingLayers], [409, 'Roads & streets is waiting for a yes from the LOKA team — it can be listed once they have answered.', ['Roads & streets']]);
  r = await W.call('POST', '/instances/' + later + '/details', { cookie: owner, body: { title: 'Roads after built', visibility: 'public' } });
  check('and so is opening it to anyone with the link', [r.status, r.j.error], [409, 'Roads & streets is waiting for a yes from the LOKA team — it can be opened to others once they have answered.']);
  r = await W.call('GET', '/instances/' + later, { cookie: owner });
  check('the owner\'s page is told what waits, in the wizard\'s words', [r.j.pendingLayers, r.j.pendingNote],
    [[{ id: 'roads', label: 'Roads & streets', why: 'heavy' }], 'Roads & streets is added after a yes from the LOKA team.']);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Roads after built/);
  const yesAfter = await W.press(W.link(mail, 'Add them'));
  check('the yes adds them now', /Roads & streets being added to “Roads after built” now/.test(yesAfter), true);
  done = await until(async () => { const i = await W.inst(later); return i && i.status === 'built' && i.layers.includes('roads') ? i : null; }, 30000);
  check('through the rebuild path: the layer is there, the record is clean', [done && done.layers, done && done.pendingLayers, done && done.rebuildPrior], [['labels', 'roads'], undefined, undefined]);
  r = await W.call('POST', '/instances/' + later + '/publish', { cookie: owner });
  check('the wait over, listing is answered as before (a private atlas: open it first)', [r.status, /private atlas cannot be listed/.test(r.j.error)], [409, true]);

  console.log('\n  a no');
  from = W.out.length;
  r = await W.build(owner, 'Roads denied', ['labels', 'roads']);
  const no = r.j.slug;
  await W.built(no);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Roads denied/);
  from = W.out.length;
  check('the no leaves the atlas as it is', /keeps its map without Roads & streets/.test(await W.press(W.link(mail, 'Leave them out'))), true);
  i = await W.inst(no);
  check('its layers kept, nothing waiting any more', [i.status, i.layers, i.pendingLayers, i.pendingApproved], ['built', ['labels'], undefined, undefined]);
  check('the owner is told, plainly', /Subject: \[LOKA Atlas\] built without Roads & streets: Roads denied[\s\S]*?was built without Roads & streets — it was not approved this time/.test(await W.mailAfter(from, /Subject: \[LOKA Atlas\] built without/) || ''), true);
  r = await W.call('POST', '/instances/' + no + '/rebuild', { cookie: owner, body: { layers: ['labels'] } });
  check('a rebuild from the Owner menu still goes its own way: no yes needed, it starts', [r.status, r.j.ok, !!r.j.jobId, r.j.change], [200, true, true, { region: false, added: [], removed: [] }]);
  await W.built(no);
  from = W.out.length;
  r = await W.call('POST', '/instances/' + no + '/rebuild', { cookie: owner, body: { layers: ['labels', 'roads'] } });
  check('and one that asks for a heavy layer waits whole, as a rebuild always did', [r.status, r.j.pendingApproval, (await W.inst(no)).status], [200, true, 'pending-approval']);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layer change: Roads denied/);
  check('the operator\'s mail says the reason from the one rule', /Reason: heavy layers: roads/.test(mail), true);
  check('and the old deny link puts it back', [/keeps its current map/.test(await W.press(W.link(mail, 'Deny'))), (await W.inst(no)).status, (await W.inst(no)).layers], [true, 'built', ['labels']]);

  console.log('\n  only heavy layers picked: the whole atlas waits, as before');
  from = W.out.length;
  r = await W.build(owner, 'Only roads', ['roads']);
  const whole = r.j.slug;
  check('no job, waiting for approval, nothing split', [r.status, r.j.status, r.j.jobId, r.j.pendingLayers], [200, 'pending-approval', null, undefined]);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] approval needed: Only roads/);
  check('the old approve link still works', /approved — build queued/.test(await W.press(W.link(mail, 'Approve'))), true);
  i = await W.built(whole);
  check('and the atlas is built whole', [i.status, i.layers], ['built', ['roads']]);

  console.log('\n  more than one build is given: the dearest layer waits');
  r = await W.build(owner, 'Long build', ['labels', 'buildings']);
  const long = r.j.slug;
  check('labels (100 s) now, buildings (500 s) later, for being too long together', [r.j.status, r.j.pendingLayers, (await W.inst(long)).layers, (await W.inst(long)).pendingLayers], ['building', ['Buildings'], ['labels'], [{ id: 'buildings', label: 'Buildings', why: 'long' }]]);
  await W.built(long);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Long build/);
  check('a yes on the long one starts the over-budget build it was held for', /Buildings being added/.test(await W.press(W.link(mail, 'Add them'))), true);
  done = await until(async () => { const i = await W.inst(long); return i && i.status === 'built' && i.layers.includes('buildings') && W.builtWith(long) && W.builtWith(long).layers.includes('buildings') ? i : null; }, 30000);
  check('with the time its estimate asks for (600 s → 960 s), not the ten minutes that would have cut it short',
    [done && done.layers, W.builtWith(long)], [['labels', 'buildings'], { layers: ['labels', 'buildings'], timeoutMs: 960000, estSeconds: 600 }]);
  check('a build that needed no yes carries no extra time', (W.builtWith(no) || {}).timeoutMs, null);

  console.log('\n  a basic build that stops');
  W.buildFails(true);
  from = W.out.length;
  r = await W.build(owner, 'Stops', ['labels', 'roads']);
  const stops = r.j.slug;
  i = await W.built(stops);
  check('the build failed, and the waiting layers went with it', [i.status, i.pendingLayers, i.pendingApproved, i.pendingNote], ['failed', undefined, undefined, undefined]);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Stops/);
  check('the yes says plainly that the build stopped, and the way on', /The build of “Stops” stopped, so nothing was added\. Once it is built again, its owner can ask for these layers from Owner ▾ → Open data layers\./.test(await W.press(W.link(mail, 'Add them'))), true);
  check('and so does the no', /stopped, so nothing was added/.test(await W.press(W.link(mail, 'Leave them out'))), true);
  r = await W.call('POST', '/instances/' + stops + '/publish', { cookie: owner });
  check('nothing stale blocks listing: the answer is about the build, not the layers', [r.status, r.j.error], [409, 'cannot publish while failed']);
  W.buildFails(false);

  console.log('\n  the same yes twice at once');
  from = W.out.length;
  r = await W.build(owner, 'Race', ['labels', 'roads']);
  const race = r.j.slug;
  await W.built(race);
  mail = await W.mailAfter(from, /Subject: \[LOKA Atlas\] layers waiting: Race/);
  from = W.out.length;
  const both = (await Promise.all([W.press(W.link(mail, 'Add them')), W.press(W.link(mail, 'Add them'))])).map((t) => (/being added/.test(t) ? 'added' : /no layers waiting/.test(t) ? 'nothing' : t)).sort();
  check('one press adds, the other finds nothing left to do', both, ['added', 'nothing']);
  done = await until(async () => { const i = await W.inst(race); return i && i.status === 'built' && i.layers.includes('roads') ? i : null; }, 30000);
  await sleep(300);
  check('one rebuild, one mail, a clean record', [(W.out.slice(from).match(/Subject: \[LOKA Atlas\] adding Roads & streets: Race/g) || []).length, done && done.layers, done && done.rebuildPrior, done && done.pendingLayers], [1, ['labels', 'roads'], undefined, undefined]);

  console.log('\n  only its maker sees it: a public build with layers waiting is refused');
  r = await W.call('POST', '/instances', { cookie: owner, body: { title: 'Public too soon', org: 'Check', region: { worldwide: true }, layers: ['labels', 'roads'], visibility: 'public' } });
  check('in plain words', [r.status, r.j.error], [400, 'While Roads & streets waits for a yes from the LOKA team, the atlas starts private. Build it private, and open it to others once they have answered.']);

  console.log('\n  an email is still needed when anything waits');
  r = await W.call('POST', '/instances', { body: { title: 'No email', org: 'Check', region: { worldwide: true }, layers: ['labels', 'roads'] } });
  check('signed out, a build is refused as it always was', r.status, 401);
} catch (e) {
  fail++;
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + W.out.slice(-1500));
} finally {
  W.cleanup();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
