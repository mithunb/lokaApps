/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The answers under an open question, as Mithun asked for them (2026-10-21):
 *
 *   1. The per-column lines ("Description: …") are off the map's panel and in
 *      the owner's Questions tab, folded shut under "What LOKA read in each
 *      column"; the old "looked at in an earlier reading; this one only
 *      answered …" now reads "read earlier — nothing new this time".
 *   2. No two rows of one panel share a heading: a later "Explore by place"
 *      shows its question as written.
 *   3. "Words people used. Tap one …" is gone from every answer; the ⓘ says
 *      it once.
 *   4. Each answer is a button: selected, it fills and says so (aria-pressed),
 *      the map keeps and frames its places and writes their names, and its
 *      words open under it. Tapped again, everything comes back.
 *
 * Runs the shared heading rule, the framing, the "is this layer's answer
 * selected" test, the pressed-state painter and the owner's column fold for
 * real against small stand-ins, and reads the wiring from the source. No
 * network, no map.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const LR = req(path.join(ROOT, 'atlas', 'label-rules.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const js = read('atlas/atlas.js');
const html = read('atlas/index.html');
const owner = read('atlas/owner.js');
const ownerCss = read('atlas/owner.css');
const enrich = await import('../api/lib/atlas/enrich.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function section(src, name) {
  const i = src.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return src.slice(i, src.indexOf('\n  }\n', i) + 4);
}

/* ------------------------------------------------------------------ */
console.log('\n  1. what LOKA read in each column: the Questions tab only');
const shelf = section(owner, 'drawQuestionShelf');
const door = section(owner, 'patternsDoor');
check('the Questions tab draws the lines, once per layer', /columnLines\(block, readingOf\(L\.id\)\);/.test(shelf), true);
check('the map panel no longer draws them under the keys', /columnLines\(wrap, readingOf\(L\.id\)\)/.test(door), false);
check('the only other call is for a layer that kept no question (no tab to hold them)',
  (owner.match(/columnLines\(/g) || []).length, 3);   // the definition, the tab, the kept-nothing note
// the fold, run for real against a tiny page
function fakeDoc() {
  function node(tag) {
    return { tag, className: '', innerHTML: '', children: [], get childNodes() { return this.children; }, open: false,
      appendChild(c) { this.children.push(c); return c; } };
  }
  return { createElement: node };
}
const doc = fakeDoc();
const el = (tag, cls, h) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (h != null) n.innerHTML = h; return n; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const colLift = new Function('document', 'el', 'esc',
  owner.slice(owner.indexOf('  var COLUMNS_FOLD ='), owner.indexOf('\n  }\n', owner.indexOf('  function columnLines(')) + 4) +
  '\nreturn { columnLines: columnLines, plainColumnLine: plainColumnLine };');
const C = colLift(doc, el, esc);
const host = el('div');
C.columnLines(host, { columns: [
  { column: 'description', asked: false, line: 'Description: looked at in an earlier reading; this one only answered the questions already on the map' },
  { column: 'festival_comment', asked: true, line: 'Festival comment: 2 questions kept: “Which day is it on?”' }] });
const fold = host.children[0];
check('the lines sit in one fold', [host.children.length, fold.tag, fold.className], [1, 'details', 'own-columns-fold']);
check('shut until tapped', fold.open, false);
check('its one line says what is inside', [fold.children[0].tag, fold.children[0].innerHTML], ['summary', 'What LOKA read in each column']);
check('one item per column', fold.children[1].children.length, 2);
check('an old stored line is shown in the plain words',
  fold.children[1].children[0].innerHTML, 'Description: read earlier — nothing new this time');
check('nothing to say: nothing drawn', (() => { const h = el('div'); C.columnLines(h, { columns: [] }); return h.children.length; })(), 0);
check('the fold is styled, with a touch-sized line on a phone',
  /\.own-columns-fold \{/.test(ownerCss) && /\.own-columns-sum \{ min-height:44px; \}/.test(ownerCss), true);
// the server writes the new words for new readings
const plan = { groups: [{ label: 'address', columns: ['address'] }], passed: [] };
const lines = enrich.columnReport(plan, {}, [{ question: 'What sort of place is it?', settled: true, columns: [] }], [], 10, {});
check('the reading itself now writes "read earlier — nothing new this time"', lines[0].line, 'Address: read earlier — nothing new this time');
check('and the old wording is gone from the server', /this one only answered the questions already on the map/.test(read('api/lib/atlas/enrich.js')), false);

/* ------------------------------------------------------------------ */
console.log('\n  2. no heading twice in one panel');
const H = (q, noun) => Object.assign(LR.keyHeading({ question: q, noun }), { asWritten: q });
const twice = LR.distinctHeadings([
  H('Which place is it?', 'place'),
  H('What is its function?', 'function'),
  H('What place does it sit beside?', 'place'),
  H('Which place is it near?', 'place')]);
check('the first keeps "Explore by place"', twice[0], { heading: 'Explore by place', sub: 'Which place is it?' });
check('another heading is left alone', twice[1].heading, 'Explore by function');
check('a later one shows its question as written, with no grey line', twice[2], { heading: 'What place does it sit beside?', sub: '' });
check('and every one after it too', twice[3], { heading: 'Which place is it near?', sub: '' });
check('the comparison ignores case', LR.distinctHeadings([{ heading: 'Explore by Place', asWritten: 'a' }, { heading: 'explore by place', asWritten: 'b' }])[1].heading, 'b');
check('no heading is repeated in the result', (() => {
  const hs = twice.map((h) => h.heading.toLowerCase());
  return hs.length === new Set(hs).size;
})(), true);
check('columns too: two columns that make the same heading', LR.distinctHeadings([
  Object.assign(LR.keyHeading({ label: 'Category', column: 'Category' }), { asWritten: 'Category' }),
  Object.assign(LR.keyHeading({ label: 'Categories', column: 'Categories' }), { asWritten: 'Categories' })]).map((h) => h.heading),
  ['Explore by category', 'Categories']);
check('the input list is left alone', (() => { const a = [{ heading: 'x', sub: 's', asWritten: 'q' }, { heading: 'x', sub: 's', asWritten: 'r' }]; LR.distinctHeadings(a); return a[1].heading; })(), 'x');
const build = section(js, 'buildKeyToggles');
check('the panel works every heading out first, with the shared rule', /LokaLabelRules\.distinctHeadings\(raw\)/.test(build) && /var hd = heads\[opt\.col\] \|\| keyHeadingOf\(L, opt\);/.test(build), true);
check('the owner\'s Questions tab says the same', /LokaLabelRules\.distinctHeadings\(onQs\.map/.test(shelf), true);

/* ------------------------------------------------------------------ */
console.log('\n  3. the words line is gone; the ⓘ says it once');
check('no "Words people used" line anywhere in the viewer', /Words people used/.test(js) || /leg-why-lead/.test(js + html), false);
check('the ⓘ note, word for word',
  /var HOW_TO = "Mark each place by one of the questions below\. Open a question to colour the map by its answers\. Tap an answer to show those places and the words people used for it; tap it again to see everything\.";/.test(js), true);
check('said only where questions are offered', /if \(keysOffered\(L\)\) parts\.push\(HOW_TO/.test(js), true);

/* ------------------------------------------------------------------ */
console.log('\n  4. an answer is a button');
const kinds = section(js, 'keyKindRows');
check('a real button, of its own class', /var r = el\("button", "leg-item key-kind key-answer"/.test(kinds) && /r\.type = "button";/.test(kinds), true);
check('it says whether it is selected', /r\.setAttribute\("aria-pressed", lit \? "true" : "false"\);/.test(kinds), true);
check('it wears the answer\'s mark and count', /r\.appendChild\(swatch\(it\)\);/.test(kinds) && /el\("span", "leg-n", String\(it\.n\)\)/.test(kinds), true);
check('the words open under it with the selection, from the same tap', /more\.hidden = !lit;/.test(kinds) && /r\._more = more;/.test(kinds), true);
check('there is no separate chevron', /leg-open|leg-pair|ICONS\.chevron/.test(kinds), false);
check('selected: a strong Leaf fill and white words', /\.key-body button\.key-answer\.on \{ background:var\(--color-leaf\); border-color:var\(--color-leaf-deep\); color:#fff;/.test(html), true);
check('not selected: a pill with an edge', /\.key-body button\.key-answer \{[^}]*border:1px solid var\(--color-border\);[^}]*border-radius:var\(--radius-pill\);/.test(html), true);
check('44px tall on touch', /@media \(pointer:coarse\), \(max-width:720px\)\{[\s\S]*?\.key-body button\.key-answer \{ min-height:44px; \}/.test(html), true);

// the pressed-state painter, run for real
function fakeBtn(attrs, n) {
  const cls = new Set(), more = { hidden: true };
  return { attrs: Object.assign({}, attrs), _more: more, cls,
    classList: { toggle(c, on) { on ? cls.add(c) : cls.delete(c); }, contains(c) { return cls.has(c); } },
    getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = String(v); },
    querySelector() { return { textContent: String(n) }; } };
}
const A = fakeBtn({ 'data-layer': 'L1', 'data-col': 'pattern_1', 'data-which': 'kind', 'data-kind': 'Park' }, 12);
const B = fakeBtn({ 'data-layer': 'L1', 'data-col': 'pattern_1', 'data-which': 'kind', 'data-kind': 'Temple' }, 5);
const paint = new Function('document', 'KF',
  'var KINDFILTER = KF;\n' + section(js, 'markLitKinds') + '\nmarkLitKinds();');
const pageOf = (btns) => ({ querySelectorAll: (q) => q.indexOf('key-kind') >= 0 ? btns : [] });
paint(pageOf([A, B]), { layer: 'L1', col: 'pattern_1', which: 'kind', label: 'Park' });
check('the tapped answer is pressed and its words open', [A.attrs['aria-pressed'], A.cls.has('on'), A._more.hidden], ['true', true, false]);
check('the others are not pressed, and keep their words shut', [B.attrs['aria-pressed'], B.cls.has('on'), B._more.hidden], ['false', false, true]);
paint(pageOf([A, B]), { layer: 'L1', col: 'pattern_1', which: 'kind', label: 'Temple' });
check('selecting another moves the selection to it', [A.attrs['aria-pressed'], B.attrs['aria-pressed'], A._more.hidden, B._more.hidden], ['false', 'true', true, false]);
paint(pageOf([A, B]), null);
check('nothing selected: none pressed, all words shut', [A.attrs['aria-pressed'], B.attrs['aria-pressed'], A._more.hidden, B._more.hidden], ['false', 'false', true, true]);

console.log('\n  the map frames the selected places');
const fbk = section(js, 'filterByKind');
check('a selection with places frames them', /if \(shown\) fitAnswer\(L\);/.test(fbk), true);
check('tapping it again unselects, and the view goes back to everything', /if \(kindFilterIs\(L, opt, which, label\)\) \{ unpickAnswer\(\); return; \}/.test(fbk) &&
  /if \(had && map\) \{ try \{ if \(!focusFit\(true\)\) fitToData\(true\); \} catch \(e\) \{\} \}/.test(section(js, 'unpickAnswer')), true);
check('"Show all" under the answers does the same', /all\.onclick = function \(\) \{ unpickAnswer\(\); \};/.test(section(js, 'keyOnlyLine')), true);
// fitAnswer, run for real across both halves of a split file
const fits = [];
const bounds = (a, b) => ({ w: a[0], s: a[1], e: b[0], n: b[1], extend(o) { this.w = Math.min(this.w, o.w); this.s = Math.min(this.s, o.s); this.e = Math.max(this.e, o.e); this.n = Math.max(this.n, o.n); return this; } });
const fit = new Function('map', 'keyHalves', 'shapeBounds', 'viewPadding',
  'var ANSWER_MAX_ZOOM = ' + (js.match(/var ANSWER_MAX_ZOOM = (\d+);/) || [])[1] + ';\n' + section(js, 'fitAnswer') + '\nreturn fitAnswer;')(
  { fitBounds: (b, o) => fits.push([b, o]) },
  () => ['areas', 'points'],
  (h) => h === 'areas' ? bounds([77.58, 12.97], [77.60, 12.98]) : bounds([77.55, 12.95], [77.56, 12.96]),
  () => ({ top: 40, right: 40, bottom: 300, left: 40 }));
fit({});
check('one frame, around the places of both halves', [fits.length, fits[0][0].w, fits[0][0].s, fits[0][0].e, fits[0][0].n], [1, 77.55, 12.95, 77.60, 12.98]);
check('with room for the panel and the phone sheet, and a little more for a pin and its name', fits[0][1].padding, { top: 72, right: 40, bottom: 356, left: 40 });
check('and no closer than street level', fits[0][1].maxZoom, 15);

console.log('\n  the names of the selected places are written');
const on = new Function('KINDFILTER', 'layerById', 'keyHalves', section(js, 'answerNamesOn') + '\nreturn answerNamesOn;');
const halves = { L1: ['L1', 'L1-pts'] };
const isOn = (kf, L) => on(kf, (id) => id, (id) => halves[id] || [id])(L);
check('the selected answer\'s layer writes every name', isOn({ layer: 'L1' }, 'L1'), true);
check('and the other half of a split file too', isOn({ layer: 'L1' }, 'L1-pts'), true);
check('another layer is left as it was', isOn({ layer: 'L1' }, 'L2'), false);
check('nothing selected: names as normal', isOn(null, 'L1'), false);
check('a pin layer lets its names overlap while selected, and puts it back after',
  /var all = answerNamesOn\(L\) \|\| !!t\.alwaysShow;/.test(section(js, 'syncPinNames')) &&
  /map\.setLayoutProperty\(L\.id \+ "-pinname", "text-allow-overlap", all\)/.test(section(js, 'syncPinNames')), true);
const fade = section(js, 'applyShapeFade');
check('an area layer writes its selected names however crowded', /map\.setLayoutProperty\(lbl, "text-allow-overlap", L\._shapeNamesAll\);/.test(fade) &&
  /map\.setLayoutProperty\(lbl, "text-ignore-placement", L\._shapeNamesAll\);/.test(fade), true);
check('and the other areas\' names go, so they do not crowd them', /var fade = \(named && p === "text-opacity"\) \? 0 : SEARCH_FADE\[p\];/.test(fade), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
