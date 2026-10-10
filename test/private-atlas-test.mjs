/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* A private atlas is one whose files have LEFT the public web root. The Owner
   menu used to say "Make it private" and only unlist the atlas from the
   gallery, leaving a survey with people's names in it downloadable by anyone
   with the address (October 2026). These checks hold the three parts to the
   truth: the words the owner sees, the routes those words call, and the way
   every file of a private atlas is fetched.

   The second half starts the real server on a spare port with a throwaway
   data folder (LOKA_DATA_DIR) and a throwaway atlas in atlas/datasets, makes
   it private, and watches the files move. It needs api/node_modules; where
   that is missing it says so and counts those checks as failed rather than
   quietly skipping them. */

const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const share = fs.readFileSync(ROOT + '/atlas/share.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const jobs = fs.readFileSync(ROOT + '/api/lib/atlas/jobs.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const addData = fs.readFileSync(ROOT + '/atlas/add-data/index.html', 'utf8');
const setupPage = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const setupJs = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the owner’s words name the real thing');
check('the switch that only unlisted is gone', /toggleLive/.test(owner), false);
check('nothing on screen is called "Make it private" or "Make it live" any more',
  /"Make it private"|"Make it live"/.test(owner), false);
check('the menu line reads one of three states',
  /private: \["Private", "— only you, your editors and people with the private link"\]/.test(owner) &&
  /link: \["Anyone with the link", "— not listed on the LOKA Atlas page"\]/.test(owner) &&
  /listed: \["Listed", "— anyone with the link, and on the LOKA Atlas page"\]/.test(owner), true);
check('private means the files have left the web root, and the owner is told so',
  /Its files leave the open web\./.test(owner), true);
check('"anyone with the link" says they can download the data too',
  /anyone who has the address can open it and download its data/.test(owner), true);
check('making it private calls the details route with visibility, never publish/unpublish',
  /api\("instances\/" \+ slug \+ "\/details", \{ method: "POST", body: \{ visibility: "private" \} \}\)/.test(owner), true);
check('making it public again moves the files back the same way',
  /body: \{ visibility: "public" \}/.test(owner), true);
check('listing is the publish route, on a public atlas only',
  /want === "listed"[\s\S]*?\/publish", \{ method: "POST" \}/.test(owner), true);
check('a new private link is its own route, and the old one is said to stop working',
  /\/view-key", \{ method: "POST" \}/.test(owner) && /The old link stops working for everyone who has it\./.test(share), true);
check('the first-look card no longer promises "only you can see it"',
  /Only you can see it until it is live/.test(owner), false);
check('it says what is true of a fresh atlas instead, following the record',
  /INST\.visibility === "private"\n\s*\? "Right now it is private — only you can open it\. Share has a private link to send to people, and the Owner menu can open it to everyone\."/.test(owner) &&
  /: "Right now anyone with the link can open it, and it is not listed on the LOKA Atlas page/.test(owner), true);
check('the wizard says a new atlas is private, before the build and after it',
  /It starts private — only you can open it; share it or open it to everyone under\s+Owner ▾\./.test(setupPage) && /It is private — only you can open it\. Share has a private link/.test(setupPage), true);
check('and never claims the old default', /anyone with the link can open it/.test(setupPage), false);
check('the private page’s sign-in line comes back to the atlas',
  /href="\.\/setup\/\?back=' \+ encodeURIComponent\(DATASET\) \+ '">sign in<\/a> and it opens for you/.test(viewer) &&
  /var back = \/\(\^\|\[\?&\]\)back=\(\[a-z0-9\]\[a-z0-9-\]\{0,60\}\)\(&\|\$\)\/\.exec\(location\.search\);\n\s*if \(back\) \{ location\.replace\("\.\.\/\?dataset=" \+ encodeURIComponent\(back\[2\]\)\); return; \}/.test(setupJs), true);
check('only the owner is offered the change (not editors), and not mid-build',
  /act\.hidden = INST\.role !== "owner" \|\| INST\.status === "building" \|\| INST\.status === "pending-approval";/.test(owner), true);

console.log('\n  search by meaning takes one road, whichever folder the atlas is in');
const imports = fs.readFileSync(ROOT + '/api/lib/atlas/imports.js', 'utf8');
const deployScript = fs.readFileSync(ROOT + '/deploy/queue-meaning-index.mjs', 'utf8');
const capabilities = fs.readFileSync(ROOT + '/LOKA-ATLAS-CAPABILITIES.md', 'utf8');
check('an atlas is looked up in both folders, by one function', /const DATASET_ROOTS = \[DATASETS_ROOT, PRIVATE_ROOT\];/.test(imports) &&
  /export function datasetDir\(id\) \{[\s\S]*?for \(const root of DATASET_ROOTS\)/.test(imports), true);
check('every gate on the embedding model is one test, so a stand-in can take the same road',
  (server.match(/embedReady\(\)/g) || []).length >= 5 && /if \(Object\.keys\(rowVecs\)\.length && embedReady\(\) && geminiAllowed\(req\)\)/.test(server), true);
check('the stand-in’s vectors are labelled as its own, so a real model never trusts them',
  /const embedModelName = \(\) => \(FAKE_EMBED \? 'stand-in' : getEmbedModel\(\)\);/.test(server) &&
  /h\.model !== embedModelName\(\)/.test(server) && /model: embedModelName\(\)/.test(server), true);
check('a draft is searched under its parent’s permission, as its files are read',
  /const searchInst = reg\.getInstance\(dataset\.split\('--draft-'\)\[0\]\);/.test(server) && /const slug = folder\.split\('--draft-'\)\[0\];/.test(server), true);
check('the meaning index has an operator’s list the server works, like the questions and the short names',
  /const meaningQueue = createQueue\(\{ file: MEANING_INDEX_FILE \}\);/.test(server) && /meaningQueue\.start\(meaningIndexJob\);/.test(server) &&
  /setInterval\(\(\) => meaningQueue\.pump\(\), 60 \* 1000\)\.unref\(\);/.test(server), true);
check('the list is filled by a deploy script that dries by default, applies on request and never touches deoria',
  /argv\.includes\('--apply'\)/.test(deployScript) && /NEVER_READ\.has\(slug\)/.test(deployScript) && /DEFAULT_ROOTS = \[\n\s*path\.join\(REPO, 'atlas', 'datasets'\),\n\s*path\.join\(REPO, 'api', 'data', 'atlas', 'private-datasets'\),/.test(deployScript), true);
check('a private file is kept as a copy the browser must ask about, as a public one is — never as one it may reuse unasked',
  [/res\.setHeader\('Cache-Control', 'private, no-cache, must-revalidate'\);/.test(server) && /if \(req\.headers\['if-none-match'\] === etag\) return res\.status\(304\)\.end\(\);/.test(server),
   /Cache-Control', 'no-store'/.test(server.slice(server.indexOf("router.get('/datasets/:slug/:file'"), server.indexOf("DATA-TO-LAYER MODULE")))], [true, false]);
check('the edit-token email carries the atlas’s address whichever kind it is',
  /const link = `\$\{siteBase\(req\)\}\/apps\/atlas\/a\/\$\{inst\.slug\}` \+ \(inst\.visibility === 'private'/.test(server), true);
check('the capabilities note no longer calls meaning search a public-only thing, and states the rule',
  [/a private atlas gets word matching only/.test(capabilities), /The parity rule/.test(capabilities)], [false, true]);

console.log('\n  the Share panel agrees with the status line');
check('it takes the three states', /function stateOf\(opts\)/.test(share) && /if \(opts\.state\) return opts\.state;/.test(share), true);
check('a private link carries the key', /u\.searchParams\.set\("key", key\)/.test(share), true);
check('and a public link never does', /u\.searchParams\.delete\("key"\)/.test(share), true);
check('a private atlas with no key on record is offered a new link, not a dead one',
  /if \(isPrivate && !opts\.viewKey\)/.test(share) && /"Make a private link"/.test(share), true);
check('no WhatsApp/Post/Email buttons and no embed code for a private atlas',
  /share intents \(never for private maps\)/.test(share) && /if \(!isPrivate\) \{\n\s*\/\/ the snippet lands/.test(share), true);
check('the old "isn’t live yet — works only for you" warning is gone (it was false)',
  /isn't live yet/.test(share), false);
check('the owner’s tools feed it state, key and the way to a new link',
  /o\.state = stateOf\(\);/.test(owner) && /o\.viewKey = INST\.viewKey \|\| "";/.test(owner) && /o\.renew = INST\.role === "owner" \? renewLink : null;/.test(owner), true);

console.log('\n  every file of the atlas is fetched through the key-aware helper');
check('dataUrl carries the key and switches root', /function dataUrl\(file, ver\)/.test(viewer) && /if \(KEY\) q\.push\("key=" \+ encodeURIComponent\(KEY\)\);/.test(viewer), true);
// every fetch(...) in the viewer that is not an API call or a basemap style goes through dataUrl/layerUrl
const fetches = [...viewer.matchAll(/fetch\(([^,)]+)/g)].map((m) => m[1].trim());
const notHelper = fetches.filter((f) => !/^dataUrl\(|^layerUrl\(|^"\.\/api\/|^vector\.url$/.test(f));
check('no fetch in atlas.js builds a dataset path by hand', notHelper, []);
check('manifest, local overlay, layers, logo and images all use it',
  /fetch\(dataUrl\("manifest\.json"\)/.test(viewer) && /fetch\(dataUrl\("manifest\.local\.json"\)/.test(viewer) &&
  /fetch\(layerUrl\(L\)\)/.test(viewer) && /img\.src = dataUrl\(b\.logo\)/.test(viewer) && /url: dataUrl\(meta\.image\)/.test(viewer), true);
check('the literal "./datasets/" address appears only where BASE is set (first load, API fallback, a reboot)',
  (viewer.match(/"\.\/datasets\/"/g) || []).length, 3);
check('the owner’s tools ask the viewer for a file’s address rather than guessing', /fileUrl: function \(nameOrLayer\)/.test(viewer), true);
check('search sends the key along', /body: JSON\.stringify\(\{ dataset: DATASET, q: q, key: KEY \|\| undefined \}\)/.test(viewer), true);
check('a static 404 is followed by one question to the API, so the owner needs no ?via=api',
  /function fetchManifest\(\)/.test(viewer) && /VIA_API = true;\n\s*BASE = "\.\/api\/datasets\/" \+ DATASET \+ "\/";/.test(viewer), true);
check('403 becomes a page that says the atlas is private, not a broken map',
  /e\.privateAtlas = true;/.test(viewer) && /"This atlas is private"/.test(viewer), true);
check('a dead private link is told apart from no link',
  /This private link no longer works — the owner has made a new one/.test(viewer), true);
check('the data bench previews a private draft through the API', /var VIA = PRIVATE \? "&via=api" : "";/.test(bench) && /private: inst\.visibility === "private",/.test(addData), true);

console.log('\n  the server keeps a private atlas out of the web root');
check('details with visibility moves the folder, owner only, and unlists',
  /if \(callerRole\(req, inst\) !== 'owner'\) return res\.status\(403\)\.json\(\{ error: 'only the owner can change who may see this atlas' \}\);/.test(server) &&
  /if \(inst\.status === 'published'\) \{ patch\.status = 'built'; patch\.publishedAt = null; \}/.test(server), true);
check('a private atlas cannot be listed', /a private atlas cannot be listed/.test(server), true);
check('a new atlas is private unless the request says public, in one place on the server',
  /const visibility = b\.visibility === 'public' \? 'public' : 'private';/.test(server) &&
  /b\.visibility === 'private' \? 'private' : 'public'/.test(server) === false, true);
check('the wizard sends no visibility at all, so it gets the server’s rule',
  /visibility/.test(setupJs.slice(setupJs.indexOf('api("instances", {'), setupJs.indexOf('api("instances", {') + 600)), false);
check('there is a route for a new private link, owner only, private only',
  /router\.post\('\/instances\/:slug\/view-key'/.test(server) && /only the owner can make a new private link/.test(server), true);
check('the key is kept so the link can be shown again; the hash is what is checked',
  /patch\.viewKey = viewKey;/.test(server) && /reg\.hashToken\(key\) === inst\.viewKeyHash/.test(server), true);
check('the gallery and the public record never carry it',
  /slug: i\.slug, title: i\.title, subtitle: i\.subtitle \|\| '', org: i\.org \|\| '',\n\s*regionLabel/.test(fs.readFileSync(ROOT + '/api/lib/atlas/registry.js', 'utf8')), true);
check('a private atlas is BUILT inside the private root, never in the web root first',
  /const buildDir = path\.join\(targetRoot, '\.building-' \+ spec\.slug\);/.test(jobs) &&
  /path\.join\(DATASETS_ROOT, '\.building-'/.test(jobs), false);
check('and a stranded build is cleaned from both roots', /for \(const root of \[DATASETS_ROOT, PRIVATE_ROOT\]\) \{\n\s*try \{ fs\.rmSync\(path\.join\(root, '\.building-'/.test(jobs), true);

/* ---------------- the operator's script, on a throwaway folder ---------------- */

console.log('\n  the deploy script finds layers without a meaning index in both folders, and never deoria');
{
  const { survey } = await import('../deploy/queue-meaning-index.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-meaning-check-'));
  const pub = path.join(tmp, 'datasets'), priv = path.join(tmp, 'private-datasets');
  const mk = (root, slug, withVec) => {
    const d = path.join(root, slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ title: slug, layers: [] }));
    fs.writeFileSync(path.join(d, 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'rows', label: 'Rows', type: 'geojson', source: 'user-rows.geojson', userLayer: true }] }));
    fs.writeFileSync(path.join(d, 'user-rows.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { name: 'x' } }] }));
    if (withVec) {
      const st = fs.statSync(path.join(d, 'user-rows.geojson'));
      fs.writeFileSync(path.join(d, 'search-rows.vec'), JSON.stringify({ v: 1, sig: st.size + ':' + Math.round(st.mtimeMs), model: 'gemini-embedding-001', dim: 768, count: 1 }) + '\n');
    }
  };
  mk(pub, 'open-one', false); mk(priv, 'closed-one', false); mk(priv, 'closed-done', true); mk(pub, 'deoria-bioregion', false);
  const r = survey([pub, priv], 'gemini-embedding-001');
  check('it lists the public and the private layer alike, and not the one already built',
    r.want.map((w) => w.dataset + ':' + w.where + ':' + w.state).sort(), ['closed-one:private:missing', 'open-one:public:missing']);
  check('deoria is skipped out loud', r.skipped.map((x) => x.dataset), ['deoria-bioregion']);
  check('a side-file from another model counts as stale', survey([pub, priv], 'some-newer-model').want.some((w) => w.dataset === 'closed-done' && /stale/.test(w.state)), true);
  const q = path.join(tmp, 'meaning-index.json');
  const run = () => spawn(process.execPath, [path.join(ROOT, 'deploy', 'queue-meaning-index.mjs'), '--apply', '--queue', q, pub, priv], { encoding: 'utf8' });
  const runOut = (p) => new Promise((ok) => { let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => ok(o)); });
  const o1 = await runOut(run());
  check('--apply puts both on the list', [/2 added\./.test(o1), Object.keys(JSON.parse(fs.readFileSync(q, 'utf8'))).sort()], [true, ['closed-one|rows', 'open-one|rows']]);
  check('and running it again adds nothing', /0 added\./.test(await runOut(run())), true);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------------- the routes, against a real server ---------------- */

const PORT = 8600 + Math.floor(Math.random() * 300);
const BASEURL = `http://127.0.0.1:${PORT}`;
const SLUG = 'private-check-' + Math.random().toString(36).slice(2, 7);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-private-check-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', SLUG);
const PRIV = path.join(DATA, 'private-datasets', SLUG);
const OWNER = 'owner@example.test', OTHER = 'other@example.test';

function manifest() {
  return { title: 'Private check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }],
    layers: [{ id: 'rows', label: 'Rows', type: 'geojson', source: 'user-rows.geojson' }] };
}
fs.mkdirSync(PUB, { recursive: true });
fs.writeFileSync(path.join(PUB, 'manifest.json'), JSON.stringify(manifest()));
fs.writeFileSync(path.join(PUB, 'user-rows.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [77, 12] }, properties: { name: 'Asha', answer: 'yes', note: 'handloom weaving cooperative' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [77, 13] }, properties: { name: 'Kabir', answer: 'no', note: 'terracotta pottery kiln' } }] }));
fs.mkdirSync(DATA, { recursive: true });
/* The operator's list (deploy/queue-meaning-index.mjs writes it; the server
   works it). The throwaway layer is put on it before the server starts, the
   way a live server finds it after a deploy, so the first search already has
   the index — what the script is for. */
const fileSig = (() => { const st = fs.statSync(path.join(PUB, 'user-rows.geojson')); return st.size + ':' + Math.round(st.mtimeMs); })();
fs.writeFileSync(path.join(DATA, 'meaning-index.json'), JSON.stringify({
  [SLUG + '|rows']: { dataset: SLUG, layerId: 'rows', sig: fileSig, payer: 'server', state: 'queued', reason: '', queuedAt: 1, at: 1 } }));
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [SLUG]: { slug: SLUG, title: 'Private check', visibility: 'public', status: 'published', publishedAt: 1,
    ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [], tokenHash: 'x', viewKeyHash: null, createdAt: 1 } },
  accounts: { [OWNER]: { email: OWNER, instances: [SLUG], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
  drafts: {},
}));

let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [PUB, PRIV, DATA]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  for (const d of fs.readdirSync(path.join(ROOT, 'atlas', 'datasets'))) {
    // the throwaway atlas, and the two the create checks make (their slugs carry SLUG)
    if (d.includes(SLUG)) { try { fs.rmSync(path.join(ROOT, 'atlas', 'datasets', d), { recursive: true, force: true }); } catch {} }
  }
}
process.on('exit', cleanup);

async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', ATLAS_OWNER_EMAILS: 'nobody@example.test',
      // no model here: the stand-in embeds by letter-triples so the ROAD a
      // search by meaning takes can be checked on both kinds of atlas
      ATLAS_FAKE_EMBED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) throw new Error('server did not start:\n' + out.slice(-800));
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function signIn(email) {
  const before = out.length;
  let r = await fetch(BASEURL + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('request-link ' + r.status);
  const t0 = Date.now();
  let code = null;
  while (!code) {
    const m = /Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(out.slice(before));
    if (m) code = m[1];
    else if (Date.now() - t0 > 5000) throw new Error('no code in the log');
    else await new Promise((r) => setTimeout(r, 50));
  }
  r = await fetch(BASEURL + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  if (!r.ok) throw new Error('verify-code ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
const J = { 'Content-Type': 'application/json' };
async function call(method, p, { cookie, body } = {}) {
  const r = await fetch(BASEURL + p, { method, headers: { ...J, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const STATIC = `/apps/atlas/datasets/${SLUG}/user-rows.geojson`;
const API = `/apps/atlas/api/datasets/${SLUG}/user-rows.geojson`;

try {
  console.log('\n  the routes, on a throwaway server (' + BASEURL + ')');
  await startServer();
  const ownerC = await signIn(OWNER);
  const otherC = await signIn(OTHER);

  check('a public atlas’s rows are a static file anyone can fetch', (await call('GET', STATIC)).status, 200);
  check('and the private route does not serve a public atlas', (await call('GET', API)).status, 404);

  /* Search by meaning, on the public atlas first. The query shares no word
     with any row — "zhandloom zweaving zcooperative" is nowhere in the data —
     so word matching finds nothing and only the meaning pass can answer. */
  console.log('\n  search by meaning is the same road for both kinds of atlas');
  const MEANING_Q = 'zhandloom zweaving zcooperative';
  const search = (opts) => call('POST', '/api/atlas/layers/search', { body: Object.assign({ dataset: SLUG, q: MEANING_Q }, opts && opts.body), cookie: opts && opts.cookie });
  const untilSemantic = async (opts) => {
    const t0 = Date.now();
    let r = await search(opts);
    while (!(r.j && r.j.semantic) && Date.now() - t0 < 6000) { await new Promise((x) => setTimeout(x, 150)); r = await search(opts); }
    return r;
  };
  const titlesOf = (r) => ((r.j && r.j.hits) || []).flatMap((h) => h.features.map((f) => f.title + (f.score != null ? '*' : '')));
  const t1 = Date.now();
  while (!fs.existsSync(path.join(PUB, 'search-rows.vec')) && Date.now() - t1 < 6000) await new Promise((x) => setTimeout(x, 100));
  check('the operator’s list built the layer’s index before anyone searched', fs.existsSync(path.join(PUB, 'search-rows.vec')), true);
  const listed = JSON.parse(fs.readFileSync(path.join(DATA, 'meaning-index.json'), 'utf8'))[SLUG + '|rows'];
  check('and the list says so', listed && listed.state, 'done');
  const pubAnswer = await search();
  check('a public atlas answers by meaning: scoring ran, and only the close row is found',
    [pubAnswer.status, pubAnswer.j.semantic, pubAnswer.j.matched, titlesOf(pubAnswer)], [200, true, 1, ['asha · yes · handloom weaving cooperative*']]);
  check('words still win when they match', titlesOf(await call('POST', '/api/atlas/layers/search', { body: { dataset: SLUG, q: 'kabir' } })), ['kabir · no · terracotta pottery kiln*']);

  check('a stranger cannot make it private', (await call('POST', `/api/atlas/instances/${SLUG}/details`, { cookie: otherC, body: { visibility: 'private' } })).status, 403);
  check('nor can nobody', (await call('POST', `/api/atlas/instances/${SLUG}/details`, { body: { visibility: 'private' } })).status, 403);
  const made = await call('POST', `/api/atlas/instances/${SLUG}/details`, { cookie: ownerC, body: { visibility: 'private' } });
  check('the owner can, and gets the key once', [made.status, made.j && made.j.visibility, typeof (made.j && made.j.viewKey)], [200, 'private', 'string']);
  const key1 = made.j.viewKey;
  check('it was listed; making it private unlisted it', made.j.status, 'built');
  check('the folder left the web root', [fs.existsSync(PUB), fs.existsSync(path.join(PRIV, 'user-rows.geojson'))], [false, true]);
  check('the public address no longer serves the rows', (await call('GET', STATIC)).status, 404);
  check('the private route refuses a stranger with no key', (await call('GET', API)).status, 403);
  check('and a signed-in stranger', (await call('GET', API, { cookie: otherC })).status, 403);
  check('and a wrong key', (await call('GET', API + '?key=wrong')).status, 403);
  check('the key opens it, signed out', (await call('GET', API + '?key=' + encodeURIComponent(key1))).status, 200);
  check('so does the manifest, and it is the atlas', (await call('GET', `/apps/atlas/api/datasets/${SLUG}/manifest.json?key=` + encodeURIComponent(key1))).j.title, 'Private check');
  check('the owner opens it by sign-in alone', (await call('GET', API, { cookie: ownerC })).status, 200);

  /* Caching: the same bargain as the public folder. A copy may be kept, but
     every use asks the server first, and the server checks who is asking
     before it says "unchanged". */
  const headed = (p, h) => fetch(BASEURL + p, { headers: h || {} });
  const r1 = await headed(API + '?key=' + encodeURIComponent(key1));
  const tag = r1.headers.get('etag');
  check('a private file comes with a tag and a must-ask cache rule', [r1.status, !!tag, r1.headers.get('cache-control'), r1.headers.get('content-length') != null], [200, true, 'private, no-cache, must-revalidate', true]);
  check('asking again with the tag gets "unchanged", not the bytes', (await headed(API + '?key=' + encodeURIComponent(key1), { 'If-None-Match': tag })).status, 304);
  check('a stranger with the same tag gets the refusal, never "unchanged"', (await headed(API, { 'If-None-Match': tag })).status, 403);
  check('nor can a signed-in stranger', (await headed(API, { 'If-None-Match': tag, Cookie: otherC })).status, 403);
  check('and in dev the data folder is not a static address either', (await headed('/apps/api/data/atlas/registry.json')).status, 403);
  /* A draft of a private atlas (<slug>--draft-<import>) is read under its
     parent's permission — for its files already, and now for search too. */
  const DRAFT = SLUG + '--draft-abc123';
  fs.mkdirSync(path.join(DATA, 'private-datasets', DRAFT), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'private-datasets', DRAFT, 'manifest.json'), JSON.stringify(manifest()));
  fs.copyFileSync(path.join(PRIV, 'user-rows.geojson'), path.join(DATA, 'private-datasets', DRAFT, 'user-rows.geojson'));
  check('a private atlas’s draft cannot be searched without the key', (await call('POST', '/api/atlas/layers/search', { body: { dataset: DRAFT, q: 'kabir' } })).status, 403);
  check('and can be with it', (await call('POST', '/api/atlas/layers/search', { body: { dataset: DRAFT, q: 'kabir', key: key1 } })).j.matched, 1);
  // the search just now wrote the draft's own index files in the background; give them a moment
  for (let i = 0; i < 20 && fs.existsSync(path.join(DATA, 'private-datasets', DRAFT)); i++) {
    try { fs.rmSync(path.join(DATA, 'private-datasets', DRAFT), { recursive: true, force: true }); } catch { await new Promise((x) => setTimeout(x, 100)); }
  }

  /* Now private. The index moved with the folder, so the very first search
     with the key answers exactly as the public atlas did — same rows, same
     scores. Then the index is taken away, and the private atlas builds it
     again on the first search, the way a public one does: word matching
     first, meaning a moment later. */
  check('the index moved with the folder', fs.existsSync(path.join(PRIV, 'search-rows.vec')), true);
  const privAnswer = await search({ body: { key: key1 } });
  check('the private atlas answers by meaning to the key, and the answer is the public one', [privAnswer.status, privAnswer.j], [200, pubAnswer.j]);
  check('and to the owner’s sign-in alone', (await search({ cookie: ownerC })).j, pubAnswer.j);
  check('a stranger gets no answer at all, not a wordier one', (await search({ cookie: otherC })).status, 403);
  // the places change (a re-commit rewrites the layer's file): the index is stale
  const gj = JSON.parse(fs.readFileSync(path.join(PRIV, 'user-rows.geojson'), 'utf8'));
  gj.features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [77, 14] }, properties: { name: 'Meera', answer: 'yes', note: 'bamboo basket makers' } });
  fs.writeFileSync(path.join(PRIV, 'user-rows.geojson'), JSON.stringify(gj));
  const first = await search({ body: { key: key1 } });
  check('when the places change, the first search is words only — on a private atlas as on a public one', [first.status, first.j.semantic, first.j.matched, first.j.total], [200, false, 0, 3]);
  const again = await untilSemantic({ body: { key: key1 } });
  const vecHeader = (() => { try { return JSON.parse(fs.readFileSync(path.join(PRIV, 'search-rows.vec')).toString('utf8').split('\n')[0]); } catch { return null; } })();
  check('and the private atlas builds its own index from that search, for the new version of the file',
    [vecHeader && vecHeader.count, again.j.semantic, again.j.hits], [3, true, pubAnswer.j.hits]);

  check('the gallery does not list it', ((await call('GET', '/api/atlas/instances')).j.instances || []).some((i) => i.slug === SLUG), false);
  check('a stranger asking about it is told nothing', (await call('GET', `/api/atlas/instances/${SLUG}`, { cookie: otherC })).status, 404);
  const mine = (await call('GET', `/api/atlas/instances/${SLUG}`, { cookie: ownerC })).j;
  check('the owner’s record carries the key and never the hashes', [mine.viewKey === key1, 'viewKeyHash' in mine, 'tokenHash' in mine], [true, false, false]);
  check('a private atlas cannot be listed', (await call('POST', `/api/atlas/instances/${SLUG}/publish`, { cookie: ownerC })).status, 409);
  check('search without a key is refused too', (await call('POST', '/api/atlas/layers/search', { body: { dataset: SLUG, q: 'asha' } })).status, 403);
  check('and allowed with it', (await call('POST', '/api/atlas/layers/search', { body: { dataset: SLUG, q: 'asha', key: key1 } })).status, 200);

  check('a stranger cannot make a new link', (await call('POST', `/api/atlas/instances/${SLUG}/view-key`, { cookie: otherC })).status, 403);
  const renewed = await call('POST', `/api/atlas/instances/${SLUG}/view-key`, { cookie: ownerC });
  const key2 = renewed.j && renewed.j.viewKey;
  check('the owner can, and it is a different key', [renewed.status, typeof key2 === 'string' && key2 !== key1], [200, true]);
  check('the old link stops working', (await call('GET', API + '?key=' + encodeURIComponent(key1))).status, 403);
  check('the new one works', (await call('GET', API + '?key=' + encodeURIComponent(key2))).status, 200);

  const back = await call('POST', `/api/atlas/instances/${SLUG}/details`, { cookie: ownerC, body: { visibility: 'public' } });
  check('making it public again moves the folder back', [back.status, fs.existsSync(path.join(PUB, 'user-rows.geojson')), fs.existsSync(PRIV)], [200, true, false]);
  check('the static address serves again', (await call('GET', STATIC)).status, 200);
  check('the private route goes quiet', (await call('GET', API + '?key=' + encodeURIComponent(key2))).status, 404);
  check('and the key is forgotten', (await call('GET', `/api/atlas/instances/${SLUG}`, { cookie: ownerC })).j.viewKey, null);
  check('a public atlas can be listed', (await call('POST', `/api/atlas/instances/${SLUG}/publish`, { cookie: ownerC })).status, 200);
  check('and then it is in the gallery', ((await call('GET', '/api/atlas/instances')).j.instances || []).some((i) => i.slug === SLUG), true);
  check('a new-link request on a public atlas is refused', (await call('POST', `/api/atlas/instances/${SLUG}/view-key`, { cookie: ownerC })).status, 409);

  /* A brand-new atlas from the create route, exactly as the wizard asks for
     one — no visibility in the request. The build itself is not the point
     (it needs the Python builder, which this check does not assume); what is
     checked is the record, where its files may be, and who is turned away. */
  console.log('\n  a new atlas starts private');
  const fresh = await call('POST', '/api/atlas/instances', { cookie: ownerC, body: { title: 'Fresh ' + SLUG, org: 'Check', region: { worldwide: true }, layers: [] } });
  const FRESH = fresh.j && fresh.j.slug;
  check('the wizard’s request is taken and answered with a private link', [fresh.status, typeof FRESH, typeof (fresh.j && fresh.j.viewKey)], [200, 'string', 'string']);
  const freshRec = (await call('GET', `/api/atlas/instances/${FRESH}`, { cookie: ownerC })).j;
  check('the record says private and carries the key', [freshRec && freshRec.visibility, freshRec && freshRec.viewKey === fresh.j.viewKey], ['private', true]);
  check('a stranger is turned away from its files before any file exists', (await call('GET', `/apps/atlas/api/datasets/${FRESH}/manifest.json`)).status, 403);
  check('and a signed-in stranger too', (await call('GET', `/apps/atlas/api/datasets/${FRESH}/manifest.json`, { cookie: otherC })).status, 403);
  check('a stranger asking about it is told nothing', (await call('GET', `/api/atlas/instances/${FRESH}`, { cookie: otherC })).status, 404);
  // wait briefly for the build to settle one way or the other, then look at the disk
  const t0 = Date.now();
  let job = null;
  while (Date.now() - t0 < 20000) {
    job = (await call('GET', `/api/atlas/jobs/${fresh.j.jobId}`)).j;
    if (job && (job.status === 'done' || job.status === 'failed')) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const pubRoot = path.join(ROOT, 'atlas', 'datasets');
  const inPublic = fs.readdirSync(pubRoot).filter((d) => d === FRESH || d === '.building-' + FRESH);
  check('nothing of it is under the public root, built or building', inPublic, []);
  if (job && job.status === 'done') {
    check('its files are under the private root', fs.existsSync(path.join(DATA, 'private-datasets', FRESH, 'manifest.json')), true);
    check('the owner opens it by sign-in alone', (await call('GET', `/apps/atlas/api/datasets/${FRESH}/manifest.json`, { cookie: ownerC })).status, 200);
    check('so does the private link, signed out', (await call('GET', `/apps/atlas/api/datasets/${FRESH}/manifest.json?key=` + encodeURIComponent(fresh.j.viewKey))).status, 200);
    check('the public address does not serve it', (await call('GET', `/apps/atlas/datasets/${FRESH}/manifest.json`)).status, 404);
  } else {
    console.log('  (the build did not finish here — ' + (job ? job.status + ': ' + job.message : 'no job') + ' — so the built-files checks are not run)');
  }
  check('asking for public in so many words still gets a public atlas',
    (await call('POST', '/api/atlas/instances', { cookie: ownerC, body: { title: 'Open ' + SLUG, org: 'Check', region: { worldwide: true }, layers: [], visibility: 'public' } })).j.viewKey, undefined);
} catch (e) {
  fail++;
  console.log('  FAIL  the route checks could not run: ' + e.message);
}
cleanup();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
