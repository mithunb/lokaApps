/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Onboarding, release 1 (October 2026): the setup wizard reordered in place,
   front end only. Sign in stays first. Then: where the work is (a place search
   and a file drop, side by side) → a look at your data, when there is a file →
   the open data, everything shown up front and nothing favoured → the name,
   filled in → the build. The description left the flow; the logo stayed,
   folded, until Settings can take it. No server change. */

const page = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const rows = fs.readFileSync(ROOT + '/atlas/catalog-rows.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function fnFrom(src, name) {
  const start = src.indexOf('\n  function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found');
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end + 5);
}
const flow = page.slice(page.indexOf('id="flow"'));
const panelAt = (id) => flow.indexOf('<section class="panel" id="' + id + '"');

console.log('\n  the order of the screens');
// release 2 (October 2026): the "your data" rung became "what we found", for
// everyone — a typed region gets the same look as a file. Same panels, same order.
check('the panels come in the walked order: where, what we found, open data, name, build',
  [panelAt('s2'), panelAt('s2b'), panelAt('s3'), panelAt('s1'), panelAt('s4')].every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])), true);
check('setup.js walks them in that order, file or no file', /function order\(\) \{ return \[2, "found", 3, 1, 4\]; \}/.test(setup), true);
check('the flow starts at the place, not the name', /\$\("#flow"\)\.hidden = false;\n    step\(2\);/.test(setup), true);
check('the stepper reads Where · What we found · Open data · Name it · Build',
  [...flow.matchAll(/<button class="stp"[^>]*><b>\d<\/b> ([^<]+)<\/button>/g)].map((m) => m[1].trim()),
  ['Where', 'What we found', 'Open data', 'Name it', 'Build']);
check('the rungs are numbered 1 to 5 in the page itself, nothing renumbers them',
  [...flow.matchAll(/<button class="stp"[^>]*><b>(\d)<\/b>/g)].map((m) => m[1]).join('') === '12345' && !/syncRungs/.test(setup), true);
check('the page says what the steps are, in plain words',
  /Four steps: where your work is, what we found there, what open data goes on it,\s+what to call it\./.test(page), true);
check('a rung already passed can be pressed; one ahead cannot',
  /if \(there >= 0 && there <= here\) b\.disabled = false;/.test(setup), true);
check('Back from the open data goes to what we found',
  /if \(b\.dataset\.go === "found"\) \{ showFound\(\); return; \}/.test(setup) &&
  /id="s3"[\s\S]*?data-go="found">← Back<\/button>/.test(flow), true);
check('Back from the name goes to the open data', /id="s1"[\s\S]*?data-go="3">← Back<\/button>/.test(flow), true);
check('a lapsed sign-in comes back to the name screen, where Build is',
  /step\(1\);\n        msg\(1, "Signed in again — press Build my atlas\.", "ok"\);/.test(setup), true);
check('a build the server refused comes back there too', /step\(1\);\n      msg\(1, errMsg\(e\)\);/.test(setup), true);

console.log('\n  where is your work: the search and the file drop as equals');
const s2 = flow.slice(panelAt('s2'), panelAt('s2b'));
check('the heading', /<h2>Where is your work\?<\/h2>/.test(s2), true);
check('search and drop sit side by side',
  /<div class="either">[\s\S]*<div class="either-a">[\s\S]*id="place"[\s\S]*<div class="either-or"[\s\S]*<div class="either-b fromfile">[\s\S]*id="geo-drop"/.test(s2), true);
