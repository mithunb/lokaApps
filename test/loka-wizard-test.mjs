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

/* Picking a LOKA space in the build wizard (LOKA sync, part 2b): the snapshot
   of spaces LOKA lists for a person, taken when they link their account
   (api/lib/atlas/loka-sync.js linkByCode, GET /spaces/mine); the rule's new
   arm (mayConnect); the choice riding with POST /instances as lokaSpace,
   checked against that snapshot and kept as wantLoka; and, once the atlas is
   built, the space connected and its places brought in (applyWantedLoka).
   Against a pretend LOKA on 127.0.0.1 and a throwaway atlas server in a
   temporary data folder; the build itself is a worldwide atlas with no
   layers, the quickest the builder makes. Nothing under atlas/datasets/ or
   api/data/ is touched; every person and id is invented. */
import { mayConnect } from '../api/lib/atlas/loka-sync.js';

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

/* ---------------- the rule's new arm ---------------- */
const S = { member: 'aaaaaaaa-1111-4222-8333-000000000001', mine: 'aaaaaaaa-1111-4222-8333-000000000002', empty: 'aaaaaaaa-1111-4222-8333-000000000003',
  org: 'aaaaaaaa-1111-4222-8333-000000000004', neither: 'aaaaaaaa-1111-4222-8333-000000000005' };
const ORG = { a: 'bbbbbbbb-1111-4222-8333-00000000000a', b: 'bbbbbbbb-1111-4222-8333-00000000000b' };
const ID = { owner: 'c0000000-0000-4000-8000-00000000000a', admin: 'c0000000-0000-4000-8000-00000000000b', other: 'c0000000-0000-4000-8000-00000000000c' };
console.log('\n  the rule: any space LOKA listed for the person, whatever the role');
{
  const link = { orgIds: [], memberSpaces: [], spaces: [{ id: S.mine, role: 'Owner' }, { id: S.org, role: 'Org' }, { id: S.member, role: 'Viewer' }, { id: S.empty, role: '' }] };
  check('one they made, their organisation\'s, one they are in, and a platform admin\'s null-role row: all allowed',
    [S.mine, S.org, S.member, S.empty].map((id) => mayConnect(link, id, null)), [true, true, true, true]);
  check('a space not on the list: not, unless the older rule lets it (member, or its organisation)',
    [mayConnect(link, S.neither, null), mayConnect({ orgIds: [ORG.b], spaces: [] }, S.neither, { orgId: ORG.b }), mayConnect({ memberSpaces: [{ id: S.neither }] }, S.neither, null)], [false, true, true]);
  check('an older link with no snapshot at all still works', mayConnect({ orgIds: [], memberSpaces: [{ id: S.member }] }, S.member, null), true);
}

/* ---------------- the pretend LOKA ---------------- */
const OWNER = 'owner@example.test', OTHER = 'other@example.test', ADMIN = 'admin@example.test';
const CODE = '482913';
const SECRETS = ['user-token-secret-owner', 'user-token-secret-admin', 'api-key-secret'];
const tag = (n) => ({ id: '00000000-0000-4000-8000-00000000000' + n, description: 'Place number ' + n + ' with a pond by the old school', labels: ['quiet'], categories: ['Nature'],
  latitude: 12.9 + n / 100, longitude: 77.5 + n / 100, address: n + ' Example Road', created_at: '2026-07-0' + n + 'T07:05:53+00:00', likes_count: 0, comments_count: 0,
  creator: ID.owner, creatorName: 'Example Person', image_urls: [] });
