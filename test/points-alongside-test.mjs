/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it.
 *
 * Village points go on ALONGSIDE the outlines, not instead of them (Mithun,
 * October 2026). A sheet naming blocks and villages: the blocks join to
 * outlines, the villages are looked up by name and the ticked ones go on as
 * points, in a second layer from the same file. Release 3 turned the whole
 * layer into points, so a block row that was not also ticked came off the
 * map. The rule runs here on a made-up report; the rest is read from the
 * source. No network, no disk beyond the source. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitPointRows } from '../api/lib/matching.js';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('  FAIL ' + name + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

/* Six rows: 0–2 are blocks the outlines placed, 3–5 are villages they did
   not. 3 and 4 were found and ticked; 5 was found and left unticked. Row 1,
   a block, was ticked too (the lookup can find a block as well). */
const report = {
  strategy: 'adminJoin', matched: 3, total: 6,
  unmatched: [{ row: 3, name: 'Rampur' }, { row: 4, name: 'Bhatpar' }, { row: 5, name: 'Pakdi' }],
  ambiguous: [], skipped: [],
};
const ticked = { 1: { lat: 26.4, lng: 83.6 }, 3: { lat: 26.5, lng: 83.7 }, 4: { lat: 26.6, lng: 83.8 } };
const out = splitPointRows(report, ticked);

console.log('\n  outline matches survive choosing points');
check('only the rows no outline placed become points', out.rows, [3, 4]);
check('a ticked block keeps its outline, not a second place', out.rows.includes(1), false);
check('every row the outlines placed is still counted as placed', out.report.matched, 5);
check('the points are counted on their own', out.report.points, 2);
check('the unticked village still needs a place', out.report.unmatched.map((e) => e.row), [5]);
check('the report it was given is left as it was', report.unmatched.length, 3);

console.log('\n  the edges');
check('no points chosen: the report is the outlines\' own',
  splitPointRows(report, {}).report.unmatched.length, 3);
check('a find without coordinates is not a point',
  splitPointRows(report, { 3: { lat: null, lng: null } }).rows, []);
const skippedOne = { matched: 0, unmatched: [], ambiguous: [], skipped: [{ row: 2, name: 'x' }] };
check('a row the fix page skipped and gave a point is a point',
  splitPointRows(skippedOne, { 2: { lat: 1, lng: 2 } }).rows, [2]);
check('and it leaves the skipped list',
  splitPointRows(skippedOne, { 2: { lat: 1, lng: 2 } }).report.skipped, []);

console.log('\n  the server');
const server = fs.readFileSync(path.join(ROOT, 'api/apps/atlas.js'), 'utf8');
const imports = fs.readFileSync(path.join(ROOT, 'api/lib/atlas/imports.js'), 'utf8');
check('choosing points beside the outlines keeps the layer a join to outlines',
  /if \(b\.alongside\) \{[\s\S]{0,500}session\.pointRows = \{\};/.test(server), true);
check('and returns before the whole layer could be turned into points',
  server.indexOf('if (b.alongside)') > 0 &&
  server.indexOf('if (b.alongside)') < server.indexOf("session.strategy = 'coordinates';"), true);
check('the points are a second layer, named after the first', /' · as points'/.test(server), true);
check('commit writes the outlines and the points both',
  /commitPart\(session, parts\.outline\.frag, outFeats\)[\s\S]{0,600}commitPart\(parts\.pointsSession, parts\.points\.frag, ptFeats\)/.test(server), true);
check('the points are pins, which the search box can find, not sized circles',
  /kind: \(session\.spec && session\.spec\.kind === 'category' && session\.spec\.categoryColumn\) \? 'category' : 'markers'/.test(server), true);
check('the two layers are marked as one file, and a layer put back alone keeps its twin',
  /imports\.pairLayers\(session\.dataset, layerId, pointsLayerId \|\| twinBefore\)/.test(server), true);
check('OpenStreetMap is credited under the same name the outlines use, so it shows once',
  /OSM_POINTS_CREDIT = \{ name: '© OpenStreetMap contributors'/.test(server), true);
check('the wizard\'s numbers, the commit and the fix list read the same split',
  (server.match(/placeAll\(/g) || []).length >= 5, true);
check('the fix page can give a row a point', /if \(f\.point\) \{/.test(server), true);
check('and look a row up on the map', /router\.post\('\/layers\/repair\/locate'/.test(server), true);
check('giving a point row an outline takes it off the points layer',
  /if \(!f\.point && session\.pointRows\) delete session\.pointRows\[f\.row\];/.test(server), true);
check('removing one of the pair takes both', /layer\.sameFileAs && \(\(m\.local\.layers/.test(server), true);
check('the kept rows are let go only when both layers are gone',
  /const ids = \(s\.repair\.layerIds && s\.repair\.layerIds\.length\)/.test(imports), true);
check('the lookup can be asked about some rows only', /const only = Array\.isArray\(b\.rows\)/.test(server), true);

console.log('\n  the pages');
const setup = fs.readFileSync(path.join(ROOT, 'atlas/setup/setup.js'), 'utf8');
const owner = fs.readFileSync(path.join(ROOT, 'atlas/owner.js'), 'utf8');
check('the setup page keeps the outlines when points are chosen', /alongside: true/.test(setup), true);
check('and looks up only the rows no outline holds', /rows: only \}/.test(setup), true);
check('the fix page offers a point beside the outline choices', /value="__point"/.test(setup), true);
check('removing one of the pair says the other goes too', /came from the same file and comes off with it/.test(owner), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
