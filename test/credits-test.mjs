/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Who gets named at the foot of an atlas. No network. */
import fs from 'node:fs';
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');

const start = src.indexOf('\n  function buildCredits(');
if (start < 0) throw new Error('buildCredits not found in atlas.js');
const body = src.slice(start, src.indexOf('\n  }\n', start) + 5);

/* Stand-ins for the four things buildCredits reaches for: the page, the
   escaper, and the manifest. Enough to watch what it writes. */
function paint(MANIFEST) {
  const make = () => ({ innerHTML: '', textContent: '', hidden: true });
  const page = {
    '#data-credits': make(), '#contrib-credits': make(), '#contrib-list': make(),
    '#walk-credits': make(), '#walk-list': make(), '#walk-head': make()
  };
  page['#walk-head'].textContent = 'Tagged on foot by';
  const $ = (s) => page[s] || null;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  new Function('$', 'esc', 'MANIFEST', body + '\n buildCredits();')($, esc, MANIFEST);
  return page;
}

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* The six who walked Cubbon Park, in the order the manifest sets. */
const CUBBON = ['Ekansh Prasad', 'Malavika Nair', 'Manoj Kurien',
  'Mithun Sheshagiri', 'Smriti Tiwari', 'Srinivas Mangipudi'];

console.log('\n  the people who walked the ground are named');
let p = paint({ taggedBy: CUBBON, layers: [] });
check('their line is shown', p['#walk-credits'].hidden, false);
check('all six are there', (p['#walk-list'].innerHTML.match(/walk-name/g) || []).length, 6);
check('in the order given, not re-sorted',
  p['#walk-list'].innerHTML.replace(/<[^>]*>/g, ''), CUBBON.join(', '));
check('and the heading is left alone', p['#walk-head'].textContent, 'Tagged on foot by');

console.log('\n  an atlas with nobody recorded says nothing');
p = paint({ layers: [] });
check('the line stays away', p['#walk-credits'].hidden, true);
check('and nothing is written into it', p['#walk-list'].innerHTML, '');

console.log('\n  the heading can be changed by whoever owns the atlas');
p = paint({ taggedBy: { heading: 'Surveyed by', people: ['Anita Rao'] }, layers: [] });
check('it says what they were asked to say', p['#walk-head'].textContent, 'Surveyed by');
check('and the one name is there', p['#walk-list'].innerHTML.replace(/<[^>]*>/g, ''), 'Anita Rao');

console.log('\n  a name is printed as written, not as markup');
p = paint({ taggedBy: ['A & B <script>'], layers: [] });
check('the ampersand and brackets are made safe',
  p['#walk-list'].innerHTML, '<span class="walk-name">A &amp; B &lt;script&gt;</span>');

console.log('\n  sources still work, and no longer gate the rest');
p = paint({ attributions: [{ name: 'OpenStreetMap', url: 'https://osm.org', license: 'ODbL' }], taggedBy: CUBBON, layers: [] });
check('a source is listed', /OpenStreetMap/.test(p['#data-credits'].innerHTML), true);
/* This is the fault the change had to avoid: buildCredits used to give up
   entirely when an atlas had no attributions, which would have taken the
   people down with it. */
p = paint({ taggedBy: CUBBON, layers: [] });
check('people show even with no sources at all', p['#walk-credits'].hidden, false);

console.log('\n  a contributed layer is still credited to whoever added it');
p = paint({ layers: [{ id: 'x', label: 'Ponds', addedBy: { org: 'Biome' } }] });
check('the block opens', p['#contrib-credits'].hidden, false);
check('and names them', /added by Biome/.test(p['#contrib-list'].innerHTML), true);

console.log('\n  the names survive the atlas being rebuilt');
/* They are written into the owner's overlay, which a rebuild does not touch —
   so the merge has to carry them across. */
check('the overlay carries them over',
  /if \(local\.taggedBy\) manifest\.taggedBy = local\.taggedBy;/.test(src), true);

console.log('\n  and the page has somewhere to put them');
check('the block is in the page', /<div id="walk-credits" hidden>/.test(html), true);
check('with a heading of the same kind as its neighbour',
  /<h3 class="contrib-head" id="walk-head">Tagged on foot by<\/h3>/.test(html), true);
check('and a line to write into', /<p id="walk-list"><\/p>/.test(html), true);
check('the names are styled', /#walk-list \.walk-name \{/.test(html), true);
check('a name does not break across two lines',
  /#walk-list \.walk-name \{[^}]*white-space:nowrap/.test(html), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
