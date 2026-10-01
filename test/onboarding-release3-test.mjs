/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it.
 *
 * Onboarding, release 3: same-name places settled by their neighbours, the
 * question screen for the rest, and a list of rows to fix that outlives the
 * build. The rule itself runs here on made-up squares, so every case is one
 * somebody can draw on paper. No network, no disk beyond the source. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { joinByName, settleByNeighbours, homeArea, kmBetween, fallbackRequest, HOME_PAD_DEG, HOME_MIN_ROWS } from '../api/lib/matching.js';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('  FAIL ' + name + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

// a small square around a point, the way a boundary arrives
const sq = (x, y, r = 0.05) => ({ type: 'Polygon', coordinates: [[[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]]] });
let n = 0;
const T = (name, x, y, parent = '') => ({ code: String(n++), name, parent, geometry: sq(x, y) });

// four places that are only one place each, around 83.5E 26.5N
const home = [T('Bhatni', 83.4, 26.4, 'Deoria'), T('Salempur', 83.9, 26.3, 'Deoria'),
  T('Barhaj', 83.7, 26.3, 'Deoria'), T('Lar', 83.95, 26.2, 'Deoria')];
const rampurIn = T('Rampur', 83.6, 26.45, 'Deoria');       // inside the home area
const rampurFar = T('Rampur', 79.0, 28.8, 'Rampur');       // about 500 km away
const ramnagarNear = T('Ramnagar', 84.9, 27.2, 'Bettiah'); // outside, nearer
const ramnagarFar = T('Ramnagar', 78.1, 29.4, 'Nainital'); // outside, further
const sadarA = T('Sadar', 83.5, 26.35, 'Deoria');          // two inside: a real question
const sadarB = T('Sadar', 84.05, 26.55, 'Kushinagar');
const targets = [...home, rampurIn, rampurFar, ramnagarNear, ramnagarFar, sadarA, sadarB];
const rows = ['Bhatni', 'Salempur', 'Barhaj', 'Lar', 'Rampur', 'Ramnagar', 'Sadar', 'Rampur'].map((p) => ({ place: p }));

console.log('  the home area');
const h = homeArea([[83.4, 26.4], [83.9, 26.3], [83.7, 26.3]]);
check('is the box around the confident rows, padded by a quarter degree', h.box.map((v) => +v.toFixed(2)), [83.15, 26.05, 84.15, 26.65]);
check('the padding is about 25 km', Math.round(kmBetween([83.5, 26.5], [83.5, 26.5 + HOME_PAD_DEG])), 28);
check('needs three confident rows', [homeArea([[1, 1], [2, 2]]), HOME_MIN_ROWS], [null, 3]);

console.log('\n  two Rampurs, one inside the area the other rows cover');
const out = joinByName(rows, 'place', null, targets);
const at = (i) => out[i];
check('the four one-place names are placed as before', out.slice(0, 4).map((r) => r.match), home.map((t) => t.code));
check('the Rampur inside the home area is picked', at(4).match, rampurIn.code);
check('and marked as put by its neighbours', at(4).byNeighbours, true);
check('every row with that name gets the same answer', [at(7).match, at(7).byNeighbours], [rampurIn.code, true]);
check('the other Rampur rides along, so changing it is one tap', at(4).candidates.map((c) => c.code), [rampurIn.code, rampurFar.code]);
check('with its distance from the other places', at(4).candidates[1].km > 400 && at(4).candidates[1].km < 700, true);

console.log('\n  two Ramnagars, both outside it');
check('is asked, not guessed', [at(5).match, !!at(5).byNeighbours], [null, false]);
check('the nearer one is offered first', at(5).candidates.map((c) => c.code), [ramnagarNear.code, ramnagarFar.code]);
check('each with its distance in km', at(5).candidates.every((c) => Number.isInteger(c.km)), true);
check('and neither claims to be inside', at(5).candidates.map((c) => c.inside), [false, false]);
check('it is marked as a same-name question', at(5).sameName, true);

console.log('\n  two Sadars, both inside it');
check('is asked too: the neighbours cannot tell them apart', at(6).match, null);
check('both are inside', at(6).candidates.map((c) => c.inside), [true, true]);
check('the one nearer the middle is first', at(6).candidates[0].code, sadarA.code);

console.log('\n  too few confident rows to stand on');
const few = joinByName([{ p: 'Bhatni' }, { p: 'Salempur' }, { p: 'Rampur' }, { p: 'Ramnagar' }], 'p', null, targets);
check('nothing is put by its neighbours', few.filter((r) => r.byNeighbours).length, 0);
check('but the places are still ordered, tightest packing first', few[2].candidates.length, 2);
check('and no distance is claimed without a home area', few[2].candidates.map((c) => c.km), [null, null]);

console.log('\n  the parent column still comes first');
const scoped = joinByName([{ p: 'Rampur', d: 'Rampur' }], 'p', 'd', targets);
check('a district column settles a shared name on its own', [scoped[0].match, !!scoped[0].byNeighbours], [rampurFar.code, false]);

console.log('\n  the model sees only what is still open');
const report = { ambiguous: out.filter((r) => r.match == null && r.candidates.length).map((r) => ({ row: r.row, name: r.name, candidates: r.candidates })), unmatched: [] };
check('Rampur, settled, is not sent', fallbackRequest(report).map((q) => q.sourceName).sort(), ['Ramnagar', 'Sadar']);

console.log('\n  names that say they are no name');
const noName = joinByName([{ p: 'Not under any CD block' }], 'p', null, [T('Not under any CD block', 80, 20), T('Not under any CD block', 81, 21)]);
check('are never a candidate', [noName[0].match, noName[0].candidates.length], [null, 0]);

console.log('\n  settleByNeighbours on its own');
const bare = [{ row: 0, match: '0' }, { row: 1, match: '1' }, { row: 2, match: '2' }, { row: 3, match: null, candidates: [], same: [rampurIn, rampurFar] }];
const sum = settleByNeighbours(bare, targets);
check('says how many it settled and how many it left', [sum.settled, sum.asked], [1, 0]);
check('and never leaves the full place list on a result', bare.every((r) => !('same' in r)), true);

/* The server side, read from the source: the join's report says which rows
   were put by their neighbours, the skipped ones are still listed, fixes stay
   pointed at the layer they were made on, and a row list outlives the build. */
console.log('\n  the server');
const server = fs.readFileSync(path.join(ROOT, 'api/apps/atlas.js'), 'utf8');
const imports = fs.readFileSync(path.join(ROOT, 'api/lib/atlas/imports.js'), 'utf8');
check('put-by-neighbours rows are reported', /report\.byNeighbours = report\.byNeighbours \|\| \[\]\)\.push/.test(server), true);
check('skipped rows are reported, not dropped', /report\.skipped = report\.skipped \|\| \[\]\)\.push/.test(server), true);
check('the finer levels are rungs after the atlas\'s own', /const geoIds = Object\.keys\(imports\.readGeoTargets\(session\.id\) \|\| \{\}\)/.test(server), true);
check('a lead chosen before the build is kept', /if \(!session\.dataset\) session\.leadLayer = lead\.opt\.id;/.test(server), true);
check('an import with rows to fix is kept after commit', /imports\.keepForRepair\(/.test(server), true);
check('kept for thirty days at most', /REPAIR_TTL_MS = 30 \* 24 \* 3600 \* 1000/.test(imports), true);
check('and swept when its layer is gone', /layerGone/.test(imports), true);
check('the address lookup can add a context column', /const context = \(Array\.isArray\(b\.context\)/.test(server), true);

check('a sheet whose best-matching column is the same on every row places by the other one', /parentGuess = nameGuess\.column;/.test(server), true);
check('a layer with nothing on it is not added', /none of the rows found a place on the map, so nothing was added/.test(server), true);
check('before a build, the region\'s own level is checked against too', /concat\(before \? \[baseLevel\] : \[\]\)/.test(server), true);

console.log('\n  the pages');
const setup = fs.readFileSync(path.join(ROOT, 'atlas/setup/setup.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'atlas/setup/index.html'), 'utf8');
const owner = fs.readFileSync(path.join(ROOT, 'atlas/owner.js'), 'utf8');
check('the question screen is on the page', /<section class="panel" id="s2q" hidden>/.test(page), true);
check('it comes after what we found, only when needed', /if \(Q\.list\.length\) showQuestion\(\);\s*else if \(Q\.guesses\.length\) showGuesses\(\);\s*else step\(3\);/.test(setup), true);
check('"same for all rows" starts ticked', /id="q-all" checked/.test(page), true);
check('skip for now is there', />Skip for now</.test(page), true);
check('the model\'s guesses are listed to check', /We guessed these spellings — check them/.test(setup), true);
// the offer used to say "Put every row on as a point"; since October 2026 the
// points go on beside the outlines, and only the rows no outline holds are looked up
check('villages can go on as points', /id="pts-go">Look them up</.test(setup), true);
check('with the district sent alongside the name', /context: pc\.context/.test(setup), true);
check('the bench\'s own fix list stands aside on this page', /#bench #card-fixes \{ display:none; \}/.test(page), true);
check('the first look links to the rows that need a place', /\.\/setup\/\?fix=/.test(owner), true);
check('and the page that fixes them reads the server\'s list', /api\("layers\/repair\?dataset="/.test(setup), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
