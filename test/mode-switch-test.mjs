/* Run me with: node test/run.mjs — or on my own with node.
 *
 * "How visitors explore": an owner switches an atlas between Standard, Event
 * and Explore (Owner menu), edits Explore's buttons (the Buttons tab), and can
 * look at it as a visitor would. These checks hold:
 *   - the rules for buttons (atlas/explore-mode.js), which the page and the
 *     server share;
 *   - the route POST/GET /instances/:slug/mode, against a real server with a
 *     throwaway data folder, on a public AND a private atlas: owner only,
 *     settings kept and given back, Event refused until it is set up;
 *   - the deploy scripts leave `modeKept` as it was;
 *   - the viewer never reads `modeKept`;
 *   - the owner's page: the menu lines, the tabs per mode, the visitor view. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const XM = require(ROOT + '/atlas/explore-mode.js');
const ownerJs = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

/* ---------------- the rules for buttons ---------------- */
console.log('\n  the rules for buttons (explore-mode.js)');
const pt = (cats) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.6, 12.97] }, properties: { name: 'x', categories: cats } });
const feats = [pt('Nature; Culture'), pt('nature'), pt('Nature'), pt('Culture'), pt('Market; Civic'), pt('Civic'), pt('Civic'), pt('Others'), pt(null)];
check('words are counted in any case, shown as most places write them, most first',
  XM.wordCounts(feats, { tagColumn: 'categories' }), [{ w: 'Nature', n: 3 }, { w: 'Civic', n: 3 }, { w: 'Culture', n: 2 }, { w: 'Market', n: 1 }, { w: 'Others', n: 1 }]);
check('a new Explore: one button for each of the four most-used words, leaf · landmark · ticket · users, ids b1..b4',
  XM.defaultButtons(feats, {}).map((b) => [b.id, b.label, b.icon, b.words]),
  [['b1', 'Nature', 'leaf', ['Nature']], ['b2', 'Civic', 'landmark', ['Civic']], ['b3', 'Culture', 'ticket', ['Culture']], ['b4', 'Market', 'users', ['Market']]]);
check('no categories: no buttons', XM.defaultButtons([pt(null)], {}), []);
const ok4 = [1, 2, 3, 4].map((i) => ({ label: 'B' + i, icon: 'leaf', words: ['Nature'] }));
check('five buttons are refused', /Four buttons is the most/.test(XM.cleanButtons(ok4.concat([{ label: 'B5', icon: 'leaf', words: [] }])).error || ''), true);
check('a picture not among the eight is refused', !!XM.cleanButtons([{ label: 'A', icon: 'factory', words: [] }]).error, true);
check('a name over 20 letters is refused', !!XM.cleanButtons([{ label: 'A'.repeat(21), icon: 'leaf', words: [] }]).error, true);
check('20 letters is 20 letters, an emoji counting as one', [!!XM.cleanButtons([{ label: '🌳'.repeat(20), icon: 'leaf', words: [] }]).error, !!XM.cleanButtons([{ label: '🌳'.repeat(21), icon: 'leaf', words: [] }]).error], [false, true]);
check('an empty name is refused', !!XM.cleanButtons([{ label: '   ', icon: 'leaf', words: [] }]).error, true);
check('more than 12 categories on one button are refused', !!XM.cleanButtons([{ label: 'A', icon: 'leaf', words: 'abcdefghijklm'.split('') }]).error, true);
check('a category over 40 letters is refused', !!XM.cleanButtons([{ label: 'A', icon: 'leaf', words: ['x'.repeat(41)] }]).error, true);
check('a category that is not a word is refused', !!XM.cleanButtons([{ label: 'A', icon: 'leaf', words: [{}] }]).error, true);
check('the eleven pictures (store, droplet and footprints added for buttons from the analysis)', XM.ICON_CHOICES, ['leaf', 'landmark', 'ticket', 'users', 'utensils', 'camera', 'music', 'book', 'store', 'droplet', 'footprints']);
const cleaned = XM.cleanButtons([{ id: 'nature', label: ' Nature ', icon: 'leaf', words: ['Nature', 'nature', ' '], extra: 'dropped' }, { label: 'New', icon: 'music', words: [] }, { id: 'nature', label: 'Twin', icon: 'book', words: [] }]);
check('kept ids stay, new and doubled ones are made; names trimmed; doubled words once; colours by place in the row; nothing else kept',
  cleaned.buttons, [
    { id: 'nature', label: 'Nature', icon: 'leaf', color: XM.PALETTE[0], words: ['Nature'] },
    { id: 'b1', label: 'New', icon: 'music', color: XM.PALETTE[1], words: [] },
    { id: 'b2', label: 'Twin', icon: 'book', color: XM.PALETTE[2], words: [] }]);
