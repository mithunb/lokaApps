/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Building the controls twice leaves what building them once does (October
 * 2026). The map button (Map or satellite) and its small sheet live on the
 * stage itself, outside the panel and the strip. Each redraw (the owner saving
 * Settings, a draft preview) clears the panel and the strip, but not the
 * stage, so without dropMovedPieces a redraw left one more map button every
 * time: 1, 2, 3 — exactly what the Map/Satellite switch did in the phone's
 * sheet foot before it. These checks lift the real dropMovedPieces and
 * placeStripPieces out of atlas.js and run a redraw three times against a
 * small stand-in for the page, at phone width and at desktop width. No
 * network, no browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function liftBlock(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error('not found: ' + start);
  const j = src.indexOf(end, i);
  return src.slice(i, j + end.length) + '\n';
}

const js = fs.readFileSync(path.join(ROOT, 'atlas/atlas.js'), 'utf8');

/* A page small enough to reason about: elements with a class, an id, children,
   and the selectors these two functions use (".a", "#id", "#id .a"). */
class El {
  constructor(cls, id) { this.className = cls || ''; this.id = id || ''; this.children = []; this.parentNode = null; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const k = ref ? this.children.indexOf(ref) : -1;
    if (k < 0) this.children.push(c); else this.children.splice(k, 0, c);
    return c;
  }
  removeChild(c) { const k = this.children.indexOf(c); if (k >= 0) this.children.splice(k, 1); c.parentNode = null; return c; }
  clear() { this.children.slice().forEach((c) => this.removeChild(c)); }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  has(cls) { return this.className.split(' ').includes(cls); }
}
function makePage() {
  const root = new El('root');
  const stage = root.appendChild(new El('atlas-stage'));
  const strip = stage.appendChild(new El('atlas-strip'));
  const sheet = stage.appendChild(new El('atlas-panel', 'atlas-panel'));
  const controls = sheet.appendChild(new El('', 'atlas-controls'));
  const match = (e, sel) => sel[0] === '#' ? e.id === sel.slice(1) : e.has(sel.slice(1));
  const qsa = (sel) => {
    const parts = sel.split(' ');
    let pool = root.all();
    if (parts.length === 2) { const scope = pool.find((e) => match(e, parts[0])); pool = scope ? scope.all() : []; }
    return pool.filter((e) => match(e, parts[parts.length - 1]));
  };
  const document = {
    querySelector: (s) => qsa(s)[0] || null,
    querySelectorAll: (s) => qsa(s),
    getElementById: (id) => qsa('#' + id)[0] || null,
  };
  return { root, stage, strip, controls, document };
}

const code =
  liftBlock(js, '  var MOVED_PIECES = ', ';') +
  liftBlock(js, '  function dropMovedPieces() {', '\n  }\n') +
  liftBlock(js, '  function placeStripPieces() {', '\n  }\n') +
  // placeStripPieces also places the search box (placeSearch), which asks onPhone
  'function onPhone() { return window.matchMedia("(max-width: 720px)").matches; }\n' +
  liftBlock(js, '  function placeSearch() {', '\n  }\n');
const make = new Function('document', 'window', '$',
  code + 'return { dropMovedPieces: dropMovedPieces, placeStripPieces: placeStripPieces };');

function run(phone) {
  const page = makePage();
  const window = { matchMedia: () => ({ matches: phone }) };
  const fns = make(page.document, window, (s) => page.document.querySelector(s));
  const counts = [];
  for (let i = 0; i < 3; i++) {
    // what buildControls does with the map button, in its order
    page.controls.clear();
    fns.dropMovedPieces();
    page.strip.clear();
    const btn = new El('map-style-btn'); btn.build = i;
    page.stage.appendChild(btn);
    page.stage.appendChild(new El('map-style-scrim'));
    page.stage.appendChild(new El('map-style-pop'));
    fns.placeStripPieces();
    const found = page.document.querySelectorAll('.map-style-btn');
    const pops = page.document.querySelectorAll('.map-style-pop');
    counts.push([found.length, pops.length, found.map((n) => n.build), found.map((n) => n.parentNode.className)]);
  }
  return counts;
}

console.log('\n  one map button, however often the map is redrawn');
check('buildControls takes the old pieces away before it makes new ones',
  /function buildControls\(\) \{\s*var panel = \$\("#atlas-controls"\);\s*panel\.innerHTML = "";\s*dropMovedPieces\(\);/.test(js), true);
check('the map button, its sheet and its scrim are on the list of pieces outside the panel',
  /var MOVED_PIECES = \["\.map-style-btn", "\.map-style-pop", "\.map-style-scrim"\];/.test(js), true);
check('phone: three redraws leave one button and one sheet each time, the newest, on the stage',
  run(true), [[1, 1, [0], ['atlas-stage']], [1, 1, [1], ['atlas-stage']], [1, 1, [2], ['atlas-stage']]]);
check('desktop: the same',
  run(false), [[1, 1, [0], ['atlas-stage']], [1, 1, [1], ['atlas-stage']], [1, 1, [2], ['atlas-stage']]]);
check('the button is appended to the stage by buildMapButton, never to the strip or the panel',
  /function buildMapButton\(stage\) \{[\s\S]*?stage\.appendChild\(btn\);\s*stage\.appendChild\(scrim\);\s*stage\.appendChild\(pop\);/.test(js), true);
check('and buildControls calls it with the stage', /if \(stage\) buildMapButton\(stage\);/.test(js), true);
check('placeStripPieces has no phone branch left: nothing moves into a foot',
  /if \(phone && foot\)/.test(js) || /sheet-foot/.test(js), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
