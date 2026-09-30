/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An owner can add or remove open-data layers after the atlas is built, and a
   rebuild keeps what is theirs. No network. */
import { CONTRIBUTED, carryContributed } from '../api/lib/atlas/jobs.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const owner = read('atlas/owner.js');
const ownerCss = read('atlas/owner.css');
const setup = read('atlas/setup/setup.js');
const setupHtml = read('atlas/setup/index.html');
const rows = read('atlas/catalog-rows.js');
const server = read('api/apps/atlas.js');
const viewer = read('atlas/atlas.js');
const design = read('DESIGN.md');

console.log('\n  the line in the Owner menu');
check('it is there, between the region and your data',
  /id="own-panel-region"><\/div>' \+\s*'<div class="own-panel-ln" id="own-panel-open">/.test(owner), true);
check('it says what it is about', /<span class="own-panel-k">Open data layers<\/span>/.test(owner), true);
check('and the one act on it', /id="own-open-data" type="button">Add or remove<\/button>/.test(owner), true);
check('pressing it opens the sheet', /\$\("#own-open-data"\)\.onclick = function \(\) \{ openOpenData\(\); \};/.test(owner), true);
check('and puts the menu away first', /closest\("#own-settings, #own-region, #own-open-data, #add-data-btn"\)/.test(owner), true);
check('the button names it for a screen reader', /open data layers, add data, settings/.test(owner), true);
check('DESIGN.md lists the line', /\*\*Open data layers\*\* · Add or remove/.test(design), true);

console.log('\n  only the owner sees any of it');
/* owner.js is fetched by the viewer only once the API has said the caller may
   edit; a visitor never loads it, so the menu — and this line — do not exist
   for them. The server checks again on the rebuild itself. */
check('the viewer fetches owner.js only for someone who may edit',
  /if \(!inst \|\| !inst\.canEdit\) return;[\s\S]*?loadOwnerTools\(inst\)/.test(viewer) ||
  /inst\.canEdit[\s\S]{0,400}loadOwnerTools\(inst\)/.test(viewer), true);
