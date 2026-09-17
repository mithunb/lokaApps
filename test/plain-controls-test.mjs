/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A control says what it does, and does only that. No network. */
import fs from 'node:fs';
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the info mark is a button, so pressing it stops at the button');
/* It was a span. A span is not interactive content, so the press travelled on
   to the label wrapping the row and turned the layer off — reported as "the
   info icon toggles the Place Tags control". */
check('it is built as a button', /el\("button", "ctl-info", ICONS\.info\)/.test(js), true);
check('no span is left behind', /el\("span", "ctl-info"/.test(js), false);
check('and it says it is a button', /info\.type = "button";/.test(js), true);
check('the press does not travel up to the row',
  /info\.onclick = function \(e\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/.test(js), true);

console.log('\n  and what it holds can be reached without a mouse');
/* A title only appears on hover with a pointer: on a phone and by keyboard the
   words behind it were simply unreachable. */
check('the words go in a paragraph under the row', /el\("p", "ctl-said", esc\(L\.info\)\)/.test(js), true);
check('put away to begin with', /said\.hidden = true;/.test(js), true);
check('pressing turns it over', /var show = said\.hidden;\s*said\.hidden = !show;/.test(js), true);
check('and it says whether it is open', /info\.setAttribute\("aria-expanded", String\(show\)\)/.test(js), true);
check('the button is named after the layer',
  /info\.setAttribute\("aria-label", "About " \+ \(L\.label \|\| L\.id\)\)/.test(js), true);
check('the paragraph is styled', /\.ctl-said \{/.test(html), true);
check('no leftover rule still calls it a hint', /\.ctl-info \{[^}]*cursor:help/.test(html), false);
check('and the old fixed 16px box is gone', /\.ctl-info \{[^}]*width:16px/.test(html), false);
check('with a hit area bigger than the mark', /\.ctl-info \{[^}]*padding:5px/.test(html), true);
check('bigger again under a finger', /\.ctl-info \{ padding:8px; \}/.test(html), true);

console.log('\n  the switch is named by its layer, not by the row it sits on');
check('named where it is made', /cb\.setAttribute\("aria-label", L\.label \|\| L\.id\)/.test(js), true);

console.log('\n  the owner’s controls say what pressing them does');
check('Card became Edit card', /btn\.textContent = "Edit card";/.test(owner), true);
check('and no bare "Card" is left', /btn\.textContent = "Card";/.test(owner), false);
check('Remove opens a question, and shows it', /del\.textContent = "Remove…";/.test(owner), true);
check('it says so to a screen reader too',
  /aria-label", "Remove " \+ \(L\.label \|\| L\.id\) \+ " from the map — asks first"/.test(owner), true);
check('"Take it off" became "Make it private"',
  /act\.textContent = live \? "Make it private" : "Make it live";/.test(owner), true);
check('and nothing on screen still says "Take it off"',
  /textContent = ("|')?[^\n]*Take it off/.test(owner), false);
check('the note afterwards says what happened',
  /toast\(live \? "Private now — only you can see it"/.test(owner), true);

console.log('\n  a credit is not printed twice on one row');
/* The owner’s row shows "added by X" in its own words, so the same credit is
   trimmed out of the layer’s note. That used to be read off the icon’s title,
   which no longer exists. */
check('the note is what gets trimmed', /var said = row\.querySelector\("\.ctl-said"\);/.test(owner), true);
check('not a title that is gone', /if \(info && info\.title\)/.test(owner), false);
check('and if nothing is left, the button goes too',
  /var mark = row\.querySelector\("\.ctl-info"\);\s*if \(mark\) mark\.parentNode\.removeChild\(mark\);/.test(owner), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
