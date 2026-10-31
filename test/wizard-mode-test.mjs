/* Run me with: node test/wizard-mode-test.mjs — or through node test/run.mjs.
 * "How should visitors explore it?" while building (Mithun, 31 Oct 2026): the
 * wizard asks, the server keeps the choice and applies it once the atlas can
 * take it (Explore once its places are in, Insight once LOKA has read them),
 * through the same switch the Owner menu uses. Paths come from where this file sits. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const js = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const pick = html.slice(html.indexOf('<fieldset class="q-opts mode-pick" id="f-mode">'), html.indexOf('</fieldset>', html.indexOf('id="f-mode"')));

console.log('\n  the wizard asks');
check('on the Name it step, before Build', html.indexOf('id="f-mode"') > html.indexOf('id="f-org"') && html.indexOf('id="f-mode"') < html.indexOf('id="build-go"'), true);
check('the question in plain words', /How should visitors explore it\?/.test(pick), true);
check('Standard, Explore and Insight to choose; Standard is the starting answer', ['standard', 'explore', 'insight'].map((v) => new RegExp('value="' + v + '"' + (v === 'standard' ? ' checked' : '')).test(pick)), [true, true, true]);
check('Event is shown but cannot be chosen yet, and says why', /value="event" disabled/.test(pick) && /LOKA sets it up for you/.test(pick), true);
check('it says the choice can change later', /change this any time under Owner/.test(pick), true);
check('the choice rides with the build', /mode: \(document\.querySelector\('#f-mode input\[name="mode"\]:checked'\) \|\| \{\}\)\.value \|\| "standard"/.test(js), true);

console.log('\n  the server keeps it and applies it when it can');
check('kept on the atlas, only for Explore or Insight', /wantMode: b\.mode === 'explore' \|\| b\.mode === 'insight' \? b\.mode : undefined,/.test(api), true);
check('one switch for the Owner menu and the wizard', /async function switchMode\(inst, want, payer, \{ file, local, now \}\)/.test(api) && /const r = await switchMode\(inst, want, req, \{ file, local, now \}\);/.test(api), true);
check('tried after a build and after every change of places', /applyWantedMode\(job\.slug\)/.test(api) && /applyWantedMode\(session\.dataset\)/.test(api), true);
check('"not yet" waits; anything else ends the wait', /if \(r\.status === 409\) return;/.test(api) && /reg\.updateInstance\(slug, \{ wantMode: undefined \}\);/.test(api), true);
check('never while building, never deoria, one at a time', /if \(inst\.status === 'building' \|\| inst\.status === 'pending-approval'\) return;\s*if \(searchText\.isNeverTouched\(slug\)\) return;/.test(api) && /WANT_RUNNING\.has\(slug\)/.test(api), true);
check('the owner choosing in Owner ▾ ends the wait', /if \(r\.status === 200 && inst\.wantMode\) reg\.updateInstance\(inst\.slug, \{ wantMode: undefined \}\);/.test(api), true);
check('the summary is paid for by the owner, as when they choose it themselves', /switchMode\(inst, inst\.wantMode, \{ payer: inst\.ownerAccount \|\| undefined \}/.test(api), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
