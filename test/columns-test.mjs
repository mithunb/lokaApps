/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Every column with words of its own gets its own look (Mithun, 2026-10-20:
   "No field - like comment - with textual data is to be ignored"). The
   measured case: a festival's 24 venues, whose festival_comment column — a
   schedule of 214 characters on every place — was sent to the model with the
   description and contributed not one word of evidence to either question
   kept. These checks use a made-up set of the same shape, not the private
   data. No network, no model. */
import * as E from '../api/lib/atlas/enrich.js';
import { createQueue } from '../api/lib/atlas/questions-queue.js';
import { survey, unusedColumns } from '../deploy/queue-question-rereads.mjs';
const RULES = createRequire(import.meta.url)(ROOT + '/atlas/reading-rules.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ---------- a made-up festival of 24 venues, shaped like the real one ---------- */
const DAYS = ['Thursday', 'Friday', 'Saturday'];
const SLOTS = ['morning', 'afternoon', 'evening'];
const SORTS = ['hotel', 'gallery', 'church', 'garden', 'school', 'theatre'];
const AREAS = ['Campal', 'Fontainhas', 'Miramar', 'Altinho'];
const rows = [];
for (let i = 0; i < 24; i++) {
  const sort = SORTS[i % SORTS.length], area = AREAS[i % AREAS.length];
  rows.push({
    loka_name: 'Venue ' + (i + 1),
    description: 'A ' + sort + ' on Rua ' + (i + 1) + ' at ' + area + ', with a ' +
      ['courtyard', 'terrace', 'lawn', 'hall'][i % 4] + ' where the festival gathers people for talks and walks.',
    festival_comment: 'EMERGENCE: FESTIVAL OF FUTURE CITIES · 29–31 Oct 2026\nFestival venue: ' +
      DAYS[Math.floor(i / 8)] + ' ' + SLOTS[(i * 7) % 3] + ' session, ' + ['panel', 'workshop', 'screening', 'walk'][i % 4] +
      ' on ' + ['water', 'housing', 'mobility', 'heritage'][(i * 5) % 4] + '. Doors open an hour before.',
    categories: ['Culture', 'Nature', 'Learning'][i % 3] + (i % 2 === 0 ? '; Heritage' : ''),
    labels: i === 3 ? 'non-profit-gallery; visual-arts-hub' : '',
    created_by: i % 5 ? 'LOKA_admin' : 'Festival team',
    address: 'Rua ' + (i + 1) + ', ' + area + ', Panaji, Goa, India',
    spaces: 'Emergence: Festival of Future Cities',
    status: 'Active',
    // a word or two a place, with more different values than a key may hold (12)
    tree: ['peepal', 'neem', 'banyan', 'mango', 'tamarind', 'jamun', 'rain tree', 'gulmohar', 'teak', 'jackfruit', 'coconut', 'cashew', 'ashoka', 'silk cotton'][i % 14],
    keeper: ['Asha', 'Ravi', 'Meera', 'Joao', 'Fatima', 'Sunil', 'Lata', 'Pedro', 'Nisha', 'Kiran', 'Maria', 'Dev', 'Rohan'][i % 13],
  });
}
const fields = RULES.wordColumns(rows);
check('the word columns the reading starts from', fields,
  ['description', 'festival_comment', 'categories', 'labels', 'created_by', 'address', 'spaces', 'status', 'tree', 'keeper']);

console.log('\n  which columns get their own look, and why the others do not');
const tc = E.textColumns(rows, fields, { nameCol: 'loka_name' });
const whyOf = (c) => (tc.passed.find((p) => p.column === c) || {}).why || '';
const kindOf = (c) => (tc.ask.find((a) => a.column === c) || {}).kind || '';
check('the description is free text, read on its own', kindOf('description'), 'text');
check('so is the festival comment — the column the old reading never drew on', kindOf('festival_comment'), 'text');
check('the address is read too, known for what it is', kindOf('address'), 'address');
check('a word or two a place with real variety is read, as a short column', [kindOf('tree'), kindOf('keeper')], ['short', 'short']);
check('the closed list the map already colours by is not asked again',
  /^already a key on the map \(3 kinds\)/.test(whyOf('categories')), true);
check('a column filled on one place is too thin', whyOf('labels'), 'only 1 place has words here, too few to find a pattern in');
check('two names over and over is a fact restated', /^already a key on the map \(2 kinds\)|fact restated/.test(whyOf('created_by')), true);
check('the same thing on every place is said so', whyOf('status'), 'it says the same thing on every place');
check('one value everywhere, with spaces in it, likewise', whyOf('spaces'), 'it says the same thing on every place');
check('nothing is unaccounted for: every word column is asked or passed over with a reason',
  [...tc.ask.map((a) => a.column), ...tc.passed.map((p) => p.column)].sort(), fields.slice().sort());
check('the place\'s name is never evidence', E.textColumns(rows, ['loka_name', 'description'], { nameCol: 'loka_name' }).passed[0].why,
  'it is the place’s name');
check('a column name reads as a label', [E.columnLabel('festival_comment'), E.columnLabel('created-by')], ['Festival comment', 'Created by']);

console.log('\n  the plan: one look per column, prose first, short columns together, within the allowance');
const plan = E.planColumns(rows, fields, { nameCol: 'loka_name', budget: 24, batches: 1 });
// prose first, the fuller column first (the made-up comments are longer than the descriptions), tags, then the address, then the short ones together
check('four groups: comment, description, address, and the short columns together',
  plan.groups.map((g) => g.label), ['festival_comment', 'description', 'address', 'tree + keeper']);
check('the short columns are one group of two', plan.groups[3].columns, ['tree', 'keeper']);
check('and say so', /read together/.test(plan.groups[3].why), true);
check('prose before an address, whatever their lengths', plan.groups.findIndex((g) => g.label === 'address') > plan.groups.findIndex((g) => g.label === 'description'), true);
check('room for ' + plan.maxGroups + ' looks on their own at 24 calls and 1 batch', plan.maxGroups, 21);
const tight = E.planColumns(rows, fields, { nameCol: 'loka_name', budget: 24, batches: 11 });
check('a reading of 420 places (11 batches) can afford one look', tight.maxGroups, 1);
check('so every column is read together in it', tight.groups.length, 1);
check('with every column on the line', tight.groups[0].columns, ['festival_comment', 'description', 'address', 'tree', 'keeper']);
check('and the record says why', /allowance of 24 calls leaves room for 1 column on its own/.test(tight.groups[0].why), true);
check('a plan never spends past the allowance: looks + answers + one retry', tight.groups.length + 11 + 1 + 11 <= 24, true);

/* ---------- a stand-in model that answers each column from its own words ---------- */
function stub({ perColumn = {}, cheat = false, log = {} } = {}) {
  log.think = []; log.file = [];
  return async (model, prompt, schema, o) => {
    if (o && o.think) {
      log.think.push(prompt);
      const col = (prompt.match(/of its data, called "([^"]+)"/) || [])[1] || (prompt.match(/columns of its data say[^:]*: "([^"]+)"/) || [])[1] || '?';
      if (perColumn[col]) return perColumn[col];
      return { verdict: 'no_clear_questions', note: 'every place had a different ' + col };
    }
    log.file.push(prompt);
    const qs = [...prompt.matchAll(/^q(\d+) — (.*?)(?:   \(asked of the "([^"]+)" column only\))?$/gm)].map((x) => [Number(x[1]), x[2], x[3]]);
    const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
    return { rows: blocks.map((b) => {
      const i = Number(b.match(/^(\d+)\./)[1]);
      const r = { i };
      for (const [n, wording, col] of qs) {
        const part = (b.match(new RegExp('(?:^\\d+\\. |\\n    )' + (col || 'description') + ': ([^\\n]*)')) || [])[1] || '';
        if (/which day/i.test(wording)) {
          const day = (part.match(/Thursday|Friday|Saturday/) || [])[0];
          if (day) { r['q' + n] = day; r['w' + n] = [cheat ? 'courtyard' : day]; }
        } else if (/sort of place/i.test(wording)) {
          const sort = (part.match(/hotel|gallery|church|garden|school|theatre/) || [])[0];
          if (sort) { r['q' + n] = sort.charAt(0).toUpperCase() + sort.slice(1); r['w' + n] = [sort]; }
        } else if (/which area/i.test(wording)) {
          const area = (part.match(/Campal|Fontainhas|Miramar|Altinho/) || [])[0];
          if (area) { r['q' + n] = area; r['w' + n] = [area]; }
        }
      }
      return r;
    }) };
  };
}
// the days run in blocks of eight, not in step with the categories column, or the day question would echo it
const dayQ = { question: 'Which day is it on?', kinds: DAYS.map((d, k) => ({ name: d, definition: 'Places that', examples: [k * 8 + 1, k * 8 + 2, k * 8 + 3] })) };
const sortQ = { question: 'What sort of place is it?', kinds: SORTS.map((s, k) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), definition: 'Places that', examples: [k + 1, k + 7, k + 13] })) };
const areaQ = { question: 'Which area is it in?', kinds: AREAS.map((a, k) => ({ name: a, definition: 'Places that', examples: [k + 1, k + 5, k + 9] })) };
const found = (questions) => ({ verdict: 'questions', reading: 'r', facts: ['f'], questions });
function read(opts = {}, stubOpts = {}) {
  const log = {};
  const p = E.enrichRows(Object.assign({
    rows, fields, title: 'Emergence', mode: 'questions', keepQuestions: [], seedSet: [],
    nameCol: 'loka_name', callBudget: 24,
    models: { flash: 'stub', flashLite: 'stub-lite' }, callJSON: stub(Object.assign({ log }, stubOpts)),
  }, opts));
  return p.then((out) => Object.assign(out, { log }));
}

