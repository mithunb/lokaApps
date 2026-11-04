/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Linking an Atlas account to its LOKA account by an emailed code, and who may
   then connect an atlas to a LOKA space (api/lib/atlas/loka-sync.js, the
   /auth/loka and /instances/:slug/loka-sync routes in api/apps/atlas.js, the
   operator's /admin/loka-requests), against a pretend LOKA server on 127.0.0.1
   and a throwaway atlas server in a temporary data folder. Nothing under
   atlas/datasets/ or api/data/ is touched; every person and id is invented. */
import { mayConnect, spaceIdFrom } from '../api/lib/atlas/loka-sync.js';

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

/* ---------------- the rule on its own ---------------- */
const S = { member: 'aaaaaaaa-1111-4222-8333-000000000001', org: 'aaaaaaaa-1111-4222-8333-000000000002', neither: 'aaaaaaaa-1111-4222-8333-000000000003',
  secret: 'aaaaaaaa-1111-4222-8333-000000000004', secretOrg: 'aaaaaaaa-1111-4222-8333-000000000005' };
const ORG = { a: 'bbbbbbbb-1111-4222-8333-00000000000a', b: 'bbbbbbbb-1111-4222-8333-00000000000b', c: 'bbbbbbbb-1111-4222-8333-00000000000c' };
console.log('\n  the rule: a member of the space, or of its organisation');
{
  const link = { orgIds: [ORG.b], memberSpaces: [{ id: S.member, orgId: ORG.a }] };
  check('a member may, without asking LOKA about the space', mayConnect(link, S.member, null), true);
  check('the organisation\'s own may', mayConnect(link, S.org, { orgId: ORG.b }), true);
  check('neither: not', mayConnect(link, S.neither, { orgId: ORG.c }), false);
  check('a space LOKA would not show (private, not a member): not, whatever the organisation', mayConnect(link, S.secretOrg, null), false);
  check('no link: not', mayConnect(null, S.member, { orgId: ORG.a }), false);
  check('a bare id, a pasted link, and nothing', [spaceIdFrom(' ' + S.member.toUpperCase() + ' '), spaceIdFrom('https://loka.place/spaces/' + S.org + '?from=app'), spaceIdFrom('nope')], [S.member, S.org, '']);
}

/* ---------------- the pretend LOKA ---------------- */
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test', ADMIN = 'admin@example.test';
const FULL = 'full@example.test';   // a second owner (invited as one) who already has twenty requests waiting
const EDIT_TOKEN = 'edit-token-secret';   // the atlas's own edit token, as a bearer
const LOKA_OWNER_EMAIL = 'owner-at-loka@example.test';   // the owner's LOKA email is not their Atlas one
const ID = { owner: 'c0000000-0000-4000-8000-00000000000a', admin: 'c0000000-0000-4000-8000-00000000000b', editor: 'c0000000-0000-4000-8000-00000000000c' };
const CODE = '482913';
const SECRETS = ['user-token-secret-owner', 'user-token-secret-admin', 'user-token-secret-editor', 'api-key-secret'];
const tag = (n) => ({ id: '00000000-0000-4000-8000-00000000000' + n, description: 'Place number ' + n + ' with a pond by the old school', labels: ['quiet'], categories: ['Nature'],
  latitude: 12.9 + n / 100, longitude: 77.5 + n / 100, address: n + ' Example Road', created_at: '2026-07-0' + n + 'T07:05:53+00:00', likes_count: 0, comments_count: 0,
  creator: ID.owner, creatorName: 'Example Person', image_urls: [] });
function pretendLoka() {
  const st = { sent: [], meCalls: 0, spaceCalls: [], downloads: [], base: '' };
  // who LOKA knows, by the email they sign in with
  st.people = {
    [LOKA_OWNER_EMAIL]: { userId: ID.owner, email: LOKA_OWNER_EMAIL, orgIds: [ORG.b], role: 'org_admin', token: 'user-token-secret-owner',
      spaces: [{ id: S.member, orgId: ORG.a, name: 'Member space', type: 'public', role: 'Contributor', description: 'x', tagsCount: 3 }] },
    [ADMIN]: { userId: ID.admin, email: ADMIN, orgIds: [], role: 'super_admin', token: 'user-token-secret-admin', spaces: [] },
    [EDITOR]: { userId: ID.editor, email: EDITOR, orgIds: [], role: null, token: 'user-token-secret-editor', spaces: [] },
  };
  st.spaces = { [S.member]: { orgId: ORG.a, name: 'Member space', type: 'public' }, [S.org]: { orgId: ORG.b, name: 'Org space', type: 'public_read' },
    [S.neither]: { orgId: ORG.c, name: 'Somebody else’s space', type: 'public' }, [S.secret]: { orgId: ORG.c, name: 'Private space', type: 'private' },
    [S.secretOrg]: { orgId: ORG.b, name: 'Private org space', type: 'private' } };
  const byToken = (req) => Object.values(st.people).find((p) => (req.headers.authorization || '') === 'Bearer ' + p.token) || null;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    let b = {}; try { b = JSON.parse(body || '{}'); } catch {}
    const json = (status, o) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/auth/send-otp' && req.method === 'POST') {
      st.sent.push(b.email);
      if (!st.people[b.email]) return json(404, { message: 'User not found' });
      return json(200, { success: true, message: 'OTP sent' });
    }
    if (u.pathname === '/auth/verify-otp' && req.method === 'POST') {
      const p = st.people[b.email];
      if (!p || b.otp !== CODE) return json(401, { message: 'Invalid OTP' });
      return json(200, { success: true, token: p.token, user: { id: p.userId } });
    }
    if (u.pathname === '/users/me') {
      st.meCalls += 1;
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
    // every space LOKA shows the person (the wizard's list, loka-wizard-test): here, the ones they are in
    if (u.pathname === '/spaces/mine') {
      const p = byToken(req);
      return p ? json(200, { spaces: p.spaces }) : json(401, {});
    }
    m = /^\/spaces\/([^/]+)$/.exec(u.pathname);
    if (m) {
      st.spaceCalls.push({ id: m[1], key: req.headers['x-loka-api-key'] || '' });
      const s = st.spaces[m[1]];
      if (!s) return json(404, { message: 'Space not found' });
      if (s.type === 'private') return json(403, { message: 'Access forbidden' });   // the sync account is in no private space
      return json(200, { space: Object.assign({ id: m[1] }, s) });
    }
    if (u.pathname === '/tags/download') {
      st.downloads.push(u.search);
      if (req.headers['x-loka-api-key'] !== 'api-key-secret') { res.writeHead(401); return res.end('{}'); }
      const s = st.spaces[u.searchParams.get('space_id')];
      if (!s || s.type === 'private') { res.writeHead(403); return res.end('{}'); }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      return res.end([tag(1), tag(2)].map((t) => JSON.stringify(t)).concat([JSON.stringify({ _eof: true, count: 2, truncated: false })]).join('\n') + '\n');
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => { st.base = 'http://127.0.0.1:' + server.address().port; st.close = () => server.close(); resolve(st); }));
}

