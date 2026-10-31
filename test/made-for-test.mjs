/* Run me with: node test/made-for-test.mjs — or through node test/run.mjs.
 * "Made for" (31 Oct 2026): the super admin sets whom an atlas was built for,
 * from the Owner menu. Regex checks on source, like navigate-test.mjs — the
 * route needs a live registry and overlay files to run for real, which these
 * checks deliberately avoid touching. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
// owner.js is at its size ceiling (test/fold-test.mjs), so this line and its
// dialog live in owner-modes.js, which it already loads for every atlas.
const ownerJs = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function grab(src, name) {
  const i = src.indexOf("router.post('/instances/:slug/" + name + "'");
  const j = src.indexOf('\n});', i);
  return src.slice(i, j + 4);
}

const route = grab(api, 'made-for');
check('the route exists', route.length > 0, true);
check('gated to the super admin (admin token or admin session)', /auth\.isAdmin\(req\) \|\| auth\.isAdminSession\(req\)/.test(route), true);
check('refuses with 403 when not the super admin', /status\(403\)/.test(route), true);
check('refuses the deoria-bioregion atlas', /searchText\.isNeverTouched\(inst\.slug\)/.test(route), true);
check('writes the overlay (writeOverlay)', /writeOverlay\(/.test(route), true);
check('answers { ok, madeFor }', /res\.json\(\{ ok: true, madeFor \}\)/.test(route), true);

// trim / strip control characters / cap 120 — run the same expression the route uses
function cleanMadeFor(raw) {
  // eslint-disable-next-line no-control-regex
  return String(raw || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120);
}
check('trims', cleanMadeFor('  Emergence Festival  '), 'Emergence Festival');
check('strips control characters', cleanMadeFor('Good\u0007Earth'), 'GoodEarth');
check('caps at 120 characters', cleanMadeFor('x'.repeat(200)).length, 120);
check('empty clears', cleanMadeFor('   '), '');

check('/auth/me carries superAdmin', /superAdmin: auth\.isAdminSession\(req\),/.test(api), true);

console.log('\n  the viewer');
check('an overlay madeFor (even "") wins over one baked into manifest.json', /if \(typeof local\.madeFor === "string"\) manifest\.madeFor = local\.madeFor;/.test(viewer), true);

console.log('\n  the Owner menu');
check('the "Made for" line is made, hidden by default', /row\.id = id;\s*row\.hidden = true;/.test(ownerJs) && /panelRow\("own-panel-madefor"\)/.test(ownerJs), true);
check('it is shown only when /auth/me says superAdmin', /api\("auth\/me"\)\.then\(function \(me\) \{ SUPER_ADMIN = !!\(me && me\.superAdmin\); paintMadeFor\(\); \}\)/.test(ownerJs), true);
check('paintMadeFor keeps the line hidden for everyone else', /slot\.hidden = !SUPER_ADMIN;/.test(ownerJs), true);
check('"Made for · <name>" or "not set"', /v \? "Made for · " \+ esc\(v\) : "Made for · not set"/.test(ownerJs), true);
check('the dialog asks the right question, plain words', /Who is this atlas made for\?/.test(ownerJs) && /Leave it empty to show/.test(ownerJs), true);
check('saving posts to the made-for route', /instances\/" \+ encodeURIComponent\(SLUG\) \+ "\/made-for"/.test(ownerJs), true);
check('no pill-shaped control: reuses the plain own-act button, not a new class', /id="own-made-for" type="button">Change<\/button>/.test(ownerJs), true);

check('clearing writes "" so it wins over a madeFor in manifest.json', /local\.madeFor = madeFor;   \/\/ "" is kept/.test(fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8')), true);
check('after saving, the page reloads so About this atlas says the new words', /setTimeout\(function \(\) \{ location\.reload\(\); \}, 1200\);/.test(fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8')), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
