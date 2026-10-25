/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Two rules for the questions a reading finds (Mithun, 25 Oct 2026). Asked
   afresh, Cubbon's places gave six questions, three of them from the Address
   column, and one of those ("What division of Bengaluru?") had one answer for
   33 of 33 places. So:
     1. an address column is not asked at all, and its line says why;
     2. a new question where one answer covers nine places in ten or more is
        dropped, and the column's line says why.
   A question already settled on the layer is held to neither: one found in
   an address by an earlier reading is still answered from that column. Made-up
   places, a stand-in model, no network. */
import * as E from '../api/lib/atlas/enrich.js';
const RULES = createRequire(import.meta.url)(ROOT + '/atlas/reading-rules.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* A stand-in model. The finder hands back whatever the check set for the
   column it was asked about; the answerer gives each place the first kind
   whose name its own column says, quoting that word, and "other" when none. */
function stub(perColumn) {
  const log = { think: 0, file: 0 };
  const call = async (model, prompt, schema, o) => {
    if (schema && schema.properties && schema.properties.checks) return { checks: [] };
    if (o && o.think) {
      log.think += 1;
      const col = (prompt.match(/of its data, called "([^"]+)"/) || [])[1] || '?';
      return perColumn[col]
        ? { verdict: 'questions', reading: 'r', facts: ['f'], questions: perColumn[col] }
        : { verdict: 'no_clear_questions', note: 'nothing' };
    }
    log.file += 1;
    const qs = [...prompt.matchAll(/^q(\d+) — (.*?)(?:   \(asked of the "([^"]+)" column only\))?\n((?:   .*\n?)+)/gm)]
      .map((x) => ({ n: Number(x[1]), col: x[3], kinds: x[4].split('\n').map((l) => l.trim().split(' — ')[0]).filter(Boolean) }));
    const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
    return { rows: blocks.map((b) => {
      const i = Number(b.match(/^(\d+)\./)[1]);
      const r = { i };
      for (const q of qs) {
        const part = ((b.match(new RegExp('(?:^\\d+\\. |\\n    )' + (q.col || 'whole record') + ': ([^\\n]*)')) || [])[1] ||
          (!/\n    /.test(b) ? b.replace(/^\d+\. /, '') : '')).toLowerCase();
        const hit = q.kinds.find((k) => new RegExp('\\b' + k.toLowerCase() + '\\b').test(part));
        r['q' + q.n] = hit || 'other';
        r['w' + q.n] = hit ? [hit.toLowerCase()] : [];
      }
      return r;
    }) };
  };
  return { call, log };
}
const ask = (question, kinds) => ({ question, noun: '', kinds: kinds.map((k) => ({ name: k, definition: 'Places that say ' + k, examples: [1, 2, 3] })) });
function read(rows, perColumn, opts = {}) {
  const fields = RULES.wordColumns(rows);
  const { call, log } = stub(perColumn);
  return E.enrichRows(Object.assign({
    rows, fields, title: 'Made-up town', mode: 'questions', keepQuestions: [], seedSet: [],
    nameCol: 'loka_name', callBudget: 24, models: { flash: 'stub', flashLite: 'stub-lite' }, callJSON: call,
  }, opts)).then((out) => Object.assign(out, { log }));
}
const lineOf = (r, c) => ((r.columns || []).find((x) => x.column === c) || {}).line || '';

/* ---------- 24 places: a description with five sorts of fact, and an address ---------- */
const MATERIAL = ['stone', 'brick', 'timber'];
const COLOUR = ['red', 'blue', 'green'];
const AREAS = ['Campal', 'Fontainhas', 'Miramar', 'Altinho'];
const town = [];
for (let i = 0; i < 24; i++) {
  town.push({
    loka_name: 'Place ' + (i + 1),
    description: 'A ' + (i % 2 ? 'large' : 'small') + ' ' + (i % 4 < 2 ? 'old' : 'new') + ' ' + COLOUR[Math.floor(i / 8)] +
      ' building of ' + MATERIAL[i % 3] + ', ' + (i < 12 ? 'round' : 'square') + ' in plan' +
      (i < 6 ? ', with a bell' : i < 9 ? ', with a gong' : '') + '.',
    address: (i % 6 < 3 ? 'Rua ' : 'Avenida ') + (i + 1) + ', ' + AREAS[i % 4] + ', Panaji, Goa, India',
  });
}
const D = [
  ask('What is it built of?', MATERIAL),
  ask('What colour is it?', COLOUR),
  ask('How big is it?', ['small', 'large']),
  ask('What shape is it?', ['round', 'square']),
  ask('Does it ring a bell or a gong?', ['bell', 'gong']),
];
// what the finder would offer for the address, were it asked
const A = [ask('Which area is it in?', ['Campal', 'Fontainhas', 'Miramar']), ask('Is it on a rua or an avenida?', ['rua', 'avenida'])];

console.log('\n  1. an address column is not asked; a question settled from one still is answered');
{
  const t = E.textColumns(town, RULES.wordColumns(town), { nameCol: 'loka_name' });
  check('the description is read; the address is passed over, with its reason',
    [t.ask.map((a) => a.column + ':' + a.kind), t.passed.map((p) => p.column + ': ' + p.why)],
    [['description:text'], ['address: an address: the map already shows where each place is']]);
}
{
  // one filled list always ends the same way: not enough to call a column an address
  const one = town.map((r, i) => ({ ...r, address: '', labels: i === 0 ? 'gallery; arts hub; learning; dialogue; community; making' : '' }));
  const t = E.textColumns(one, RULES.wordColumns(one), { nameCol: 'loka_name' });
  check('a column with a single list in it is not taken for an address', t.passed.some((p) => p.column === 'labels' && /an address/.test(p.why)), false);
}
{
  const r = await read(town, { description: D, address: A });
  check('it lands', r.verdict, 'questions');
  check('the finder is called for the description only', r.log.think, 1);
  check('no question comes from the address', r.questions.filter((q) => q.column === 'address').length, 0);
  check('the five description questions are all kept, nothing crowded out', r.questions.length, 5);
  check('the address\'s line says why, in plain words', lineOf(r, 'address'),
    'Address: not asked — an address: the map already shows where each place is');
}
{
  // a question an earlier reading found in the address, settled on the layer with its column
  const settled = [Object.assign(ask('Which area is it in?', ['Campal', 'Fontainhas', 'Miramar']), { columns: ['address'] })];
  const r = await read(town, { description: D, address: A }, { keepQuestions: settled });
  check('a normal re-read keeps it, settled, still from the address', r.questions.map((q) => [q.question, q.settled, q.column]),
    [['Which area is it in?', true, 'address']]);
  check('and answers it from the address: every Campal, Fontainhas and Miramar place (18 of 24)', r.questions[0].answered, 18);
  check('with the address\'s own words under each answer', r.questions[0].why.filter((w) => w.length).length, 18);
  check('no finder call: a re-read answers what is settled', r.log.think, 0);
  check('the address\'s line says the question it holds, not "not asked"',
    /^Address: looked at in an earlier reading, which kept “Which area is it in\?” \(reaches 18 of 24 places\); not asked again — an address/.test(lineOf(r, 'address')), true);
  const add = await read(town, { address: A }, { keepQuestions: settled, addColumns: ['address'] });
  check('asked to add from the address, it adds nothing and keeps what is settled', add.verdict, 'nothing_new');
}

console.log('\n  2. a new question one answer nearly fills is dropped; a settled one is not');
const split = (n, many, few) => Array.from({ length: n }, (_, i) => ({
  loka_name: 'Spot ' + (i + 1),
  description: 'A shelter built of ' + (i < many ? 'stone' : 'brick') + ', ' + (i % 2 ? 'open' : 'closed') + ' at night, beside the path.',
})).slice(0, many + few);
const built = ask('What is it built of?', ['stone', 'brick']);
const night = ask('Is it open at night?', ['open', 'closed']);
{
  const r = await read(split(33, 30, 3), { description: [built, night] });
  check('30 of 33 the same: the new question is dropped', r.questions.map((q) => q.question), ['Is it open at night?']);
  check('and its column\'s line says so, with the counts',
    /“What is it built of\?” dropped — one answer covers 30 of 33 places — it tells nothing apart/.test(lineOf(r, 'description')), true);
}
{
  const r = await read(split(33, 30, 3), {}, { keepQuestions: [built] });
  check('the same split on a settled question: kept', r.questions.map((q) => [q.question, q.settled, q.biggestCount, q.answered]),
    [['What is it built of?', true, 30, 33]]);
}
{
  const r = await read(split(28, 25, 3), { description: [built, night] });
  check('25 of 28 (89 in 100): kept', r.questions.map((q) => q.question).sort(), ['Is it open at night?', 'What is it built of?']);
  check('and marked lopsided for the panel, as before', (r.questions.find((q) => q.question === 'What is it built of?') || {}).flat, true);
}
{
  const r = await read(split(30, 27, 3), { description: [built, night] });
  check('27 of 30 (exactly nine in ten): dropped', r.questions.map((q) => q.question), ['Is it open at night?']);
}
{
  const r = await read(split(33, 30, 3), { description: [built] });
  check('a reading whose only question is one-sided keeps nothing, and says why',
    [r.verdict, /one answer covers 30 of 33 places/.test(lineOf(r, 'description'))], ['refused', true]);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
