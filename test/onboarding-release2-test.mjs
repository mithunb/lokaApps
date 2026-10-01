/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Onboarding, release 2 (October 2026): "Here's what we found" after the
   place — the count, the places, a small map, the file's check folded in,
   and the 60% rule on the buttons; a first look on the finished atlas; the
   organisation name and the logo in Settings, the logo gone from the wizard;
   the docs corrected against the code. No server change: Settings uses the
   fast-edit route that already took org, branding.orgName, logoData and
   removeLogo. */

const page = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ownerCss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
const capDoc = fs.readFileSync(ROOT + '/LOKA-ATLAS-CAPABILITIES.md', 'utf8');
const appDoc = fs.readFileSync(ROOT + '/LOKA-APP-AND-ATLAS.md', 'utf8');

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
const s2b = flow.slice(panelAt('s2b'), panelAt('s3'));

console.log('\n  here’s what we found: one screen, for everyone');
check('the heading', /<h2>Here&rsquo;s what we found<\/h2>/.test(s2b), true);
check('it comes after the place and before the open data', panelAt('s2') < panelAt('s2b') && panelAt('s2b') < panelAt('s3'), true);
check('the count is the one big thing: a number, then what it counts',
  /<p class="found-n"><b id="found-num"><\/b> <span id="found-what"><\/span><\/p>/.test(s2b), true);
check('the places are chips, and the map is a plain SVG with a caption',
  /<div class="chips found-chips" id="found-chips">/.test(s2b) &&
  /<figure class="found-map" id="found-map" hidden>\s*<svg viewBox="0 0 400 260" role="img" focusable="false"><\/svg>\s*<figcaption id="found-map-cap">/.test(s2b), true);
check('the setup page loads no map library', /maplibre|leaflet/i.test(page), false);
check('the file check (release 1’s own step) is folded into this screen: the bench sits under the summary',
  s2b.indexOf('id="found-chips"') < s2b.indexOf('id="check-verdict"') && s2b.indexOf('id="check-verdict"') < s2b.indexOf('id="bench"') &&
  s2b.indexOf('id="bench"') < s2b.indexOf('id="found-btns"'), true);
/* the review fixes (October 2026) moved "Choose the places myself" up beside
   the region it changes, and gave Where a plain forward label — see
   onboarding-review-fixes-test.mjs */
check('the two buttons keep their ids; which is green is decided in code',
  /<button class="btn" id="next-2b">Looks right →<\/button>/.test(s2b) &&
  /<button class="btn secondary" id="found-mine">Choose the places myself<\/button>/.test(s2b), true);
check('the forward button on Where is a plain one', /<button class="btn" id="next-2">Continue →<\/button>/.test(flow), true);
check('Where goes here whether or not there is a file',
  /\$\("#next-2"\)\.onclick = function \(\) \{[\s\S]*?msg\(2, ""\);\n\s*showFound\(\);\n\s*\};/.test(setup), true);
check('a typed region gets the screen without a check to run',
  /if \(!GEO\.canonical\) \{ stopBench\(\); paintFound\(\); return; \}/.test(setup), true);
check('the count is the region-finding’s until the check settles, then the check’s',
  /what\.textContent = FOUND\.settled \? "rows are on the map" : "rows name a place we know";/.test(setup) &&
  /FOUND\.placed = Math\.min\(sum\.features \|\| 0, FOUND\.rows\);/.test(setup), true);
check('the map is drawn from what the region-finding already sent (outlines) and the file’s own coordinates',
  /var units = \(\(GEO\.infer && GEO\.infer\.units\) \|\| \[\]\)\.filter/.test(setup) && /var pts = \(GEO\.canonical && GEO\.points\) \|\| \[\];/.test(setup), true);
check('the server sends those outlines when there are 60 or fewer places',
  /const units = r\.units\.length <= 60 \? r\.units : r\.units\.map\(\(\{ geometry, \.\.\.u \}\) => u\);/.test(server), true);
check('dots are thinned to the pixel and capped, so a big file stays light',
  /for \(var i = 0; i < pts\.length && drawn < 3000; i\+\+\)/.test(setup) && /var cell = Math\.round\(x\) \+ "," \+ Math\.round\(y\);/.test(setup), true);
