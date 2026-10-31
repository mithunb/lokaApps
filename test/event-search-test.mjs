/* Run me with: node test/event-search-test.mjs — or through node test/run.mjs.
 * Search on an event guide (Mithun, 30 Oct 2026: "Search flow is confusing and
 * it's hard to see the search results. Search does not touch the comments
 * section"): a venue's sessions are searchable by their words, on the page and
 * on the server; what was typed beats a match by meaning; and the guide's list
 * becomes the answer while the box has words in it. Paths come from where this
 * file sits. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchCellText, featureSearchText } from '../api/lib/atlas/search-text.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const ev = fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const sessions = [{ day: '2026-10-31', start: '14:00', end: '15:30', title: 'Governance Action Lab', organiser: 'Nagrika' }];

console.log('\n  sessions are words, not "[object Object]"');
check('the server reads a list of records as their words', searchCellText(sessions), 'Governance Action Lab Nagrika');
check('a plain list is as it was', searchCellText(['a', 'b']), 'a; b');
check('a venue is found by a session it runs', featureSearchText({ loka_name: 'IPSCDL', sessions }, { id: 'tags' }).indexOf('governance action lab') >= 0, true);
check('and by who runs it', featureSearchText({ sessions }, { id: 'tags' }).indexOf('nagrika') >= 0, true);
const grab = (name) => { const i = js.indexOf('  function ' + name + '('); return js.slice(i, js.indexOf('\n  }\n', i) + 4); };
const page = new Function(grab('recordWords') + grab('cellText') + 'return cellText;')();
check('the page reads them the same way', page(sessions), 'Governance Action Lab Nagrika');

console.log('\n  what was typed comes first');
check('when the typed words appear somewhere, only those places answer', /var typedFound = !!q && layers\.some\(/.test(js) && /\(!typedFound && !!byRow\[e\.f\._row\]\)/.test(js), true);
check('the line names the word and the way back on a pin map too', /updateSearchCount\(shown, total, matchPts, null, searchWord \|\| q, searchNoun\(layers\)\)/.test(js), true);

console.log('\n  the guide lists the answer');
check('the page tells the mode what is searched, and when the search is cleared', /if \(EV && EV\.searched\) EV\.searched\(searchWord \|\| q\);/.test(js) && /updateSearchCount\(null\);\n\s*if \(EV && EV\.searched\) EV\.searched\(null\);/.test(js), true);
check('the list is the answer while the box has words', /if \(state\.search\) \{ renderSearch\(box\); return; \}/.test(ev), true);
check('a venue row says which of its sessions matched, by day and time', /sessionHits\(f\.properties, ql\)/.test(ev) && /dayLabel\(s\.day\)/.test(ev), true);
check('every button\'s pins show during a search, and the chip comes back after', /if \(state\.search\) CATS\.forEach\(function \(c\) \{ \(byCat\[c\.id\] \|\| \[\]\)\.forEach\(function \(L\) \{ api\.setLayerVisible\(L, true\); \}\); \}\);/.test(ev) && /else if \(was\) showChosen\(\);/.test(ev), true);
check('the count and "show all" are said once, under the box, not again in the list', /class="ev-search-top"|"ev-search-top"/.test(ev), false);
check('Enter brings the list up on a phone', /if \(EV && EV\.showResults && si\.value\.trim\(\)\) \{ e\.preventDefault\(\); si\.blur\(\); EV\.showResults\(\); \}/.test(js) && /api\.setSheet\("full"\)/.test(ev), true);
check('nothing found says what to try', /Try a venue, a session, a speaker or a word like café or toilet\./.test(ev), true);
check('the sheet head says Search and how many places were found', /return \{ label: "Search", small: countWord\(found, "place found", "places found"\) \};/.test(ev), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