function pretendLoka() {
  const st = { mineCalls: [], downloads: [], base: '' };
  const space = (id, name, type, ownerId, orgId, tagsCount, extra) => Object.assign({ id, orgId, name, type, ownerId, description: 'x', categories: [], tagsCount,
    thumbnail: null, thumbnailUrl: null, createdAt: '2026-10-01T00:00:00+00:00', updatedAt: '2026-11-01T00:00:00+00:00' }, extra || {});
  // every space, as a platform admin sees them (role null): ordered by name
  st.all = () => [
    space(S.empty, 'Empty space', 'public', ID.other, ORG.b, 0),
    space(S.member, 'Member space', 'public', ID.other, ORG.a, 2, { thumbnailUrl: st.base + '/api/thumbs/member.png' }),
    space(S.mine, 'My own space', 'private', ID.owner, ORG.b, 5),
    space(S.org, 'Org space', 'public_read', ID.other, ORG.b, 2, { thumbnailUrl: 'javascript:alert(1)' }),   // not a web address: dropped
    space(S.neither, 'Somebody else’s space', 'public', ID.other, ORG.a, 2),
  ];
  // the owner's own list: the one they are in, the one they made, their organisation's (membership role first, then Owner, then Org)
  const owners = () => st.all().filter((s) => s.id !== S.neither).map((s) => Object.assign({}, s,
    { role: s.id === S.member ? 'Viewer' : s.id === S.mine ? 'Owner' : 'Org' }));
  st.people = {
    [OWNER]: { userId: ID.owner, email: OWNER, orgIds: [ORG.b], role: 'org_admin', token: 'user-token-secret-owner',
      spaces: [{ id: S.member, orgId: ORG.a, name: 'Member space', type: 'public', role: 'Viewer' }], mine: owners },
    [ADMIN]: { userId: ID.admin, email: ADMIN, orgIds: [], role: 'super_admin', token: 'user-token-secret-admin', spaces: [], mine: () => st.all().map((s) => Object.assign({}, s, { role: null })) },
  };
  const byToken = (req) => Object.values(st.people).find((p) => (req.headers.authorization || '') === 'Bearer ' + p.token) || null;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    let b = {}; try { b = JSON.parse(body || '{}'); } catch {}
    const json = (status, o) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/auth/send-otp' && req.method === 'POST') return json(st.people[b.email] ? 200 : 404, {});
    if (u.pathname === '/auth/verify-otp' && req.method === 'POST') {
      const p = st.people[b.email];
      if (!p || b.otp !== CODE) return json(401, { message: 'Invalid OTP' });
      return json(200, { success: true, token: p.token, user: { id: p.userId } });
    }
    if (u.pathname === '/users/me') {
      const p = byToken(req);
      if (!p) return json(401, {});
      return json(200, { success: true, userId: p.userId, phone: null, userName: 'Example', role: p.role, email: p.email, orgIds: p.orgIds });
    }
    let m = /^\/users\/([^/]+)\/spaces$/.exec(u.pathname);
    if (m) {
      const p = byToken(req);
      if (!p || p.userId !== m[1]) return json(403, { message: 'Access forbidden' });
      return json(200, { spaces: p.spaces });
    }
    if (u.pathname === '/spaces/mine') {
      const p = byToken(req);
      st.mineCalls.push(p ? p.email : '');
      if (!p) return json(401, { message: 'Unauthorized' });
      return json(200, { spaces: p.mine() });
    }
    m = /^\/spaces\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const s = st.all().find((x) => x.id === m[1]);
      if (!s) return json(404, { message: 'Space not found' });
      if (s.type === 'private') return json(403, { message: 'Access forbidden' });
      return json(200, { space: s });
    }
    if (u.pathname === '/tags/download') {
      st.downloads.push(u.searchParams.get('space_id'));
      if (req.headers['x-loka-api-key'] !== 'api-key-secret') { res.writeHead(401); return res.end('{}'); }
      const s = st.all().find((x) => x.id === u.searchParams.get('space_id'));
      if (!s || s.type === 'private') { res.writeHead(403); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      return res.end([tag(1), tag(2)].map((t) => JSON.stringify(t)).concat([JSON.stringify({ _eof: true, count: 2, truncated: false })]).join('\n') + '\n');
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { st.base = 'http://127.0.0.1:' + server.address().port; st.close = () => server.close(); resolve(st); }));
}

