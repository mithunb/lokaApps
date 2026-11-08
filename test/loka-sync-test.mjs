/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Keeping an atlas up to date from a LOKA space (api/lib/atlas/loka-sync.js and
   the /instances/:slug/loka-sync routes in api/apps/atlas.js), against a pretend
   LOKA server on 127.0.0.1 and a throwaway atlas server in a temporary data
   folder. Nothing under atlas/datasets/ or api/data/ is touched, no real LOKA
   key exists here, and the people in the pretend places are invented. */
import { toRow, toRows, lay, mergeNewReading, EXPORT_COLUMNS, UNREAD } from '../api/lib/atlas/loka-sync.js';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(60); }
  return null;
}

/* ---------------- the row: the columns of a LOKA export file ---------------- */
// the header of the real export (bengaluru-tags.csv)
const EXPORT_HEADER = 'tag_id,description,categories,labels,created_by,created_by_user_id,created_at,latitude,longitude,address,likes,comments,photo_count,photo_urls,photo_1_url,photo_2_url,photo_3_url,photo_4_url,thumbnail_url,public_link,spaces';
const SPACE = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const PERSON = 'c0000000-0000-4000-8000-000000000001';
const tid = (n) => '00000000-0000-4000-8000-00000000000' + n;
const tag = (n, over) => Object.assign({
  id: tid(n), description: 'Place number ' + n + ' with a pond by the old school and a long walk', labels: ['quiet', 'pond'], categories: ['Nature'],
  latitude: 12.9 + n / 100, longitude: 77.5 + n / 100, address: n + ' Example Road', created_at: '2026-07-0' + n + 'T07:05:53.375738+00:00',
  likes_count: 0, comments_count: 0, thumbnail: null, creator: PERSON, creatorName: 'Example Person', spaceIds: [SPACE],
  updated_at: '2026-07-0' + n + 'T07:05:53+00:00', thumbnail_url: 'https://loka.example/api/images/thumb_' + n + '.jpg',
  image_urls: ['https://loka.example/api/images/a' + n + '.jpg', 'https://loka.example/api/images/b' + n + '.jpg'] }, over || {});

console.log('\n  one place, one row');
{
  const r = toRow(tag(1), 'Example space');
  check('exactly the export columns, in the export\'s order', Object.keys(r).join(','), EXPORT_HEADER);
  check('the same list as the module names', EXPORT_COLUMNS.join(','), EXPORT_HEADER);
  check('lists joined with "; ", photos with " | "', [r.categories, r.labels, r.photo_urls], ['Nature', 'quiet; pond', 'https://loka.example/api/images/a1.jpg | https://loka.example/api/images/b1.jpg']);
  check('people columns from creatorName and creator', [r.created_by, r.created_by_user_id], ['Example Person', PERSON]);
  check('counts, photos, public link, space', [r.likes, r.comments, r.photo_count, r.photo_1_url, r.photo_3_url, r.public_link, r.spaces],
    [0, 0, 2, 'https://loka.example/api/images/a1.jpg', '', 'https://loka.place/t/' + tid(1), 'Example space']);
  const real = '/Users/mithunsheshagiri/work/bengaluru-tags.csv';
  if (fs.existsSync(real)) check('and the real export file has that very header', fs.readFileSync(real, 'utf8').replace(/^﻿/, '').split('\n')[0].trim(), EXPORT_HEADER);
  const t = toRows([tag(1), tag(2, { latitude: null }), tag(3, { longitude: 'x' }), tag(1)], 'S');
  check('a place with no position is left out and counted; a repeat is dropped', [t.rows.length, t.skipped], [1, 2]);
}

