/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Finding the column that holds places, and the places inside a sentence.
 * No network: the real functions are read out of the product and run here. */
import fs from 'node:fs';
import { norm } from '../api/lib/matching.js';
import { aliasSpellings } from '../api/lib/atlas/place-aliases.js';

const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');

const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  const b = src.indexOf(close, a + head.length);
  if (b < 0) throw new Error('never closed: ' + head);
  return src.slice(a, b + close.length);
};
const fnFrom = (src, name, pad) => cut(src, '\n' + pad + 'function ' + name + '(', '\n' + pad + '}\n');
const varFrom = (src, name) => cut(src, '\n  var ' + name + ' =', ';\n');

/* the setup page's picker, run as the page runs it */
const { nameColumns, shortCol } = new Function(
  varFrom(setup, 'READS_GEOGRAPHIC') + varFrom(setup, 'READS_PERSONAL') +
  varFrom(setup, 'MAX_NAME_COLUMNS') + varFrom(setup, 'COLUMNS_BUDGET') +
  fnFrom(setup, 'nameColumns', '  ') + fnFrom(setup, 'shortCol', '  ') +
  '\n return { nameColumns, shortCol };')();

/* the server's sentence scanner, run with the real norm and rename table */
const { namesInside, LOOSE_IN_A_SENTENCE } = new Function('norm', 'aliasSpellings',
  cut(server, '\nconst LOOSE_IN_A_SENTENCE = new Set([', '\n]);') +
  '\nconst SCAN_MAX_WORDS = 80, SCAN_MAX_HITS = 12, SCAN_MIN_CHARS = 3;' +
  fnFrom(server, 'namesInside', '') +
  '\n return { namesInside, LOOSE_IN_A_SENTENCE };')(norm, aliasSpellings);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* A form export, shaped like the one that failed: the person's name first, the
   question about geography five columns later, contact details throughout. */
const FORM = {
  schema: [
    { name: 'Timestamp', type: 'string' },
    { name: 'Name ', type: 'string' },
    { name: 'Email address ', type: 'string' },
    { name: 'Name of Organisation or Collective (if applicable)', type: 'string' },
    { name: 'Which geographic areas do you work in? (Feel free to mention country, village, district, and state/province details.)', type: 'string' },
    { name: 'If you answered yes, please share your social media handles here (Instagram, Linkedin, Facebook etc)', type: 'string' },
  ],
  rows: [
    { 'Timestamp': '9/9/2026 14:23:46', 'Name ': 'Gijs Spoor', 'Email address ': 'g@example.org',
      'Name of Organisation or Collective (if applicable)': 'Green Silk Road',
      'Which geographic areas do you work in? (Feel free to mention country, village, district, and state/province details.)': 'Eastern and Western Ghats',
      'If you answered yes, please share your social media handles here (Instagram, Linkedin, Facebook etc)': '@greensilkroad' },
    { 'Timestamp': '9/9/2026 18:25:12', 'Name ': 'Sutanu Satpathy', 'Email address ': 's@example.org',
      'Name of Organisation or Collective (if applicable)': 'KIIT',
      'Which geographic areas do you work in? (Feel free to mention country, village, district, and state/province details.)': 'Arunachal Pradesh',
      'If you answered yes, please share your social media handles here (Instagram, Linkedin, Facebook etc)': '@sutanu' },
  ],
};

console.log('\n  a form export offers the geography question, not the person');
const cols = nameColumns(FORM);
/* the budget must never drop the column the headings liked best */
const HEAVY = JSON.parse(JSON.stringify(FORM));
HEAVY.rows = HEAVY.rows.map((r) => {
  const o = {};
  for (const k of Object.keys(r)) o[k] = r[k] + ' ' + 'x'.repeat(900000);
  return o;
});
check('too big to send it all, and the best column still goes',
  nameColumns(HEAVY).length, 1);
check('the geography question comes first', shortCol(cols[0].col), 'Which geographic areas do you work in?');
check('and it is the answers that would be sent', cols[0].names[0], 'Eastern and Western Ghats');
const heads = cols.map((c) => c.col.trim());
check('the person’s name is still offered, second', heads[1], 'Name');
/* the fault: "Name" was taken because it was FIRST, and twelve people's names
   went to the boundary data */
check('but it is no longer the one taken', heads[0] === 'Name', false);

console.log('\n  a column of contact details is never a place');
check('email is not offered', heads.some((h) => /Email/.test(h)), false);
/* "Email address" carries the word address, which reads geographic */
check('social handles are not offered', heads.some((h) => /social media/.test(h)), false);
/* and this is why: the old test matched "gram" inside "Instagram" */
check('"Instagram" no longer reads as "gram", a village',
  /\bgram\b/i.test('handles here (Instagram, Linkedin, Facebook etc)'), false);
check('the old test did read it that way', /(gram)/i.test('(Instagram, Linkedin'), true);

console.log('\n  a long question is named short enough to recognise');
check('cut at the question mark', shortCol('Which geographic areas do you work in? (Feel free to mention country)'),
  'Which geographic areas do you work in?');