console.log('\n  a reading: every column asked on its own, the comments included');
const r1 = await read({}, { perColumn: {
  description: found([sortQ]), festival_comment: found([dayQ]), address: found([areaQ]) } });
check('it lands', r1.verdict, 'questions');
check('one call to find questions for each of the four groups', r1.log.think.length, 4);
check('one call to answer 24 places', r1.log.file.length, 1);
check('five calls in all; the old reading cost two', r1.log.think.length + r1.log.file.length, 5);
const commentPrompt = r1.log.think.find((p) => /called "festival_comment"/.test(p));
check('the comments column is asked by name', Boolean(commentPrompt), true);
check('and the lines put to it hold the comments alone', /Festival venue: Thursday/.test(commentPrompt) && !/where the festival gathers people/.test(commentPrompt), true);
check('and it is told a different line on every place is not the same as no pattern',
  /not the same as no pattern/.test(commentPrompt) && /which day, morning against evening/.test(commentPrompt), true);
check('the short columns are asked together, labelled', /columns of its data say[^\n]*"tree" \(a word or two\), "keeper"/.test(r1.log.think[3]), true);
check('the closed list is still told to every column\'s finder',
  r1.log.think.every((p) => /The categories column is a CLOSED list of 4/.test(p)), true);
check('three questions kept, one from each column', r1.questions.map((q) => q.column), ['festival_comment', 'description', 'address']);
check('each knows the column its words come from', r1.questions.map((q) => q.columns), [['festival_comment'], ['description'], ['address']]);
check('the answer prompt labels each place\'s line by column', /^0\. festival_comment: EMERGENCE/m.test(r1.log.file[0]) && /\n    description: A hotel/.test(r1.log.file[0]), true);
check('and says which column each question is asked of', /Which day is it on\?   \(asked of the "festival_comment" column only\)/.test(r1.log.file[0]), true);
const day = r1.questions.find((q) => q.column === 'festival_comment');
check('the day question reaches every place', day.answered, 24);
check('with its words taken from the comments', day.why.every((w) => w.length === 1 && DAYS.includes(w[0])), true);
check('the facts carry the column they came from', r1.facts, ['Festival comment: f', 'Description: f', 'Address: f']);