check('the rebuild route refuses anyone else',
  /router\.post\('\/instances\/:slug\/rebuild'[\s\S]{0,300}if \(!callerCanEdit\(req, inst\)\) return res\.status\(403\)/.test(server), true);

console.log('\n  the sheet is the wizard\'s step 3, from one shared piece');
check('the words and rows live in catalog-rows.js', /window\.LokaCatalogRows = \{/.test(rows), true);
check('the wizard includes it', /<script src="\.\.\/catalog-rows\.js\?v=dev"><\/script>/.test(setupHtml), true);
check('and draws its rows from it', /lab\.innerHTML = CR\.rowHTML\(l, !!S\.picked\[l\.id\]\);/.test(setup), true);
check('the wizard no longer carries its own copy of the tag', /needs approval/.test(setup), false);
check('nor of the group names', /Ecological landscape/.test(setup), false);
check('owner.js draws its rows from the same piece', /lab\.innerHTML = CR\.rowHTML\(l, !!OD\.picked\[l\.id\]\);/.test(owner), true);
check('and fetches it the first time the sheet opens', /s\.src = "\.\/catalog-rows\.js\?v=" \+/.test(owner), true);
check('the tag is written once, in the shared piece', (rows.match(/cost-ask">needs approval/g) || []).length, 1);
check('the sheet has the wizard\'s row styling', /\.own-od \.cat-row \.cost-ask \{ background:var\(--color-sindoor-tint\)/.test(ownerCss), true);

// run the shared piece as a browser would and read what it says
const win = {};
vm.runInNewContext(rows, { window: win });
const CR = win.LokaCatalogRows;
const catalog = [
  { id: 'admin', label: 'Admin boundaries', required: true, group: 'base', cost: 'free' },
  { id: 'labels', label: 'Place names', group: 'base', cost: 'free' },
  { id: 'rivers-wris', label: 'Rivers', info: 'Rivers for your region.', group: 'eco', cost: 'free' },
  { id: 'floodplain-ndem', label: 'Flood plains', info: 'Where floods reach.', group: 'eco', cost: 'approval' },
  { id: 'terrain', label: 'Terrain', info: 'Hills & slopes.', group: 'context', cost: 'free', feasible: false },
  { id: 'health', label: 'Health centres', info: '<b>PHCs</b>', group: 'people', cost: 'free' },
];
check('what every atlas gets is said in plain words',
  CR.givenLine(catalog), 'Included in every atlas: <b>your region’s boundaries</b> and <b>place names</b>. Sources are credited on the map.');
// release 1 (October 2026): A to Z inside a group, so the order carries no opinion
check('the given layers are not offered as a choice, and the rest read A to Z',
  CR.groups(catalog).map((g) => g.layers.map((l) => l.id)), [['floodplain-ndem', 'rivers-wris'], ['terrain'], ['health']]);
check('groups carry their plain names', CR.groups(catalog).map((g) => g.label),
  ['Ecological landscape', 'Context & infrastructure', 'People & services']);
check('a ticked free layer', CR.rowHTML(catalog[2], true),
  '<input type="checkbox" value="rivers-wris" checked /><span><b>Rivers</b><span class="src">Rivers for your region.</span></span>');
check('a heavy layer says it needs approval', /<span class="cost cost-ask">needs approval<\/span>/.test(CR.rowHTML(catalog[3], false)), true);
check('one the region is too wide for cannot be ticked',
  /disabled \/>[\s\S]*too wide an area for this one/.test(CR.rowHTML(catalog[4], true)) && !/checked/.test(CR.rowHTML(catalog[4], true)), true);
check('the description is text, never markup', /&lt;b&gt;PHCs&lt;\/b&gt;/.test(CR.rowHTML(catalog[5], false)), true);
check('needsApproval reads the cost', [CR.needsApproval(catalog[2]), CR.needsApproval(catalog[3])], [false, true]);

console.log('\n  the sheet, from the owner\'s side');
check('it is pre-ticked with what the atlas has', /OD\.picked\[l\.id\] = CR\.isGiven\(l\) \|\| OD\.have\.indexOf\(l\.id\) >= 0;/.test(owner), true);
check('the groups it already draws from are open', /d\.open = g\.layers\.some\(function \(l\) \{ return OD\.have\.indexOf\(l\.id\) >= 0; \}\);/.test(owner), true);
check('the catalogue is asked with the region\'s width, like the wizard',
  /api\("catalog\?iso3=" \+ encodeURIComponent\(iso3\) \+ \(area > 0 \? "&areaDeg2=" \+ area\.toFixed\(3\) : ""\)\)/.test(owner), true);
check('it says what Apply would do', /bits\.push\("Adding " \+ d\.addNames\.join\(", "\)\)/.test(owner) && /bits\.push\("Taking off " \+ d\.dropNames\.join\(", "\)\)/.test(owner), true);
check('and that a heavy layer is checked first', /heavy to build, so the LOKA team checks first/.test(owner), true);
check('Apply is quiet until something changed', /sum\.textContent = "No changes yet\."; btn\.disabled = true;/.test(owner), true);
check('it sends only layers, never a region', /method: "POST", body: \{ layers: d\.want \}/.test(owner), true);
check('taking a layer off asks first', /"Take " \+ d\.dropNames\.join\(", "\) \+ " off the map\? "/.test(owner), true);
check('and says what stays', /Your own data layers stay as they are\./.test(owner), true);
check('adding alone does not ask', /if \(!d\.drop\.length\) \{ send\(\); return; \}/.test(owner), true);
check('the promise it makes is the one the build keeps',
  /your own data, About text and logo are kept/.test(owner), true);

console.log('\n  waiting for approval');
check('the API is asked before anything is promised', /if \(r && r\.pendingApproval\) \{[\s\S]{0,200}INST\.status = "pending-approval";/.test(owner), true);
check('the menu line says so', /if \(waitingForLayers\(\)\) \{ act\.textContent = "Waiting for approval"; return; \}/.test(owner), true);
check('the sheet says what was asked for instead of offering ticks',
  /textContent = "You asked to " \+ \(bits\.join\(" and "\) \|\| "rebuild"\)/.test(owner), true);
check('and that the atlas carries on as it is', /The atlas carries on exactly as it is until then, and your data stays where it is\./.test(owner), true);
check('while a rebuild runs the line says so and cannot be pressed',
  /act\.textContent = "Rebuilding…"; act\.disabled = true;/.test(owner), true);

console.log('\n  an atlas the wizard did not build');
check('is told from the record, not from a name', /function wizardBuilt\(\) \{[\s\S]*?Array\.isArray\(INST\.layers\) && INST\.layers\.length/.test(owner), true);
check('no atlas is named', /deoria/i.test(owner.slice(owner.indexOf('function wizardBuilt()'), owner.indexOf('function paintOpenDataLine()'))), false);
check('an atlas with no region at all still counts', /r\.worldwide \|\| \(Array\.isArray\(r\.shapeIDs\) && r\.shapeIDs\.length\)/.test(owner), true);
check('the line explains rather than hides', /note\.textContent = "Made by hand — can’t be changed here";/.test(owner), true);
check('and the sheet will not open', /function openOpenData\(\) \{\s*if \(!wizardBuilt\(\)\) return;/.test(owner), true);
check('DESIGN.md says so', /Made by hand — can't be changed here/.test(design), true);

console.log('\n  what a rebuild keeps — the server');
const rebuild = server.slice(server.indexOf("router.post('/instances/:slug/rebuild'"), server.indexOf("router.delete('/instances/:slug'"));
check('the title, blurb and About text travel in the spec', /title: inst\.title, subtitle: inst\.subtitle, about: inst\.about, branding,/.test(rebuild), true);
check('the logo is read back into the spec', /branding\.logoData = 'data:image\/png;base64,' \+ fs\.readFileSync\(logoPath\)/.test(rebuild), true);
check('layers not sent means the layers it has', /b\.layers\.map\(String\) : priorLayers/.test(rebuild), true);
check('a region not sent means the region it has', /: \{ iso3: cur\.iso3 \|\| '', level: cur\.level, shapeIDs: cur\.shapeIDs \|\| \[\] \}/.test(rebuild), true);
check('an atlas with no region keeps having none', /const worldwide = !regionSent && !!cur\.worldwide;/.test(rebuild), true);
check('boundaries stay compulsory where there is a region', /if \(!worldwide\) \{\s*for \(const l of allowed\.values\(\)\) if \(l\.required/.test(rebuild), true);
check('the answer says which layers it will build', /res\.json\(\{ ok: true, jobId, slug: inst\.slug, wasPublished, layers: layerIds, change,/.test(rebuild), true);
check('the prior record is kept for every rebuild, not only one that waits',
  /rebuildPrior: \{ status: inst\.status, tier: inst\.tier, region: inst\.region,\s*regionLabel: inst\.regionLabel, layers: priorLayers, change \},/.test(rebuild), true);
check('a failed rebuild puts the record back', /reg\.updateInstance\(job\.slug, rebuildFailedPatch\(inst, job\.message\)\);/.test(server), true);
check('so does one stranded by a restart', /const patch = rebuildFailedPatch\(inst, job\.message\);/.test(server), true);
check('and a finished one lets go of it', /rebuildKeepPublished: undefined, rebuildPrior: undefined, failReason: undefined,/.test(server), true);
check('a change of layers is not called a widening',
  /subject: `\[LOKA Atlas\] \$\{layersOnly \? 'layer change' : 'widen request'\}: \$\{inst\.title\}`/.test(rebuild), true);
check('the owner is told which it was', /Some of that is heavy to build, so the LOKA team takes a quick look first/.test(rebuild), true);
check('and a denial names what was asked', /subject: `\[LOKA Atlas\] \$\{layersOnly \? 'layers not changed' : 'not widened'\}: \$\{inst\.title\}`/.test(server), true);

console.log('\n  what a rebuild keeps — the files');
const keep = ['manifest.local.json', 'user-people.geojson', 'user-wells-2.geojson', 'categories.local.json',
  'search.local.json', 'search-people.vec', 'branding-logo.png'];
const drop = ['manifest.json', 'admin.geojson', 'rivers-wris.geojson', 'style.json', 'user_people.geojson', 'user-people.geojson.tmp'];
check('the owner\'s files are the ones carried', keep.filter((n) => !CONTRIBUTED.some((re) => re.test(n))), []);
check('the built ones are not — the fresh build has them', drop.filter((n) => CONTRIBUTED.some((re) => re.test(n))), []);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-carry-'));
try {
  const from = path.join(tmp, 'old'), to = path.join(tmp, 'new');
  fs.mkdirSync(from); fs.mkdirSync(to);
  for (const n of keep.concat(drop)) fs.writeFileSync(path.join(from, n), 'old ' + n);
  fs.mkdirSync(path.join(from, '.history'));
  // the fresh build already wrote these; the built file wins
  fs.writeFileSync(path.join(to, 'manifest.json'), 'new manifest');
  fs.writeFileSync(path.join(to, 'branding-logo.png'), 'new logo');
  const job = { log: [] };
  carryContributed(from, to, job);
  const after = fs.readdirSync(to).sort();
  check('everything of the owner\'s is in the new build', keep.filter((n) => !after.includes(n)), []);
  check('nothing of the old base build came along', drop.filter((n) => after.includes(n) && n !== 'manifest.json'), []);
  check('the builder\'s own manifest is the one kept', fs.readFileSync(path.join(to, 'manifest.json'), 'utf8'), 'new manifest');
  check('a logo the builder re-emitted is left alone', fs.readFileSync(path.join(to, 'branding-logo.png'), 'utf8'), 'new logo');
  check('a data layer arrives whole', fs.readFileSync(path.join(to, 'user-people.geojson'), 'utf8'), 'old user-people.geojson');
  check('the job log says how many', job.log.some((l) => /kept 6 contributed file\(s\) across the rebuild/.test(l)), true);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
