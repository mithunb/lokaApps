/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Crediting a shape somebody else published.
 *
 * A row saying "Western Ghats" gets the outline of the Western Ghats drawn for
 * it, and that outline came from a mountain inventory. For a while the outline
 * was drawn and the inventory was named nowhere a reader could see — the credit
 * lived on the shape, and nothing carried it from the shape to the page.
 *
 * Worse in the OpenStreetMap case, where the licence asks for a notice as well
 * as a thank-you. The notice was raised by looking for OpenStreetMap among the
 * layer credits, so a layer that said nothing about where its shapes came from
 * suppressed the notice too.
 *
 * No network, no disk beyond the product's own files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ------------------------------------------------------------------ *
 * The page. buildCredits is lifted out and run for real against stand-ins
 * for the page and the manifest, so these watch behaviour and not wording.
 * ------------------------------------------------------------------ */
const start = src.indexOf('\n  function buildCredits(');
if (start < 0) throw new Error('buildCredits not found in atlas.js');
const body = src.slice(start, src.indexOf('\n  }\n', start) + 5);

function paint(MANIFEST) {
  const make = () => ({ innerHTML: '', textContent: '', hidden: true });
  const page = {
    '#data-credits': make(), '#contrib-credits': make(), '#contrib-list': make(),
    '#walk-credits': make(), '#walk-list': make(), '#walk-head': make(),
    '#odbl-note': make()
  };
  const $ = (s) => page[s] || null;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  new Function('$', 'esc', 'MANIFEST', body + '\n buildCredits();')($, esc, MANIFEST);
  return page;
}

/* What an atlas always carries: the basemap, which is OpenStreetMap tiles. */
const BASE = [
  { name: 'Esri World Imagery', note: 'Satellite basemap & place labels' },
  { name: 'OpenStreetMap contributors & CARTO', note: 'Map basemap', license: 'ODbL' }
];

/* A layer made by joining rows to borrowed outlines. */
const BORROWED = {
  id: 'where-people-work', label: 'Where the respondents work',
  attribution: 'GMBA Mountain Inventory v2.0; National Tiger Conservation Authority',
  credits: [
    { name: 'GMBA Mountain Inventory v2.0', note: 'Shapes joined to this layer', license: 'CC BY 4.0' },
    { name: 'National Tiger Conservation Authority', note: 'Shapes joined to this layer' }
  ]
};

console.log('\n  a layer that borrowed its shapes names who published them');
let p = paint({ attributions: BASE.slice(), layers: [BORROWED] });
check('the mountain inventory reaches the page',
  /GMBA Mountain Inventory v2\.0/.test(p['#data-credits'].innerHTML), true);
check('so does the reserve register',
  /National Tiger Conservation Authority/.test(p['#data-credits'].innerHTML), true);
check('with the licence beside it',
  /CC BY 4\.0/.test(p['#data-credits'].innerHTML), true);
check('and the basemap is still there',
  /Esri World Imagery/.test(p['#data-credits'].innerHTML), true);

console.log('\n  a source is named once, however many ways it reaches the page');
p = paint({
  attributions: [{ name: 'GMBA Mountain Inventory v2.0', note: 'Mountain ranges' }, ...BASE],
  layers: [BORROWED, { id: 'b', credits: [{ name: 'GMBA Mountain Inventory v2.0' }] }]
});
check('the inventory appears exactly once',
  (p['#data-credits'].innerHTML.match(/GMBA Mountain Inventory/g) || []).length, 1);
check('the first mention wins, so the built atlas keeps its own wording',
  /Mountain ranges/.test(p['#data-credits'].innerHTML), true);

console.log('\n  an atlas with no borrowed shapes is unchanged');
p = paint({ attributions: BASE.slice(), layers: [{ id: 'districts', label: 'Districts' }] });
check('only the sources it was built from',
  (p['#data-credits'].innerHTML.match(/<li>/g) || []).length, 2);

