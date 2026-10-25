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

/* ---------- question finding v2 (Fable's review, 25 Oct 2026) ----------
   A: the finder goes through a fixed checklist and names the item each
   question tells (about); B: the schema asks for it; G1: one new question per
   item; G2: the columns read together once more when on their own they gave
   fewer than 4; G3: a kind the finder could name fewer than 3 places for is
   dropped before anything is filed into it. A second stand-in that keeps what
   it was sent, and answers a place by the first kind named anywhere on its
   lines (the joint read's questions are asked of several columns at once). */
function stub2(perColumn, { cap = null, jointFails = false, runsOutOnce = false } = {}) {
  let ranOut = false;
  const log = { think: 0, file: 0, prompts: [], schemas: [], filePrompts: [] };
  const call = async (model, prompt, schema, o) => {
    if (schema && schema.properties && schema.properties.checks) return { checks: [] };
    if (o && o.think) {
      log.think += 1; log.prompts.push(prompt); log.schemas.push(schema);
      const col = (prompt.match(/of its data, called "([^"]+)"/) || [])[1] || '?';
      if (jointFails && col === '?') throw new Error('the model did not answer');
      if (runsOutOnce && !ranOut) { ranOut = true; throw new Error('the answer stopped early (MAX_TOKENS)'); }
      return perColumn[col]
        ? { verdict: 'questions', reading: 'r', facts: ['f'], questions: perColumn[col] }
        : { verdict: 'no_clear_questions', note: 'nothing' };
    }
    log.file += 1; log.filePrompts.push(prompt);
    const qs = [...prompt.matchAll(/^q(\d+) — (.*?)(?:   \(asked of .*? only\))?\n((?:   .*\n?)+)/gm)]
      .map((x) => ({ n: Number(x[1]), kinds: x[3].split('\n').map((l) => l.trim().split(' — ')[0]).filter(Boolean) }));
    const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
    return { rows: blocks.map((b) => {
      const r = { i: Number(b.match(/^(\d+)\./)[1]) };
      const part = b.toLowerCase();
      for (const q of qs) {
        const hit = q.kinds.find((k) => new RegExp('\\b' + k.toLowerCase() + '\\b').test(part));
        r['q' + q.n] = hit || 'other';
        r['w' + q.n] = hit ? [hit.toLowerCase()] : [];
      }
      return r;
    }) };
  };
  if (cap != null) { call.cap = cap; call.spent = () => log.think + log.file; }
  return { call, log };
}
function read2(rows, perColumn, opts = {}, stubOpts = {}) {
  const fields = RULES.wordColumns(rows);
  const { call, log } = stub2(perColumn, stubOpts);
  return E.enrichRows(Object.assign({
    rows, fields, title: 'Made-up town', mode: 'questions', keepQuestions: [], seedSet: [],
    nameCol: 'loka_name', callBudget: 24, models: { flash: 'stub', flashLite: 'stub-lite' }, callJSON: call,
  }, opts)).then((out) => Object.assign(out, { log }));
}
const about = (n, q) => Object.assign({ about: n }, q);
// the same 24 places with no address, and a second column of free text of their own
const DAYS = ['Monday', 'Friday'];
const twoCols = town.map((r, i) => ({ loka_name: r.loka_name, description: r.description,
  notes: 'Note ' + (i + 1) + ': swept every ' + DAYS[i % 2] + ' by the ' + (i < 12 ? 'warden' : 'volunteers') + ' of the ward.' }));