console.log('\n  the record says what became of every column');
const lineOf = (c) => (r1.columns.find((x) => x.column === c) || {}).line || '';
check('one line per word column, none missing', r1.columns.map((c) => c.column).sort(), fields.slice().sort());
check('the comments: a question kept, and how far it reaches', lineOf('festival_comment'),
  'Festival comment: 1 question kept: “Which day is it on?” (reaches 24 of 24 places)');
check('the description likewise', /^Description: 1 question kept: “What sort of place is it\?” \(reaches 24 of 24 places\)$/.test(lineOf('description')), true);
check('a column the model found nothing in says what the model said', lineOf('tree'),
  'Tree: no question kept — every place had a different tree (read together with keeper: a word or two a place, so these 2 columns were read together)');
check('a column passed over says why', lineOf('status'), 'Status: not asked — it says the same thing on every place');
check('and so does the one filled on a single place', lineOf('labels'), 'Labels: not asked — only 1 place has words here, too few to find a pattern in');
check('the lines are marked asked or not', r1.columns.filter((c) => c.asked).map((c) => c.column), ['festival_comment', 'description', 'address', 'tree', 'keeper']);

console.log('\n  the evidence for an answer must come from the column the question was asked of');
const r2 = await read({}, { cheat: true, perColumn: { festival_comment: found([dayQ]) } });
const cheated = r2.verdict === 'questions' ? r2.questions.find((q) => q.column === 'festival_comment') : null;
check('a day answer standing on a description word ("courtyard") is not kept', cheated ? cheated.answered : 0, 0);
check('so the question falls, and the record says why', (r2.columns.find((c) => c.column === 'festival_comment') || {}).line,
  'Festival comment: no question kept — “Which day is it on?” — fewer than two of its kinds fit three or more places');

