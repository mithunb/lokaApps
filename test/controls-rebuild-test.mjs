/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Building the controls twice leaves what building them once does (October
 * 2026). On a phone the Map/Satellite switch is carried out of the strip into
 * the bottom sheet's foot. Each redraw (the owner saving Settings, a draft
 * preview) cleared the panel and the strip, but not the foot, so the phone
 * gained one more switch every time: 1, 2, 3. These checks lift the real
 * placeStripPieces and dropMovedPieces out of atlas.js and run a redraw three
 * times against a small stand-in for the page, at phone width and at desktop
 * width. No network, no browser.
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
  const foot = sheet.appendChild(new El('sheet-foot'));
  foot.appendChild(new El('sheet-foot-words'));
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
  return { root, stage, strip, controls, foot, document };
}

const code =
  liftBlock(js, '  var MOVED_PIECES = ', ';') +
  liftBlock(js, '  function dropMovedPieces() {', '\n  }\n') +
  liftBlock(js, '  function placeStripPieces() {', '\n  }\n');
const make = new Function('document', 'window', '$',
  code + 'return { dropMovedPieces: dropMovedPieces, placeStripPieces: placeStripPieces };');

function run(phone) {
  const page = makePage();
  const window = { matchMedia: () => ({ matches: phone }) };
  const fns = make(page.document, window, (s) => page.document.querySelector(s));
  const counts = [];
  for (let i = 0; i < 3; i++) {
    // what buildControls does with the switch, in its order
    page.controls.clear();
    fns.dropMovedPieces();
    page.strip.clear();
    const bm = new El('ctl-basemaps'); bm.build = i;
    page.strip.appendChild(bm);
    fns.placeStripPieces();
    const found = page.document.querySelectorAll('.ctl-basemaps');
    counts.push([found.length, found.map((n) => n.build), found.map((n) => n.parentNode.className)]);
  }
  return counts;
}

console.log('\n  one Map/Satellite switch, however often the map is redrawn');
check('buildControls takes the old switch away before it makes a new one',
  /function buildControls\(\) \{\s*var panel = \$\("#atlas-controls"\);\s*panel\.innerHTML = "";\s*dropMovedPieces\(\);/.test(js), true);
check('the switch is on the list of pieces that get moved out',
  /var MOVED_PIECES = \[[^\]]*"\.ctl-basemaps"/.test(js), true);
check('phone: three redraws leave one switch each time, the newest, in the sheet foot',
  run(true), [[1, [0], ['sheet-foot']], [1, [1], ['sheet-foot']], [1, [2], ['sheet-foot']]]);
check('desktop: three redraws leave one switch each time, the newest, in the strip',
  run(false), [[1, [0], ['atlas-strip']], [1, [1], ['atlas-strip']], [1, [2], ['atlas-strip']]]);
check('phone: the switch leads the foot, before the credit',
  (() => { const p = makePage(); const f = make(p.document, { matchMedia: () => ({ matches: true }) }, (s) => p.document.querySelector(s));
    f.dropMovedPieces(); p.strip.appendChild(new El('ctl-basemaps')); f.placeStripPieces();
    return p.foot.children.map((c) => c.className); })(), ['ctl-basemaps', 'sheet-foot-words']);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
