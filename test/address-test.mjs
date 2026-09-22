/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Finding a place by its address, and choosing which part of a file to read.
 * No network: the deciding function is read out of the server and run here. */
import fs from 'node:fs';
import { norm } from '../api/lib/matching.js';

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const css = fs.readFileSync(ROOT + '/atlas/databench.css', 'utf8');

const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  const b = src.indexOf(close, a + head.length);
  return src.slice(a, b + close.length);
};
const { locateAgrees } = new Function('norm',
  cut(server, '\nfunction locateAgrees(', '\n}\n') + '\n return { locateAgrees };')(norm);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  what came back is ticked when it is NAMED after what was asked');
/* Every one of these is a real answer the provider gave, biased to Bengaluru. */
check('a neighbourhood the boundary data has never heard of',
  locateAgrees('Jeevan Bhima Nagar, Bengaluru', 'Jeevan Bhima Nagar, Jeevan Bhimanagar, Karnataka, India'), true);
check('a park', locateAgrees('Cubbon Park, Bengaluru', 'Cubbon Park, Sampangirama Nagar, Bengaluru, Karnataka, India'), true);
check('a garden the provider spells with an s',
  locateAgrees('Lalbagh Botanical Garden, Bengaluru', 'Lalbagh Botanical Gardens, Ashoka Pillar, Bengaluru, Karnataka, India'), true);

console.log('\n  and not when it merely sounds like it');
/* The provider graded this one EXACT — it knows that bistro's doorway to the
   metre. Exact is a claim about precision, never about being the right place,
   which is the whole reason the grade cannot decide this. */
check('"Pan India" is not a bistro in JP Nagar',
  locateAgrees('Pan India', '24th Main Pan Indian Bistro, 12th Cross Road, JP Nagar, Karnataka, India'), false);
check('a tiger reserve is not a banknote printing press',
  locateAgrees('BRT Tiger Reserve, Chamarajanagar district, Karnataka, India',
    'Bharatiya Reserve Bank Note Mudran Private Limited - BRBNMPL, Metagalli Industrial Area, Karnataka'), false);
check('nothing found means nothing agreed', locateAgrees('Anywhere', ''), false);
check('a scrap too short to mean anything', locateAgrees('BRT', 'BRTC Bus Depot, Dhaka'), false);

console.log('\n  the page ticks on that, not on the provider’s own grade');
check('agreement is what decides', /function addrSure\(r\) \{ return r\.lat != null && r\.agrees && !r\.collided; \}/.test(bench), true);
check('the grade no longer does', /r\.confidence === "exact" && !r\.collided/.test(bench), false);
check('and an unticked row says why', /not called what you asked for/.test(bench), true);
check('several rows on one point is its own reason', /several rows landed here/.test(bench), true);
check('which the server works out by the pile-up', /markCollisions\(out\);/.test(server), true);

console.log('\n  looking up places NEVER places them');
check('the lookup writes no coordinates onto any row',
  /router\.post\('\/layers\/locate', async[\s\S]*?\n\}\);/.exec(server)[0].includes('r[latName]'), false);
check('placing them is a second request, naming the rows',
  /router\.post\('\/layers\/locate\/keep'/.test(server), true);
check('which writes only the rows it was given', /if \(!wanted\.has\(i\) \|\| !p \|\| p\.lat == null\) return;/.test(server), true);
check('and clears last time’s answers first', /delete r\[latName\]; delete r\[lngName\];/.test(server), true);
check('then the layer is an ordinary coordinates layer',
  /session\.strategy = 'coordinates';\n  imports\.saveImport\(session\);/.test(server), true);
check('with the two columns given their roles',
  /\{ name: latName, role: 'latitude' \}, \{ name: lngName, role: 'longitude' \}/.test(server), true);
check('under names nothing else has taken', /while \(\(session\.columnsRaw \|\| \[\]\)\.includes\(n\)\) n = base \+ ' ' \+ \(k\+\+\);/.test(server), true);

console.log('\n  a session lives on disk, so what was found is written down');
/* Without this the second request reads a session that never heard of the
   first, and answers "nothing has been looked up yet" — which it did. */
check('the lookup saves', /looked, results: locateSoFar\(session\) \}\);/.test(server) &&
  /imports\.saveImport\(session\);\n  const done = Object\.keys\(held\)\.length;/.test(server), true);

console.log('\n  and it is paced and bounded, because the providers are somebody else’s');
check('twenty fresh lookups per request', /const LOCATE_BATCH = 20;/.test(server), true);
check('five hundred rows at most', /const LOCATE_MAX_ROWS = 500;/.test(server), true);
check('a bigger file is turned away with the arithmetic',
  /looking up ' \+ rows\.length \+ ' addresses one at a time would take '/.test(server), true);
check('asking again resumes rather than restarting', /if \(held\[i\]\) continue;/.test(server), true);
check('a different column is a different question',
  /if \(!session\.located \|\| session\.located\.column !== col\) session\.located = \{ column: col, byRow: \{\} \};/.test(server), true);
check('the lookup is biased to the atlas’s own region', /function locateBias\(session\)/.test(server), true);

console.log('\n  the page offers it as a third way to place rows');
check('a third segment', /data-strat="address">By address<\/button>/.test(bench), true);
check('which is not a strategy the server knows', /if \(PLACE_MODE !== "address"\) \{ \$\("#s-strategy"\)\.value = PLACE_MODE; PLACE_MODE = ""; \}/.test(bench), true);
check('so choosing it applies nothing yet', /if \(!\$\("#pd-addr-fields"\)\.hidden\) return;/.test(bench), true);
check('the review list is styled', /\.addr-row \{/.test(css), true);
check('and folds to two columns on a phone', /@media \(max-width:640px\)\{ \.addr-row \{ grid-template-columns:auto 1fr; \}/.test(css), true);

console.log('\n  which part of a file to read is asked, not assumed');
check('the wizard asks', /function askWhichPart\(file, question, entries\)/.test(setup), true);
check('with the sheets and their sizes', /That workbook has several sheets — which one holds the places\?/.test(setup), true);
check('and it no longer just takes the first',
  /res\.pick\(res\.sheets\[0\]\.name/.test(setup), false);
check('one part is no question at all', /if \(entries\.length === 1\) return takePart\(file, entries\[0\]\);/.test(setup), true);
check('mixed shapes get the same question', /That file mixes shapes — which of them should the atlas read\?/.test(setup), true);
check('forgetting the file forgets the question', /FILE_STATE\.pick = null;\n      msg\(2, ""\);/.test(setup), true);
check('the choices are styled', /\.part-opt \{/.test(fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8')), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
