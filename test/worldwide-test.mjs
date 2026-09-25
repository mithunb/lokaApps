/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An atlas with no region, and a build that says what it is doing. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const build = fs.readFileSync(ROOT + '/api/atlas-builders/build_dataset.py', 'utf8');
const common = fs.readFileSync(ROOT + '/api/atlas-builders/common.py', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  a build waiting for a person is not a build that finished');
/* One unchecked field produced three wrong things: "Your atlas is ready", a
   file that "couldn't be added automatically", and a viewer saying there is no
   atlas at that address. */
check('the status is read, not just the job id', /if \(r\.status === "pending-approval"\) \{ waitForApproval\(\); return; \}/.test(setup), true);
check('and it comes before the old shortcut',
  setup.indexOf('r.status === "pending-approval"') < setup.indexOf('if (!r.jobId) { finish(); return; }'), true);
check('the screen says what is true', /Waiting to be approved/.test(setup), true);
check('and who is waiting on whom', /They have been emailed, and you will be too once it is built/.test(setup), true);
check('it does not navigate to an atlas that is not there',
  /waitForApproval\(\)[\s\S]{0,1200}?location\.href/.test(setup), false);

console.log('\n  and it keeps watching, because the file is held by this page');
check('it polls the atlas, there being no job to poll', /api\("instances\/" \+ encodeURIComponent\(S\.slug\)\)/.test(setup), true);
check('a job id appearing means approved', /if \(inst && inst\.jobId\) \{/.test(setup), true);
check('and from there it is an ordinary build', /S\.jobId = inst\.jobId;[\s\S]{0,200}?poll\(\);/.test(setup), true);
check('a failure after approval is not silence', /Something failed after approval/.test(setup), true);
check('the person is told the file depends on the page staying open',
  /Keep this page open and your file goes on as soon as it is approved/.test(setup), true);

console.log('\n  the rebuild path had the same fault');
check('it checks before promising', /if \(r && r\.pendingApproval\) \{/.test(owner), true);
check('and says what it actually did', /Sent for approval — a region this size is checked first/.test(owner), true);
check('it also names layers the width lost', /Rebuilding without " \+ lost\.join\(", "\)/.test(owner), true);

console.log('\n  an atlas can have no region at all');
/* "Which country is this atlas in" has no answer for a record of sightings
   across four of them. */
check('the server takes it', /const worldwide = !!r\.worldwide;/.test(server), true);
check('and stops demanding a country and units', /if \(!worldwide && \(!\/\^\[A-Z\]\{3\}\$\/\.test\(iso3\) \|\| !shapeIDs\.length\)\)/.test(server), true);
check('the bounds are the world', /if \(worldwide\) \{ w = -180; s = -85; e = 180; n = 85; \}/.test(server), true);
check('it is called something a person would recognise', /worldwide \? 'Worldwide'/.test(server), true);
/* boundaries are compulsory so an atlas SHOWS its region; with no region there
   is nothing to outline and forcing it would ask the builder for a selection
   that does not exist */
check('boundaries are not forced on when there is no region',
  /if \(!worldwide\) \{\n\s*for \(const l of allowed\.values\(\)\) if \(l\.required/.test(server), true);
check('and no layers at all is allowed', /if \(!layerIds\.length && !worldwide\)/.test(server), true);
check('the spec carries it to the builder', /shapeNames, bbox: \[w, s, e, n\], worldwide,/.test(server), true);
check('and there is no boundary file to name', /simplifiedFile: worldwide \? null :/.test(server), true);

console.log('\n  and the builder knows what to do with it');
check('the selection is the world', /if r\.get\("worldwide"\):\n\s*return box\(\*WORLD_BBOX\), list\(WORLD_BBOX\), \[\]/.test(common), true);
check('stopping short of the poles, where Mercator runs to infinity',
  /WORLD_BBOX = \[-180\.0, -85\.0, 180\.0, 85\.0\]/.test(common), true);
check('no layers is only a failure when a region was asked for',
  /if not layers and not spec\["region"\]\.get\("worldwide"\):/.test(build), true);
/* 8% of 360 degrees put the eastern edge at 208, which is not a place */
check('the world is not padded past its own edges',
  /final_bounds = \[max\(-180\.0, final_bounds\[0\]\), max\(-85\.0, final_bounds\[1\]\),/.test(build), true);
check('and it opens zoomed out, not into the Atlantic', /floor = 1\.0 if span > 180 else 5\.5/.test(build), true);
check('the manifest says so', /"worldwide": True\} if spec\["region"\]\.get\("worldwide"\)/.test(build), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
