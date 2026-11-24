/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An uploaded cell is never silently cut short. A file of wildlife recordings
   listed 77 creatures heard at one place, 1,523 characters of it; the map was
   given 26 of them, the 26th halfway through its name, the column counting
   them still said 77, and the owner was told nothing. No network. */
import fs from 'node:fs';
import { keepWholeCell, MAX_CELL, sanitizeFeatures } from '../api/lib/fragment.js';
import { featureSearchText } from '../api/lib/atlas/search-text.js';
import { buildDigest } from '../api/lib/atlas/enrich.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* The fixture: one place with a list of 77 creatures and a paragraph about it. */
const NAMES = Array.from({ length: 77 }, (_, i) => 'Creature number ' + (i + 1) + ' of the night');
const LIST = NAMES.join('; ');
const PROSE = Array.from({ length: 500 }, (_, i) => 'word' + i).join(' ');
check('the list cell is the length the real one was', LIST.length > 1500, true);
check('and the prose cell is longer still', PROSE.length > 3000, true);

console.log('\n  a cell is kept whole, however long it is');
check('the list comes back word for word', keepWholeCell(LIST).value, LIST);
check('nothing was cut', keepWholeCell(LIST).cut, false);
check('the prose comes back word for word', keepWholeCell(PROSE).value, PROSE);
check('all 77 names are still there', keepWholeCell(LIST).value.split('; ').length, 77);
check('numbers are left as numbers by the caller, not stringified here',
  keepWholeCell(5).value, '5');
check('nothing is nothing', keepWholeCell(null).value, '');

console.log('\n  the ceiling is generous, and cuts at a separator when it fires');
check('it is far past any real writing', MAX_CELL >= 20000, true);
const huge = Array.from({ length: 4000 }, (_, i) => 'Creature number ' + i).join('; ');
const cutHuge = keepWholeCell(huge);
check('a pathological list is cut', cutHuge.cut, true);
check('and fits the ceiling', cutHuge.value.length <= MAX_CELL, true);
check('no item is left broken in half',
  cutHuge.value.split('; ').every((t) => /^Creature number \d+$/.test(t)), true);
check('what is kept is the start of what was sent',
  huge.startsWith(cutHuge.value), true);
const hugeProse = Array.from({ length: 6000 }, (_, i) => 'word' + i).join(' ');
const cutProse = keepWholeCell(hugeProse);
check('a pathological paragraph is cut between words',
  cutProse.cut && cutProse.value.split(' ').every((w) => /^word\d+$/.test(w)), true);
check('a caller may still ask for a smaller one (a preview, a card)',
  keepWholeCell(LIST, 500).value.length <= 500 &&
  keepWholeCell(LIST, 500).value.split('; ').every((t) => NAMES.includes(t)), true);

console.log('\n  and the stored layer keeps it: the commit path, really run');
const feats = [{ type: 'Feature', properties: { name: 'A pond', animals_heard: LIST, note: PROSE },
  geometry: { type: 'Point', coordinates: [73.9, 19.45] } }];
const clean = sanitizeFeatures(feats, ['name', 'animals_heard', 'note'], null, 'keep');
check('one feature survives', clean.features.length, 1);
check('the list cell on the map equals the one uploaded',
  clean.features[0].properties.animals_heard, LIST);
check('the prose cell too', clean.features[0].properties.note, PROSE);
check('nothing is stored at exactly five hundred any more',
  Object.values(clean.features[0].properties).some((v) => String(v).length === 500), false);

console.log('\n  the door says so when it does have to shorten one');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('the door keeps the cell by the one shared rule',
  /const kept = keepWholeCell\(v\);/.test(server), true);
check('and no longer cuts at five hundred',
  /String\(v\)\.slice\(0, 500\)/.test(server), false);
check('it counts the places, column by column',
  /if \(kept\.cut\) shortened\.set\(c, \(shortened\.get\(c\) \|\| 0\) \+ 1\);/.test(server), true);
check('keeps the count on the upload', /shortened: shortenedCols\.length \? shortenedCols : undefined,/.test(server), true);
check('and hands it back with every answer about that upload',
  /if \(session\.shortened && session\.shortened\.length\) report\.shortened = session\.shortened;/.test(server), true);
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
check('the wizard says which column and how many places, in plain words',
  /\(rep\.shortened \|\| \[\]\)\.forEach/.test(setup) &&
  /was too long to keep whole on/.test(setup), true);
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
check('the workbench says it too', /\(rep\.shortened \|\| \[\]\)\.forEach/.test(bench), true);

console.log('\n  a preview, a search and a prompt keep their own budgets');
check('the peek of a row is still short', /String\(v\)\.slice\(0, 120\)/.test(server), true);
const blob = featureSearchText({ animals_heard: LIST, note: PROSE }, null);
check('the search blob is capped where it always was', blob.length <= 4000, true);
check('and it still holds the words it is searched by', blob.indexOf('creature number 1 ') >= 0, true);
const digest = buildDigest([
  { animals_heard: LIST, note: PROSE },
  { animals_heard: NAMES.slice(0, 40).join('; '), note: 'a quieter pond' },
  { animals_heard: NAMES.slice(10, 25).join('; '), note: 'a third pond' },
], ['animals_heard', 'note']);
check('the reading\'s prompt line stays within its budget',
  digest.entries[0].text.length < 900, true);
check('while the place itself still counts every one of its 77 words',
  digest.entries[0].tags.length, 77);
check('the prompt line says nothing of a cut cell being the stored one',
  /…/.test(digest.entries[0].text), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
