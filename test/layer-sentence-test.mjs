/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Placing a layer's rows reads sentences, the way choosing a region does.
 * No network: the real scanner is read out of the server and run here. */
import fs from 'node:fs';
import { norm } from '../api/lib/matching.js';
import { aliasSpellings } from '../api/lib/atlas/place-aliases.js';

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  return src.slice(a, src.indexOf(close, a + head.length) + close.length);
};
const { namesInside } = new Function('norm', 'aliasSpellings',
  cut(server, '\nconst LOOSE_IN_A_SENTENCE = new Set([', '\n]);') +
  '\nconst SCAN_MAX_WORDS = 80, SCAN_MAX_HITS = 12, SCAN_MIN_CHARS = 3;' +
  cut(server, '\nfunction namesInside(', '\n}\n') +
  '\n return { namesInside };')(norm, aliasSpellings);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* The districts a real atlas of this data holds, as join targets. */
const TARGETS = ['Chamarajanagar', 'Dehradun', 'Kullu', 'Bangalore Urban', 'Kodagu',
  'Nagpur', 'Ghazipur', 'East', 'Nagar'].map((name, i) => ({ code: String(i), name, parent: '' }));
const byName = new Map();
for (const t of TARGETS) {
  const k = norm(t.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(t);
}
const found = (cell) => namesInside(cell, (k) => byName.get(k) || null).map((h) => h.cands[0].name);

console.log('\n  the place inside the answer somebody actually wrote');
check('a district named after the reserve it holds',
  found('BRT Tiger Reserve, Chamarajanagar district, Karnataka, India')[0], 'Chamarajanagar');
check('the first place named wins, being the most specific',
  found('Dehradun, Uttarakhand  Naggar and Chachogi villages, Kullu district, Himachal Pradesh')[0], 'Dehradun');
check('and the others are still seen',
  found('Dehradun, Uttarakhand  Naggar and Chachogi villages, Kullu district').includes('Kullu'), true);

console.log('\n  and the words that must not become places');
/* Each of these is a real unit in the boundary data and the wrong answer. */
check('"East vidarbha" is not East', found('East vidarbha maharashtra tadoba pench'), []);
check('"Jeevan Bhima Nagar" is not Nagar', found('Jeevan Bhima Nagar, Bengaluru'), []);
check('"Pan India" is nothing here', found('Pan India'), []);

console.log('\n  the layer path now does what the region path did');
check('it reaches for the same scanner', /namesInside\(res\.name, insideTargets\)/.test(server), true);
check('over the boundary layer it is joining to', /const insideTargets = \(k\) => byTargetName\.get\(k\) \|\| null;/.test(server), true);
/* Only after joinByName has failed on the whole cell — a row that matched
   plainly, or that somebody fixed by hand, never reaches this. */
check('only when the whole cell found nothing', server.indexOf('if (!code) {') < server.indexOf('namesInside(res.name, insideTargets)'), true);
check('and only for cells with more than one word',
  /\/\\s\/\.test\(String\(res\.name == null \? '' : res\.name\)\.trim\(\)\)/.test(server), true);
check('a hand-made choice still wins', /const code = manual === 'skip' \? null : \(manual \|\| res\.match\);/.test(server), true);

console.log('\n  what it finds is placed, counted and named');
check('one place: the row is placed', /placeOn\(first\.cands\[0\], res\.row\);/.test(server), true);
check('and counted apart from a plain match', /report\.inSentence = \(report\.inSentence \|\| 0\) \+ 1;/.test(server), true);
check('several places of that name: the person is asked',
  /candidates: first\.cands\.map\(\(t\) => \(\{ code: t\.code, name: t\.name, parent: t\.parent, score: 1 \}\)\)/.test(server), true);
check('nothing found: unchanged from before',
  /\(res\.candidates\.length \? report\.ambiguous : report\.unmatched\)\.push\(\{/.test(server), true);
check('placing a row happens in one place now', (server.match(/const placeOn = \(target, rowIdx\) => \{/g) || []).length, 1);
check('the page says how many were found that way',
  /if \(rep\.inSentence\) bits\.push\(rep\.inSentence \+ " found inside a longer answer"\);/.test(bench), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
