/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An atlas can have more than one owner. No network. */
import fs from 'node:fs';
import * as auth from '../api/lib/atlas/auth.js';
import * as reg from '../api/lib/atlas/registry.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  accounts that own every atlas here');
const was = process.env.ATLAS_OWNER_EMAILS;
delete process.env.ATLAS_OWNER_EMAILS;
delete process.env.ATLAS_ADMIN_EMAIL;
check('the operator, when nothing else is set', auth.isStandingOwner('mithun@socratus.org'), true);
check('and nobody else', auth.isStandingOwner('someone@example.com'), false);
check('case and spacing cannot mint a second identity',
  auth.isStandingOwner('  Mithun@Socratus.ORG '), true);
process.env.ATLAS_OWNER_EMAILS = 'a@x.org, b@x.org';
check('a list can be given', [auth.isStandingOwner('a@x.org'), auth.isStandingOwner('b@x.org')], [true, true]);
check('and it replaces the default', auth.isStandingOwner('mithun@socratus.org'), false);
if (was === undefined) delete process.env.ATLAS_OWNER_EMAILS; else process.env.ATLAS_OWNER_EMAILS = was;

console.log('\n  invited as an owner rather than an editor');
const inst = { collaborators: [
  { email: 'ed@x.org', role: 'editor' },
  { email: 'co@x.org', role: 'owner' },
  { email: 'old@x.org' },
] };
check('an editor is an editor', reg.collaboratorRole(inst, 'ed@x.org'), 'editor');
check('an owner is an owner', reg.collaboratorRole(inst, 'co@x.org'), 'owner');
check('somebody invited before roles existed is an editor',
  reg.collaboratorRole(inst, 'old@x.org'), 'editor');
check('and a stranger is nothing', reg.collaboratorRole(inst, 'no@x.org'), null);

console.log('\n  the server asks in the right order');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('an account that owns everything is an owner',
  /if \(auth\.isStandingOwner\(session\.email\)\) return 'owner';/.test(server), true);
check('and an invitation says which of the two it was',
  /const asked = reg\.collaboratorRole\(inst, session\.email\);/.test(server), true);
check('nobody is silently made an editor any more',
  /if \(reg\.isCollaborator\(inst, session\.email\)\) return 'editor';/.test(server), false);
check('an invite can name the role', /req\.body\.role === 'owner' \? 'owner' : 'editor'/.test(server), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