check('the first four colours are the ones Explore has been wearing: green, red, orange, blue', XM.PALETTE.slice(0, 4), ['#2A6B41', '#C9402B', '#B5541B', '#3A7FA1']);
check('the icon kit has every picture an owner may choose',
  XM.ICON_CHOICES.every((k) => new RegExp('\\n    ' + k + ': svgIcon\\(').test(fs.readFileSync(ROOT + '/atlas/iconkit.js', 'utf8'))), true);
check('the explore viewer can be handed new buttons (the live preview)', /setButtons: setButtons/.test(fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8')), true);
check('with no buttons there is no row of buttons', /if \(!BUTTONS\.length\) \{ if \(bar\.parentNode\) bar\.parentNode\.removeChild\(bar\); return; \}/.test(fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8')), true);

/* ---------------- the viewer never reads modeKept ---------------- */
console.log('\n  the viewer reads `mode`, never `modeKept`');
const mStart = viewer.indexOf('  function mergeLocalOverlay(manifest) {');
const mEnd = viewer.indexOf('  /* An atlas whose manifest carries a `mode`');
const mergeSrc = viewer.slice(mStart, mEnd);
const ctx = { result: null };
vm.createContext(ctx);
vm.runInContext(mergeSrc + `
  function dataUrl(f) { return f; }
  function uploadKind() { return ''; }
  var fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({
    layers: [], mode: { name: 'explore', buttons: [] }, modeKept: { event: { name: 'event' } } }); } }); };
  result = mergeLocalOverlay({ layers: [], groups: [], attributions: [] });`, ctx);
const merged = await ctx.result;
check('the mode in use reaches the page', merged.mode && merged.mode.name, 'explore');
check('the kept settings do not', 'modeKept' in merged, false);
check('and the function never names them', /modeKept/.test(mergeSrc), false);

/* ---------------- the owner's page ---------------- */
console.log('\n  the owner\'s page');
check('the menu opens with a place for "See it as a visitor"', /'<div class="own-panel-t">Owner<\/div>' \+\s*'<div class="own-panel-ln" id="own-panel-visitor"><\/div>'/.test(ownerJs), true);
check('…filled with its switch', /See it as a visitor[^]*?Hide your tools and look at the atlas as anyone would[^]*?role="switch" aria-checked="false"/.test(owner), true);
check('"How visitors explore" sits right after who can see it', /id="own-live" hidden type="button"><\/button>' \+\s*"<\/div>" \+\s*'<div class="own-panel-ln" id="own-panel-mode"><\/div>'/.test(ownerJs), true);
check('owner.js fetches the kit, as it is fetched itself (a visitor never downloads it)', /js\.src = "\.\/owner-modes\.js"/.test(ownerJs) && !/owner-modes\.js/.test(fs.readFileSync(ROOT + '/atlas/index.html', 'utf8')), true);
check('seen as a visitor, the map wears the saved buttons; back to editing, the draft', /v\.setButtons\(previewList\(VISITOR \? BTN\.saved : BTN\.draft\)\)/.test(owner) && /if \(BTN\.saved && btnDirty\(\)\) previewButtons\(\);/.test(owner), true);
check('a name is cut at 20 letters, not 20 code units', /var chars = Array\.from\(inp\.value\);/.test(owner) && !/maxlength/.test(owner), true);
check('an editor sees the line without Change', /small\.textContent = owner \? MODES\[name\]\.d : "Only the owner can change this";\s*act\.hidden = !owner/.test(owner), true);
// Insight joined as the fourth (25 Oct 2026, test/insight-mode-test.mjs); Field is not offered
check('the dialog: four choices only', /var MODE_ORDER = \["standard", "event", "explore", "insight"\];/.test(owner) && !/Field/.test(owner.slice(owner.indexOf('var MODES = {'), owner.indexOf('var MODE_ORDER'))), true);
check('its question', /How should visitors find their way\?/.test(owner), true);
check('the confirm says nothing is lost and the old settings are kept', /Nothing is lost: /.test(owner) && /’s settings are kept\. Switch back and they return as you left them\./.test(owner) && /"Keep " \+ MODES\[cur\]\.t/.test(owner) && /"Switch to " \+ MODES\[to\]\.t/.test(owner), true);
check('an event guide not set up: the sentence, and no Switch button', /if \(to === "event" && !\(MODEINFO && MODEINFO\.canEvent\)\) \{\s*conf\.innerHTML = "<p>" \+ esc\(EVENT_NOT_SET_UP\) \+ "<\/p>";\s*go\.hidden = true;/.test(owner), true);
check('the steps tick on real answers: the server\'s, then the reload (said on arrival)', /\.then\(function \(\) \{\s*var s1 = [^]*?s1\.classList\.add\("done"\)[^]*?Done — reloading the atlas…[^]*?sessionStorage\.setItem\(MODE_SWITCHED[^]*?location\.reload\(\)/.test(owner) && /"Now in " \+ MODES\[was\.to\]\.t \+ "\. Your " \+ MODES\[was\.from\]\.t \+ " settings are kept for when you switch back\."/.test(owner), true);
check('an error leaves the choice on screen with the server\'s words', /\.catch\(function \(e\) \{\s*busy = false;[^]*?err\.textContent = errMsg\(e\);/.test(owner), true);
check('tabs per mode: Explore has Around here · Buttons', /if \(drawn === "explore"\) pairs = \[\["around", "Around here"\], \["buttons", "Buttons"\]\];/.test(ownerJs), true);
check('an Event guide has no tabs', /if \(drawn === "event"\) return;/.test(ownerJs), true);
check('Standard keeps Layers · Questions', /pairs = \[\["layers", "Layers"\], \["questions", "Questions"\]\];/.test(ownerJs), true);
check('the Buttons tab: at most four, and says why', /Four buttons is the most: a row of four still fits on a phone/.test(owner), true);
check('the none-line, every way it can read', /under no button<\/b> \(/.test(owner) && /Every place is under at least one button\./.test(owner) && /No buttons: visitors see the map and the Around here list\./.test(owner), true);
check('the save bar\'s words', /Not saved yet\. The map shows your changes; visitors don't see them until you save\./.test(owner) && /Saving…/.test(owner) && /Saved\. Visitors see the new buttons from now\./.test(owner), true);
check('no reordering, no colour picker', /data-mv|Move up|type="color"/.test(owner), false);
check('the visitor view is one class on the page, not remembered', /classList\.toggle\("atlas-as-visitor", VISITOR\)/.test(owner) && !/localStorage[^\n]*VISITOR|sessionStorage[^\n]*VISITOR/.test(owner), true);
check('it hides everything owner.js made', /html\.atlas-as-visitor :is\(\[class\^=\\"own-\\"\],\[class\*=\\" own-\\"\]\):not\(\.own-toast\)\{display:none !important\}/.test(owner), true);
check('and the pill brings the tools back', /Seeing it as a visitor<\/span>[^]*?Back to editing/.test(owner), true);
check('the route is owner only', /if \(role !== 'owner'\) return res\.status\(403\)\.json\(\{ error: 'Only the owner can change how visitors explore this atlas\.' \}\);/.test(server), true);

/* ---------------- the deploy scripts keep modeKept ---------------- */
console.log('\n  the deploy scripts leave the kept settings be');
const blr = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/blr.geojson', 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-modes-'));
{
  const pub = path.join(tmp, 'datasets');
  const A = path.join(pub, 'modes-test-copy');
  fs.mkdirSync(A, { recursive: true });
  fs.writeFileSync(A + '/manifest.json', JSON.stringify({ id: 'bengaluru-on-loka', layers: [] }));
  const kept = { event: { name: 'event', layer: 'x', days: ['2026-10-29'] } };
  fs.writeFileSync(A + '/manifest.local.json', JSON.stringify({ layers: [{ id: 'bengaluru-tags', group: 'userdata', source: 'user-bengaluru-tags.geojson', userLayer: true, type: 'marker' }], modeKept: kept }));
  fs.writeFileSync(A + '/user-bengaluru-tags.geojson', JSON.stringify(blr));
  const env = Object.assign({}, process.env, { LOKA_DATA_DIR: tmp, LOKA_PUBLIC_DATASETS: pub });
  const r = spawnSync(process.execPath, [ROOT + '/deploy/apply-explore-mode.mjs', 'modes-test-copy', '--apply', '--server-is-stopped'], { encoding: 'utf8', env });
  const after = JSON.parse(fs.readFileSync(A + '/manifest.local.json', 'utf8'));
  check('apply-explore-mode writes the mode and keeps modeKept as it was', [r.status, after.mode && after.mode.name, after.modeKept], [0, 'explore', kept]);
}
{
  const SLUG = 'emergence-festival-of-future-cities';
  const FIX = ROOT + '/test/fixtures';
  const data = path.join(tmp, 'event-data');
  const E = path.join(data, 'private-datasets', SLUG);
  fs.mkdirSync(E, { recursive: true });
  for (const f of fs.readdirSync(FIX + '/event-atlas/private-datasets/' + SLUG)) fs.copyFileSync(path.join(FIX, 'event-atlas/private-datasets', SLUG, f), path.join(E, f));
  const local = JSON.parse(fs.readFileSync(E + '/manifest.local.json', 'utf8'));
  const exploreWas = { name: 'explore', layer: 'tags', tagColumn: 'categories', buttons: [{ id: 'b1', label: 'Nature', icon: 'leaf', words: ['Nature'] }] };
  const keptStd = { standard: { note: 'kept' } };
  local.mode = exploreWas; local.modeKept = keptStd;
  fs.writeFileSync(E + '/manifest.local.json', JSON.stringify(local));
  const env = Object.assign({}, process.env, { LOKA_DATA_DIR: data, LOKA_PUBLIC_DATASETS: path.join(tmp, 'no-such-folder') });
  const run = (script, extra) => spawnSync(process.execPath, [ROOT + '/deploy/' + script, SLUG, '--apply', '--server-is-stopped', '--osm-file=' + FIX + '/event-osm.json'].concat(extra || []), { encoding: 'utf8', env });
  const a = run('apply-event-mode.mjs');
  let now = JSON.parse(fs.readFileSync(E + '/manifest.local.json', 'utf8'));
  check('apply-event-mode puts an Explore in use aside, never away, and keeps what was kept',
    [a.status, now.mode && now.mode.name, now.modeKept], [0, 'event', { standard: keptStd.standard, explore: exploreWas }]);
  const r = run('refresh-event-atlas.mjs');
  now = JSON.parse(fs.readFileSync(E + '/manifest.local.json', 'utf8'));
  check('the event refresh rewrites the mode and keeps modeKept as it was',
    [r.status, now.mode && now.mode.name, now.modeKept], [0, 'event', { standard: keptStd.standard, explore: exploreWas }]);
}

/* ---------------- the route, against a real server ---------------- */
const PORT = 8600 + Math.floor(Math.random() * 300);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const PUBSLUG = 'mode-check-' + TAG, PRIVSLUG = 'mode-private-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-mode-check-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', PUBSLUG);
const PRIV = path.join(DATA, 'private-datasets', PRIVSLUG);
const OWNER = 'owner@example.test', EDITOR = 'editor@example.test', OTHER = 'other@example.test';
const BLR_MODE = JSON.parse(fs.readFileSync(ROOT + '/deploy/explores/bengaluru-on-loka.json', 'utf8')).mode;

function seed(dir, mode) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Mode check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
  const local = { layers: [{ id: 'bengaluru-tags', label: 'Tags', group: 'userdata', type: 'marker', userLayer: true, source: 'user-bengaluru-tags.geojson' }], placeName: 'Bengaluru' };
  if (mode) local.mode = mode;
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify(local));
  fs.writeFileSync(path.join(dir, 'user-bengaluru-tags.geojson'), JSON.stringify(blr));
}
seed(PUB, BLR_MODE);
seed(PRIV, null);
const rec = (slug, vis) => ({ slug, title: 'Mode check', visibility: vis, status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [],
  tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [{ email: EDITOR, role: 'editor' }] });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: { [PUBSLUG]: rec(PUBSLUG, 'public'), [PRIVSLUG]: rec(PRIVSLUG, 'private') },
  accounts: { [OWNER]: { email: OWNER, instances: [PUBSLUG, PRIVSLUG], verifiedAt: 1 }, [EDITOR]: { email: EDITOR, instances: [], verifiedAt: 1 }, [OTHER]: { email: OTHER, instances: [], verifiedAt: 1 } },
  drafts: {},
}));

let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [PUB, DATA, tmp]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
process.on('exit', cleanup);
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_OWNER_EMAILS: 'nobody@example.test' },
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
const fileOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'));

try {
  console.log('\n  the route, on a throwaway server (' + BASEURL + ')');
  await startServer();
  const ownerC = await signIn(OWNER), editorC = await signIn(EDITOR), otherC = await signIn(OTHER);
  const M = (slug) => `/api/atlas/instances/${slug}/mode`;

  for (const [slug, dir, label] of [[PUBSLUG, PUB, 'public'], [PRIVSLUG, PRIV, 'private']]) {
    console.log('\n  a ' + label + ' atlas');
    const start = fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8');
    check('nobody signed in may not switch it', (await call('POST', M(slug), { body: { name: 'standard' } })).status, 403);
    check('a signed-in stranger may not', (await call('POST', M(slug), { cookie: otherC, body: { name: 'standard' } })).status, 403);
    check('nor ask what it is', (await call('GET', M(slug), { cookie: otherC })).status, 403);
    const ed = await call('POST', M(slug), { cookie: editorC, body: { name: 'standard' } });
    check('an editor is told, plainly, only the owner can', [ed.status, ed.j && ed.j.error], [403, 'Only the owner can change how visitors explore this atlas.']);
    check('an editor\'s buttons are refused too', (await call('POST', M(slug), { cookie: editorC, body: { buttons: [] } })).status, 403);
    check('an editor may see which mode, but not change it', [(await call('GET', M(slug), { cookie: editorC })).j.canChange], [false]);
    check('nothing was written by any of them', fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'), start);
    check('a name not among the three is refused', (await call('POST', M(slug), { cookie: ownerC, body: { name: 'field' } })).status, 400);
    const ev = await call('POST', M(slug), { cookie: ownerC, body: { name: 'event' } });
    check('Event with nothing kept is refused, in the sentence the dialog shows', [ev.status, ev.j && ev.j.error],
      [409, 'An event guide needs its venues and programme set up first. LOKA sets this up for you — write to us.']);
    check('…and nothing changes', fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'), start);
    check('the owner is told Event cannot be chosen yet', (await call('GET', M(slug), { cookie: ownerC })).j.canEvent, false);
  }

  console.log('\n  the public atlas: Explore → Standard → Explore');
  const was = fileOf(PUB);
  const toStd = await call('POST', M(PUBSLUG), { cookie: ownerC, body: { name: 'standard', buttons: [{ label: 'sneaky', icon: 'leaf' }], junk: 1 } });
  let f = fileOf(PUB);
  check('switched to Standard: no mode, the Explore settings kept whole', [toStd.status, 'mode' in f, f.modeKept && f.modeKept.explore], [200, false, was.mode]);
  check('nothing but the whitelisted fields was read', [JSON.stringify(f).includes('sneaky'), JSON.stringify(f).includes('junk')], [false, false]);
  check('the layers and the place name are as they were', [f.layers, f.placeName], [was.layers, was.placeName]);
  check('buttons are refused when it is not in Explore', (await call('POST', M(PUBSLUG), { cookie: ownerC, body: { buttons: [] } })).status, 409);
  const g = (await call('GET', M(PUBSLUG), { cookie: ownerC })).j;
  check('the server says what is in use and what is kept', [g.name, g.kept, g.canChange], ['standard', ['explore'], true]);
  const back = await call('POST', M(PUBSLUG), { cookie: ownerC, body: { name: 'explore' } });
  f = fileOf(PUB);
  check('back to Explore: the identical buttons return', [back.status, f.mode], [200, was.mode]);
  check('and nothing is left kept twice', 'modeKept' in f, false);
  check('switching to the mode in use changes nothing', [(await call('POST', M(PUBSLUG), { cookie: ownerC, body: { name: 'explore' } })).j.already, fileOf(PUB)], [true, f]);

  console.log('\n  the public atlas: the buttons');
  const B = (buttons) => call('POST', M(PUBSLUG), { cookie: ownerC, body: { buttons } });
  const four = was.mode.buttons.map((b) => ({ id: b.id, label: b.label, icon: b.icon, words: b.words }));
  check('five buttons are refused', (await B(four.concat([{ label: 'Five', icon: 'leaf', words: [] }]))).status, 400);
  check('a picture not among the eight is refused', (await B([{ label: 'A', icon: 'factory', words: [] }])).status, 400);
  check('a name over 20 letters is refused', (await B([{ label: 'A much too long name!!', icon: 'leaf', words: [] }])).status, 400);
  check('buttons that are not a list are refused', (await B('Nature')).status, 400);
  check('…and none of those wrote anything', fileOf(PUB), f);
  const edited = four.slice(0, 3);
  edited[0] = { ...edited[0], label: 'Green places', words: ['Nature', 'Others'] };
  edited.push({ label: 'Music', icon: 'music', words: ['Culture'] });
  const saved = await B(edited);
  f = fileOf(PUB);
  check('a good edit is saved: renamed, re-ticked, one removed, one added with a new id, colours by place in the row',
    [saved.status, f.mode.buttons.map((b) => [b.id, b.label, b.icon, b.color, b.words])],
    [200, [['nature', 'Green places', 'leaf', XM.PALETTE[0], ['Nature', 'Others']], ['art', 'Art & history', 'landmark', XM.PALETTE[1], ['Culture', 'Heritage']],
      ['do', 'Things to do', 'ticket', XM.PALETTE[2], ['Activities', 'Social', 'Food and Drink', 'Market']], ['b1', 'Music', 'music', XM.PALETTE[3], ['Culture']],
      // the places under none of the four go under "Odds & ends", added by itself (smart buttons, 24 Oct 2026)
      ['odds', 'Odds & ends', 'dots', XM.PALETTE[4], []]]]);
  check('the rest of the mode is as it was', [f.mode.layer, f.mode.tagColumn, f.mode.frameShare], [was.mode.layer, was.mode.tagColumn, was.mode.frameShare]);
  check('the answer carries the saved buttons', saved.j.mode.buttons, f.mode.buttons);
  check('no buttons at all is allowed', [(await B([])).status, fileOf(PUB).mode.buttons], [200, []]);
  await B(four);

  console.log('\n  the private atlas: a first Explore, then Event once it is set up');
  const pv = fileOf(PRIV);
  const first = await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'explore' } });
  let p = fileOf(PRIV);
  // and "Odds & ends" for the places under none of the four (smart buttons, 24 Oct 2026)
  const want = XM.withRest(XM.defaultButtons(blr.features, { tagColumn: 'categories' }), blr.features, { tagColumn: 'categories' });
  check('Explore with nothing kept: the places\' own layer, and a button for each of the four most-used categories',
    [first.status, p.mode.name, p.mode.layer, p.mode.tagColumn, p.mode.frameShare, p.mode.buttons], [200, 'explore', 'bengaluru-tags', 'categories', 0.8, want]);
  check('…four of them, b1..b4, leaf · landmark · ticket · users', p.mode.buttons.map((b) => b.id + ' ' + b.icon), ['b1 leaf', 'b2 landmark', 'b3 ticket', 'b4 users', 'odds dots']);
  check('written where a private atlas lives, never in the public folder', fs.existsSync(path.join(ROOT, 'atlas', 'datasets', PRIVSLUG)), false);
  const firstMode = p.mode;
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'standard' } });
  p = fileOf(PRIV);
  check('to Standard: Explore kept', [p.mode, p.modeKept.explore], [undefined, firstMode]);
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'explore' } });
  check('and back: the same buttons', fileOf(PRIV).mode, firstMode);
  // the team sets an event guide up (deploy/apply-event-mode.mjs); here it is simply kept
  const evKept = { name: 'event', layer: 'bengaluru-tags', days: ['2026-10-29'] };
  p = fileOf(PRIV); p.modeKept = { event: evKept };
  fs.writeFileSync(path.join(PRIV, 'manifest.local.json'), JSON.stringify(p));
  check('once set up, the server says Event can be chosen', (await call('GET', M(PRIVSLUG), { cookie: ownerC })).j.canEvent, true);
  const toEv = await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'event' } });
  p = fileOf(PRIV);
  check('to Event: its settings in use, Explore\'s kept', [toEv.status, p.mode, p.modeKept], [200, evKept, { explore: firstMode }]);
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'standard' } });
  p = fileOf(PRIV);
  check('to Standard from Event: both kept', p.modeKept, { explore: firstMode, event: evKept });
  check('the private atlas\'s layers were never touched', p.layers, pv.layers);
  p = fileOf(PRIV); p.mode = { buttons: ['no name'] };
  fs.writeFileSync(path.join(PRIV, 'manifest.local.json'), JSON.stringify(p));
  await call('POST', M(PRIVSLUG), { cookie: ownerC, body: { name: 'explore' } });
  p = fileOf(PRIV);
  check('a mode in use with no proper name is kept under _unnamed, never dropped', [p.mode.name, p.modeKept._unnamed], ['explore', { buttons: ['no name'] }]);
  check('the file is written whole (no .tmp left behind)', fs.readdirSync(PRIV).filter((x) => x.endsWith('.tmp')), []);
} catch (e) {
  fail++;
  console.log('  FAIL the route checks stopped: ' + (e && e.message));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