console.log('\n  laying a download beside what the atlas holds');
{
  const rows = [1, 2, 3, 4].map((n) => toRow(tag(n), 'S'));
  const stored = rows.map((r, i) => Object.assign({}, r, { pattern_1: 'K' + i, pattern_1_why: 'w', loka_name: 'Name ' + i, photo_small: 'small-' + i + '.jpg' }));
  const next = [rows[0], Object.assign({}, rows[1], { description: 'something else entirely' }), Object.assign({}, rows[2], { likes: 5 }), toRow(tag(5), 'S')];
  const out = lay(stored, next, { asking: true });
  check('counted: 1 new, 2 changed, 1 gone', [out.added, out.changed, out.removed], [1, 2, 1]);
  check('unchanged keeps its answers and its own columns', [out.rows[0].pattern_1, out.rows[0].loka_name, out.rows[0].photo_small, out.rows[0][UNREAD]], ['K0', 'Name 0', 'small-0.jpg', '']);
  check('changed words: answers and short name cleared, marked, small photo kept (photos same)', [out.rows[1].pattern_1, out.rows[1].loka_name, out.rows[1].photo_small, out.rows[1][UNREAD]], ['', '', 'small-1.jpg', '1']);
  check('changed only in likes: new value, answers kept, not marked', [out.rows[2].likes, out.rows[2].pattern_1, out.rows[2][UNREAD]], [5, 'K2', '']);
  check('new place is marked, the gone one is gone', [out.rows[3].tag_id, out.rows[3][UNREAD], out.rows.some((r) => r.tag_id === rows[3].tag_id)], [tid(5), '1', false]);
  const photos = lay(stored, [Object.assign({}, rows[0], { photo_urls: 'x', photo_1_url: 'x' })].concat(rows.slice(1)));
  check('changed photos lose their small photo', [photos.rows[0].photo_small, photos.changed], ['', 1]);
  check('a layer with no questions is not marked', lay([], rows, { asking: false }).rows.some((r) => r[UNREAD]), false);
  const long = toRow(tag(1, { description: 'x'.repeat(700) }), 'S');
  const saved = Object.assign({}, long, { description: long.description.slice(0, 500) });
  check('a description cut at 500 on saving is not a change', lay([saved], [long]).changed, 0);
  check('a different space name alone is not a change (a taken-over upload may carry another)', lay(stored.map((r) => Object.assign({}, r, { spaces: 'Old name' })), rows).changed, 0);
  const q = [{ question: 'Is it wet?', noun: '', columns: [], kinds: [{ name: 'Wet', definition: '' }] }];
  const rs = [{ pattern_1: 'Wet', pattern_1_why: 'pond, tank' }, { pattern_1: '' }, { pattern_1: '' }];
  const m1 = mergeNewReading(rs, [2], { pattern_1: 'Is it wet?' }, q, { questions: [{ question: ' Is it wet? ', categories: ['Wet'], why: [['lake']] }] });
  check('merge: wording matched trimmed; the marked place gets its answer, the others keep theirs', m1 && [m1.questions[0].categories, m1.questions[0].why], [['Wet', '', 'Wet'], [['pond', 'tank'], [], ['lake']]]);
  check('merge: a settled question with no answers for the marked places writes nothing at all',
    mergeNewReading(rs, [2], { pattern_1: 'Is it wet?' }, q, { questions: [{ question: 'Something else', categories: ['x'], why: [[]] }] }), null);
  // a settled question the reading retired (read from an address) is left out rather than matched
  const q2 = q.concat([{ question: 'Which area?', noun: '', columns: ['address'], kinds: [{ name: 'North', definition: '' }] }]);
  const m2 = mergeNewReading(rs.map((r) => Object.assign({ pattern_2: 'North' }, r)), [2], { pattern_1: 'Is it wet?', pattern_2: 'Which area?' }, q2,
    { questions: [{ question: 'Is it wet?', categories: ['Wet'], why: [['lake']] }], retired: [{ question: 'Which area?', columns: ['address'] }] });
  check('merge: a question the reading retired is left out, and the rest merge as before', m2 && m2.questions.map((x) => x.question), ['Is it wet?']);
  check('photo links saved with "; " between them are the same list as " | "', lay(stored.map((r) => Object.assign({}, r, { photo_urls: r.photo_urls.replace(' | ', '; ') })), rows).changed, 0);
  check('nothing different: nothing counted', (({ added, changed, removed }) => [added, changed, removed])(lay(stored, rows)), [0, 0, 0]);
}

