/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A question is kept whole and shown whole. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const ocss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  one number says how long a question may be');
check('it is named once', /const MAX_QUESTION_CHARS = 120;/.test(server), true);
check('asking reads it', /b\.question \|\| ''\)\.trim\(\)\.slice\(0, MAX_QUESTION_CHARS\)/.test(server), true);
check('and storing reads the same one',
  /String\(k\)\.slice\(0, 60\), v\.trim\(\)\.slice\(0, MAX_QUESTION_CHARS\)/.test(server), true);
/* the two disagreeing is what sawed a question in half: asked at 120, kept at 40 */
check('a question is no longer kept at forty characters',
  /v\.trim\(\)\.slice\(0, 40\)/.test(server), false);

console.log('\n  and it is shown whole');
check('a question wraps rather than ending in an ellipsis',
  /\.own-q-name \{[^}]*white-space:normal/.test(ocss), true);
check('no ellipsis is left on it', /\.own-q-name \{[^}]*text-overflow:ellipsis/.test(ocss), false);
check('the switch sits with its first line', /\.own-q \{ align-items:flex-start; \}/.test(ocss), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