console.log('\n  3. the prompt goes through a checklist; the schema asks which item a question tells');
{
  const r = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [about(4, D[0])] });
  const p = r.log.prompts[0] || '';
  check('the checklist, all eight items, in order',
    [' 1. what sort of thing it is', ' 4. what it is made of, or what it looks like', ' 8. anything else many lines each give their own value of']
      .map((l) => p.includes('\n' + l + '\n')), [true, true, true]);
  check('a question is never about the record', p.includes('Never about the record — who wrote it, in whose voice, how it is written, how long it is, whether it has a name.'), true);
  check('a question may be as long as the server keeps (at most 120 characters), no longer 40',
    [p.includes('at most ' + E.MAX_QUESTION_CHARS + ' characters'), E.MAX_QUESTION_CHARS, /at most 40 characters/.test(p)], [true, 120, false]);
  check('every place a kind holds, not a sample', p.includes('Under examples list EVERY place number that belongs, up to 12, not a sample.'), true);
  check('one question per item, its number in the about field', p.includes('ONE question per item, never two') && p.includes('Put the item\'s number in the about field.'), true);
  const s = (((r.log.schemas[0] || {}).properties || {}).questions || {}).items || {};
  check('the schema requires about, an integer, written first',
    [s.required.includes('about'), (s.properties.about || {}).type, s.propertyOrdering[0]], [true, 'INTEGER', 'about']);
  check('the item travels with the question kept', r.questions.map((q) => [q.question, q.about]), [['What is it built of?', 4]]);
}

console.log('\n  4. G1: one new question per checklist item; a settled one is never grouped');
{
  // two new questions tell item 4; the colour is asked first but reaches only 16 places, the material all 24
  const colour = about(4, ask('What colour is it?', ['red', 'blue']));
  const material = about(4, D[0]);
  const size = about(7, D[2]);
  const r = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [colour, material, size] });
  check('the better ranked of the two is kept, the other dropped; a different item is untouched',
    r.questions.map((q) => q.question).sort(), ['How big is it?', 'What is it built of?']);
  check('and the column\'s line names the one kept',
    lineOf(r, 'description').includes('“What colour is it?” dropped — another question already asks about the same thing: “What is it built of?”'), true);
  // item 8 is "anything else": two questions under it are both kept
  const r8 = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [about(8, ask('What colour is it?', ['red', 'blue'])), about(8, D[0])] });
  check('two questions under item 8, anything else, are both kept', r8.questions.map((q) => q.question).sort(), ['What colour is it?', 'What is it built of?']);
  // the same, on a layer already holding a settled question about item 4, re-read to add from the description
  const settled = [Object.assign(about(4, ask('What shape is it?', ['round', 'square'])), { columns: ['description'] })];
  const r2 = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })),
    { description: [colour, material] }, { keepQuestions: settled, addColumns: ['description'] });
  check('the settled question stays, and only the new ones are grouped',
    r2.questions.map((q) => [q.question, q.settled]), [['What shape is it?', true], ['What is it built of?', false]]);
  const plain = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })),
    { description: [D[0], ask('What colour is it?', COLOUR)] });
  check('questions with no item are grouped with nothing', plain.questions.length, 2);
}