console.log('\n  one question, asked by two columns, is one question');
const r3 = await read({}, { perColumn: { description: found([sortQ]), festival_comment: found([dayQ]), address: found([sortQ]) } });
check('the column read first keeps it', r3.questions.map((q) => q.question + ' ← ' + q.column),
  ['Which day is it on? ← festival_comment', 'What sort of place is it? ← description']);
check('and the address\'s copy is not counted twice', (r3.columns.find((c) => c.column === 'address') || {}).line,
  'Address: no question kept — its question was one another column had already asked');
const r3c = await read({}, { perColumn: { description: found([sortQ]), festival_comment: found([dayQ]), address: found([{ question: 'What sort of place is this?', kinds: sortQ.kinds }]) } });
check('the same question in slightly different words is the same question', r3c.questions.map((q) => q.question), ['Which day is it on?', 'What sort of place is it?']);

console.log('\n  every column says no: the model\'s own no, column by column');
const r4 = await read({}, {});
check('the verdict is the model\'s', r4.verdict, 'no_clear_questions');
check('with each column\'s reason', /^Festival comment: every place had a different festival_comment Description: every place had a different description/.test(r4.note), true);
check('and the record still has a line for every column', r4.columns.map((c) => c.column).sort(), fields.slice().sort());

console.log('\n  a second attempt re-asks only the column that left a hole');
const r5 = await read({ missed: [{ word: 'friday', places: 8, under: 'Which day is it on?' }], reuseFound: r1.found },
  { perColumn: { description: found([sortQ]), festival_comment: found([dayQ]), address: found([areaQ]) } });
check('one finder call, not four', r5.log.think.length, 1);
check('to the comments', /called "festival_comment"/.test(r5.log.think[0]), true);
check('told it is the second attempt', /IMPORTANT, this is a second attempt/.test(r5.log.think[0]), true);
check('the other columns\' questions are reused, unpaid', r5.questions.map((q) => q.column), ['festival_comment', 'description', 'address']);
check('and the whole set is answered again, once', r5.log.file.length, 1);