/* ---------------- a throwaway atlas server ---------------- */
function world(slug, lokaBase) {
  const PORT = 9700 + Math.floor(Math.random() * 250);
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-link-check-'));
  const W = { PORT, DATA, slug, out: '', child: null, base: 'http://127.0.0.1:' + PORT, seen: [] };
  for (const s of [slug, 'deoria-bioregion']) {
    const dir = path.join(DATA, 'private-datasets', s);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Link check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
    fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [] }));
  }
  const inst = (s) => ({ slug: s, title: 'Link check', visibility: 'private', status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
    tokenHash: crypto.createHash('sha256').update(EDIT_TOKEN).digest('hex'), viewKeyHash: null, createdAt: 1,
    collaborators: [{ email: EDITOR, role: 'editor' }, { email: FULL, role: 'owner' }], branding: { orgName: 'Sync', hasLogo: false } });
  const accounts = Object.fromEntries([OWNER, EDITOR, OTHER, ADMIN, FULL].map((e) => [e, { email: e, instances: [], verifiedAt: 1 }]));
  accounts[FULL].lokaLink = { lokaUserId: 'c0000000-0000-4000-8000-0000000000ff', lokaEmail: FULL, orgIds: [], memberSpaces: [], linkedAt: '2026-11-01T00:00:00Z' };
  const waiting = Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['w' + i, { id: 'w' + i, slug, spaceId: 'dddddddd-1111-4222-8333-0000000000' + String(i).padStart(2, '0'),
    spaceName: '', by: FULL, at: '2026-11-01T00:00:00Z', state: 'pending', decidedAt: null }]));
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
    instances: { [slug]: inst(slug), 'deoria-bioregion': inst('deoria-bioregion') }, accounts, drafts: {}, lokaRequests: waiting }));
  W.start = async () => {
    W.child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
      env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1',
        ATLAS_FAKE_READING_MS: '300', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: ADMIN, ATLAS_ADMIN_EMAIL: ADMIN, ATLAS_ADMIN_TOKEN: '',
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
  // any route under /api/atlas; a path starting with "/" is whole, else it is under this atlas
  W.call = async (method, p, { cookie, body, slug: s, bearer } = {}) => {
    const r = await fetch(W.base + '/api/atlas' + (p.charAt(0) === '/' ? p : '/instances/' + (s || slug) + '/' + p),
      { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    W.seen.push(JSON.stringify(j));
    return { status: r.status, j };
  };
  W.registry = () => JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8'));
  W.finished = async (cookie) => until(async () => { const g = await W.call('GET', 'loka-sync', { cookie }); return g.j && g.j.connected && !g.j.running && g.j.lastUpdate ? g.j.lastUpdate : null; });
  // connect, wait for the first update, then take the link off again, so the next connect starts clean
  W.connectAndUndo = async (cookie, body) => {
    const r = await W.call('POST', 'loka-sync', { cookie, body });
    if (r.status !== 200) return r;
    const n = await W.finished(cookie);
    await W.call('DELETE', 'loka-sync', { cookie });
    return { status: r.status, j: r.j, note: n };
  };
  return W;
}

const loka = await pretendLoka();
const W = world('link-check-' + Math.random().toString(36).slice(2, 7), loka.base);
process.on('exit', () => { W.cleanup(); try { loka.close(); } catch {} });

try {
  await W.start();
  const owner = await W.signIn(OWNER), editor = await W.signIn(EDITOR), other = await W.signIn(OTHER), admin = await W.signIn(ADMIN);
  const regAfter = async () => { await sleep(80); return W.registry(); };   // the registry is written a tick after the change

  console.log('\n  before linking');
  check('a stranger may not look', (await W.call('GET', 'loka-sync', { cookie: other })).status, 403);
  check('nobody signed in may ask for a code', (await W.call('POST', '/auth/loka/send-code', { body: { email: OWNER } })).status, 401);
  let g = (await W.call('GET', 'loka-sync', { cookie: owner })).j;
  check('the owner is offered the link, with their Atlas email to start from, and may not connect yet', [g.canLink, g.link, g.canConnect, g.email, g.request], [true, null, false, OWNER, null]);
  g = (await W.call('GET', 'loka-sync', { cookie: editor })).j;
  check('the editor is told nothing of it', Object.keys(g).sort().join(), 'canConnect,canStop,connected,lastUpdate,running,spaceName');
  let r = await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.member } });
  check('an owner with no link is refused in plain words', [r.status, r.j.error], [403, 'Link your LOKA account first, then connect a space of yours.']);
  check('and may not ask for access yet either', (await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.neither } })).status, 403);

  console.log('\n  linking by an emailed code');
  const SAID = 'If that email has a LOKA account, a code is on its way. It can take a minute.';
  r = await W.call('POST', '/auth/loka/send-code', { cookie: owner });
  check('the code goes to the Atlas email unless another is given; LOKA does not know it, and the answer does not say so', [r.status, loka.sent[0], r.j], [200, OWNER, { ok: true, email: OWNER, said: SAID }]);
  r = await W.call('POST', '/auth/loka/send-code', { cookie: owner, body: { email: LOKA_OWNER_EMAIL } });
  check('with the LOKA email, LOKA is asked to send the code; the very same answer', [r.status, r.j, loka.sent[1]], [200, { ok: true, email: LOKA_OWNER_EMAIL, said: SAID }, LOKA_OWNER_EMAIL]);
  r = await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { email: LOKA_OWNER_EMAIL, code: '000000' } });
  check('a wrong code: refused, nothing linked', [r.status, r.j.error, (await regAfter()).accounts[OWNER].lokaLink], [400, 'That code didn’t work. Check it, or send a new one.', undefined]);
  r = await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { email: 'nobody@example.test', code: CODE } });
  check('an email LOKA does not know gets the same sentence as a wrong code', [r.status, r.j.error], [400, 'That code didn’t work. Check it, or send a new one.']);
  r = await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { email: LOKA_OWNER_EMAIL, code: CODE, userId: ID.admin, lokaUserId: ID.admin, orgIds: [ORG.c] } });
  check('the right code links; what comes back names the LOKA email and the spaces, never a token', [r.status, r.j], [200, { ok: true, lokaEmail: LOKA_OWNER_EMAIL, spaces: 1 }]);
  const link = (await regAfter()).accounts[OWNER].lokaLink;
  check('who they are came from LOKA\'s /users/me alone: the body\'s claim to be someone else is ignored',
    [loka.meCalls, link.lokaUserId, link.lokaEmail, link.orgIds], [1, ID.owner, LOKA_OWNER_EMAIL, [ORG.b]]);
  check('the memberships kept: id, organisation, name, type, role — not the rest of LOKA\'s card',
    link.memberSpaces, [{ id: S.member, orgId: ORG.a, name: 'Member space', type: 'public', role: 'Contributor' }]);
  check('kept on the account, not on the atlas (with the snapshot of spaces LOKA listed, see loka-wizard-test)', [Object.keys(link).sort().join(), JSON.stringify(W.registry().instances).includes('lokaLink')], ['linkedAt,lokaEmail,lokaUserId,memberSpaces,orgIds,spaces,spacesAt', false]);
  g = (await W.call('GET', 'loka-sync', { cookie: owner })).j;
  check('Settings now says linked, and the owner may connect', [g.link.lokaEmail, g.link.spaces, g.canConnect], [LOKA_OWNER_EMAIL, 1, true]);

  console.log('\n  which spaces an owner may connect');
  r = await W.connectAndUndo(owner, { spaceId: 'https://loka.place/spaces/' + S.member + '?from=app' });
  check('a space they are a member of, by a pasted link: connected, and the places came in', [r.status, r.j, r.note.added, r.note.error], [200, { started: true }, 2, '']);
  check('LOKA was not asked about the space (membership settles it); the name came from the membership', [loka.spaceCalls.length, loka.downloads.length], [0, 1]);
  r = await W.connectAndUndo(owner, { spaceId: S.org });
  check('a space of their organisation: connected', [r.status, r.note.added], [200, 2]);
  check('LOKA was asked about that space with the server\'s own sign-in', loka.spaceCalls.map((c) => [c.id, c.key]), [[S.org, 'api-key-secret']]);
  r = await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.neither } });
  check('neither: refused with the sentence, and the way to ask', [r.status, r.j], [403, { error: 'Your LOKA account isn’t listed as a member of this space or its organisation. If you made this space, ask for access and we’ll approve it.', canRequest: true }]);
  check('a private space they are not in: refused, even in their organisation', [(await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.secret } })).status,
    (await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.secretOrg } })).status], [403, 403]);
  check('nothing was downloaded by any refusal', loka.downloads.length, 2);
  check('deoria-bioregion is refused, link or not', [(await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.member }, slug: 'deoria-bioregion' })).status,
    (await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.member }, slug: 'deoria-bioregion' })).status], [403, 403]);
  check('the editor still only presses Update now', [(await W.call('POST', 'loka-sync', { cookie: editor, body: { spaceId: S.member } })).status,
    (await W.call('POST', 'loka-sync/request', { cookie: editor, body: { spaceId: S.member } })).status], [403, 403]);
  check('the edit token is not a person: with a stranger signed in beside it, or alone, connect and ask are refused',
    [(await W.call('POST', 'loka-sync', { cookie: other, bearer: EDIT_TOKEN, body: { spaceId: S.member } })).status, (await W.call('POST', 'loka-sync/request', { cookie: other, bearer: EDIT_TOKEN, body: { spaceId: S.member } })).status,
      (await W.call('POST', 'loka-sync', { bearer: EDIT_TOKEN, body: { spaceId: S.member } })).status, (await W.call('GET', 'loka-sync', { cookie: other, bearer: EDIT_TOKEN })).j.link], [403, 403, 403, undefined]);
  g = (await W.call('GET', 'loka-sync', { cookie: owner, slug: 'deoria-bioregion' })).j;
  check('on deoria-bioregion the owner is offered neither the link nor a connect', [g.canLink, g.canConnect, g.connected], [false, false, false]);

  console.log('\n  asking for access');
  const mails = (from) => (W.out.slice(from).match(/Subject: LOKA Atlas: a request to connect a LOKA space/g) || []).length;
  const mailBefore = W.out.length;
  r = await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.neither, spaceName: 'Somebody else’s space' } });
  check('the owner asks', [r.status, r.j], [200, { ok: true, state: 'pending' }]);
  check('asking again does not ask twice', [(await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.neither } })).j.state, Object.values((await regAfter()).lokaRequests).filter((x) => x.by === OWNER).length], ['pending', 1]);
  await sleep(100);
  check('one line went to the operator, not two', mails(mailBefore), 1);
  check('an owner with twenty requests waiting may not add another', (await W.call('POST', 'loka-sync/request', { cookie: await W.signIn(FULL), body: { spaceId: S.neither } })).j.error, 'You already have 20 requests waiting. Wait for those to be answered first.');
  check('the owner sees it waiting', (await W.call('GET', 'loka-sync', { cookie: owner })).j.request, { spaceId: S.neither, spaceName: 'Somebody else’s space', state: 'pending' });
  check('the operator has no need to ask', (await W.call('POST', 'loka-sync/request', { cookie: admin, body: { spaceId: S.neither } })).status, 400);
  check('the list is the operator\'s: signed out 401, anyone else 403', [(await W.call('GET', '/admin/loka-requests')).status, (await W.call('GET', '/admin/loka-requests', { cookie: owner })).status], [401, 403]);
  let list = (await W.call('GET', '/admin/loka-requests', { cookie: admin })).j.requests;
  check('the operator sees who asks for what (the twenty waiting ones too)', [list.length, list[0].by, list[0].title, list[0].spaceId, list[0].state], [21, OWNER, 'Link check', S.neither, 'pending']);
  r = await W.call('POST', '/admin/loka-requests/' + list[0].id, { cookie: admin, body: { state: 'declined' } });
  check('declined', [r.status, r.j.request.state, r.j.note], [200, 'declined', '']);
  check('a declined request lets nothing through', [(await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.neither } })).status, (await W.call('GET', 'loka-sync', { cookie: owner })).j.request.state], [403, 'declined']);
  check('only the operator answers', (await W.call('POST', '/admin/loka-requests/' + list[0].id, { cookie: owner, body: { state: 'approved' } })).status, 404);
  await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.neither } });
  list = (await W.call('GET', '/admin/loka-requests', { cookie: admin })).j.requests;
  check('asked again after a no: a fresh request, the old one kept', [list.filter((x) => x.by === OWNER).length, list[0].state, list[1].state], [2, 'pending', 'declined']);
  r = await W.call('POST', '/admin/loka-requests/' + list[0].id, { cookie: admin, body: { state: 'approved' } });
  check('approved; a public space needs no more', [r.status, r.j.request.state, r.j.note], [200, 'approved', '']);
  r = await W.connectAndUndo(owner, { spaceId: S.neither });
  check('and now the owner connects it, named as they asked', [r.status, r.note.added, r.note.error], [200, 2, '']);
  check('an answer that is neither yes nor no is refused', (await W.call('POST', '/admin/loka-requests/' + list[0].id, { cookie: admin, body: { state: 'maybe' } })).status, 400);
  await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: S.secret } });
  list = (await W.call('GET', '/admin/loka-requests', { cookie: admin })).j.requests;
  const askedBefore = loka.spaceCalls.length;
  r = await W.call('POST', '/admin/loka-requests/' + list[0].id, { cookie: admin, body: { state: 'approved' } });
  check('a private space approved: the operator is told the one step left, in plain words, and it is not done for them (LOKA is only asked about the space)',
    [r.j.note, loka.spaceCalls.slice(askedBefore).map((c) => c.id)], ['This space is private, or LOKA doesn’t show it to this server. For the update to work, add the sync account to the space in LOKA as a Viewer.', [S.secret]]);
  r = await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.secret } });
  check('until that step, connecting it says LOKA doesn\'t share it (and nothing is linked)', [r.status, /doesn.t share that space/.test(r.j.error), (await W.call('GET', 'loka-sync', { cookie: owner })).j.connected], [502, true, false]);

  console.log('\n  the operator, unlinking, linking again');
  r = await W.connectAndUndo(admin, { spaceId: S.neither, spaceName: 'Any space' });
  check('the operator connects any space without a link of their own', [r.status, r.note.added, (await W.call('GET', 'loka-sync', { cookie: admin })).j.link], [200, 2, null]);
  await W.call('POST', '/auth/loka/send-code', { cookie: admin });
  r = await W.call('POST', '/auth/loka/confirm', { cookie: admin, body: { code: CODE } });
  check('the operator can link their own account too (email and code only)', [r.status, r.j.lokaEmail, (await regAfter()).accounts[ADMIN].lokaLink.lokaUserId], [200, ADMIN, ID.admin]);
  check('unlink', [(await W.call('DELETE', '/auth/loka', { cookie: owner })).status, (await regAfter()).accounts[OWNER].lokaLink], [200, undefined]);
  g = (await W.call('GET', 'loka-sync', { cookie: owner })).j;
  check('back to the start: offered the link, may not connect', [g.link, g.canConnect, (await W.call('POST', 'loka-sync', { cookie: owner, body: { spaceId: S.member } })).status], [null, false, 403]);
  loka.people[LOKA_OWNER_EMAIL].spaces.push({ id: S.org, orgId: ORG.b, name: 'Org space', type: 'public_read', role: 'Viewer' });
  await W.call('POST', '/auth/loka/send-code', { cookie: owner, body: { email: LOKA_OWNER_EMAIL } });
  r = await W.call('POST', '/auth/loka/confirm', { cookie: owner, body: { email: LOKA_OWNER_EMAIL, code: CODE } });
  check('linking again takes the memberships afresh', [r.j.spaces, (await regAfter()).accounts[OWNER].lokaLink.memberSpaces.map((s) => s.name)], [2, ['Member space', 'Org space']]);

  console.log('\n  limits');
  const to = (i) => 'target' + i + '@example.test';
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await W.call('POST', '/auth/loka/send-code', { cookie: editor, body: { email: to(i) } })).status);
  check('five codes an hour for an account, whatever the emails, then no more', codes, [200, 200, 200, 200, 200, 429]);
  const aimed = [];
  for (let i = 0; i < 5; i++) aimed.push((await W.call('POST', '/auth/loka/send-code', { cookie: other, body: { email: 'shared@example.test' } })).status);
  aimed.push((await W.call('POST', '/auth/loka/send-code', { cookie: admin, body: { email: 'shared@example.test' } })).status);
  check('and five an hour aimed at one email, whoever asks', aimed, [200, 200, 200, 200, 200, 429]);
  const tries = [];
  for (let i = 0; i < 11; i++) tries.push((await W.call('POST', '/auth/loka/confirm', { cookie: editor, body: { email: to(i), code: '111111' } })).status);
  check('ten tries an hour for an account, then no more', tries, [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 429]);
  const triesAt = [];
  for (let i = 0; i < 10; i++) triesAt.push((await W.call('POST', '/auth/loka/confirm', { cookie: other, body: { email: 'shared@example.test', code: '111111' } })).status);
  triesAt.push((await W.call('POST', '/auth/loka/confirm', { cookie: admin, body: { email: 'shared@example.test', code: '111111' } })).status);
  check('and ten an hour at one email, whoever tries', triesAt, [400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 429]);
  check('the limit is the account\'s, not everyone\'s', (await W.call('POST', '/auth/loka/send-code', { cookie: owner, body: { email: LOKA_OWNER_EMAIL } })).status, 200);
  const asks = [];
  for (let i = 0; i < 12 && asks[asks.length - 1] !== 429; i++) asks.push((await W.call('POST', 'loka-sync/request', { cookie: owner, body: { spaceId: 'eeeeeeee-1111-4222-8333-0000000000' + String(i).padStart(2, '0') } })).status);
  // four asks were made above, so six more go through before the hour's ten are used up
  check('ten requests an hour for an account, then no more', asks, [200, 200, 200, 200, 200, 200, 429]);

  console.log('\n  no token, anywhere');
  const everything = W.seen.join('\n') + W.out + fs.readFileSync(path.join(W.DATA, 'registry.json'), 'utf8') +
    (fs.existsSync(path.join(W.DATA, 'loka-key.json')) ? fs.readFileSync(path.join(W.DATA, 'loka-key.json'), 'utf8') : '');
  check('a person\'s LOKA token is in no reply, no log line and no file', SECRETS.filter((s) => everything.includes(s)), []);
  check('no code typed in is in the log either', W.out.includes(CODE), false);
} catch (e) {
  fail++;
  console.log('  FAIL  the check itself broke: ' + (e && e.stack || e) + '\n' + W.out.slice(-1500));
}