console.log('\n  5. G2: the columns read together once more when on their own they gave fewer than 4');
{
  const r = await read2(twoCols, {
    description: [about(4, D[0])],
    notes: [about(6, ask('Which day is it swept?', DAYS))],
    '?': [about(3, ask('Who sweeps it?', ['warden', 'volunteers']))],
  });
  check('two columns, two questions: one more finder call, with no column of its own', r.log.think, 3);
  const joint = r.log.prompts[2] || '';
  check('the joint read is shown every column asked', joint.includes('columns named: description, notes') && !/of its data, called/.test(joint), true);
  check('and told the questions already kept', joint.includes('already asks: “What is it built of?”, “Which day is it swept?”'), true);
  check('what it found is kept, under its own label',
    r.questions.map((q) => [q.question, q.column]).sort(),
    [['What is it built of?', 'description'], ['Which day is it swept?', 'notes'], ['Who sweeps it?', 'all columns together']]);
  check('and its line says why it was read',
    /^All columns together: read together once more because the columns on their own yielded fewer than 4 questions; 1 question kept: “Who sweeps it\?”/.test(lineOf(r, 'all columns together')), true);
  const twin = await read2(twoCols, { description: [about(4, D[0])], '?': [about(1, ask('What is it built of?', MATERIAL))] });
  check('a joint question that is one already asked goes, as from any column', twin.questions.map((q) => q.question), ['What is it built of?']);
}
{
  const r = await read2(twoCols, {
    description: [about(4, D[0]), about(5, D[1]), about(7, D[2])],
    notes: [about(6, ask('Which day is it swept?', DAYS))],
    '?': [about(3, ask('Who sweeps it?', ['warden', 'volunteers']))],
  });
  check('four or more from the columns on their own: no joint read', [r.log.think, lineOf(r, 'all columns together')], [2, '']);
}
{
  // a caller with nothing left after the two columns' calls
  const r = await read2(twoCols, { description: [about(4, D[0])], notes: [about(6, ask('Which day is it swept?', DAYS))],
    '?': [about(3, ask('Who sweeps it?', ['warden', 'volunteers']))] }, {}, { cap: 2 });
  check('no calls left: the joint read is not made', r.log.think, 2);
  check('and the record says so',
    lineOf(r, 'all columns together'), 'All columns together: not read together once more — the columns on their own yielded fewer than 4 questions, but this reading had no calls left for it');
  check('the questions the columns gave are still answered', r.questions.map((q) => q.question).sort(), ['What is it built of?', 'Which day is it swept?']);
}
{
  // the joint read fails: the columns' questions stand, and its line says so
  const r = await read2(twoCols, { description: [about(4, D[0])], notes: [about(6, ask('Which day is it swept?', DAYS))] }, {}, { jointFails: true });
  check('a failed joint read keeps what the columns found', [r.verdict, r.questions.map((q) => q.question).sort()], ['questions', ['What is it built of?', 'Which day is it swept?']]);
  check('and its line says the read did not come back', /did not answer that read; the questions above stand$/.test(lineOf(r, 'all columns together')), true);
}
{
  // an answer that ran out of room is asked for once more, and what comes back is used
  const r = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [about(4, D[0]), about(5, D[1])] }, {}, { runsOutOnce: true });
  check('a finder answer that stopped early (MAX_TOKENS) is asked once more', [r.verdict, r.questions.map((q) => q.question).sort()], ['questions', ['What colour is it?', 'What is it built of?']]);
}
{
  // one column only: there is nothing to read together
  const r = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [about(4, D[0])], '?': [about(3, D[1])] });
  check('a single column is not read twice', r.log.think, 1);
}

console.log('\n  6. G3: a kind the finder names fewer than 3 places for is dropped before filing');
{
  const q = about(4, { question: 'What is it built of?', noun: '', kinds: [
    { name: 'stone', definition: 'Places that say stone', examples: [1, 4, 7] },
    { name: 'brick', definition: 'Places that say brick', examples: [2, 5, 8, 11] },
    { name: 'timber', definition: 'Places that say timber', examples: [3, 6, 6, 99] },
  ] });
  const r = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [q] });
  const asked = (r.log.filePrompts[0] || '').split('\n').filter((l) => /^   \S/.test(l)).map((l) => l.trim().split(' — ')[0]);
  check('timber (two real places: 3 and 6) is never offered to the answering', asked, ['stone', 'brick']);
  check('the question keeps the two kinds that held', r.questions.map((x) => x.counts.map((c) => c.name).sort()), [['brick', 'stone']]);
  const lone = about(4, { question: 'What is it built of?', noun: '', kinds: [
    { name: 'stone', definition: 'Places that say stone', examples: [1, 4, 7] },
    { name: 'brick', definition: 'Places that say brick', examples: [2, 5] },
  ] });
  const r2 = await read2(town.map((x) => ({ loka_name: x.loka_name, description: x.description })), { description: [lone] });
  check('a question left with one kind goes, and its column says a question was suggested',
    [r2.verdict, /it suggested 1 question, but it did not have two answers/.test(lineOf(r2, 'description')), r2.log.file], ['refused', true, 0]);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