/* ---------------- the pretend LOKA ---------------- */
const SECRETS = ['refresh-secret-zero', 'refresh-secret-one', 'refresh-secret-two', 'access-secret-one', 'access-secret-two', 'api-key-secret'];
function pretendLoka() {
  const st = { tags: [], mode: 'ok', delay: 0, refreshExpect: 'refresh-secret-zero', n: 0, refreshCalls: 0, downloads: [], base: '' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth/refresh' && req.method === 'POST') {
      st.refreshCalls += 1;
      if ((req.headers.authorization || '') !== 'Bearer ' + st.refreshExpect) { res.writeHead(401); return res.end('{}'); }
      st.n += 1;
      st.refreshExpect = st.n === 1 ? 'refresh-secret-one' : 'refresh-secret-two';
      st.access = st.n === 1 ? 'access-secret-one' : 'access-secret-two';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, token: st.access, refreshToken: st.refreshExpect }));
    }
    if (u.pathname === '/tags/download') {
      st.downloads.push({ auth: req.headers.authorization || '', key: req.headers['x-loka-api-key'] || '', query: u.search });
      const okAuth = req.headers['x-loka-api-key'] === 'api-key-secret' || req.headers.authorization === 'Bearer ' + st.access;
      if (!okAuth) { res.writeHead(401); return res.end('{}'); }
      if (st.mode === 'forbidden') { res.writeHead(403); return res.end('{}'); }
      if (st.mode === 'busy') { res.writeHead(429, { 'Retry-After': '170' }); return res.end('{}'); }
      if (st.delay) await sleep(st.delay);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const lines = st.tags.map((t) => JSON.stringify(t));
      if (st.mode === 'ok') lines.push(JSON.stringify({ _eof: true, count: st.tags.length, truncated: false, resolved_space_ids: null }));
      if (st.mode === 'truncated') lines.push(JSON.stringify({ _eof: true, count: st.tags.length, truncated: true, resolved_space_ids: null }));
      return res.end(lines.join('\n') + '\n');
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { st.base = 'http://127.0.0.1:' + server.address().port; st.close = () => server.close(); resolve(st); }));
}