{
  console.log('\n  the words on the Settings line and the operator\'s page');
  const ui = fs.readFileSync(ROOT + '/atlas/owner-loka.js', 'utf8');
  check('link, send, confirm, unlink, connect by id or link, request access', ['Link your LOKA account', 'Send code', 'Confirm', 'Unlink', 'Space id or link', 'Request access'].filter((w) => !ui.includes(w)), []);
  check('the waits say what is happening', [/busy\(send, "Sending a code…"\)/.test(ui), /busy\(confirm, "Checking the code with LOKA…"\)/.test(ui), /busy\(ask, "Asking…"\)/.test(ui)], [true, true, true]);
  check('an editor sees nothing until it is connected', /!s\.connected && !s\.canConnect && !s\.canLink/.test(ui), true);
  check('no pill shapes', /pill/.test(ui), false);
  const admin = fs.readFileSync(ROOT + '/atlas/admin/index.html', 'utf8');
  check('the operator\'s page lists the requests with Approve and Decline', [/admin\/loka-requests/.test(admin), />Approve</.test(admin), />Decline</.test(admin)], [true, true, true]);
  const srv = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  check('the operator is never made to add the sync account to a space by the server', /spaces\/[^'"]*\/users/.test(srv), false);
  check('whether LOKA knows an email is never said: one sentence for a code sent, one for a code that failed',
    [/LOKA doesn.t know that email/.test(fs.readFileSync(ROOT + '/api/lib/atlas/loka-sync.js', 'utf8')), /r\.said \+ " Type it here\."/.test(ui)], [false, true]);
  check('the renewed key is written under a name of its own before it is put in place', /process\.pid \+ '-' \+ Math\.random\(\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/loka-sync.js', 'utf8')), true);
}
W.cleanup(); loka.close();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
