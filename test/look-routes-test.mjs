/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The look routes (api/apps/atlas.js): GET /look, POST /look/read, POST /look
   (save), POST /look/undo, DELETE /look, POST /look/credit — against a
   throwaway server with a private atlas in a temporary data folder (nothing
   under atlas/datasets/ is touched). What these hold: owner AND editors may
   read, save, undo and switch the credit (D2); a stranger may not; save never
   trusts the browser's block (unknown keys dropped, a dark page refused, a
   300 KB logo refused); the logo goes through the one logo function; Undo
   swaps the look and the logo files back, and again is redo (D9); Back to
   LOKA's look leaves the logo; the credit line is on unless switched off
   (D3); a read of a private or local address is refused with the plain
   sentence and never leaves the machine. No network beyond 127.0.0.1. */

const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function grab(src, method, name) {
  const i = src.indexOf("router." + method + "('/instances/:slug/" + name + "'");
  if (i < 0) return '';
  const j = src.indexOf('\n});', i);
  return src.slice(i, j + 4);
}

console.log('\n  the routes, in the source');
for (const [m, n] of [['get', 'look'], ['post', 'look/read'], ['post', 'look'], ['post', 'look/undo'], ['delete', 'look'], ['post', 'look/credit']]) check(m.toUpperCase() + ' /instances/:slug/' + n + ' exists and goes through the gate', /lookGate\(req, res/.test(grab(api, m, n)), true);
check('the gate: owner or editor (callerCanEdit, as /details), never deoria-bioregion for a write, not while building', /if \(!callerCanEdit\(req, inst\)\)/.test(api.slice(api.indexOf('function lookGate'), api.indexOf('function cleanLookTheme'))) && /searchText\.isNeverTouched\(inst\.slug\)/.test(api.slice(api.indexOf('function lookGate'), api.indexOf('function cleanLookTheme'))), true);
check('the logo save is one function, used by /details and by the look save', (api.match(/const saved = saveLogoFile\(inst, /g) || []).length, 2);
check('and /details no longer writes the file itself', /fs\.writeFileSync\(path\.join\(curDir, 'branding-logo\.png'\)/.test(api), false);
check('a read is logged with the host and outcome, never with page content', /console\.info\('\[look\] ' \+ inst\.slug \+ ' ' \+ host/.test(api), true);
check('a second press while one read runs gets the running one’s answer', /const running = lookRead\.runningRead\(inst\.slug\);/.test(api), true);

/* ---------------- against a real server ---------------- */
const PORT = 8900 + Math.floor(Math.random() * 90);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const SLUG = 'look-check-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-look-check-'));
const DIR = path.join(DATA, 'private-datasets', SLUG);
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test';
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ title: 'Look check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
fs.writeFileSync(path.join(DIR, 'manifest.local.json'), JSON.stringify({ layers: [] }));
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [SLUG]: { slug: SLUG, title: 'Look check', visibility: 'private', status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
    tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }], branding: { orgName: 'Look', hasLogo: false } } },
  accounts: { [OWNER]: { email: OWNER, instances: [SLUG], verifiedAt: 1 }, [EDITOR]: { email: EDITOR, instances: [], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
  drafts: {},
}));
let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: 'nobody@example.test' },
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
async function call(method, p, { cookie, body } = {}) {
  const r = await fetch(BASEURL + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const overlay = () => JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.local.json'), 'utf8'));
// the registry is written a moment after it changes (persist() is debounced), so wait for it
const registry = async () => { await new Promise((r) => setTimeout(r, 250)); return JSON.parse(fs.readFileSync(path.join(DATA, 'registry.json'), 'utf8')).instances[SLUG]; };
const hasFile = (n) => fs.existsSync(path.join(DIR, n));
// a PNG's first bytes, which is all validLogo looks at; the byte at 16 tells the two apart
function png(mark, bytes) {
  const b = Buffer.alloc(bytes || 33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b[16] = mark;
  return 'data:image/png;base64,' + b.toString('base64');
}
const LOOK = { version: 1, colors: { page: '#FFFDFD', surface: '#FFFFFF', surfaceAlt: '#E8F9EE', text: '#060606', textSecondary: '#3D3C3C', textMuted: '#656464', accent: '#6B1164', accentDeep: '#4B0C46', highlight: '#FC3103', highlightDeep: '#CF2802' },
  corners: 'square', logoMaxWidth: 180, source: { url: 'https://emergencefestival.in/', host: 'emergencefestival.in', readAt: '2026-11-02T03:00:00.000Z' }, fonts: { display: 'Comic Sans' }, extra: 1 };

try {
  await startServer();
  console.log('\n  the routes, on a throwaway server (' + BASEURL + ')');
  const owner = await signIn(OWNER), editor = await signIn(EDITOR), other = await signIn(OTHER);
  const P = '/api/atlas/instances/' + SLUG;

  check('GET /look: a stranger is refused', (await call('GET', P + '/look', { cookie: other })).status, 403);
  check('…nobody at all too', (await call('GET', P + '/look')).status, 403);
  check('an editor may look (D2)', (await call('GET', P + '/look', { cookie: editor })).j, { theme: null, canUndo: false, hasLogo: false, hasIcon: false, site: '' });

  let r = await call('POST', P + '/look/read', { cookie: owner, body: { url: 'localhost' } });
  check('a read of localhost is refused with the plain sentence, before any connection', [r.status, r.j.error], [422, 'We couldn’t reach that address. Check it and try again.']);
  r = await call('POST', P + '/look/read', { cookie: owner, body: { url: 'http://10.0.0.1/' } });
  check('a private address too', [r.status, r.j.error], [422, 'We couldn’t reach that address. Check it and try again.']);
  r = await call('POST', P + '/look/read', { cookie: owner, body: { url: 'http://127.0.0.1:' + PORT + '/' } });
  check('this very server, by its loopback address and port', [r.status, r.j.error], [422, 'We couldn’t reach that address. Check it and try again.']);
  check('a stranger may not read', (await call('POST', P + '/look/read', { cookie: other, body: { url: 'example.org' } })).status, 403);
  check('an empty address', (await call('POST', P + '/look/read', { cookie: owner, body: {} })).status, 400);

  r = await call('POST', P + '/look', { cookie: other, body: { theme: LOOK } });
  check('save: a stranger is refused', r.status, 403);
  r = await call('POST', P + '/look', { cookie: editor, body: { theme: LOOK } });
  check('an editor may save (D2)', [r.status, r.j.ok], [200, true]);
  let t = overlay().theme;
  check('the block is kept known-keys-only: no fonts, no extra', [t.fonts, t.extra, t.version, t.corners, t.logoMaxWidth], [undefined, undefined, 1, 'square', 180]);
  check('the colours as given (already readable)', t.colors.accent, '#6B1164');
  check('the source rides along for the credit line, which is on by default (D3)', [t.source.host, t.credit], ['emergencefestival.in', true]);
  check('a previous look is kept for Undo: none before', overlay().themePrevious, { ...overlay().themePrevious, theme: null, logoWas: false, logoChanged: false });
  check('the answer says what Settings needs', r.j, { ok: true, theme: t, canUndo: true, hasLogo: false, hasIcon: false, site: '' });

  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { colors: { page: '#111111', accent: '#6B1164' } } } });
  check('a dark page is refused', [r.status, r.j.error], [400, 'That page colour is too dark. LOKA has no dark mode, so a look needs a light page.']);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { colors: { accent: '#03FCAD', highlightDeep: '#FC3103' } } } });
  check('a faint colour is darkened by the guard at save, so what is kept needs no change at run time', [r.status, overlay().theme.colors.accent !== '#03FCAD', overlay().theme.colors.highlightDeep !== '#FC3103'], [200, true, true]);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { colors: {} } } });
  check('no colours at all is refused', r.status, 400);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: 'x' } });
  check('not a block is refused', r.status, 400);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: png(1, 300 * 1024) } });
  check('a 300 KB logo is refused', [r.status, r.j.error], [400, 'The logo must be a PNG under 200 KB.']);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } });
  check('an SVG is refused: only the PNG the browser made', r.status, 400);

  // a logo the owner uploaded by hand, then a look with the site's logo
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', logoData: png(1) } } });
  check('(a hand-uploaded logo is there)', [hasFile('branding-logo.png'), (await registry()).branding.hasLogo], [true, true]);
  const accentBefore = overlay().theme.colors.accent;
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: png(2) } });
  check('a look with the site’s logo: saved, the old logo put aside for Undo', [r.status, r.j.hasLogo, hasFile('branding-logo.png'), hasFile('branding-logo.previous.png'), fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16], fs.readFileSync(path.join(DIR, 'branding-logo.previous.png'))[16]], [200, true, true, true, 2, 1]);
  check('the registry marks the logo and who said they may use it', [(await registry()).branding.hasLogo, (await registry()).branding.logoRights.by, (await registry()).branding.logoRights.from], [true, OWNER, 'emergencefestival.in']);
  check('the public manifest points at the logo', JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')).branding.logo, 'branding-logo.png');
  check('themePrevious knows the logo changed', [overlay().themePrevious.logoChanged, overlay().themePrevious.logoWas], [true, true]);
  check('the saved look remembers its logo came from the site, so the credit may name it', overlay().theme.source.logo, true);

  r = await call('POST', P + '/look/undo', { cookie: editor });
  check('Undo (an editor may): the previous look is back, and the hand-uploaded logo with it', [r.status, overlay().theme.colors.accent, fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16], (await registry()).branding.hasLogo], [200, accentBefore, 1, true]);
  check('the undone look waits as the previous one (Undo again is redo)', overlay().themePrevious.theme.source.host, 'emergencefestival.in');
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo again: the site’s look and logo are back', [overlay().theme.source.host, fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16]], ['emergencefestival.in', 2]);

  r = await call('POST', P + '/look/credit', { cookie: editor, body: { on: false } });
  check('the credit line can be switched off (an editor may)', [r.status, overlay().theme.credit], [200, false]);
  r = await call('POST', P + '/look/credit', { cookie: owner, body: { on: true } });
  check('…and on', overlay().theme.credit, true);

  r = await call('DELETE', P + '/look', { cookie: editor });
  check('Back to LOKA’s look (an editor may): the theme goes, the logo stays', [r.status, overlay().theme, hasFile('branding-logo.png'), (await registry()).branding.hasLogo], [200, undefined, true, true]);
  check('…and Undo can bring it back', [(await call('POST', P + '/look/undo', { cookie: owner })).status, overlay().theme.source.host], [200, 'emergencefestival.in']);
  check('a stranger cannot undo, delete or switch the credit', [(await call('POST', P + '/look/undo', { cookie: other })).status, (await call('DELETE', P + '/look', { cookie: other })).status, (await call('POST', P + '/look/credit', { cookie: other, body: { on: false } })).status], [403, 403, 403]);
  check('the credit switch with no look says so', [(await call('DELETE', P + '/look', { cookie: owner })).status, (await call('POST', P + '/look/credit', { cookie: owner, body: { on: false } })).status], [200, 409]);

  // a logo brought by a look where there was none before: Undo removes it
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', removeLogo: true } } });
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: png(3) } });
  check('(a look with a logo where there was none)', [r.j.hasLogo, hasFile('branding-logo.png')], [true, true]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo takes the site’s logo away again, since there was none before', [r.j.hasLogo, hasFile('branding-logo.png'), (await registry()).branding.hasLogo], [false, false, false]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('…and redo brings it back', [r.j.hasLogo, hasFile('branding-logo.png')], [true, true]);

  // a logo changed by hand in Identity after a look brought one: Undo leaves the logo alone
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', logoData: png(7) } } });
  check('(a hand-uploaded logo replaces the look’s; the look’s kept copy goes with it)', [fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16], hasFile('branding-logo.previous.png'), overlay().themePrevious.logoChanged], [7, false, false]);
  check('…and the credit stops naming the logo: it is the owner’s own now', overlay().theme.source.logo, false);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo now changes the theme only; the hand-uploaded logo stays', [r.status, fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16], r.j.hasLogo], [200, 7, true]);
  await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: png(8) } });
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', removeLogo: true } } });
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('…and the same after the owner removes the logo by hand', [overlay().themePrevious.logoChanged, hasFile('branding-logo.png'), r.j.hasLogo], [false, false, false]);

  // phase 2: the site's font is saved with the look, its address built by the server
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { ...LOOK, fonts: { text: 'poppins', cssUrl: 'https://evil.example/x.css' } } } });
  check('the font: a Google Fonts family in LOKA’s list is kept, spelt as Google spells it; the address is built here, never the browser’s', [r.status, overlay().theme.fonts], [200, { text: 'Poppins', cssUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap' }]);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { ...LOOK, fonts: { text: 'Gotham' } } } });
  check('a family not in the list is dropped: the look is saved without a font (D6)', [r.status, overlay().theme.fonts], [200, undefined]);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: { ...LOOK, fonts: { text: 'Pacifico' } } } });
  check('a headline face is allowed (P2)', overlay().theme.fonts.text, 'Pacifico');
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo takes the font with the look', overlay().theme.fonts, undefined);

  // phase 2: the site's icon as the tab icon, when ticked; Undo covers it like the logo
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', removeLogo: true, removeIcon: true } } });
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useIcon: true, iconData: png(21) } });
  check('a look with the site’s icon: saved as branding-icon.png, the record and the public manifest know', [r.status, r.j.hasIcon, hasFile('branding-icon.png'), (await registry()).branding.hasIcon, JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')).branding.icon], [200, true, true, true, 'branding-icon.png']);
  check('themePrevious knows the icon changed and that there was none', [overlay().themePrevious.iconChanged, overlay().themePrevious.iconWas], [true, false]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo takes the icon away again, since there was none before', [r.j.hasIcon, hasFile('branding-icon.png'), (await registry()).branding.hasIcon, JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')).branding.icon], [false, false, false, undefined]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('…and redo brings it back', [r.j.hasIcon, fs.readFileSync(path.join(DIR, 'branding-icon.png'))[16]], [true, 21]);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useIcon: true, iconData: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } });
  check('an icon that is not the PNG the browser made is refused', [r.status, r.j.error], [400, 'The tab icon must be a PNG under 200 KB.']);
  // a hand-picked icon in Settings, then a look's icon over it, then Undo
  await call('POST', P + '/details', { cookie: owner, body: { branding: { iconData: png(22) } } });
  check('Settings: an icon picked by hand, with nothing else in the body (the fields are preserved)', [fs.readFileSync(path.join(DIR, 'branding-icon.png'))[16], (await registry()).branding.hasIcon, (await registry()).title, overlay().themePrevious.iconChanged], [22, true, 'Look check', false]);
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useIcon: true, iconData: png(23) } });
  check('a look’s icon over it: the hand-picked one goes aside', [fs.readFileSync(path.join(DIR, 'branding-icon.png'))[16], fs.readFileSync(path.join(DIR, 'branding-icon.previous.png'))[16]], [23, 22]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('Undo: the hand-picked icon is back', [r.j.hasIcon, fs.readFileSync(path.join(DIR, 'branding-icon.png'))[16]], [true, 22]);
  await call('POST', P + '/look/undo', { cookie: owner });
  await call('POST', P + '/details', { cookie: owner, body: { branding: { removeIcon: true } } });
  check('Take it off in Settings: the file goes, and a look’s kept copy with it, so Undo leaves the icon alone', [hasFile('branding-icon.png'), hasFile('branding-icon.previous.png'), (await registry()).branding.hasIcon, overlay().themePrevious.iconChanged], [false, false, false, false]);
  r = await call('POST', P + '/look/undo', { cookie: owner });
  check('…as it does', [r.status, hasFile('branding-icon.png'), r.j.hasIcon], [200, false, false]);

  // the overlay is written before the logo: when it cannot be, nothing has changed
  await call('POST', P + '/details', { cookie: owner, body: { title: 'Look check', org: 'Look', branding: { orgName: 'Look', logoData: png(9) } } });
  fs.mkdirSync(path.join(DIR, 'manifest.local.json.tmp'));   // the overlay's temp file cannot be written over a folder
  r = await call('POST', P + '/look', { cookie: owner, body: { theme: LOOK, useLogo: true, logoData: png(10) } });
  fs.rmdirSync(path.join(DIR, 'manifest.local.json.tmp'));
  check('save fails before the logo is touched: "Nothing changed" is true', [r.status, /Nothing changed/.test(r.j.error), fs.readFileSync(path.join(DIR, 'branding-logo.png'))[16], hasFile('branding-logo.previous.png')], [500, true, 9, false]);
  check('the overlay is written before the logo in the save route', (() => { const i = api.indexOf("router.post('/instances/:slug/look',"); const seg = api.slice(i, api.indexOf('\n});', i)); return seg.indexOf('writeOverlay(file, local)') < seg.indexOf('saveLogoFile(inst, b.logoData)'); })(), true);
  check('every read was logged, with its host and outcome, and none got through to the network', [(out.match(/\[look\] look-check-\S+ (localhost|10\.0\.0\.1|127\.0\.0\.1) \d+ms failed: /g) || []).length, (out.match(/\[look\] .* ok /g) || []).length], [3, 0]);
} catch (e) {
  fail++;
  console.log('  FAIL  the server part threw: ' + (e && e.stack || e) + '\n' + out.slice(-1500));
} finally {
  cleanup();
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