check('names go on the map only when there are few enough to read', /if \(units\.length <= 12\) \{/.test(setup), true);
check('on a phone the map drops under the words, no taller than 200px',
  /@media \(max-width:720px\) \{\n\s*\.found \{ grid-template-columns:1fr; \}\n\s*\.found-map svg \{ max-height:200px; \}/.test(page), true);

console.log('\n  the 60% rule');
check('the line is 60%', /var LOW_COVER = 0\.6;/.test(setup), true);
check('under it the buttons swap: choosing the places goes green, continuing goes second',
  /on\.className = \(low \|\| FOUND\.failed\) \? "btn secondary" : "btn";/.test(setup) &&
  /: \(low \|\| FOUND\.failed\) \? "Continue anyway" : "Looks right →";/.test(setup) &&
  /mine\.className = low \? "btn" : "btn secondary";/.test(setup), true);
check('and a line says why', /Fewer than " \+ Math\.round\(LOW_COVER \* 100\) \+ "% of your rows landed in a place we know\./.test(setup), true);
check('the share is the check’s once it has one, else the region-finding’s, and nothing without a file',
  /function foundShare\(\) \{\n\s*if \(!GEO\.canonical \|\| S\.worldwide\) return null;\n\s*if \(FOUND\.settled\) return FOUND\.rows \? FOUND\.placed \/ FOUND\.rows : null;/.test(setup), true);
check('choosing the places myself, under the line, drops the file’s places and keeps the file and anything typed',
  /if \(low && \(GEO\.addedIds \|\| \[\]\)\.length\) \{\n\s*S\.chosen = S\.chosen\.filter\(function \(c\) \{ return GEO\.addedIds\.indexOf\(c\.id\) < 0; \}\);/.test(setup) &&
  /stays with the atlas and is checked again against what you choose\./.test(setup), true);
check('above the line the same button only goes back, and reads "Change the places" for a typed region',
  /mine\.textContent = GEO\.canonical \? "Choose the places myself" : "Change the places";/.test(setup), true);
// the words, run as the page would run them
const { placeList } = new Function(fnFrom(setup, 'placeList') + '; return { placeList };')();
check('one place', placeList(['Mysuru']), 'Mysuru');
check('two', placeList(['Mysuru', 'Kodagu']), 'Mysuru and Kodagu');
check('four', placeList(['A', 'B', 'C', 'D']), 'A, B, C and D');
check('many', placeList(['A', 'B', 'C', 'D', 'E', 'F']), 'A, B, C and 3 more');

console.log('\n  the first look, on the finished atlas');
check('the wizard leaves the numbers for it in the browser and flags the address once',
  /localStorage\.setItem\("loka-first-look", JSON\.stringify\(look\)\)/.test(setup) &&
  /var go = "\.\.\/\?dataset=" \+ encodeURIComponent\(S\.slug\) \+ "&built=1";/.test(setup), true);
check('a file that could not be added is not counted as placed', /look\.added = false; look\.placed = 0; look\.open = 0; keepLook\(\);/.test(setup), true);
check('the atlas shows it once and takes the flag off the address',
  /if \(\/\(\^\|\[\?&\]\)built=1\/\.test\(location\.search\)\) \{\n\s*history\.replaceState\(null, "", location\.pathname \+ "\?dataset=" \+ encodeURIComponent\(SLUG\)\);\n\s*firstLook\(\);/.test(owner), true);
check('it is the owner’s (owner.js), not the viewer’s', /firstLook|own-first|loka-first-look/.test(viewer), false);
check('the numbers are read once and cleared', /localStorage\.removeItem\("loka-first-look"\);/.test(owner), true);
check('and only trusted for this atlas', /if \(!look \|\| look\.slug !== SLUG\) look = \{/.test(owner), true);
check('it says what was built, what of the file is on the map, and what still needs a place, with the way to fix it',
  /"Boundaries and place names" \+ \(where \? " for " \+ where : ""\)/.test(owner) &&
  /rows from " \+ look\.file \+ " are on the map\."/.test(owner) &&
  /add it again under Your data<\/a>/.test(owner) && /\.\/add-data\/\?dataset=/.test(owner), true);
check('its two acts are the Owner menu’s own', /id="own-first-live">Make it live</.test(owner) && /id="own-first-open">Add open data</.test(owner) &&
  /openOpenData\(\); \};/.test(owner) && /\{ shut\(\); toggleLive\(\); \}/.test(owner), true);
check('× and Esc put it away', /if \(e\.key === "Escape"\) shut\(\);/.test(owner) && /\.own-first-x"\)\.onclick = shut;/.test(owner), true);
check('it docks where the place card docks, and spans the map on a phone',
  /\.own-first \{\n\s*position:absolute; top:8px; right:8px;/.test(ownerCss) && /width:340px;/.test(ownerCss) &&
  /@media \(max-width:720px\) \{\n\s*\.own-first \{ top:8px; right:8px; left:8px; width:auto; \}/.test(ownerCss), true);

console.log('\n  the organisation name and the logo, in Settings');
check('Settings asks for the organisation', /<label class="own-fld">Your organisation or project/.test(owner) && /id="own-org"/.test(owner), true);
check('and for the logo, with change and remove', /id="own-logo-add"/.test(owner) && /id="own-logo-change"/.test(owner) && /id="own-logo-remove"/.test(owner), true);
check('an empty organisation is refused before anything is sent',
  /if \(!org\) \{ err\.textContent = "Name the organisation or project this atlas belongs to\."; /.test(owner), true);
check('a changed logo counts as unsaved work', /scrim\.__logo !== undefined;\n\s*\}/.test(owner), true);
check('the reboot is told the files changed, or the browser would keep showing the old logo',
  /if \(scrim\.__logo !== undefined && window\.LokaAtlas\.dataChanged\) window\.LokaAtlas\.dataChanged\(\);/.test(owner), true);
check('the route reads org and branding.orgName, and defaults the one to the other',
  /const org = has\('org'\) \? cap\(b\.org, 60\) : \(inst\.org \|\| ''\);/.test(server) &&
  /orgName: hasB\('orgName'\) \? \(cap\(bb\.orgName, 60\) \|\| org\) : \(curB\.orgName \|\| org\),/.test(server), true);
check('the header draws the organisation name and logo from the manifest, which the route rewrites',
  /function renderBranding\(b\)/.test(viewer) && /rewriteManifest\(updated\);/.test(server) && /if \(b\.hasLogo\) bset\.logo = 'branding-logo\.png';/.test(server), true);
check('the wizard’s Name screen has no logo fold and says where it went',
  !/logo-fold/.test(page) && /Add a logo and description\s+later, under Owner ▾ → Settings\./.test(page), true);
check('the Owner menu line still promises the logo', /Title, logo, about<\/span>/.test(owner), true);

console.log('\n  the docs say what the code does');
check('the area rule: the 6 / 40 square-degree ceiling is stated nowhere as current (only as gone)',
  /Above \*\*6 square degrees\*\*|Above \*\*40 square degrees\*\*|Region ceiling — approval|Region ceiling — refusal/.test(capDoc) ||
  /Above \*\*40 square degrees\*\*|Above 6 square degrees a build/.test(appDoc), false);
check('the approval rule is any approval layer or a build over 270 s, and that is what the code does',
  /estimated build is over 270 seconds/.test(capDoc) && /over 270 seconds/.test(appDoc) &&
  /const BUILD_BUDGET_S = 9 \* 60;/.test(server) && /const largeRegion = buildSeconds > BUILD_BUDGET_S \/ 2;/.test(server) &&
  /const needsApproval = heavy \|\| buildSeconds > BUILD_BUDGET_S \/ 2;/.test(server), true);
check('unbuildable layers are dropped and named, and the docs say so',
  /dropped from the build and named in the answer/.test(capDoc) && /dropped from the build and named in the answer/.test(appDoc) &&
  /droppedLabels: dropped\.map/.test(server), true);
check('the AI limits are 150 / 40 / 24, in the code and the docs',
  /const AI_CALLS_PER_HOUR = 150;/.test(server) && /const AI_CALLS_PER_HOUR_IP = 40;/.test(server) && /const AI_CALLS_PER_READING = 24;/.test(server) &&
  /150 model calls per rolling hour for a\s+signed-in account/.test(capDoc) && /150 per signed-in account; 40 per internet address signed out; 24 per reading/.test(capDoc) &&
  !/30 model calls per internet address/.test(capDoc) && !/\| 30 \(with two holes/.test(capDoc), true);
check('keys are rows beside the pin, not corner badges', /one row of small marks beside the pin/.test(capDoc) &&
  !/sit at the pin's four corners|corners are all taken|corner badges/.test(capDoc) &&
  /var ROW_SHAPES = \["circle", "square", "triangle", "diamond", "bar"\];/.test(viewer), true);
check('the 85% rule is in the code and the docs', /var KEY_DOMINANCE = 0\.85;/.test(viewer) && /counts\[0\]\.n \/ feats\.length > KEY_DOMINANCE\) return;/.test(viewer) &&
  /no single answer may cover more than 85% of the places/.test(capDoc), true);
check('DESIGN.md describes the release', /### The setup wizard, release 2 \(October 2026\)/.test(design) && /The first look/.test(design) && /The logo lives in Settings/.test(design), true);

console.log('\n  the first look counts what is drawn, not what was hoped for');
check('it counts the owner\'s own rows from the layers themselves', /function rowsOnMap\(\)[\s\S]{0,400}A\.dataFor\(L\.id\)/.test(owner), true);
check('the drawn count wins over the wizard\'s matched count', /if \(look\.file && look\.added && look\.rows && drawn != null\) look\.placed = Math\.min\(look\.rows, drawn\);/.test(owner), true);
check('and a file that placed nothing says so', /could be put on the map yet\./.test(owner), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