console.log('\n  a layer read under the old rule: keep its questions, add from the columns they never drew on');
const settled = [{ question: 'What sort of place is it?', kinds: SORTS.map((s) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), definition: '' })) }];
const r6 = await read({ keepQuestions: settled, addColumns: ['festival_comment'] },
  { perColumn: { description: found([sortQ]), festival_comment: found([dayQ]), address: found([areaQ]) } });
check('one finder call, to the named column only', r6.log.think.length, 1);
check('the settled question comes first, so its key keeps its place', r6.questions[0].question, 'What sort of place is it?');
check('and has no column, as it was found from the pile', r6.questions[0].column, '');
check('the new one follows, from the comments', [r6.questions[1].question, r6.questions[1].column], ['Which day is it on?', 'festival_comment']);
check('the columns not named are reported as not asked this time', (r6.columns.find((c) => c.column === 'address') || {}).line,
  'Address: not asked — this reading answered the questions already on the map');
const r7 = await read({ keepQuestions: settled }, { perColumn: { festival_comment: found([dayQ]) } });
check('a plain re-answer of settled questions asks no column', r7.log.think.length, 0);
check('and answers them once', [r7.log.file.length, r7.questions.length], [1, 1]);

console.log('\n  the calls a reading costs, before and after, on the made-up festival');
console.log('        before: 1 to find + 1 to answer = 2 (4 with the retry)');
console.log('        after:  ' + r1.log.think.length + ' to find + 1 to answer = ' + (r1.log.think.length + 1) + ' (' + (r1.log.think.length + 1 + 2) + ' with the retry)');
check('within the allowance of 24 with the retry', r1.log.think.length + 1 + 2 <= 24, true);