/* ------------------------------------------------------------------ *
 * The Open Database Licence notice.
 * ------------------------------------------------------------------ */
console.log('\n  the licence notice follows the data, not the basemap');

p = paint({ attributions: BASE.slice(), layers: [{ id: 'districts', label: 'Districts' }] });
check('a map that only SHOWS OpenStreetMap underneath says nothing',
  p['#odbl-note'].hidden, true);

p = paint({
  attributions: BASE.slice(),
  layers: [{ id: 'w', label: 'Wards', attribution: '© OpenStreetMap contributors' }]
});
check('a boundary layer built from OpenStreetMap raises it',
  p['#odbl-note'].hidden, false);

p = paint({
  attributions: BASE.slice(),
  layers: [{
    id: 'mine', label: 'My data',
    credits: [{ name: '© OpenStreetMap contributors', license: 'ODbL 1.0' }]
  }]
});
check('and so does somebody’s own data joined to an OpenStreetMap outline',
  p['#odbl-note'].hidden, false);
check('which is the case that used to slip through',
  /Open Database Licence/.test(p['#odbl-note'].innerHTML), true);

p = paint({ attributions: BASE.slice(), layers: [BORROWED] });
check('a map whose borrowed shapes came from elsewhere says nothing',
  p['#odbl-note'].hidden, true);

/* ------------------------------------------------------------------ *
 * The server side. These read the source rather than run a join, which
 * needs a whole import session — so they check the wiring is present,
 * not that it fires. The join itself is watched on a real atlas.
 * ------------------------------------------------------------------ */
console.log('\n  the wiring that carries a credit off the shape (source, not behaviour)');
check('a match target carries who published it',
  /credit: f\.properties\.credit \? String\(f\.properties\.credit\) : ''/.test(server), true);
check('and under what terms',
  /licence: f\.properties\.licence \? String\(f\.properties\.licence\) : ''/.test(server), true);
check('placing a row records the source it borrowed from',
  /borrowedFrom\.set\(target\.credit/.test(server), true);
check('only sources actually drawn are recorded',
  /if \(target\.credit && !borrowedFrom\.has\(target\.credit\)\)/.test(server), true);
check('and the finished layer carries them',
  /frag\.stanza\.credits = \[\.\.\.borrowedFrom\]/.test(server), true);

const places = fs.readFileSync(ROOT + '/api/atlas-builders/places.py', 'utf8');
check('a fetched shape remembers which source it came from',
  /"source": entry\.get\("source"\)/.test(places), true);
const recipes = fs.readFileSync(ROOT + '/api/atlas-builders/recipes.py', 'utf8');
check('the named-places layer reports what it used',
  /"credits": credit_rows/.test(recipes), true);
const build = fs.readFileSync(ROOT + '/api/atlas-builders/build_dataset.py', 'utf8');
check('and the atlas folds that into its own list',
  /for row in \(lyr\.get\("credits"\) or \[\]\)/.test(build), true);

console.log('\n  re-committing a layer does not drop whose shapes they are');
/* Credits are worked out while rows are joined to borrowed outlines. Reopening
   a layer to fix its wording skips that — the shapes are already there, so
   there is nothing to join — and the credits would have gone. Re-committing to
   fix a label would have quietly stopped naming the mountain inventory, the
   reserve register and OpenStreetMap as the source of the outlines drawn. */
check('reopening a layer picks up the credits it already carries',
  /replacingCredits: layer\.credits \|\| null,/.test(server), true);
check('and its attribution line', /replacingAttribution: layer\.attribution \|\| '',/.test(server), true);
check('a replace keeps them when the new reading cannot work them out',
  /if \(!frag\.stanza\.credits && session\.replacingCredits && session\.replacingCredits\.length\)/.test(server), true);
check('but a reading that DID work them out wins, having looked at the data',
  /A reading that DID work\s*\n\s*them out wins/.test(server), true);
check('the other replace path carries them too',
  /replacingCredits: replacing \? replacing\.credits : undefined,/.test(server), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