check('with an "or" between them', /<div class="either-or" aria-hidden="true"><span>or<\/span><\/div>/.test(s2), true);
check('the drop is a headline offer now', /<b>Drop a spreadsheet or map file<\/b>/.test(s2), true);
check('it says what leaves the browser', /Only the place names are sent to find\s+your region &mdash; never the whole file\./.test(s2), true);
check('the search asks for a district, block or state', /placeholder="Type a district, block or state…"/.test(s2), true);
check('the first screen has no Back', /data-go=/.test(s2), false);
check('the same file reading and inference as before; the check now runs on the found screen',
  /api\("geo\/infer", \{/.test(setup) && /function startBench\(\)/.test(setup) && /stages: "checkPlace"/.test(setup), true);
check('the page stacks the two on a phone', /@media \(max-width:720px\) \{\n\s*\.either \{ grid-template-columns:1fr;/.test(page), true);

console.log('\n  the open data: everything up front, nothing favoured');
const s3 = flow.slice(panelAt('s3'), panelAt('s1'));
check('the heading', /<h2>What open data goes on it\?<\/h2>/.test(s3), true);
check('the intro', /Everything this region can have\. Tick what you want; add or remove any of it\s+later\./.test(s3), true);
check('every group is open, not only the first', /\n\s*d\.open = true;/.test(setup) && !/if \(gi === 0\) d\.open = true;/.test(setup), true);
check('the boundaries are shown as a locked first row', /lab\.className = "cat-row cat-row-given";\n\s*lab\.innerHTML = CR\.rowHTML\(l, true, \{ locked: true \}\);/.test(setup), true);
check('place names stay in the line above, as today', /CR\.givenLine\(S\.catalog\.filter\(function \(l\) \{ return !l\.required; \}\)\)/.test(setup), true);
check('and are still sent with the build', /S\.catalog\.filter\(CR\.isGiven\)\.forEach\(function \(l\) \{ S\.picked\[l\.id\] = true; \}\);/.test(setup), true);
check('nothing else is pre-ticked', /S\.picked\[l\.id\] = true/g.test(setup) && (setup.match(/S\.picked\[[^\]]+\] = true/g) || []).length, 1);
check('no "recommended" anywhere', /recommend/i.test(page) || /recommend/i.test(setup) || /recommend/i.test(rows), false);
check('the foot names the way back to this list', /You can add any of these later from Owner ▾ → Open data layers\./.test(s3), true);
check('the forward button names the next screen', /<button class="btn" id="next-3">Name it →<\/button>/.test(s3), true);
check('a ticked layer that needs an OK says what happens, once',
  /checked by the LOKA team first, so your atlas waits for a quick OK — usually the same day\./.test(setup), true);

// the shared rows, run as a browser would
const win = {};
vm.runInNewContext(rows, { window: win });
const CR = win.LokaCatalogRows;
const catalog = [
  { id: 'admin', label: 'Admin boundaries', required: true, group: 'base', cost: 'free', estSeconds: 30 },
  { id: 'labels', label: 'Place names', group: 'base', cost: 'free', estSeconds: 1 },
  { id: 'roads', label: 'Roads & streets', group: 'base', cost: 'free' },
  { id: 'buildings', label: 'Buildings', group: 'base', cost: 'free', feasible: false },
  { id: 'places', label: 'Named places (ranges, reserves, wards)', group: 'base', cost: 'free', default: true },
  { id: 'health', label: 'Health facilities', group: 'people', cost: 'free' },
  { id: 'lulc', label: 'Land use / land cover', group: 'eco', cost: 'free' },
  { id: 'floodplain-ndem', label: 'Floodplain (observed inundation)', group: 'eco', cost: 'approval' },
  { id: 'terrain', label: 'Terrain & elevation', group: 'context', cost: 'free' },
  { id: 'access', label: 'Travel time to healthcare', group: 'context', cost: 'free', feasible: false },
];
check('the four groups come in the catalogue\'s order whatever order the layers arrive in',
  CR.groups(catalog).map((g) => g.id), ['base', 'eco', 'context', 'people']);
check('inside a group the rows read A to Z, and one the region is too wide for goes last',
  CR.groups(catalog).map((g) => g.layers.map((l) => l.id)),
  [['places', 'roads', 'buildings'], ['floodplain-ndem', 'lulc'], ['terrain', 'access'], ['health']]);
check('named places is an ordinary row (its catalogue "default" flag is not read)', /\.default\b/.test(setup) || /\.default\b/.test(rows), false);
check('a locked row is ticked, disabled, and says so',
  CR.rowHTML(catalog[0], true, { locked: true }),
  '<input type="checkbox" value="admin" checked disabled /><span><b>Admin boundaries</b> <span class="cost cost-given">always included</span><span class="src"></span></span>');
check('an ordinary row is what it was', CR.rowHTML(catalog[2], false),
  '<input type="checkbox" value="roads" /><span><b>Roads &amp; streets</b><span class="src"></span></span>');
check('a row that needs approval keeps its calm tag and stays tickable', CR.rowHTML(catalog[7], true),
  '<input type="checkbox" value="floodplain-ndem" checked /><span><b>Floodplain (observed inundation)</b><span class="src"> <span class="cost cost-ask">needs approval</span></span></span>');
check('the Owner sheet never asks for a locked row', /CR\.rowHTML\([^)]*locked/.test(owner), false);
check('and the group order is one list, exported', CR.GROUP_ORDER, ['base', 'eco', 'context', 'people']);

// the foot's arithmetic, lifted out and run
const { aboutTime } = new Function(fnFrom(setup, 'aboutTime') + '; return { aboutTime };')();
check('half a minute', aboutTime(31), 'about half a minute');
check('a minute', aboutTime(70), 'about a minute');
check('six minutes', aboutTime(6 * 60 + 12), 'about 6 minutes');
check('the estimate for this width is preferred over the catalogue\'s flat one',
  /Number\(l\.estSecondsHere != null \? l\.estSecondsHere : l\.estSeconds\)/.test(setup), true);
check('the foot reads "N layers · about … to build"',
  /\(picked === 1 \? " layer" : " layers"\)\n\s*: "Nothing chosen yet"\) \+ " · " \+ aboutTime\(pickedSeconds\(\)\) \+ " to build"/.test(setup), true);

console.log('\n  name it: last, and filled in');
const s1 = flow.slice(panelAt('s1'), panelAt('s4'));
check('the heading', /<h2>Name it<\/h2>/.test(s1), true);
check('the two fields', /Atlas name <span class="req">required<\/span>/.test(s1) && /Your organisation or project <span class="req">required<\/span>/.test(s1), true);
check('no description field in the flow', /id="f-desc"/.test(page) || /f-desc/.test(setup), false);
check('and no subtitle in the build request', /subtitle:/.test(setup), false);
// release 2: the logo left the wizard for Settings (see logo-test.mjs)
check('no logo fold on the Name screen any more', /id="logo-fold"/.test(s1) || /id="logo-file"/.test(page), false);
check('and the build request carries only the organisation name', /branding: \{ orgName: \$\("#f-org"\)\.value\.trim\(\) \},/.test(setup) && !/logoData/.test(setup), true);
check('Build is on this screen', /<button class="btn" id="build-go">Build my atlas →<\/button>/.test(s1), true);
check('and checks the name before anything leaves', /\$\("#build-go"\)\.onclick = function \(\) \{\n\s*var btn = this;\n\s*if \(!nameIsComplete\(\)\) return;/.test(setup), true);
check('it says who can see it (truthfully: anyone with the link) and where the logo and description went',
  /Once built, anyone with the link can open it — choose who can see it under\s+Owner ▾\. Add a logo and description later, under Owner ▾ → Settings\./.test(s1), true);
const { plainFileName } = new Function(fnFrom(setup, 'plainFileName') + '; return { plainFileName };')();
check('a file name is made plain', plainFileName('village_survey-2026.csv'), 'Village survey 2026');
check('a dotted one too', plainFileName('wards.final.v2.xlsx'), 'Wards final v2');
check('the name comes from the file, else "<place> atlas"',
  /if \(GEO\.file && GEO\.file\.name\) return plainFileName\(GEO\.file\.name\);\n\s*if \(S\.chosen\.length\) return \(S\.chosen\[0\]\.label \|\| S\.chosen\[0\]\.name\) \+ " atlas";/.test(setup), true);
check('the organisation comes from the account (/auth/me says org), when it has one',
  /if \(!o\.value\.trim\(\) && S\.me && S\.me\.org\) \{ o\.value = S\.me\.org; fromAccount = true; \}/.test(setup), true);
check('a name someone typed is never overwritten', /if \(want && \(!t\.value\.trim\(\) \|\| t\.value === NAME_AUTO\)\)/.test(setup), true);
check('the hint says where the organisation came from, only when it did',
  /\(fromAccount \? "The organisation is filled in from your account\. " : ""\) \+\n\s*"Both show on the map; change either any time\."/.test(setup), true);

check('the waiting screen names the layer being checked, not the region, when that is the reason',
  /asks\.join\(" and "\) \+ \(asks\.length > 1 \? " are" : " is"\) \+ " checked by the LOKA team first\. "\n\s*: "A region this size is checked by the LOKA team first\. "/.test(setup), true);

console.log('\n  the design notes say so');
check('DESIGN.md describes the wizard\'s order', /### The setup wizard \(October 2026, release 1\)/.test(design), true);
check('and the open-data rule', /nothing pre-ticked but the boundaries/.test(design), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
