/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Onboarding, review fixes (October 2026), from Mithun building a real atlas
   out of a 134-row file:
     1. Where said the file's places twice, either side of the button, and
        ended "Ready to build" with open data and a name still to come;
     2. the column table's heading said "Choose the columns for your map";
     3. the check on "Here's what we found" showed a stripe and nothing else,
        and "Looks right" could be pressed while it ran — which skipped the
        questions the check was about to ask;
     4. "Choose the places myself" sat under the column table, where it read
        as part of that box;
     5. a new atlas showed one key where five were coming, because the
        questions are found by a reading that starts when the owner first
        opens it, and its note sat at the foot of the row. */

const page = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function fnFrom(src, name, indent = '  ') {
  const start = src.indexOf('\n' + indent + 'function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found');
  const end = src.indexOf('\n' + indent + '}\n', start);
  return src.slice(start, end + indent.length + 3);
}
const flow = page.slice(page.indexOf('id="flow"'));
const s2b = page.slice(page.indexOf('<section class="panel" id="s2b"'), page.indexOf('<section class="panel" id="s2q"'));

console.log('\n  1 · Where says what the file found once');
check('the file’s places are no longer a second message under the button',
  /your file’s places sit in/.test(setup), false);
check('"Ready to build" is gone from every line', /Ready to build/.test(setup + page), false);
check('the forward button is a plain one', /<button class="btn" id="next-2">Continue →<\/button>/.test(flow), true);
check('"See what we found" is gone', /See what we found/.test(page + setup), false);
check('the one line is painted with the chips, so it follows them',
  /v\.textContent = foundLine\(\) \|\| \("Your atlas will cover " \+ placeList\(/.test(setup), true);
check('the reading message is cleared once the file has answered',
  /GEO\.said\.notes = said;\n\s*msg\(2, ""\);/.test(setup), true);
check('a new file, or forgetting one, forgets what the last one said',
  /GEO\.said = null;\n\s*msg\(2, "Reading " \+ file\.name/.test(setup) &&
  /GEO\.part = ""; GEO\.said = null;/.test(setup), true);

// the line itself, run as the page runs it
const { placeList } = new Function(fnFrom(setup, 'placeList') + '; return { placeList };')();
function lineFor(GEO, chosen) {
  const S = { chosen };
  return new Function('GEO', 'S', 'placeList', fnFrom(setup, 'foundLine') + '; return foundLine();')(GEO, S, placeList);
}
const blr = [{ id: 'a', label: 'Bangalore' }, { id: 'b', label: 'Bangalore Rural' }];
const geo = { file: { name: 'x.csv' }, foundIds: ['a', 'b'],
  said: { how: 'the coordinates', matched: 134, rows: 134, notes: '' } };
check('coordinates: one line, places, source and count',
  lineFor(geo, blr),
  'Found: Bangalore and Bangalore Rural, from the coordinates in 134 of 134 rows. Take any out, or search to add more.');
check('a named column says which',
  lineFor(Object.assign({}, geo, { said: { how: 'the “district” column', matched: 30, rows: 42, notes: ' 2 rows we couldn’t read.' } }), blr),
  'Found: Bangalore and Bangalore Rural, from the “district” column in 30 of 42 rows. 2 rows we couldn’t read. Take any out, or search to add more.');
check('it follows the chips: take one out and it names what is left',
  lineFor(geo, blr.slice(1)),
  'Found: Bangalore Rural, from the coordinates in 134 of 134 rows. Take any out, or search to add more.');
check('none of the file’s places left: no file line (the plain one takes over)',
  lineFor(geo, [{ id: 'z', label: 'Mysuru' }]), '');
check('no file: no file line', lineFor(Object.assign({}, geo, { file: null }), blr), '');

console.log('\n  2 · the columns, in plain words');
check('the heading says what the columns are for',
  /\$\("#check-title"\)\.textContent = "Columns the atlas will use" \+/.test(bench), true);
check('"Choose the columns for your map" is gone', /Choose the columns for your map/.test(bench), false);
check('one short line under it, no "please"',
  /Untick any you don't want on the map\. <b>✎<\/b> renames one or changes what it holds;\s*<b>Preview rows<\/b> lets you fix entries by hand\./.test(bench) &&
  !/[Pp]lease/.test(bench.slice(bench.indexOf('id="check-sub"'), bench.indexOf('id="check-sub"') + 300)), true);

console.log('\n  3 · the check says what it is doing, and the way on waits for it');
check('the rows go with a progress token', /body\.progress = "p" \+ Date\.now\(\)\.toString\(36\)/.test(bench), true);
check('the server answers how far a check has got',
  /router\.get\('\/layers\/progress', \(req, res\) => \{/.test(server), true);
check('it names each step as it starts',
  ["tell('outlines')", "tell('reading')", "tell('matching')", "tell('spelling', { names: ask.length })", "tell('placing')"]
    .every((t) => server.includes(t)), true);
check('every check ends its record, failed or not, and it is forgotten a minute later',
  /tell\.end\(false\);\n\s*return out;\n\s*\} catch \(e\) \{\n\s*tell\.end\(true\);/.test(server) &&
  /setTimeout\(\(\) => PROGRESS\.delete\(id\), PROGRESS_KEEP\)\.unref\(\);/.test(server), true);

// the server's record, run as the server runs it
{
  const src = server.slice(server.indexOf('const PROGRESS = new Map();'), server.indexOf("router.get('/layers/progress'"));
  const make = new Function('setTimeout', src + '; return { PROGRESS, progressFor };');
  const later = [];
  const { PROGRESS, progressFor } = make((fn) => { later.push(fn); return { unref() {} }; });
  const tell = progressFor('abcdefgh12', 134);
  check('a fresh check starts at sending', PROGRESS.get('abcdefgh12').step, 'sending');
  tell('spelling', { names: 12 });
  const p = PROGRESS.get('abcdefgh12');
  check('a step carries its counts and nothing else', [p.step, p.rows, p.names], ['spelling', 134, 12]);
  tell.end(false);
  check('the end is recorded', PROGRESS.get('abcdefgh12').step, 'done');
  later.forEach((fn) => fn());
  check('and then forgotten', PROGRESS.has('abcdefgh12'), false);
  const none = progressFor('../etc', 5);
  none('matching');
  check('a token that is not one records nothing', PROGRESS.size, 0);
}

// the words, run as the bench runs them
{
  const src = fnFrom(bench, 'watchProgress');
  const said = [];
  const timers = [];
  const api = () => ({ then(ok) { ok({ step: 'matching', rows: 134 }); return { then(f) { f(); } }; } });
  const run = new Function('api', 'setTimeout', 'clearTimeout', 'countRows',
    src + '; return watchProgress;')(api, (fn) => { timers.push(fn); return timers.length; }, () => {},
    (n) => n.toLocaleString() + (n === 1 ? ' row' : ' rows'));
  const w = run('tok', 134, (t) => said.push(t));
  timers.shift()();
  check('the matching step in words', said[0], 'Matching your 134 rows to places…');
  w.stop();
  check('spelling counts the names', /"Checking the spelling of " \+ n\.toLocaleString\(\) \+ \(n === 1 \? " place name" : " place names"\)/.test(src), true);
  check('a long step shows its seconds', /secs >= 3 \? " " \+ secs \+ " seconds so far\."/.test(src), true);
  check('no share done is invented', /%|percent/.test(src), false);
}

check('the way on is disabled while the check runs, and says why',
  /var checking = !!\(GEO\.canonical && BENCH && !FOUND\.settled && !FOUND\.failed\);\n\s*on\.disabled = checking;/.test(setup) &&
  /on\.textContent = checking \? "Checking your rows…"/.test(setup), true);
check('the check paints that before it starts', /paintFoundButtons\(\);\s*\/\/ the way on waits[^\n]*\n\s*BENCH\.start\(GEO\.canonical\);/.test(setup), true);
check('a press while it is disabled does nothing', /if \(this\.disabled\) return;/.test(setup), true);
check('a failure before the answer is said plainly, with a retry',
  /if \(kind === "err" && !FOUND\.settled\) \{[\s\S]{0,400}?Your rows couldn’t be checked\.[\s\S]{0,300}?checkFailed\(\);/.test(setup) &&
  /<button class="btn secondary" type="button" id="check-again">Try again<\/button>/.test(s2b), true);
check('after a failure the way on is open again, as "Continue anyway"',
  /\(low \|\| FOUND\.failed\) \? "Continue anyway" : "Looks right →"/.test(setup), true);
check('Try again runs the same check from the start',
  /\$\("#check-again"\)\.onclick = function \(\) \{\n\s*if \(BENCH\) \{ BENCH\.destroy\(\); BENCH = null; \}\n\s*BENCH_KEY = "";/.test(setup), true);
check('a fresh check clears the last one before the words are painted',
  /startBench\(\);\n\s*paintFound\(\);\n\s*\}/.test(setup), true);
check('the disabled button stays leaf, faded, not grey', /#next-2b:disabled \{ opacity:\.6; cursor:progress; \}/.test(page), true);

console.log('\n  4 · "Choose the places myself" sits with the places');
check('it is on the found screen, under the summary and before the check and the table',
  s2b.indexOf('id="found-mine"') > s2b.indexOf('id="found-map"') &&
  s2b.indexOf('id="found-mine"') < s2b.indexOf('id="check-verdict"') &&
  s2b.indexOf('id="found-mine"') < s2b.indexOf('id="bench"'), true);
check('not in the foot row any more', /id="found-btns"[\s\S]*?id="found-mine"[\s\S]*?<\/div>\s*<div id="msg-2b">/.test(s2b), false);
check('outlined when most rows landed, green when under 60% did',
  /mine\.className = low \? "btn" : "btn secondary";/.test(setup), true);

console.log('\n  5 · questions that are still coming say so');
check('the note sits under the layer’s keys, not at the foot of the row',
  /var keys = box\.querySelector\("\.key-chips"\);\n\s*if \(keys && keys\.parentNode === box\) box\.insertBefore\(wrap, keys\.nextSibling\);/.test(owner), true);
/* The reading moved to the server, so "Keep this page open" is no longer true
   and is gone; the rest of the line stands (server-questions-test has more). */
check('it says more are coming, and roughly when',
  /"Finding questions in your data\\u2026 more will appear here in about half a minute\."\)/.test(owner), true);
check('and no longer asks the owner to keep the page open', /Keep this page open until they do/.test(owner), false);
check('the old wording is gone', /patterns underneath/.test(owner), false);
/* The record a redrawn row reads is now the server's, carried on /layers/list,
   so a redrawn row says what the server says and nothing older. */
check('a redrawn row reads the server\'s record, so it never says "still reading" after the end',
  /var q = readingOf\(L\.id\);/.test(owner) && /return \(m && m\.questions\) \|\| null;/.test(owner), true);

console.log('\n  the design notes');
check('DESIGN.md has the review fixes', /### The setup wizard, review fixes \(October 2026\)/.test(design), true);
check('and the late questions', /\*\*Questions on a new atlas arrive late, and say so\.\*\*/.test(design), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