check('cut at a bracket when there is no question mark',
  shortCol('Village name (as written on the survey sheet, in full)'), 'Village name');
check('a plain heading is left alone', shortCol('District'), 'District');
check('and something long with neither is trimmed',
  shortCol('a'.repeat(90)).length, 63);

console.log('\n  the places a sentence names');
const KNOWN = ['Karnataka', 'Chamarajanagar', 'Arunāchal Pradesh', 'Mahārāshtra', 'Bangalore',
  'East', 'Nagar', 'Industrial', 'Panna', 'West'];
const byName = new Map();
for (const n of KNOWN) {
  const k = norm(n);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push({ properties: { id: k, name: n }, bbox: [0, 0, 1, 1] });
}
const found = (s) => namesInside(s, (k) => byName.get(k) || null).map((h) => h.cands[0].properties.name);

check('a district and a state, wrapped in words',
  found('BRT Tiger Reserve, Chamarajanagar district, Karnataka, India'), ['Chamarajanagar', 'Karnataka']);
check('the longest name wins, and takes its words with it',
  found('I work across Arunachal Pradesh'), ['Arunāchal Pradesh']);
check('a former spelling is still the place',
  found('Primarily Bengaluru, and some work elsewhere'), ['Bangalore']);

console.log('\n  and the places it must not invent');
/* Measured: a loose run of this same scan put the Western Ghats in West Delhi,
   Pan India in Panna, and a sentence about industrial clients in an ADM3
   called Industrial. Each was a real entry in the boundary data. */
check('"Pan India" is not Panna', found('Pan India'), []);
check('"Western Ghats" is not West district', found('Eastern and Western Ghats'), []);
check('"industrial clients" is not a place', found('I work with industrial clients'), []);
check('"Jeevan Bhima Nagar" does not become Nagar', found('Jeevan Bhima Nagar'), []);
check('"East vidarbha" does not become East',
  found('East vidarbha maharashtra tadoba pench'), ['Mahārāshtra']);

console.log('\n  a word is only silenced when it stands alone');
check('a whole cell saying East is untouched by the list',
  server.includes('const lookup = (k) => byName.get(k) || null;'), true);
check('two words including a silenced one still match',
  found('the East district office'), []);
check('the words that caused it are named', [
  LOOSE_IN_A_SENTENCE.has('east'), LOOSE_IN_A_SENTENCE.has('industrial'),
  LOOSE_IN_A_SENTENCE.has('nagar'), LOOSE_IN_A_SENTENCE.has('india'),
], [true, true, true, true]);
check('and a real state is not on it',
  [LOOSE_IN_A_SENTENCE.has('kerala'), LOOSE_IN_A_SENTENCE.has('punjab')], [false, false]);

console.log('\n  only sentences are scanned, and only after the whole cell fails');
check('a single word goes straight to the old path',
  server.includes('const inside = /\\s/.test(String(nm).trim()) ? namesInside(nm, lookup) : [];'), true);
check('the whole cell is tried first, under every spelling it has had',
  /for \(const sp of aliasSpellings\(nm\)\) \{ cands = byName\.get\(sp\); if \(cands\) break; \}/.test(server), true);

console.log('\n  a row answered by a sentence is counted once');
check('the row is counted where it is found', /matchedRows \+= n;\s*\/\/ the ROW is answered, once/.test(server), true);
check('and settling a shared name later does not count it again',
  /if \(!counted\) \{ matchedRows \+= n; sharedRows \+= n; \}/.test(server), true);
check('however many places it names', /if \(inside\.some\(\(h\) => h\.cands\.length > 1\)\) sharedRows \+= n;/.test(server), true);

console.log('\n  the page offers columns and the boundary data picks one');
check('the page sends candidates', /body = pts \? \{ iso3: S\.iso3, points: pts \} : \{ iso3: S\.iso3, columns: cols \}/.test(setup), true);
check('at most four of them', /var MAX_NAME_COLUMNS = 4;/.test(setup), true);
check('and only as many as one request can carry', /var COLUMNS_BUDGET = 1400000;/.test(setup), true);
check('the server screens them', /async function pickNameColumn\(iso3, columns, avail\)/.test(server), true);
check('ties keep the one whose heading read best', /if \(!best \|\| rate > best\.rate\) best =/.test(server), true);
check('one column needs no screening at all', /if \(columns\.length < 2\) return \{ col: columns\[0\]\.col/.test(server), true);
check('a page still sending one unnamed column works',
  /if \(names\.length && !columns\.length\) columns\.push\(\{ col: '', names \}\);/.test(server), true);
check('and the answer says which column was read', /res\.json\(\{ iso3, mode, column, level: r\.level/.test(server), true);

console.log('\n  and the page says so, whether or not it found anything');
check('when nothing is found, it names the column it read',
  /msg\(2, "We read " \+ how \+ " and couldn’t match any of it/.test(setup), true);
check('the old message that explained nothing is gone',
  /We couldn’t match these rows to any place we know/.test(setup), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
