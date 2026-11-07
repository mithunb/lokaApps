/* Coloured disc rings on Standard atlases (Mithun, 7 Nov 2026: "Include rings
   in Standard or non-research mode").

   An atlas read in no mode rings its counted discs by the FIRST key switched
   on in the layers panel — the first visible layer, in the manifest's order,
   with an active key, and that layer's first active key — in the key's own
   kind colours, the kinds past the sixth and the places that do not answer
   pooled in grey, exactly as Insight's open question does (atlas.js, COLOURED
   DISCS). No key on: the plain ink disc. A mode is left alone: it lends its
   own colouring or none. The pure part runs for real with stand-ins. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
function fn(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  return js.slice(i, js.indexOf('\n  }\n', i) + 4);
}

console.log('\n  the ring follows the first key switched on');
// stand-ins: two layers offering keys, a twin, a mode
const L1 = { id: 'L1', _keyOptions: [{ col: 'kind', kept: ['Tree', 'Pond', 'Rock'] }, { col: 'age', kept: ['Old', 'New'] }] };
const L2 = { id: 'L2', _keyOptions: [{ col: 'use', kept: ['Park', 'Market', 'Temple', 'School', 'Shop', 'Road', 'Lake', 'Mill'] }] };
const T1 = { id: 'L1-pts' };
const host = (L) => (L === T1 ? L1 : L);
const make = (EV, keyState, layers) => new Function('EV', 'MANIFEST', 'keyHost', 'activeKeyOptions', 'keyKindColor', 'optValuesOf', 'keyHalves', 'DISC_SLOTS',
  fn('standardDiscColouring') + '\nreturn standardDiscColouring;')(
  EV, { layers },
  host,
  (L) => { const st = keyState[L.id]; return st && L._keyOptions ? L._keyOptions.filter((o) => st.active.indexOf(o.col) >= 0) : []; },
  (L, opt, fi, slot) => 'c' + slot,
  (L, opt, f) => { const v = f.properties[opt.col]; return v ? String(v).split(';').map((x) => x.trim()) : []; },
  (L) => (L === L1 ? [L1, T1] : [L]),
  6)();
check('no key on anywhere: plain discs (null)', make(null, { L1: { active: [] }, L2: { active: [] } }, [L1, L2]), null);
let c = make(null, { L1: { active: ['kind'] }, L2: { active: ['use'] } }, [L1, T1, L2]);
check('L1\'s "kind" key on: its kept kinds in the key\'s colours, the pool "Doesn’t say"', [c.colours, c.names, c.pool], [['c0', 'c1', 'c2'], ['Tree', 'Pond', 'Rock'], 'Doesn’t say']);
check('a place\'s slot is its first answer\'s place among the kinds; a list cell reads its first; an answer not kept, no answer, or another layer\'s place pools',
  [c.slotOf(L1, { properties: { kind: 'Pond' } }), c.slotOf(T1, { properties: { kind: 'Rock; Tree' } }), c.slotOf(L1, { properties: { kind: 'Moss' } }), c.slotOf(L1, { properties: {} }), c.slotOf(L2, { properties: { kind: 'Tree' } })],
  [1, 2, 6, 6, 6]);
check('the first ACTIVE key of that layer, in the panel\'s order, not the first offered', make(null, { L1: { active: ['age'] } }, [L1, L2]).names, ['Old', 'New']);
check('two keys on one layer: the first in the panel\'s order rings the discs', make(null, { L1: { active: ['kind', 'age'] } }, [L1]).names, ['Tree', 'Pond', 'Rock']);
check('L1 hidden: the ring moves to the next layer with a key on; eight kinds: six colours and the pool says "another answer"',
  (() => { const h = { ...L1, _visible: false }; const k = make(null, { L1: { active: ['kind'] }, L2: { active: ['use'] } }, [h, L2]); return [k.names.length, k.pool, k.slotOf(L2, { properties: { use: 'Mill' } })]; })(),
  [6, 'Another answer, or doesn’t say', 6]);
check('a points twin never leads: its host holds the keys', make(null, { L1: { active: ['kind'] } }, [T1, L1]).names, ['Tree', 'Pond', 'Rock']);
check('a mode is left alone (it lends its own colouring, or none)', make({ insight: true }, { L1: { active: ['kind'] } }, [L1]), null);

console.log('\n  wired where the first key on can change');
check('syncStandardDiscs lends the colouring and does nothing in a mode or before the map', /function syncStandardDiscs\(\) \{\n\s+if \(EV \|\| !map\) return;\n\s+setDiscColouring\(standardDiscColouring\(\)\);/.test(js), true);
check('a key toggled (applyLayerKeys), the keys first offered, a layer shown or hidden',
  [/applyMarkerVisibility\(h\); \}\);[^\n]*\n\s+syncStandardDiscs\(\);/.test(fn('applyLayerKeys')), /keyState\[H\.id\] = \{ active: active, note: null, noteCol: null \};[\s\S]{0,600}?syncStandardDiscs\(\);/.test(js), /if \(twin\) setLayerVisible\(twin, show\);\n\s+\/\/[^\n]*\n\s+if \(keyState\[keyHost\(L\)\.id\]\) syncStandardDiscs\(\);/.test(fn('setLayerVisible'))], [true, true, true]);
check('Event, Explore and Insight are untouched: the only callers are the Standard key paths', (js.match(/syncStandardDiscs\(\)/g) || []).length, 4);
check('plain ES5', /=>|`|\b(const|let)\b/.test(fn('standardDiscColouring') + fn('syncStandardDiscs')), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
