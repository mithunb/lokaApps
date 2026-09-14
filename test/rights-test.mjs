/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Removing a layer and asking a question of it are different rights. No network. */
import fs from 'node:fs';
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the server says both things, separately');
check('taking a layer off the map stays with whoever put it there',
  /canRemove: role === 'owner' \|\| !!\(who && l\.addedBy && l\.addedBy\.email === who\.email\),/.test(server), true);
check('asking a question needs only that you may edit the atlas',
  /canAsk: !!role,/.test(server), true);

console.log('\n  and the tab follows the right one');
check('the Questions tab asks canAsk', /m && m\.canAsk && L\.keyLabels/.test(owner), true);
check('it no longer asks canRemove', /m && m\.canRemove && L\.keyLabels/.test(owner), false);
check('the Change button still asks canRemove', /if \(!m \|\| !m\.canRemove\) return;/.test(owner), true);

console.log('\n  turning a question off is about the map, not about whose layer it is');
check('hiding alone is recognised', /const onlyHiding = Array\.isArray\(b\.hiddenKeys\)/.test(server), true);
check('and is allowed to anyone who may edit', /if \(role !== 'owner' && !onlyHiding\)/.test(server), true);
/* renaming the layer, choosing its title column or its card columns are still
   about whose layer it is, so they must NOT ride in on the hiding exemption */
check('renaming still needs the layer to be yours',
  /typeof b\.label !== 'string'/.test(server), true);
check('so does the column that names a place', /typeof b\.titleColumn !== 'string'/.test(server), true);
check('and so do the card columns', /!Array\.isArray\(b\.cardColumns\)/.test(server), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
