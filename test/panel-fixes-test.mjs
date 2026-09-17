/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Three things the panel got wrong. No network. */
import fs from 'node:fs';
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const atlas = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  a question you keep shows up where you look for it');
check('the shelf can be drawn again', /var SHOW_SHELF = null;/.test(owner), true);
check('and is, when the shelves already exist',
  /if \(head\.querySelector\("\.own-shelves"\)\) \{ if \(SHOW_SHELF\) SHOW_SHELF\(\); return; \}/.test(owner), true);
check('the overlay that names the keys is never served stale',
  /fetch\(dataUrl\("manifest\.local\.json"\), \{ cache: "no-store" \}\)/.test(atlas), true);

console.log('\n  renaming cannot go dead after one go');
/* The pencil worked once per page because opening the box took over what it
   did when clicked and nothing handed that back. That was fixed, and then the
   pencil was removed altogether: the name is the control now, so there is
   nothing to take over and nothing to give back. This guards the fault, not
   the mechanism that used to carry it. */
/* \b matters: "open.onclick" contains "pen.onclick", and an unrelated
   control three hundred lines away would otherwise fail this. */
check('nothing takes over a control while an edit is open',
  /\bpen\.onclick/.test(owner), false);
check('the name is the control, and it is still there when the edit ends',
  /nameBtn\.hidden = false;/.test(owner), true);
check('and it gets the focus back', /nameBtn\.focus\(\);/.test(owner), true);

console.log('\n  and a map may wear as many questions as it earns');
check('no cap is counted', /MAX_QUESTIONS_ON_A_LAYER/.test(server), false);
check('and nothing says a map can wear only so many',
  /as many as a map can wear/.test(server), false);

console.log('\n  nothing narrates the interface at somebody');
/* the comment explaining its removal names it, so read the code alone */
const ownerCode = owner.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
check('the caption explaining the questions is gone',
  /Patterns found once/.test(ownerCode), false);

console.log('\n  a fold says what it opens and whether it is open');
/* Both were later renamed for what pressing them does — the wording itself is
   checked in plain-controls; here the point is only that there are two. */
check('each control is named for its own half',
  /btn\.textContent = "Edit card";/.test(owner) && /del\.textContent = "Remove\u2026";/.test(owner), true);
check('and the one that ends something is coloured as such',
  /own-change own-change-danger/.test(owner), true);
check('it starts shut and says so', /btn\.setAttribute\("aria-expanded", "false"\)/.test(owner), true);
check('opening one says which one is open',
  /buildFold\(L, meta, kind\);\s*saidOpen\(L\.id, kind\);/.test(owner), true);
check('and shutting says neither is', /var lid = FOLD\.lid;\s*saidOpen\(lid, null\);/.test(owner), true);
check('its label no longer claims to be about how a layer looks',
  /Change how " \+ \(L\.label/.test(owner), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