/* ---------------- a throwaway atlas server ---------------- */
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test', ADMIN = 'admin@example.test';
function world(slug, lokaBase, extraEnv) {
  // its own range: 8600-9199 is shared by the other server tests, and they run side by side
  const PORT = 9400 + Math.floor(Math.random() * 300);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-sync-check-'));
  const W = { PORT, DATA, slug, out: '', child: null, base: 'http://127.0.0.1:' + PORT, seen: [] };
  for (const s of [slug, 'deoria-bioregion']) {
    const dir = path.join(DATA, 'private-datasets', s);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Sync check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
    fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [] }));
  }
  const inst = (s) => ({ slug: s, title: 'Sync check', visibility: 'private', status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
    tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }], branding: { orgName: 'Sync', hasLogo: false } });
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
    instances: { [slug]: inst(slug), 'deoria-bioregion': inst('deoria-bioregion') },
    accounts: Object.fromEntries([OWNER, EDITOR, OTHER, ADMIN].map((e) => [e, { email: e, instances: [], verifiedAt: 1 }])), drafts: {} }));
  W.start = async () => {
    W.out = '';
    W.child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
      env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1',
        ATLAS_FAKE_READING_MS: '900', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: ADMIN, ATLAS_ADMIN_EMAIL: ADMIN, ATLAS_ADMIN_TOKEN: '',
        LOKA_API_BASE: lokaBase, LOKA_REFRESH_TOKEN: '', LOKA_API_KEY: '', ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'] });
    W.child.stdout.on('data', (d) => { W.out += d; });
    W.child.stderr.on('data', (d) => { W.out += d; });
    const t0 = Date.now();
    while (!/listening on/.test(W.out)) {
      if (Date.now() - t0 > 15000 || W.child.exitCode != null) throw new Error('server did not start:\n' + W.out.slice(-800));
      await sleep(100);
    }
  };
  W.stop = () => { try { W.child && W.child.kill('SIGKILL'); } catch {} };
  W.cleanup = () => { W.stop(); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} };
  W.signIn = async (email) => {
    const before = W.out.length;
    let r = await fetch(W.base + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if (!r.ok) throw new Error('request-link ' + r.status);
    const code = await until(() => (/Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(W.out.slice(before)) || [])[1], 5000);
    r = await fetch(W.base + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
    if (!r.ok) throw new Error('verify-code ' + r.status);
    return (r.headers.get('set-cookie') || '').split(';')[0];
  };
  W.call = async (method, p, { cookie, body, slug: s } = {}) => {
    const r = await fetch(W.base + '/api/atlas/instances/' + (s || slug) + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    W.seen.push(JSON.stringify(j));
    return { status: r.status, j };
  };
  W.overlay = () => JSON.parse(fs.readFileSync(path.join(DATA, 'private-datasets', slug, 'manifest.local.json'), 'utf8'));
  W.layerRows = () => {
    const ov = W.overlay(), id = ov.lokaSync && ov.lokaSync.layerId;
    const L = (ov.layers || []).find((l) => l.id === id);
    if (!L) return null;
    return JSON.parse(fs.readFileSync(path.join(DATA, 'private-datasets', slug, L.source), 'utf8')).features.map((f) => f.properties);
  };
  W.layerRaw = () => {
    const ov = W.overlay(), L = (ov.layers || []).find((l) => l.id === (ov.lokaSync && ov.lokaSync.layerId));
    return L ? fs.readFileSync(path.join(DATA, 'private-datasets', slug, L.source), 'utf8') : '';
  };
  // wait for an update to finish: the route says it is not running and has a result
  W.finished = async (cookie, since) => until(async () => {
    const g = await W.call('GET', '/loka-sync', { cookie });
    return g.j && g.j.connected && !g.j.running && g.j.lastUpdate && g.j.lastUpdate.at !== since ? g.j.lastUpdate : null;
  });
  return W;
}

const loka = await pretendLoka();
const W = world('sync-check-' + Math.random().toString(36).slice(2, 7), loka.base, { LOKA_REFRESH_TOKEN: 'refresh-secret-zero' });
const K = world('sync-key-' + Math.random().toString(36).slice(2, 7), loka.base, { LOKA_API_KEY: 'api-key-secret' });
process.on('exit', () => { W.cleanup(); K.cleanup(); try { loka.close(); } catch {} });

try {
  await W.start();
  const owner = await W.signIn(OWNER), editor = await W.signIn(EDITOR), other = await W.signIn(OTHER), admin = await W.signIn(ADMIN);
  loka.tags = [1, 2, 3, 4].map((n) => tag(n, n === 2 ? { description: 'A pond behind the market, a quiet water tank' } : n === 3 ? { description: 'Market square with many stalls and loud traders' } : {}));

  console.log('\n  who may do what');
  const body = { spaceId: SPACE, spaceName: 'Example space' };
  check('a stranger may not look', (await W.call('GET', '/loka-sync', { cookie: other })).status, 403);
  check('nor connect', (await W.call('POST', '/loka-sync', { cookie: other, body })).status, 403);
  check('the owner may not connect either (only the operator, for now)', (await W.call('POST', '/loka-sync', { cookie: owner, body })).status, 403);
  check('nor an editor', (await W.call('POST', '/loka-sync', { cookie: editor, body })).status, 403);
  check('not connected: update is refused', (await W.call('POST', '/loka-sync/update', { cookie: editor })).status, 400);
  check('deoria-bioregion is refused, for the operator too', (await W.call('POST', '/loka-sync', { cookie: admin, body, slug: 'deoria-bioregion' })).status, 403);
  check('and its update', (await W.call('POST', '/loka-sync/update', { cookie: admin, slug: 'deoria-bioregion' })).status, 403);
  check('a space id that is not one is refused before LOKA is asked', (await W.call('POST', '/loka-sync', { cookie: admin, body: { spaceId: 'nope' } })).status, 400);
  check('the owner is told the operator may connect: not for them', (await W.call('GET', '/loka-sync', { cookie: owner })).j.canConnect, false);
  check('the operator is told they may', (await W.call('GET', '/loka-sync', { cookie: admin })).j.canConnect, true);
  check('LOKA was not asked by any of that', loka.downloads.length, 0);

  console.log('\n  connecting and the first update');
  let r = await W.call('POST', '/loka-sync', { cookie: admin, body });
  check('the operator connects: answered at once, work in the background', [r.status, r.j], [200, { started: true }]);
  let note = await W.finished(owner, undefined);
  check('four places brought in', note && [note.added, note.changed, note.removed, note.skipped, note.error], [4, 0, 0, 0, '']);
  check('the download asked for this space, as a stream', /space_id=aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb&format=ndjson/.test(loka.downloads[0].query), true);
  check('signed in with the renewed 60-minute key', loka.downloads[0].auth, 'Bearer access-secret-one');
  const keyPath = path.join(W.DATA, 'loka-key.json');
  check('the renewed refresh key is kept in a file only the server can read',
    [JSON.parse(fs.readFileSync(keyPath, 'utf8')).refreshToken, (fs.statSync(keyPath).mode & 0o777).toString(8)], ['refresh-secret-one', '600']);
  let rows = W.layerRows();
  check('the layer holds the export columns for each place', [rows.length, rows[0].tag_id, rows[0].spaces, rows[0].public_link], [4, tid(1), 'Example space', 'https://loka.place/t/' + tid(1)]);
  check('its places are on the map as points', JSON.parse(W.layerRaw()).features[0].geometry.type, 'Point');
  const g = (await W.call('GET', '/loka-sync', { cookie: editor })).j;
  check('the editor sees the link, never the key', [g.connected, g.spaceName, g.running, g.canStop, g.canConnect, Object.keys(g).sort().join()],
    [true, 'Example space', false, false, false, 'canConnect,canStop,connected,lastUpdate,running,spaceName']);

  // the first reading: the stand-in answers every place
  const answered = await until(() => { const x = W.layerRows(); return x && x.length === 4 && x.every((p) => p.pattern_1 && p.pattern_1 !== '') ? x : null; }, 25000);
  check('the layer is read once, as any new layer is', !!answered, true);
  check('no marker is left once it is read', (answered || []).some((p) => p[UNREAD]), false);
  const before = Object.fromEntries((answered || []).map((p) => [p.tag_id, { a: p.pattern_1, b: p.pattern_2, c: p.pattern_1_why }]));

  console.log('\n  a later update: new, changed, taken out');
  loka.tags = [
    tag(1),                                                                                           // unchanged
    tag(2, { description: 'Stalls selling vegetables and flowers; nothing wet about it', updated_at: 'later' }), // words changed
    tag(3, { description: 'Market square with many stalls and loud traders', likes_count: 7 }),         // only a like
    tag(5, { description: 'A brand new place with a long description of its own for the reading' }),   // new; 4 is gone
  ];
  const at = (await W.call('GET', '/loka-sync', { cookie: editor })).j.lastUpdate.at;
  const rawBefore = W.layerRaw();
  r = await W.call('POST', '/loka-sync/update', { cookie: editor });
  check('an editor may press Update now', [r.status, r.j], [200, { started: true }]);
  r = await W.call('POST', '/loka-sync/update', { cookie: owner });
  check('one at a time: a second press is turned away', r.status, 409);
  note = await W.finished(editor, at);
  check('counted: 1 new, 2 changed, 1 taken out', note && [note.added, note.changed, note.removed, note.error], [1, 2, 1, '']);
  check('the key was renewed again and the newer one sent', [loka.downloads[1].auth, JSON.parse(fs.readFileSync(keyPath, 'utf8')).refreshToken], ['Bearer access-secret-two', 'refresh-secret-two']);
  rows = W.layerRows();
  const by = Object.fromEntries(rows.map((p) => [p.tag_id, p]));
  check('the place taken out of LOKA is gone, the new one is in', [!!by[tid(4)], !!by[tid(5)], rows.length], [false, true, 4]);
  check('an unchanged place keeps its answers', [by[tid(1)].pattern_1, by[tid(1)].pattern_2], [before[tid(1)].a, before[tid(1)].b]);
  check('a place that changed only in likes keeps its answers and takes the new count', [by[tid(3)].pattern_1, by[tid(3)].likes], [before[tid(3)].a, 7]);
  check('a place whose words changed has no answers, and is marked for reading (before the reading lands)',
    [by[tid(2)].pattern_1 || '', by[tid(2)][UNREAD] || ''].join('|'), '|1');
  check('a backup of the layer was made first', fs.readdirSync(path.join(W.DATA, 'backups')).some((d) => /^loka-sync-/.test(d)), true);
  check('the earlier file is not what is there now', rawBefore !== W.layerRaw(), true);

  const readAgain = await until(() => { const x = W.layerRows(); return x && x.every((p) => p.pattern_1 && !p[UNREAD]) ? x : null; }, 25000);
  check('only the new and the changed place are read (2 places; the other 2 keep their answers)', /reading only the 2 new or changed places; the other 2 keep their answers/.test(W.out), true);
  check('and then every place has an answer, with no marker left', !!readAgain, true);
  const after = Object.fromEntries((readAgain || []).map((p) => [p.tag_id, p]));
  check('the answers of places not read are exactly as before', [after[tid(1)].pattern_1, after[tid(1)].pattern_1_why, after[tid(3)].pattern_2], [before[tid(1)].a, before[tid(1)].c, before[tid(3)].b]);

  console.log('\n  an update that goes wrong changes nothing');
  const rawNow = W.layerRaw();
  for (const [mode, why] of [['noeof', /cut short/], ['truncated', /cut short/], ['forbidden', /doesn.t share that space/], ['busy', /^LOKA is busy\. Try again in 3 minutes\.$/]]) {
    loka.mode = mode; loka.tags = loka.tags.slice(0, 1);
    const was = (await W.call('GET', '/loka-sync', { cookie: editor })).j.lastUpdate.at;
    await W.call('POST', '/loka-sync/update', { cookie: editor });
    const n = await W.finished(editor, was);
    check(mode + ': says so in plain words', n && [n.added + n.changed + n.removed, why.test(n.error), n.error.endsWith('unchanged.') || /doesn.t share|busy/.test(n.error)], [0, true, true]);
    check(mode + ': no secret or internal word in what is kept for visitors to the page', /refresh|token|Bearer|stack|http/i.test(n.error), false);
    check(mode + ': the layer file is untouched', W.layerRaw(), rawNow);
  }
  loka.mode = 'ok';

  console.log('\n  an update with no new words reads nothing and overwrites no answer');
  const readsNow = () => (W.out.match(/\[questions\] reading /g) || []).length;
  const snap = () => JSON.stringify(W.layerRows().map((p) => [p.tag_id, p.pattern_1, p.pattern_2, p.pattern_1_why]));
  const kept = snap(), readsBefore = readsNow();
  for (const [name, tags, want] of [
    ['only a like moved', [tag(1, { likes_count: 9 }), after[tid(2)] ? tag(2, { description: 'Stalls selling vegetables and flowers; nothing wet about it', updated_at: 'later' }) : tag(2), tag(3, { description: 'Market square with many stalls and loud traders', likes_count: 7 }), tag(5, { description: 'A brand new place with a long description of its own for the reading' })], [0, 1, 0]],
    ['only a place was taken out', [tag(1, { likes_count: 9 }), tag(2, { description: 'Stalls selling vegetables and flowers; nothing wet about it', updated_at: 'later' }), tag(3, { description: 'Market square with many stalls and loud traders', likes_count: 7 })], [0, 0, 1]],
  ]) {
    loka.tags = tags;
    const was = (await W.call('GET', '/loka-sync', { cookie: editor })).j.lastUpdate.at;
    await W.call('POST', '/loka-sync/update', { cookie: editor });
    const n = await W.finished(editor, was);
    check(name + ': counted as it is', n && [n.added, n.changed, n.removed, n.error], [want[0], want[1], want[2], '']);
    await sleep(2500);   // longer than the stand-in's reading takes
    check(name + ': no reading is started', readsNow(), readsBefore);
    check(name + ': every answer is as it was (the places left standing)', JSON.stringify(JSON.parse(snap()).filter((r) => tags.some((t) => t.id === r[0]))),
      JSON.stringify(JSON.parse(kept).filter((r) => tags.some((t) => t.id === r[0]))));
    check(name + ': no place is left marked', W.layerRows().some((p) => p[UNREAD]), false);
  }

  console.log('\n  what visitors can read, and a layer that is not from LOKA');
  const ovl = W.overlay().lokaSync;
  check('the link holds nothing private: no email of who connected', [Object.keys(ovl).sort().join(), JSON.stringify(W.overlay()).includes(ADMIN)], ['connectedAt,lastUpdate,layerId,spaceId,spaceName', false]);

  console.log('\n  disconnecting, and the key never leaks');
  check('an editor may not disconnect', (await W.call('DELETE', '/loka-sync', { cookie: editor })).status, 403);
  check('the owner may', (await W.call('DELETE', '/loka-sync', { cookie: owner })).status, 200);
  check('the places stay', (W.overlay().layers || []).length, 1);
  check('and it says not connected', (await W.call('GET', '/loka-sync', { cookie: editor })).j.connected, false);
  {
    const dir = path.join(W.DATA, 'private-datasets', W.slug), ov = W.overlay();
    fs.writeFileSync(path.join(dir, 'plain.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [77, 12] }, properties: { name: 'A', latitude: 12, longitude: 77 } }] }));
    ov.layers.push({ id: 'plain', label: 'Plain', source: 'plain.geojson', type: 'marker', group: 'userdata' });
    fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify(ov));
    const rr = await W.call('POST', '/loka-sync', { cookie: admin, body: { spaceId: SPACE, layerId: 'plain' } });
    check('taking over a layer whose places have no LOKA id is refused in plain words', [rr.status, rr.j.error], [400, 'That layer’s places don’t come from LOKA, so it can’t be kept up to date from there.']);
    check('and nothing was linked', W.overlay().lokaSync, undefined);
  }
  const everything = W.seen.join('\n') + W.out;
  check('no secret appears in any reply or in the server\'s own log', SECRETS.filter((s) => everything.includes(s)), []);
  check('the refresh key the server was started with is nowhere in the layer file', SECRETS.filter((s) => W.layerRaw().includes(s)), []);

  console.log('\n  the other way in: an API key');
  loka.downloads.length = 0; const refreshBefore = loka.refreshCalls;
  loka.tags = [tag(1), tag(2)];
  await K.start();
  const kadmin = await K.signIn(ADMIN);
  r = await K.call('POST', '/loka-sync', { cookie: kadmin, body });
  check('connects', r.status, 200);
  note = await K.finished(kadmin, undefined);
  check('and brings the places in', note && [note.added, note.error], [2, '']);
  check('the key goes in X-LOKA-API-Key and nothing else is sent', [loka.downloads[0].key, loka.downloads[0].auth], ['api-key-secret', '']);
  check('no renewal is asked for, and no key file is written', [loka.refreshCalls - refreshBefore, fs.existsSync(path.join(K.DATA, 'loka-key.json'))], [0, false]);
  check('the key is in no reply and not in the log', SECRETS.filter((s) => (K.seen.join('\n') + K.out).includes(s)), []);

  console.log('\n  a space with no places in it');
  await until(() => { const x = K.layerRows(); return x && x.length === 2 && x.every((p) => p.pattern_1) ? x : null; }, 25000);
  const kRaw = K.layerRaw(), kBackups = () => fs.readdirSync(path.join(K.DATA, 'backups')).filter((d) => /^loka-sync-/.test(d)).length;
  loka.tags = []; loka.mode = 'noeof';
  let kAt = (await K.call('GET', '/loka-sync', { cookie: kadmin })).j.lastUpdate.at;
  await K.call('POST', '/loka-sync/update', { cookie: kadmin });
  note = await K.finished(kadmin, kAt);
  check('an empty download that was cut short (no closing line) changes nothing', [note.error !== '', note.removed, K.layerRaw() === kRaw, (await K.call('GET', '/loka-sync', { cookie: kadmin })).j.connected], [true, 0, true, true]);
  loka.mode = 'ok'; kAt = note.at;
  const kb = kBackups();
  await K.call('POST', '/loka-sync/update', { cookie: kadmin });
  note = await K.finished(kadmin, kAt);
  check('a complete download with no places takes every place out, and says so', [note.removed, note.emptied, note.error], [2, true, '']);
  check('the layer is gone from the atlas and a backup was made first', [(K.overlay().layers || []).length, kBackups() === kb + 1], [0, true]);
  check('the link stays, ready to make the layer afresh', [K.overlay().lokaSync.spaceId, K.overlay().lokaSync.layerId], [SPACE, '']);
  loka.tags = [tag(1), tag(2), tag(3)]; kAt = note.at;
  await K.call('POST', '/loka-sync/update', { cookie: kadmin });
  note = await K.finished(kadmin, kAt);
  check('and when the space has places again the next update brings them in', [note.added, note.error, (K.layerRows() || []).length], [3, '', 3]);
} catch (e) {
  fail++;
  console.log('  FAIL  the check itself broke: ' + (e && e.stack || e) + '\n' + W.out.slice(-1500));
}

/* ---------------- a copy of a real LOKA-layer atlas ---------------- */
const REAL = path.join(ROOT, 'api/data/atlas/backups/small-photos-explore-preview-2026-10-24T07-10-31-863Z/user-bengaluru-tags.geojson');
if (fs.existsSync(REAL)) {
  console.log('\n  a copy of a real LOKA-layer atlas (134 places, copied to a temporary folder; the backup is only read)');
  const R = world('real-copy-' + Math.random().toString(36).slice(2, 7), loka.base, { LOKA_API_KEY: 'api-key-secret' });
  try {
    const feats = JSON.parse(fs.readFileSync(REAL, 'utf8')).features;
    // the stand-in speaks for two questions, so the copy keeps the first two the places were asked
    for (const f of feats) for (const k of Object.keys(f.properties)) if (/^pattern_[3-9]/.test(k)) delete f.properties[k];
    const dir = path.join(R.DATA, 'private-datasets', R.slug);
    fs.writeFileSync(path.join(dir, 'user-bengaluru-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features: feats }));
    fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'bengaluru-tags', label: 'Bengaluru tags', source: 'user-bengaluru-tags.geojson', type: 'marker', group: 'userdata',
      keyLabels: { pattern_1: 'How much is written about this place?', pattern_2: 'Does it mention water?' } }] }));
    const ofRow = (p) => ({ id: p.tag_id, description: p.description, labels: p.labels ? p.labels.split('; ') : [], categories: p.categories ? p.categories.split('; ') : [],
      latitude: Number(p.latitude), longitude: Number(p.longitude), address: p.address, created_at: p.created_at, likes_count: Number(p.likes), comments_count: Number(p.comments),
      creator: p.created_by_user_id, creatorName: p.created_by, thumbnail_url: p.thumbnail_url, image_urls: [1, 2, 3, 4].map((n) => p['photo_' + n + '_url']).filter(Boolean) });
    const real = feats.map((f) => ofRow(f.properties));
    const answersOf = () => JSON.stringify(R.layerRows().map((p) => [p.tag_id, p.pattern_1, p.pattern_2, p.pattern_1_why]));
    await R.start();
    const radmin = await R.signIn(ADMIN);
    const reads = () => (R.out.match(/\[questions\] reading /g) || []).length;
    loka.tags = real; loka.mode = 'ok';
    const raw0 = fs.readFileSync(path.join(dir, 'user-bengaluru-tags.geojson'), 'utf8');
    let r2 = await R.call('POST', '/loka-sync', { cookie: radmin, body: { spaceId: SPACE, spaceName: 'Example space', layerId: 'bengaluru-tags' } });
    check('taking over the copied layer starts', [r2.status, r2.j], [200, { started: true }]);
    let n2 = await R.finished(radmin, undefined);
    check('the same places served: nothing had changed', n2 && [n2.added, n2.changed, n2.removed, n2.skipped, n2.error], [0, 0, 0, 0, '']);
    await sleep(2500);
    check('no reading, and the layer file is not rewritten', [reads(), fs.readFileSync(path.join(dir, 'user-bengaluru-tags.geojson'), 'utf8') === raw0], [0, true]);
    const answers0 = answersOf();
    loka.tags = real.slice(1).map((t, i) => i === 4 ? Object.assign({}, t, { description: t.description + ' Now with a lake and a pond beside it.' }) : t)
      .concat([tag(9, { description: 'A newly added place with a few words about a lake and a path around it' })]);
    r2 = await R.call('POST', '/loka-sync/update', { cookie: radmin });
    n2 = await R.finished(radmin, n2.at);
    check('one added, one changed, one removed', n2 && [n2.added, n2.changed, n2.removed, n2.error], [1, 1, 1, '']);
    const done = await until(() => { const x = R.layerRows(); return x && x.length === 134 && x.every((p) => !p[UNREAD]) && x.filter((p) => p.pattern_1).length >= 133 ? x : null; }, 25000);
    check('a reading of the 2 places only; the other 132 keep their answers', [/reading only the 2 new or changed places; the other 132 keep their answers/.test(R.out), reads()], [true, 1]);
    check('every place that had an answer still has one, the new ones too, none marked', !!done, true);
    const was = new Map(JSON.parse(answers0).map((r) => [r[0], r]));
    const now = new Map(JSON.parse(answersOf()).map((r) => [r[0], r]));
    const moved = [...now.keys()].filter((id) => was.has(id) && JSON.stringify(was.get(id)) !== JSON.stringify(now.get(id)));
    check('only the changed place\'s answers moved', moved.length, 1);
  } catch (e) {
    fail++;
    console.log('  FAIL  the real-copy check itself broke: ' + (e && e.stack || e) + '\n' + R.out.slice(-1200));
  }
  R.cleanup();
} else console.log('\n  (no real LOKA-layer backup on this computer: the real-copy check is skipped)');
{
  const ui = fs.readFileSync(ROOT + '/atlas/owner-loka.js', 'utf8');
  console.log('\n  the words on the Settings line');
  check('after a failure it says "last tried", never "updated"', /u\.error \? "last tried " : "updated "/.test(ui), true);
  check('before the first run it says "not updated yet"', /"not updated yet"/.test(ui) && !/"never"/.test(ui), true);
  const srv = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  check('a layer that is one half of a file is not taken over (the other half would be stranded)', /if \(mine\.layer\.sameFileAs \|\| imports\.mergedLayers\(imports\.readManifest\(inst\.slug\)\)\.some\(\(L\) => L\.sameFileAs === layerId\)\)/.test(srv), true);
  check('a reading of only the new places that did not line up says so plainly, not "no questions could be found"', /if \(out\.verdict === 'unmatched'\) \{/.test(srv) && /the new places’ answers did not match the questions; nothing was written/.test(srv), true);
  check('Connect, Update now and Stop wait with a calm line and a disabled button', [/busy\(go, "Checking the space…"\)/.test(ui), /busy\(now, WAIT\)/.test(ui), /busy\(off, "Stopping…"\)/.test(ui), /btn\.disabled = true/.test(ui)], [true, true, true, true]);
}
W.cleanup(); K.cleanup(); loka.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