/* ---------------- a throwaway atlas server ---------------- */
function world(lokaBase) {
  const PORT = 9700 + Math.floor(Math.random() * 250);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-wizard-check-'));
  const W = { PORT, DATA, out: '', child: null, base: 'http://127.0.0.1:' + PORT, seen: [] };
  const accounts = Object.fromEntries([OWNER, OTHER, ADMIN].map((e) => [e, { email: e, instances: [], verifiedAt: 1 }]));
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({ instances: {}, accounts, drafts: {}, lokaRequests: {} }));
  /* The boundary data the place search uses, for working out where a space's
     places are: India's states and districts, copied from this computer's
     geocache (never fetched). Without them the region checks are skipped. */
  W.geo = ['IND-ADM1.json', 'IND-ADM2.json'].every((f) => fs.existsSync(path.join(ROOT, 'api', 'data', 'atlas', 'geocache', f)));
  if (W.geo) {
    fs.mkdirSync(path.join(DATA, 'geocache'), { recursive: true });
    for (const f of ['IND-ADM1.json', 'IND-ADM2.json']) fs.copyFileSync(path.join(ROOT, 'api', 'data', 'atlas', 'geocache', f), path.join(DATA, 'geocache', f));
    fs.writeFileSync(path.join(DATA, 'geocache', 'IND-levels.json'), JSON.stringify({ iso3: 'IND', levels: [1, 2] }));
  }
  W.start = async () => {
    W.child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
      env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1',
        ATLAS_FAKE_READING_MS: '300', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: ADMIN, ATLAS_ADMIN_EMAIL: ADMIN, ATLAS_ADMIN_TOKEN: '', ATLAS_PER_IP_PER_DAY: '20',
        LOKA_API_BASE: lokaBase, LOKA_REFRESH_TOKEN: '', LOKA_API_KEY: 'api-key-secret' },
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
    W.seen.push(JSON.stringify(j));
    return { status: r.status, j };
  };
  W.registry = () => JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8'));
  // the wizard's request, as setup.js sends it: a worldwide atlas of no layers, with a space chosen
  W.build = (cookie, lokaSpace, more) => W.call('POST', '/instances', { cookie, body: Object.assign({ title: 'Wizard check', org: 'Check', region: { worldwide: true }, layers: [], lokaSpace }, more || {}) });
  // a build takes as long as the builder takes; then the first update, which is quick against the pretend LOKA
  W.built = (cookie, slug) => until(async () => { const i = (await W.call('GET', '/instances/' + slug, { cookie })).j; return i && i.status !== 'building' ? i : null; }, 120000);
  W.updated = (cookie, slug) => until(async () => { const g = (await W.call('GET', '/instances/' + slug + '/loka-sync', { cookie })).j; return g && g.connected && !g.running && g.lastUpdate ? g : null; }, 30000);
  return W;
}

const loka = await pretendLoka();
const W = world(loka.base);
process.on('exit', () => { W.cleanup(); try { loka.close(); } catch {} });

