/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The list of named places, and the script that writes it.
 *
 * The first version of this list was made by a script nobody kept. Two things
 * went wrong because of that. 123 of the 125 mountain ranges never got in, so
 * they shipped in the data file and could never be found — a row saying
 * "Aravalli Range" got nothing while the outline sat right there. And there was
 * no way to add a place, or a source, without writing the whole list again.
 *
 * These checks read the list on disk against the files it is made from, so the
 * same loss cannot happen quietly a second time.
 *
 * No network. Reads only the product's own files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = ROOT + '/api/atlas-builders/places';

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const index = read(P + '/index.json');
const ranges = read(P + '/ranges-IND.geojson');
const reserves = read(P + '/reserves-IND.geojson');
const extra = read(P + '/places-extra.json');
const aliasesExtra = read(P + '/aliases-extra.json');

const canon = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const listed = new Set(index.places.map((p) => canon(p.name)));
const byName = new Map(index.places.map((p) => [canon(p.name), p]));

/* Names that belong to a state or union territory first and a landform
   second. The list is searched ahead of the administrative boundaries, so
   letting these in would hand a state's rows to a mountain polygon. */
const POLITICAL = ['Meghalaya', 'Andaman and Nicobar Islands'];

console.log('\n  every mountain range that ships is findable');
const rangeNames = ranges.features.map((f) => f.properties.name);
const missingRanges = rangeNames
  .filter((n) => !POLITICAL.some((q) => canon(q) === canon(n)))
  .filter((n) => !listed.has(canon(n)));
check('none of them are left out', missingRanges, []);
check('and there are as many as the file holds',
  index.places.filter((p) => p.kind === 'mountain range').length,
  rangeNames.length - POLITICAL.length);

console.log('\n  a state’s name is not handed to a landform');
POLITICAL.forEach((n) =>
  check('“' + n + '” is left out of the list', listed.has(canon(n)), false));

/* Every name the list answers to — its own, and the other names it goes by.
   A place whose name is shared is listed under "Name (State)", and the bare
   name survives as one of its other names, so a row that uses the bare name
   finds both and is asked which. */
const answersTo = new Set();
index.places.forEach((p) => {
  answersTo.add(canon(p.name));
  (p.aliases || []).forEach((a) => answersTo.add(canon(a)));
});

console.log('\n  every reserve that ships is findable');
const reserveNames = [...new Set(reserves.features.map((f) => canon(f.properties.name)))];
check('none of them are left out',
  reserveNames.filter((n) => !answersTo.has(n)), []);

console.log('\n  two places of the same name are both kept, and told apart');
const shared = {};
reserves.features.forEach((f) => {
  const k = canon(f.properties.name);
  shared[k] = (shared[k] || 0) + 1;
});
Object.entries(shared).filter(([, n]) => n > 1).forEach(([k, n]) => {
  const mine = index.places.filter((p) => canon(p.name).startsWith(k + ' '));
  check('“' + k + '” is in the list ' + n + ' times, not once', mine.length, n);
  /* The state, and a number after it when even the state cannot tell them
     apart — the register really does list two Aruakgre Community Reserves in
     Meghalaya, with different outlines and different areas. */
  check('  each says which state it is in',
    mine.every((p) => new RegExp('\\(' + (p.state || '') + '( \\d+)?\\)$').test(p.name)), true);
  check('  and each fetches its own shape',
    new Set(mine.map((p) => p.at)).size, n);
});

console.log('\n  a shape is fetched by position, not by the first name that matches');
const fetcher = fs.readFileSync(ROOT + '/api/atlas-builders/places.py', 'utf8');
check('the fetcher reads the position', /at = entry\.get\("at"\)/.test(fetcher), true);
check('and checks the name before trusting it',
  /if isinstance\(at, int\) and 0 <= at < len\(feats\)/.test(fetcher), true);
const fromFile = index.places.filter((p) => p.source === 'file');
check('every place in a shipped file records its position',
  fromFile.filter((p) => typeof p.at !== 'number').map((p) => p.name), []);

console.log('\n  other names written for a place that does not exist are called out');
check('the builder warns about them',
  /other names written for a place that is not in any file/.test(
    fs.readFileSync(ROOT + '/api/atlas-builders/build_places_index.py', 'utf8')), true);

console.log('\n  the places written by hand survive a rebuild');
extra.places.forEach((e) => {
  const got = byName.get(canon(e.name));
  check('“' + e.name + '” is still there', !!got, true);
  if (got) check('  fetched from ' + e.source, got.source, e.source);
});

console.log('\n  so do the other names written by hand');
for (const [official, alts] of Object.entries(aliasesExtra.aliases)) {
  const got = byName.get(canon(official));
  if (!got) { check('“' + official + '” is in the list', false, true); continue; }
  const have = new Set((got.aliases || []).map(canon));
  const lost = alts.filter((a) => !have.has(canon(a)));
  check('“' + official + '” keeps all ' + alts.length + ' of its other names', lost, []);
}

console.log('\n  the two the whole thing was built for');
['Western Ghats', 'Eastern Ghats'].forEach((n) => {
  const got = byName.get(canon(n));
  check('“' + n + '” is a mountain range', got && got.kind, 'mountain range');
});
check('“Sahyadri” still reaches the Western Ghats',
  (byName.get('western ghats').aliases || []).map(canon).includes('sahyadri'), true);

console.log('\n  every place can be found, fetched and credited');
const noBox = index.places.filter((p) => !Array.isArray(p.bbox) || p.bbox.length !== 4);
check('all of them say roughly where they are', noBox.map((p) => p.name), []);
const noId = index.places.filter((p) => !p.source || !p.id);
check('all of them say how to fetch the shape', noId.map((p) => p.name), []);
const noCredit = index.places.filter((p) => !p.credit);
check('all of them say who to credit', noCredit.map((p) => p.name), []);
const noLicence = index.places.filter((p) => !p.licence);
check('all of them say under what terms', noLicence.map((p) => p.name), []);
const unknownSource = index.places.filter((p) => !index.sources[p.source]);
check('every source named is one the list describes',
  unknownSource.map((p) => p.name), []);

console.log('\n  no two places answer to the same name');
const counts = {};
index.places.forEach((p) => { counts[canon(p.name)] = (counts[canon(p.name)] || 0) + 1; });
check('nothing is listed twice',
  Object.entries(counts).filter(([, n]) => n > 1).map(([k]) => k), []);

console.log('\n  the list can be made again');
const builder = ROOT + '/api/atlas-builders/build_places_index.py';
check('the script that writes it is kept', fs.existsSync(builder), true);
const b = fs.readFileSync(builder, 'utf8');
[['ranges-IND.geojson', 'the ranges'], ['reserves-IND.geojson', 'the reserves'],
 ['places-extra.json', 'the hand-written places'],
 ['aliases-extra.json', 'the hand-written other names']].forEach(([f, what]) =>
  check('it reads ' + what, b.includes(f), true));
check('it says out loud what it dropped', /NO LONGER IN THE INDEX/.test(b), true);

console.log('\n  a rebuilt map file is not served from yesterday’s cache');
const conf = fs.readFileSync(ROOT + '/deploy/lokaApps.conf', 'utf8');
check('map files must revalidate like the pages do',
  /FilesMatch "\\\.\(html\|js\|css\|json\|geojson\)\$"/.test(conf), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
