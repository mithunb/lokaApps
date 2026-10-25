/* Run me with: node test/run.mjs — or on my own with node.
 *
 * A question read from who made the record (created_by, created_by_user_id,
 * any *_user_id column) is never shown to a visitor, in any mode: not as a
 * colour key, not on a place card (which shows a question only through its
 * key), not in the words a search looks through. One shared test
 * (LokaLabelRules.isPeopleQuestion) with the same rule kept inline as a
 * fallback, so a missing file hides rather than shows. Insight keeps hiding
 * them (its own test). atlas.js needs a browser, so the function is cut out of
 * its source and run here, and the places that must call it are checked in text.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LR = require(ROOT + '/atlas/label-rules.js');
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const imSrc = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const a = src.indexOf('function peopleQuestion(L, col)');
const b = src.indexOf('function computeKeyOptions');
const body = src.slice(a, src.lastIndexOf('/*', b) > a ? src.lastIndexOf('/*', b) : b);
function load(withShared) {
  const ctx = { keyHalves: (L) => [L] };
  if (withShared) ctx.LokaLabelRules = LR;
  vm.createContext(ctx);
  vm.runInContext(body + '\nthis.f = peopleQuestion;', ctx);
  return ctx.f;
}
const layer = { keyLabels: { pattern_1: 'Who created this place?', pattern_2: 'What can be seen?', pattern_3: 'Mixed' },
  keyColumns: { pattern_1: ['created_by'], pattern_3: ['status', 'created_by'] } };

/* the real computeKeyOptions, lifted the way keys-fold-test lifts it */
function fn(name) {
  const i = src.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = src.indexOf('\n  }\n', i);
  const k = src.indexOf('\n', i + 1);
  return /\}\s*$/.test(src.slice(i, k)) && src.slice(i, k).split('{').length === src.slice(i, k).split('}').length
    ? src.slice(i, k) + '\n' : src.slice(i, j + 4) + '\n';
}
function constant(name) { const m = src.match(new RegExp('\\n  var ' + name + ' = [^;]*;')); if (!m) throw new Error('no var ' + name); return m[0] + '\n'; }
const lifted = ['KEY_MAX', 'KEY_CAP', 'KEY_DOMINANCE', 'QUESTION_MIN_REACH', 'KEY_LOPSIDED_MIN_KINDS', 'KEY_MIN_SHARED', 'DATEY', 'MONTHS'].map(constant).join('') +
  ['prettyCol', 'colLabel', 'dateKeyName', 'looksLikeDates', 'dateBucket', 'dateGrain', 'unbrace', 'unquotePiece', 'cellText', 'skipSearchValue', 'sharedShare', 'computeKeyOptions'].map(fn).join('');
const keys = (L, shared) => new Function('LokaLabelRules', lifted + 'return computeKeyOptions;')(shared ? LR : Object.assign({}, LR, { isPeopleQuestion: undefined }));
const rows = [];
for (let i = 0; i < 12; i++) rows.push({ pattern_1: ['ann', 'bob'][i % 2], pattern_2: ['park', 'lake', 'road'][i % 3], pattern_3: ['open', 'shut'][i % 2] });
const feats = rows.map((p) => ({ type: 'Feature', properties: p, geometry: null }));
const L2 = { keyLabels: { pattern_1: 'Who created this place?', pattern_2: 'What kind of place?', pattern_3: 'Is it open?' },
  keyColumns: { pattern_1: ['created_by'], pattern_3: ['status', 'created_by'] } };
for (const shared of [true, false]) {
  const cols = keys(L2, shared)(L2, feats).map((o) => o.col);
  check('colour keys (' + (shared ? 'shared file' : 'file missing') + '): only the place question is offered', cols.includes('pattern_2') && !cols.includes('pattern_1') && !cols.includes('pattern_3'), true);
}

console.log('\n  people questions are hidden from visitors');
for (const [name, withShared] of [['shared file loaded', true], ['shared file missing', false]]) {
  const f = load(withShared);
  check(name + ': a created_by question is hidden', f(layer, 'pattern_1'), true);
  check(name + ': a place question is kept', f(layer, 'pattern_2'), false);
  check(name + ': a mixed [status, created_by] question is hidden (fail closed)', f(layer, 'pattern_3'), true);
  check(name + ': *_user_id and created_by_user_id are hidden', [f({ keyColumns: { p: 'created_by_user_id' } }, 'p'), f({ keyColumns: { p: ['owner_user_id'] } }, 'p')], [true, true]);
}
check('the shared test is the one Insight uses (shared function exists)', typeof LR.isPeopleQuestion, 'function');
check('Insight asks the shared test first, and keeps its own rule as a fallback', /LokaLabelRules\.isPeopleQuestion/.test(imSrc) && /created_by_user_id/.test(imSrc), true);
check('the viewer\'s key options skip a people question', /isQuestion\) \{\s*var kcols[^]*?isPeopleQuestion[^]*?if \(ofPeople\) return;/.test(src), true);
check('the viewer\'s search text skips a people question', /\^pattern_\\d\+\$\/\.test\(k\) && peopleQuestion\(L, k\)/.test(src), true);
check('label-rules loads before atlas.js', (() => { const h = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8'); return h.indexOf('label-rules.js') < h.indexOf('./atlas.js'); })(), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