try {
  await W.start();
  const owner = await W.signIn(OWNER), admin = await W.signIn(ADMIN);
  const regAfter = async () => { await sleep(80); return W.registry(); };

  console.log('\n  before linking');
  check('signed out, the wizard is told nothing', (await W.call('GET', '/auth/loka')).status, 401);
  let r = await W.call('GET', '/auth/loka', { cookie: owner });
  check('signed in and not linked: LOKA is set up here, no link, the Atlas email to start from', [r.status, r.j], [200, { email: OWNER, setUp: true, link: null }]);
  r = await W.build(owner, { spaceId: S.member });
  check('a space chosen with no link: refused in plain words, and no atlas is made', [r.status, r.j.error, Object.keys((await regAfter()).instances).length], [403, 'Link your LOKA account first, then connect a space of yours.', 0]);

  console.log('\n  the snapshot, taken when the account is linked');
  await W.call('POST', '/auth/loka/send-code', { cookie: owner });
  r = await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { code: CODE } });
  check('linked; LOKA was asked for the person\'s spaces with their own sign-in, once', [r.status, loka.mineCalls], [200, [OWNER]]);
  const link = (await regAfter()).accounts[OWNER].lokaLink;
  check('every space LOKA listed is kept, as the little the wizard and the rule need — never the whole card',
    link.spaces.map((s) => [s.id, s.name, s.type, s.role, s.tagsCount, s.thumbnailUrl ? 'pic' : '']),
    [[S.empty, 'Empty space', 'public', 'Org', 0, ''], [S.member, 'Member space', 'public', 'Viewer', 2, 'pic'], [S.mine, 'My own space', 'private', 'Owner', 5, ''], [S.org, 'Org space', 'public_read', 'Org', 2, '']]);
  check('each row carries the owner and organisation too, and when it was; the list is dated; a picture that is not a web address is dropped',
    [Object.keys(link.spaces[0]).sort().join(), link.spaces[2].ownerId, link.spaces[0].orgId, typeof link.spacesAt, link.spaces[3].thumbnailUrl], ['id,name,orgId,ownerId,role,tagsCount,thumbnailUrl,type,updatedAt', ID.owner, ORG.b, 'string', '']);
  check('what linking answered counts the same list the wizard shows', r.j.spaces, 4);
  r = (await W.call('GET', '/auth/loka', { cookie: owner })).j;
  check('the wizard gets the list dated, with the relation in plain words and no ids but the space\'s',
    [r.link.lokaEmail, r.link.spacesAt === link.spacesAt, r.link.spaces.map((s) => s.role), Object.keys(r.link.spaces[0]).sort().join()],
    [OWNER, true, ['Your organisation’s', 'Member', 'You made this', 'Your organisation’s'], 'id,name,role,tagsCount,thumbnailUrl,type']);

  console.log('\n  the choice, checked at POST /instances');
  r = await W.build(owner, { spaceId: S.neither, spaceName: 'Somebody else’s space' });
  check('a space not on their list: refused, with the way round', [r.status, r.j.error], [403, 'That space isn’t on your LOKA list. Build the atlas without it, then ask for access under Owner ▾ → Settings.']);
  r = await W.build(owner, { spaceId: S.empty });
  check('a space with no places: refused', [r.status, r.j.error], [400, 'That space has no places yet.']);
  r = await W.build(owner, { spaceId: 'not-a-space' });
  check('nonsense: refused', r.status, 400);
  check('nothing was made by any refusal', Object.keys((await regAfter()).instances).length, 0);
  r = await W.build(owner, { spaceId: S.member, spaceName: 'A name the browser made up' });
  const slug = r.j.slug;
  check('a space on their list: the build starts', [r.status, typeof slug, typeof r.j.jobId], [200, 'string', 'string']);
  const made = (await regAfter()).instances[slug];
  check('kept on the atlas as wantLoka, named as LOKA names it and remembering who chose it, until the build is done', made.wantLoka, { spaceId: S.member, spaceName: 'Member space', by: OWNER, sup: false });
  check('deoria-bioregion cannot be built at all, space or no space', (await W.build(owner, { spaceId: S.member }, { slug: 'deoria-bioregion' })).status, 409);

  console.log('\n  where a space\'s places are (the area the wizard offers)');
  check('signed out: nothing', (await W.call('POST', '/auth/loka/region', { body: { spaceId: S.member } })).status, 401);
  check('a space not on their list: refused', (await W.call('POST', '/auth/loka/region', { cookie: owner, body: { spaceId: S.neither } })).status, 403);
  r = await W.call('POST', '/auth/loka/region', { cookie: owner, body: { spaceId: S.mine, iso3: 'IND' } });
  check('a space LOKA will not share with the server: the plain sentence, so the wizard asks "where" as usual', [r.status, /doesn.t share that space/.test(r.j.error)], [502, true]);
  if (W.geo) {
    r = await W.call('POST', '/auth/loka/region', { cookie: owner, body: { spaceId: S.member, iso3: 'IND' } });
    check('the places\' positions find the district that holds them all, from the same boundary data the place search uses',
      [r.status, r.j.spaceName, r.j.places, r.j.iso3, r.j.level, r.j.units.length, r.j.matchedRows, r.j.worldwide], [200, 'Member space', 2, 'IND', 2, 1, 2, undefined]);
    check('the unit comes with what the wizard\'s chips and the found map need', [typeof r.j.units[0].id, typeof r.j.units[0].name, r.j.units[0].bbox.length, !!r.j.units[0].geometry], ['string', 'string', 4, true]);
    r = await W.call('POST', '/auth/loka/region', { cookie: owner, body: { spaceId: S.member, iso3: 'KEN' } });
    check('a wrong country chosen above does not mislead: the positions tell the country', [r.status, r.j.iso3, r.j.units.length], [200, 'IND', 1]);
  } else console.log('  (no geocache on this computer: the district checks are skipped)');

  console.log('\n  once built, the space is connected and its places come in');
  const inst = await W.built(owner, slug);
  check('the atlas was built', inst && inst.status, 'built');
  let g = inst && inst.status === 'built' ? await W.updated(owner, slug) : null;
  check('connected to the space, and the first update brought its places in', g && [g.connected, g.spaceName, g.lastUpdate.added, g.lastUpdate.error], [true, 'Member space', 2, '']);
  check('the choice was used up; the places were downloaded once for the build (and once per look above), by the server\'s own sign-in',
    [(await regAfter()).instances[slug].wantLoka, loka.downloads.filter((id) => id === S.member).length], [undefined, W.geo ? 3 : 1]);
  check('Settings counts the same list as the wizard', g && g.link.spaces, 4);
  const overlay = JSON.parse(fs.readFileSync(path.join(W.DATA, 'private-datasets', slug, 'manifest.local.json'), 'utf8'));
  check('the atlas has the layer, and the link names it (the same link Settings makes, no email in it)',
    [(overlay.layers || []).length, overlay.lokaSync.spaceId, overlay.lokaSync.layerId === overlay.layers[0].id, JSON.stringify(overlay.lokaSync).includes('@')], [1, S.member, true, false]);

  console.log('\n  the operator, and a space LOKA will not share');
  r = await W.build(admin, { spaceId: S.org, spaceName: 'A name the browser made up' });
  check('the operator needs no link of their own, and may take any space; the name is LOKA\'s, never the browser\'s', [r.status, (await regAfter()).instances[r.j.slug].wantLoka], [200, { spaceId: S.org, spaceName: 'Org space', by: ADMIN, sup: true }]);
  await W.built(admin, r.j.slug);
  r = await W.build(admin, { spaceId: S.mine, spaceName: 'My own space' });
  const slug2 = r.j.slug;
  check('a space LOKA will not even name for the server gets a plain name', (await regAfter()).instances[slug2].wantLoka.spaceName, 'LOKA space');
  const inst2 = await W.built(admin, slug2);
  const g2 = inst2 && inst2.status === 'built' ? await W.updated(admin, slug2) : null;
  check('a private space the server cannot download: the atlas stands, connected, and the Settings line says the plain failure',
    g2 && [g2.connected, /doesn.t share that space/.test(g2.lastUpdate.error), g2.lastUpdate.added], [true, true, 0]);
  check('and Update now is the way to try again once LOKA has added the sync account', (await W.call('POST', '/instances/' + slug2 + '/loka-sync/update', { cookie: admin })).status, 200);
  await until(async () => !(await W.call('GET', '/instances/' + slug2 + '/loka-sync', { cookie: admin })).j.running, 10000);

  console.log('\n  the right to the space is checked again when the atlas is built');
  r = await W.build(owner, { spaceId: S.member });
  const slug3 = r.j.slug;
  check('the choice remembers who made it', (await regAfter()).instances[slug3].wantLoka, { spaceId: S.member, spaceName: 'Member space', by: OWNER, sup: false });
  await W.call('DELETE', '/auth/loka', { cookie: owner });   // unlinked while it builds
  const inst3 = await W.built(owner, slug3);
  await sleep(300);
  g = (await W.call('GET', '/instances/' + slug3 + '/loka-sync', { cookie: owner })).j;
  check('unlinked meanwhile: built, not connected, and Settings says why', [inst3 && inst3.status, g.connected, g.note, (await regAfter()).instances[slug3].wantLoka],
    ['built', false, 'The LOKA space chosen while building wasn’t connected: your LOKA account is no longer linked. Link it here, then connect the space.', undefined]);
  await W.call('POST', '/auth/loka/send-code', { cookie: owner });
  await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { code: CODE } });
  r = await W.call('POST', '/instances/' + slug3 + '/loka-sync', { cookie: owner, body: { spaceId: S.member } });
  await W.updated(owner, slug3);
  check('linked again and connected from Settings: the note goes', [r.status, (await W.call('GET', '/instances/' + slug3 + '/loka-sync', { cookie: owner })).j.note], [200, '']);

  console.log('\n  no token, anywhere');
  const everything = W.seen.join('\n') + W.out + fs.readFileSync(path.join(W.DATA, 'registry.json'), 'utf8');
  check('a person\'s LOKA token is in no reply, no log line and no file', SECRETS.filter((s) => everything.includes(s)), []);
} catch (e) {
  fail++;
  console.log('  FAIL  the check itself broke: ' + (e && e.stack || e) + '\n' + W.out.slice(-1500));
}