/* ---------- the server's side, read from the code ---------- */
console.log('\n  the server, read from its code');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const queueSrc = fs.readFileSync(ROOT + '/api/lib/atlas/questions-queue.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const css = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
check('the reading names the place\'s name column', /nameCol, callBudget: AI_CALLS_PER_READING,/.test(server), true);
check('and the allowance it may spend', /const AI_CALLS_PER_READING = 24;/.test(server), true);
check('the second attempt reuses the first\'s questions per column', /reuseFound: firstFound,/.test(server) && /firstFound = out\.found \|\| null;/.test(server), true);
check('there is still exactly one retry', (server.match(/await ask\(/g) || []).length, 2);
check('a re-read may add from named columns', /addColumns: Array\.isArray\(opts\.addColumns\)/.test(server), true);
check('which the job passes from the list', /addColumns: Array\.isArray\(job\.addColumns\) \? job\.addColumns : null/.test(server), true);
check('every column\'s line goes to the log', /for \(const c of \(out\.columns \|\| \[\]\)\) console\.log\('\[atlas\] ' \+ dataset \+ '\/' \+ layerId \+ ' — ' \+ c\.line\);/.test(server), true);
check('and onto the record when questions were written', /return \{ state: 'done', reason: '', calls: out\.calls, sig: fileSigOf\(dataset, layerId\) \|\| out\.sig,\s*columns: out\.columns \|\| \[\] \};/.test(server), true);
check('and when nothing was kept', /return \{ state: 'none', reason: why, sig: fileSigOf\(dataset, layerId\) \|\| out\.sig, columns: out\.columns \|\| \[\] \};/.test(server), true);
check('the stand-in pays one call per column read, like the real thing', /for \(const g of plan\.groups\) await pay\('fake', 'find ' \+ g\.label, null, \{\}\);/.test(server), true);
check('the list hands the lines to the owner\'s page', /columns: Array\.isArray\(r\.columns\) \? r\.columns : \[\]/.test(queueSrc), true);
check('the owner\'s page shows them under the keys', /columnLines\(wrap, readingOf\(L\.id\)\);/.test(owner), true);
check('and under "nothing here"', /columnLines\(wrap, said\);/.test(owner), true);
check('one list item per column line', /list\.appendChild\(el\("li", c\.asked \? "own-column asked" : "own-column", esc\(c\.line\)\)\);/.test(owner), true);
check('styled quietly', /\.own-columns \{/.test(css), true);

console.log('\n  the list: a re-read of the same version, adding columns');
{
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-columns-'));
  const q = createQueue({ file: path.join(TMP, 'q.json') });
  check('a layer goes on', q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x' }), true);
  q.remember('a', 'l', { state: 'done' });
  check('the same version again does not', q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x' }), false);
  check('unless columns are to be added', q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x', addColumns: ['festival_comment'] }), true);
  check('and the line says which', q.get('a', 'l').addColumns, ['festival_comment']);
  check('while it waits, it is not added again', q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x', addColumns: ['festival_comment'] }), false);
  q.remember('a', 'l', { state: 'done', columns: [{ column: 'x', line: 'X: fine' }] });
  check('the owner\'s page gets the lines', q.forDataset('a').l.columns, [{ column: 'x', line: 'X: fine' }]);
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('\n  the one-off script: layers whose questions never drew on a column');
{
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-rereads-'));
  const root = path.join(TMP, 'datasets');
  const put = (slug, layer, feats) => {
    fs.mkdirSync(path.join(root, slug), { recursive: true });
    fs.writeFileSync(path.join(root, slug, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(root, slug, 'manifest.local.json'), JSON.stringify({ layers: [layer] }));
    fs.writeFileSync(path.join(root, slug, layer.source), JSON.stringify({ type: 'FeatureCollection',
      features: feats.map((p) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [0, 0] } })) }));
  };
  // read under the old rule: a question drawing on the description, the comments untouched
  const old = RULES.shapeReading(rows, [{ question: 'What sort of place is it?', counts: SORTS.map((s) => ({ name: s })),
    categories: rows.map((r) => (r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]),
    why: rows.map((r) => [(r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]]) }]).rows;
  put('festival', { id: 'tags', type: 'marker', source: 'user-tags.geojson', label: 'Tags', popup: { title: 'loka_name' } }, old);
  put('unread', { id: 'pins', type: 'marker', source: 'user-pins.geojson' }, rows);
  put('deoria-bioregion', { id: 'tags', type: 'marker', source: 'user-tags.geojson' }, old);
  const u = unusedColumns({ popup: { title: 'loka_name' } }, old);
  check('the description is drawn on', u.drawnOn, ['description']);
  check('the comments and the address are not', u.unused.map((x) => x.column), ['festival_comment', 'address', 'tree', 'keeper']);
  const { want, skipped } = survey([root]);
  check('the layer read under the old rule is listed', want.map((w) => w.dataset + '/' + w.layerId), ['festival/tags']);
  check('with the columns to add', want[0].unused.map((x) => x.column), ['festival_comment', 'address', 'tree', 'keeper']);
  check('a layer never read is not this script\'s business', want.some((w) => w.dataset === 'unread'), false);
  check('deoria is skipped, visibly', skipped, [{ dataset: 'deoria-bioregion', why: 'never touched (standing rule)' }]);
  // and --apply, on a list of its own
  const { spawnSync } = await import('node:child_process');
  const qf = path.join(TMP, 'q.json');
  const dry = spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'queue-question-rereads.mjs'), '--queue', qf, '--registry', path.join(TMP, 'none.json'), root], { encoding: 'utf8' });
  check('a dry run names the layer and the columns', /festival\/tags/.test(dry.stdout) && /never drawn on: Festival comment \(text, \d+ characters on 24 places\)/.test(dry.stdout), true);
  check('and changes nothing', fs.existsSync(qf), false);
  const applied = spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'queue-question-rereads.mjs'), '--apply', '--queue', qf, '--registry', path.join(TMP, 'none.json'), root], { encoding: 'utf8' });
  const line = createQueue({ file: qf }).get('festival', 'tags');
  check('--apply puts it on the list', [applied.status, line && line.state], [0, 'queued']);
  check('with the columns to add', line && line.addColumns, ['festival_comment', 'address', 'tree', 'keeper']);
  check('nothing in the atlas folder was written', fs.readdirSync(path.join(root, 'festival')).sort(), ['manifest.json', 'manifest.local.json', 'user-tags.geojson']);
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
