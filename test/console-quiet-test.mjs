/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Two things the console said on every visit to the reference atlas. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  "you may not edit this" is not "there is no such thing"');
/* The reference atlas was built before the registry existed, so it has no
   entry, so asking whether the viewer may edit it answered 404 — a failed
   request logged on every single visit, which JavaScript cannot suppress. */
check('a dataset on disk with no registry entry answers plainly',
  /return res\.json\(\{ slug, canEdit: false, registered: false \}\);/.test(server), true);
check('and it must really be on disk to say so',
  /fs\.existsSync\(path\.join\(DATASETS_ROOT, slug, 'manifest\.json'\)\)/.test(server), true);
check('under a plain slug that cannot walk out of the folder',
  /const plain = \/\^\[a-z0-9\]\[a-z0-9-\]\{1,38\}\[a-z0-9\]\$\/\.test\(slug\);/.test(server), true);
/* validSlug answers "may somebody CLAIM this address". The reference atlas's
   address is reserved because it is already taken, so asking that question
   turned away the very dataset this was written for — measured live. */
check('and not by asking whether the address is free', /reg\.validSlug\(slug\) &&/.test(server), false);
/* PRIVATE_ROOT is deliberately not consulted: whether a private atlas exists
   is exactly what the remaining 404 is there to withhold. */
check('the private folder is not consulted here',
  /if \(!inst\) \{[\s\S]{0,400}?PRIVATE_ROOT/.test(server), false);
check('an unknown slug is still not found',
  /return res\.status\(404\)\.json\(\{ error: 'not found' \}\);\n  \}/.test(server), true);
/* within THIS route only: one 404 for an unknown slug, one for an atlas that
   exists and is nobody's business to know about */
const route = server.slice(server.indexOf("router.get('/instances/:slug'"),
  server.indexOf("router.", server.indexOf("router.get('/instances/:slug'") + 10));
check('and an atlas that exists but is nobody’s business still is not found',
  (route.match(/res\.status\(404\)\.json\(\{ error: 'not found' \}\);/g) || []).length, 2);

console.log('\n  an image the base map’s own sprite does not have');
/* ["concat", "road_", ["get", "ref_length"]] on a road with no number. */
check('a blank is supplied rather than a warning per feature',
  /map\.addImage\(id, \{ width: 1, height: 1, data: new Uint8Array\(4\) \}\);/.test(viewer), true);
check('on the event maplibre offers for it', /map\.on\("styleimagemissing", function \(e\) \{/.test(viewer), true);
check('never twice for one name', /if \(!id \|\| map\.hasImage\(id\)\) return;/.test(viewer), true);
/* Silencing the whole class would hide a missing image that IS ours, so each
   distinct name is still said once. */
check('each name is still said, once', /if \(blanked\[id\]\) return;\s*\n\s*blanked\[id\] = true;/.test(viewer), true);
check('and it says whose fault it is not', /that its sprite does not have/.test(viewer), true);
check('the map’s own errors are untouched',
  /map\.on\("error", function \(e\) \{ console\.error\("Atlas map error:"/.test(viewer), true);

console.log('\n  and "nobody is signed in" is an answer, not a failure');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const admin = fs.readFileSync(ROOT + '/atlas/admin/index.html', 'utf8');
/* Most visitors are signed out, so this fired on almost every page load. */
check('the route says so plainly', /if \(!session\) return res\.json\(\{ signedIn: false \}\);/.test(server), true);
/* Scoped to this route: POST /auth/profile still refuses with 401, and should
   — a refusal is not the same as an answer to "who is looking". */
const meRoute = server.slice(server.indexOf("router.get('/auth/me'"),
  server.indexOf('router.', server.indexOf("router.get('/auth/me'") + 10));
check('and this route no longer refuses',
  /res\.status\(401\)/.test(meRoute), false);
check('but a route that really needs a session still does',
  /router\.post\('\/auth\/profile'[\s\S]{0,200}?res\.status\(401\)\.json\(\{ error: 'not signed in' \}\)/.test(server), true);
check('a signed-in answer says which it is', /res\.json\(\{\n    signedIn: true,\n    email: session\.email,/.test(server), true);

/* THE RISK IN THIS CHANGE: two callers drove their signed-out screen from the
   rejection. A 200 would have run their signed-in branch on an empty answer. */
check('the wizard turns the new answer back into its gate',
  /api\("auth\/me"\)\.then\(function \(me\) \{[\s\S]{0,240}?if \(!me \|\| !me\.email\) throw new Error\("not signed in"\);/.test(setup), true);
check('and so does the data bench',
  /api\("auth\/me"\)\.then\(function \(me\) \{[\s\S]{0,260}?if \(!me \|\| !me\.email\) throw new Error\("not signed in"\);/.test(bench), true);
check('the viewer already read the answer rather than the status',
  /if \(!me \|\| !me\.email\) return; \/\/ stays: "sign in" link/.test(viewer), true);
check('and the admin page already caught it',
  /api\("auth\/me"\)\.catch\(function \(\) \{ return null; \}\)/.test(admin), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