{
  console.log('\n  the wizard\'s words, and what the server does after a build');
  const html = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
  const js = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
  check('one choice beside the file drop, on the Where step', /either-b[\s\S]*Bring places from a LOKA space/.test(html), true);
  check('the link by code, the list, and the way to bring it up to date', ['Link your LOKA account', 'Send code', 'Confirm', 'Your list is from', 'send a new code', 'Find a space by name'].filter((w) => !js.includes(w)), []);
  check('a space with no places is shown but cannot be picked', /if \(!s\.tagsCount\) b\.disabled = true;/.test(js) && js.includes('"No places yet"'), true);
  check('every space but a public one says the one step LOKA must take', [/function lokaOpen\(s\) \{ return s\.type === "public"; \}/.test(js), /lokaOpen\(s\) \? "" : " " \+ \(s\.type === "private" \? "Private spaces" : "Spaces that aren’t fully public"\) \+ " need one extra step by LOKA before their places can come in\."/.test(js)], [true, true]);
  check('the area comes from where the places are, with a wait line, the country as a hint only, and the usual chips to change it',
    [/api\("auth\/loka\/region", \{ method: "POST", body: \{ spaceId: s\.id, iso3: S\.iso3 \} \}\)/.test(js), js.includes('"Finding where its places are…"'), /from where the space’s places are\. Take any out below, or search to add more\./.test(js), /if \(s && !S\.chosen\.length && !GEO\.file\) lokaFindArea\(s\);/.test(js)], [true, true, true, true]);
  check('LOKA unreadable: the usual "where is it?" stands, with one plain sentence', /Where its places are couldn’t be worked out: " \+ errMsg\(e\) \+ " Search for the place above instead\./.test(js), true);
  check('the Settings line shows why a chosen space was not connected', /s\.note \? esc\(s\.note\)/.test(fs.readFileSync(ROOT + '/atlas/owner-loka.js', 'utf8')), true);
  check('"can\'t find your space" points at Request access after the build', /Can’t find your space\? Spaces you belong to show here\. For another, build the atlas and use Request access/.test(js), true);
  check('the waits say what is happening', ['"Looking at your LOKA account…"', '"Sending a code…"', '"Checking the code with LOKA…"'].filter((w) => !js.includes(w)), []);
  check('the choice rides with the build, left out when none', /lokaSpace: LOKA\.space \? \{ spaceId: LOKA\.space\.id, spaceName: LOKA\.space\.name \} : undefined/.test(js), true);
  check('no pill shapes in the new styles', /radius-pill/.test(html.slice(html.indexOf('.lokapick {'), html.indexOf('.lokasp-what span'))), false);
  check('no styling step was added to the wizard', (html.match(/class="stp"/g) || []).length, 5);
  check('the Owner menu\'s own file was not touched', fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8').includes('lokaSpace'), false);
  const srv = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  check('after a build the server connects the space, never on deoria-bioregion, through the same link Settings makes (one function: defined once, used twice)',
    [/setImmediate\(\(\) => \{ applyWantedLoka\(job\.slug, firstBuild\); \}\);/.test(srv), /function applyWantedLoka[\s\S]*isNeverTouched\(slug\)[\s\S]*connectLoka\(inst/.test(srv), (srv.match(/\bconnectLoka\(/g) || []).length], [true, true, 3]);
  check('only the first build of a new atlas, never a rebuild; a failed build drops the choice',
    [/const firstBuild = !inst\.builtAt;/.test(srv), /if \(!firstBuild \|\| lokaStateOf\(inst\)/.test(srv), (srv.slice(srv.indexOf('function rebuildFailedPatch'), srv.indexOf('setStrandedBuildHook((job)')).match(/wantLoka: undefined/g) || []).length], [true, true, 3]);
  check('the picture\'s address is checked again where it is kept', /thumbnailUrl: \/\^https\?:\\\/\\\/\/\.test\(String\(s\.thumbnailUrl \|\| ''\)\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/registry.js', 'utf8')), true);
}
W.cleanup(); loka.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
