/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A worldwide atlas's own file: checked before the build, placed, and counted
   truthfully afterwards. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the rows of a worldwide atlas are checked before the build, like any other');
/* The wizard sent the country still showing in its dropdown with no places
   under it, and the server refused the check for want of places — so the file
   was never added, and an atlas built from a spreadsheet had no data on it. */
check('the wizard sends no country and no places for a worldwide atlas',
  /region: S\.worldwide \? \{ worldwide: true \} : \{\n\s*iso3: S\.iso3, level: S\.level,/.test(setup), true);
check('and keys the check on the world, not on a list of places',
  /var key = S\.worldwide \? "world" : S\.iso3/.test(setup), true);
check('the server takes a pending region that is the world',
  /const worldwidePending = !dataset && !!\(b\.region && b\.region\.worldwide\);/.test(server), true);
check('with the world as its bounds', /bbox: worldwidePending \? WORLD_BBOX\.slice\(\)/.test(server), true);
check('and does not demand a country or places of it',
  /if \(!pendingRegion\.worldwide && \(!\/\^\[A-Z\]\{3\}\$\/\.test\(pendingRegion\.iso3\) \|\| !pendingRegion\.shapeIDs\.length\)\)/.test(server), true);
check('nor counts its (zero) places against the unit limit',
  /const tooManyHere = pendingRegion\.worldwide \? '' : tooManyUnits\(pendingRegion\.shapeIDs\);/.test(server), true);
/* res does not exist inside ingestLayerSteps; a region over the limit used
   to crash the check instead of refusing it */
check('and a region over the limit is refused, not crashed into',
  /if \(tooManyHere\) throw refuse\(400, tooManyHere, \{ tooManyUnits: pendingRegion\.shapeIDs\.length \}\);/.test(server), true);
check('the world stops short of the poles, as the builder does', /const WORLD_BBOX = \[-180, -85, 180, 85\];/.test(server), true);

console.log('\n  names with no outlines to match are rows without a place, not a refusal');
/* "no joinable boundary layer" was thrown for a file of place names on an
   atlas with no outlines. Every row now waits for a place instead, which is
   the state the OpenStreetMap lookup and the finished atlas already handle. */
check('placement has a branch for no outlines at all',
  /\} else if \(!boundaryTargets\(session, session\.joinLayer\)\) \{/.test(server), true);
check('every row is listed as needing a place, and the report says why',
  /report\.noOutlines = true;\n\s*rows\.forEach\(\(r, i\) => \{\n[\s\S]{0,300}?reason: 'no outlines'/.test(server), true);
check('and the name column is still found when no outlines could score it',
  /if \(!nameGuess && !allOptions\.length\) \{\n\s*const nameish = profiles\.find/.test(server), true);
check('the lookup by name is not boxed to any patch of the world',
  /if \(r\.worldwide\) return \{\};/.test(server) && /if \(mf && mf\.region && mf\.region\.worldwide\) return \{\};/.test(server), true);
check('the wizard explains the lookup in the world\'s terms, not a village\'s',
  /rep\.noOutlines\n\s*\? "This atlas covers the whole world, so it has no outlines of its own to match a name against\. "/.test(setup), true);
check('a country column goes with the name to the lookup',
  /\/district\|zila\|jila\|tehsil\|taluk\|block\|state\|country\/i/.test(setup), true);

console.log('\n  and the screen says how many rows are on the map, in the same words');
check('the headline is the check\'s number once it has one',
  /if \(GEO\.canonical && FOUND\.settled\) \{\n[\s\S]{0,400}?num\.textContent = placed\.toLocaleString\(\) \+ " of " \+ rows\.toLocaleString\(\);\n\s*what\.textContent = "rows are on the map";/.test(setup), true);
check('with the rest said the way the regional path says it',
  /say\.textContent = world \+ \(FOUND\.rep \? " " \+ checkSays\(FOUND\.rep\) : ""\);/.test(setup), true);
check('and "Worldwide" until then', /num\.textContent = "Worldwide";/.test(setup), true);
check('the check is not said to be against places there are none of',
  /S\.worldwide \? "Checking " \+ GEO\.file\.name \+ "…"/.test(setup), true);

console.log('\n  the first look counts the layers the atlas was built with');
/* The wizard's ticks were the count, and a tick is not a layer: boundaries
   are ticked and then dropped on a worldwide atlas, which said "2 open data
   layers" of an atlas with one; one tick can build two layers; and every
   plain atlas of boundaries and place names said "with 2 open data layers". */
check('the count is read off the manifest', /window\.LokaAtlas\.manifest\.layers\) \|\| \[\]\)\n\s*\.filter\(function \(L\) \{ return L && !L\.userLayer; \}\);/.test(owner), true);
check('boundaries and place names are named, not counted',
  /return L\.id !== "admin" && L\.id !== "labels"; \}\)\.length;/.test(owner), true);
check('an atlas with no boundaries does not claim them',
  /hasAdmin && hasLabels \? "Boundaries and place names" : hasAdmin \? "Boundaries" : hasLabels \? "Place names" : "A base map"/.test(owner), true);
check('and the world is said as the world', /worldwide \? " for the whole world" : where \? " for " \+ where : ""/.test(owner), true);
check('the wizard no longer sends a count of ticks', /layers: Object\.keys\(S\.picked\)/.test(setup), false);
check('and the card no longer reads one', /look\.layers/.test(owner), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
