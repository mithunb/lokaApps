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
  whyOf('categories'), 'the map can already colour places by this (3 answers)');
check('a column filled on one place is still read: no data is excluded for being sparse', whyOf('labels') === '' && kindOf('labels') !== '', true);
check('two names, neither on more than 85 of 100 places, is a key the map offers', /^the map can already colour places by this \(2 answers\)$/.test(whyOf('created_by')), true);
check('the same thing on every place is said so', whyOf('status'), 'says the same thing for every place');
check('one value everywhere, with spaces in it, likewise', whyOf('spaces'), 'says the same thing for every place');
check('nothing is unaccounted for: every word column is asked or passed over with a reason',
  [...tc.ask.map((a) => a.column), ...tc.passed.map((p) => p.column)].sort(), fields.slice().sort());
check('the place\'s name is never evidence', E.textColumns(rows, ['loka_name', 'description'], { nameCol: 'loka_name' }).passed[0].why,
  'this is the place’s name');
check('a column name reads as a label', [E.columnLabel('festival_comment'), E.columnLabel('created-by')], ['Festival comment', 'Created by']);

console.log('\n  the plan: one look per column, prose first, short columns together, within the allowance');
const plan = E.planColumns(rows, fields, { nameCol: 'loka_name', budget: 24, batches: 1 });
// prose first, the fuller column first (the made-up comments are longer than the descriptions), tags, then the address, then the short ones together
check('four groups: comment, description, address, and the short columns together',
  plan.groups.map((g) => g.label), ['festival_comment', 'description', 'address', 'tree + keeper + labels']);
check('the short columns are one group of two', plan.groups[3].columns, ['tree', 'keeper', 'labels']);
check('and say so', /read together/.test(plan.groups[3].why), true);
check('prose before an address, whatever their lengths', plan.groups.findIndex((g) => g.label === 'address') > plan.groups.findIndex((g) => g.label === 'description'), true);
check('room for ' + plan.maxGroups + ' looks on their own at 24 calls and 1 batch', plan.maxGroups, 21);
const tight = E.planColumns(rows, fields, { nameCol: 'loka_name', budget: 24, batches: 11 });
check('a reading of 420 places (11 batches) can afford one look', tight.maxGroups, 1);
check('so every column is read together in it', tight.groups.length, 1);
check('with every column on the line', tight.groups[0].columns, ['festival_comment', 'description', 'address', 'tree', 'keeper', 'labels']);
check('and the record says why, without counting calls', tight.groups[0].why, 'read together with other columns, to keep the cost of one reading down');
check('a plan never spends past the allowance: looks + answers + one retry', tight.groups.length + 11 + 1 + 11 <= 24, true);

/* ---------- a stand-in model that answers each column from its own words ---------- */
function stub({ perColumn = {}, cheat = false, log = {} } = {}) {
  log.think = []; log.file = [];
  return async (model, prompt, schema, o) => {
    // the careful check on answers (answer-check-test.mjs has its own checks): it says yes to all
    if (schema && schema.properties && schema.properties.checks) { (log.check = log.check || []).push(prompt); return { checks: [] }; }
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
        // a question with no column is answered from the whole record, or the whole line when nothing is labelled
        const part = (b.match(new RegExp('(?:^\\d+\\. |\\n    )' + (col || 'whole record') + ': ([^\\n]*)')) || [])[1] ||
          (!col && !/\n    /.test(b) ? b.replace(/^\d+\. /, '') : '');
        if (/which day/i.test(wording)) {
          const day = (part.match(/Thursday|Friday|Saturday/) || [])[0];
          if (day) { r['q' + n] = day; r['w' + n] = [cheat ? 'courtyard' : day]; }
        } else if (/sort of place/i.test(wording)) {
          const sort = (part.match(/hotel|gallery|church|garden|school|theatre/) || [])[0];
          if (sort) { r['q' + n] = sort.charAt(0).toUpperCase() + sort.slice(1); r['w' + n] = [sort]; }
        } else if (/kind of venue/i.test(wording)) {
          const sort = (part.match(/hotel|gallery|church|garden|school|theatre/) || [])[0];
          if (sort) { r['q' + n] = 'A ' + sort; r['w' + n] = [sort]; }
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
check('a column the model found nothing in says so in a fixed plain sentence, not the model\'s own note', lineOf('tree'),
  'Tree: no question kept — nothing in it sorts the places into groups (read with Keeper and Labels — each holds only a word or two)');
check('a column passed over says why', lineOf('status'), 'Status: not asked — says the same thing for every place');
check('the lines are marked asked or not', r1.columns.filter((c) => c.asked).map((c) => c.column), ['festival_comment', 'description', 'address', 'tree', 'keeper', 'labels']);

console.log('\n  the evidence for an answer must come from the column the question was asked of');
const r2 = await read({}, { cheat: true, perColumn: { festival_comment: found([dayQ]) } });
const cheated = r2.verdict === 'questions' ? r2.questions.find((q) => q.column === 'festival_comment') : null;
check('a day answer standing on a description word ("courtyard") is not kept', cheated ? cheated.answered : 0, 0);
check('so the question falls, and the record says why', (r2.columns.find((c) => c.column === 'festival_comment') || {}).line,
  'Festival comment: no question kept — “Which day is it on?” — fewer than two of its answers fit three or more places');

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
check('in a fixed plain sentence, not the model\'s own notes strung together', r4.note, 'None of the 4 columns read had anything that sorts the places into groups.');
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
check('a column not named this time is never called "not asked": it was read in the earlier reading', (r6.columns.find((c) => c.column === 'address') || {}).line,
  'Address: read earlier — nothing new this time');
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
check('the owner\'s page shows them in the Questions tab', /columnLines\(block, readingOf\(L\.id\)\);/.test(owner), true);
check('and under "nothing here"', /columnLines\(wrap, said\);/.test(owner), true);
check('one list item per column line', /list\.appendChild\(el\("li", c\.asked \? "own-column asked" : "own-column", esc\(plainColumnLine\(c\.line\)\)\)\);/.test(owner), true);
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
  check('the comments and the address are not', u.unused.map((x) => x.column), ['festival_comment', 'labels', 'address', 'tree', 'keeper']);
  const { want, skipped } = survey([root]);
  check('the layer read under the old rule is listed', want.map((w) => w.dataset + '/' + w.layerId), ['festival/tags']);
  check('with the columns to add', want[0].unused.map((x) => x.column), ['festival_comment', 'labels', 'address', 'tree', 'keeper']);
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
  check('with the columns to add', line && line.addColumns, ['festival_comment', 'labels', 'address', 'tree', 'keeper']);
  check('nothing in the atlas folder was written', fs.readdirSync(path.join(root, 'festival')).sort(), ['manifest.json', 'manifest.local.json', 'user-tags.geojson']);
  fs.rmSync(TMP, { recursive: true, force: true });
}

/* ---------- the review's fixes (2026-10-20) ---------- */
console.log('\n  1. only four reasons pass a column over; the rest are read');
{
  const mk = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const small = mk(30, (i) => ({
    loka_name: 'P' + i,
    // eleven different answers: the viewer's cap is ten, so the map never offers it
    zone: ['north', 'south', 'east', 'west', 'centre', 'hill', 'lake', 'fort', 'market', 'harbour', 'station'][i % 11],
    // one answer on 28 of 30 places: over the viewer's 85 in 100, so not a key either
    open: i < 28 ? 'yes' : 'no',
    // two names, three in four one of them: a key the viewer does offer
    keeper: i % 4 ? 'Asha' : 'Ravi',
    status: 'Active',
    sparse: i < 5 ? 'a note' : '',
  }));
  const f2 = ['zone', 'open', 'keeper', 'status', 'sparse'];
  const t2 = E.textColumns(small, f2, { nameCol: 'loka_name' });
  const k2 = (c) => (t2.ask.find((a) => a.column === c) || {}).kind || '';
  const w2 = (c) => (t2.passed.find((p) => p.column === c) || {}).why || '';
  check('eleven different answers is not a key the map offers, so it is read', k2('zone'), 'short');
  check('so the reading and the viewer agree on the cap (10, not 12)', E.keyShapedColumns(small, ['zone']).has('zone'), false);
  check('one answer on 28 of 30 places is not a key the map offers, so it is read', k2('open'), 'short');
  check('a column with few different values is no longer "a fact restated"', t2.passed.some((p) => /fact restated|over and over/.test(p.why)), false);
  check('a key the viewer offers is still passed over', /^the map can already colour places by this \(2 answers\)$/.test(w2('keeper')), true);
  check('one value on every place is passed over', w2('status'), 'says the same thing for every place');
  check('filled on few places (5 of 30) is still read', w2('sparse') === '' && k2('sparse') !== '', true);
  // a share, not a count: no floor in places (Mithun: "anything above 50% is legit")
  const tiny = mk(12, (i) => ({ loka_name: 'T' + i, note: i < 7 ? ['by the well', 'near the gate', 'under the tree', 'on the hill', 'past the school', 'at the lake', 'behind the temple'][i] : '' }));
  check('7 of 12 places filled (58%) is read, though under the old floor of 8', E.textColumns(tiny, ['note'], { nameCol: 'loka_name' }).ask.map((a) => a.column), ['note']);
  const half = mk(6, (i) => ({ note: i < 3 ? ['by the well', 'near the gate', 'under the tree'][i] : '' }));
  check('half filled is read', E.textColumns(half, ['note']).ask.length, 1);
  const sparse = mk(100, (i) => ({ note: i < 5 ? 'wheelchair ramp at the side' : '' }));
  check('one value on 5 of 100 places, empty on the rest, is read (it sorts has it / hasn\'t)', E.textColumns(sparse, ['note']).ask.length, 1);
  const empty = mk(10, () => ({ note: '' }));
  check('a column empty everywhere is passed over, said plainly', E.textColumns(empty, ['note']).passed[0].why, 'empty on every place');
  const most = mk(200, (i) => ({ note: i < 101 ? 'note number ' + i : '' }));
  check('101 of 200 is more than half: read', E.textColumns(most, ['note']).ask.length, 1);
  const p2 = E.planColumns(small, f2, { nameCol: 'loka_name', budget: 24, batches: 1 });
  check('the short columns with real variety share one look, at no extra call', p2.groups.map((g) => g.label), ['zone + open + sparse']);
}

console.log('\n  2. six questions a layer at most, settled ones keeping their place');
{
  const five = [1, 2, 3, 4, 5].map((n) => ({ question: 'Settled question number ' + n + '?',
    kinds: [{ name: 'Alpha ' + n, definition: '' }, { name: 'Beta ' + n, definition: '' }] }));
  const r = await read({ keepQuestions: five, addColumns: ['festival_comment', 'description'] },
    { perColumn: { festival_comment: found([dayQ]), description: found([sortQ]) } });
  check('five settled and two new make six, not seven', r.questions.length, 6);
  check('the settled five keep their places, first', r.questions.slice(0, 5).map((q) => q.question), five.map((q) => q.question));
  check('the best new one takes the sixth place', r.questions[5].question, 'Which day is it on?');
  check('the one left out is named on its column\'s line, with why',
    /“What sort of place is it\?” — a layer keeps at most 6 questions/.test((r.columns.find((c) => c.column === 'description') || {}).line), true);
  const six = [1, 2, 3, 4, 5, 6].map((n) => ({ question: 'Settled question number ' + n + '?', kinds: five[0].kinds }));
  const full = await read({ keepQuestions: six, addColumns: ['festival_comment'] }, { perColumn: { festival_comment: found([dayQ]) } });
  check('a layer already holding six adds nothing, and says so', full.verdict, 'nothing_new');
}

console.log('\n  3. a settled question with no column is answered from the whole record');
{
  const r = await read({ keepQuestions: settled, addColumns: ['festival_comment'] },
    { perColumn: { festival_comment: found([dayQ]) } });
  check('the answer prompt shows the whole record beside the asked column', /^0\. whole record: .*where the festival gathers people/m.test(r.log.file[0]) && /\n    festival_comment: EMERGENCE/.test(r.log.file[0]), true);
  check('and tells the model which part an un-columned question is judged by', /judged by the part labelled "whole record"/.test(r.log.file[0]), true);
  check('the settled question is not marked as asked of a column', /What sort of place is it\?\n/.test(r.log.file[0]), true);
  const sort = r.questions.find((q) => q.question === 'What sort of place is it?');
  check('so it is still answered, from the description inside the whole record', sort.answered, 24);
  const plain = await read({ keepQuestions: settled }, {});
  check('a plain re-answer sends the whole line, unlabelled, as before', /^0\. A hotel on Rua 1/m.test(plain.log.file[0]) && !/festival_comment: /.test(plain.log.file[0]), true);
  check('and only the columns a question is asked of are labelled', /\n    address: /.test(r.log.file[0]), false);
}

console.log('\n  4. the column a question came from is kept with it, and used next time');
{
  const shaped = RULES.shapeReading(rows, r1.questions);
  check('the reading\'s shape carries each question\'s column', shaped.keyColumns,
    { pattern_1: ['festival_comment'], pattern_2: ['description'], pattern_3: ['address'] });
  const settledAgain = RULES.settledQuestions({ keyLabels: shaped.keyLabels, keyKinds: shaped.keyKinds, keyColumns: shaped.keyColumns }, shaped.rows);
  check('and a layer gives it back as settled', settledAgain.map((q) => q.columns), [['festival_comment'], ['description'], ['address']]);
  check('a question from before has none', RULES.settledQuestions({ keyLabels: { pattern_1: 'Q?' }, keyKinds: { pattern_1: [{ name: 'a' }] } }, []).map((q) => q.columns), [[]]);
  const again = await read({ keepQuestions: settledAgain.slice(0, 1) }, { cheat: true });
  check('re-answered, it is asked of its own column', /Which day is it on\?   \(asked of the "festival_comment" column only\)/.test(again.log.file[0]), true);
  check('and a description word ("courtyard") still cannot stand under a day answer', again.questions[0].answered, 0);
  const honest = await read({ keepQuestions: settledAgain.slice(0, 1) }, {});
  check('while the comment\'s own words do', honest.questions[0].answered, 24);
  const gone = await read({ keepQuestions: [Object.assign({}, settledAgain[0], { columns: ['no_such_column'] })] }, {});
  check('a column that has gone from the places falls back to the whole record', /^0\. EMERGENCE|^0\. A hotel/m.test(gone.log.file[0]) && !/asked of the/.test(gone.log.file[0]), true);
}

console.log('\n  5. an add-columns re-read that keeps nothing new stops there');
{
  const r = await read({ keepQuestions: settled, addColumns: ['festival_comment'] }, {});
  check('nothing new found: the verdict says so', r.verdict, 'nothing_new');
  check('and nothing is answered again', r.log.file.length, 0);
  check('the column asked still has its line', /^Festival comment: no question kept/.test((r.columns.find((c) => c.column === 'festival_comment') || {}).line), true);
  const fell = await read({ keepQuestions: settled, addColumns: ['festival_comment'] }, { cheat: true, perColumn: { festival_comment: found([dayQ]) } });
  check('a new question that falls in the counting also ends as nothing new — not written', fell.verdict, 'nothing_new');
}

console.log('\n  6. a question that sorts the places the same way as a kept one is a duplicate');
{
  const venueQ = { question: 'What kind of venue is it?', kinds: SORTS.map((x, k) => ({ name: 'A ' + x, definition: 'Places that', examples: [k + 1, k + 7, k + 13] })) };
  check('the wording alone would not catch it', E.similarity(venueQ.question, sortQ.question) < 0.8, true);
  const r = await read({ keepQuestions: settled, addColumns: ['description'] }, { perColumn: { description: found([venueQ]) } });
  check('against a settled question: dropped, so nothing new', r.verdict, 'nothing_new');
  check('and the line says which question it repeated', /“What kind of venue is it\?” — it sorted the places the same way as “What sort of place is it\?”/.test((r.columns.find((c) => c.column === 'description') || {}).line), true);
  const r2 = await read({}, { perColumn: { description: found([sortQ, venueQ]) } });
  check('two new questions in one reading: the first keeps it', r2.questions.map((q) => q.question), ['What sort of place is it?']);
  check('and the echo is recorded', r2.echoed.some((e) => e.sameAs === 'What sort of place is it?'), true);
}

console.log('\n  7. the owner\'s per-column lines stay accurate');
{
  const r = await read({ keepQuestions: settled, addColumns: ['festival_comment'], previousColumns: r1.columns },
    { perColumn: { festival_comment: found([dayQ]) } });
  const ln = (x, c) => (x.columns.find((y) => y.column === c) || {}).line;
  check('a column this reading did not look at keeps its earlier line', ln(r, 'address'), ln(r1, 'address'));
  check('and is still marked as asked', (r.columns.find((y) => y.column === 'address') || {}).asked, true);
  check('the column it did look at gets a new line', /^Festival comment: 1 question kept/.test(ln(r, 'festival_comment')), true);
  check('a passed-over column keeps its line too', ln(r, 'status'), ln(r1, 'status'));
  const settledCols = [{ question: 'Which area is it in?', kinds: areaQ.kinds.map((k) => ({ name: k.name, definition: '' })), columns: ['address'] }];
  const noPrev = await read({ keepQuestions: settledCols }, {});
  check('with no earlier line, a settled question\'s column says what it kept', /^Address: looked at in an earlier reading, which kept “Which area is it in\?”/.test(ln(noPrev, 'address')), true);
  check('no line on a re-answer says "not asked" of a column that was read', noPrev.columns.filter((c) => /not asked — this reading/.test(c.line)).length, 0);
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-lines-'));
  const q = createQueue({ file: path.join(TMP, 'q.json') });
  q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x' });
  q.remember('a', 'l', { state: 'done', columns: [{ column: 'x', line: 'X: 1 question kept', asked: true }] });
  q.offer({ dataset: 'a', layerId: 'l', sig: 's1', restore: true });
  check('a restore keeps the lines', q.get('a', 'l').columns, [{ column: 'x', line: 'X: 1 question kept', asked: true }]);
  q.offer({ dataset: 'a', layerId: 'l', sig: 's1', payer: 'o@x', addColumns: ['y'] });
  check('so does an add-columns re-read while it waits', q.get('a', 'l').columns.length, 1);
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('\n  8. the re-read script is safe to run twice, and fair about shared words');
{
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-rereads2-'));
  const root = path.join(TMP, 'datasets');
  // the comment repeats the description's sort word, so both columns are drawn on
  const shared = rows.map((r) => Object.assign({}, r, { festival_comment: r.festival_comment + ' At the ' + (r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0] + '.' }));
  const old = RULES.shapeReading(shared, [{ question: 'What sort of place is it?', counts: SORTS.map((x) => ({ name: x })),
    categories: shared.map((r) => (r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]),
    why: shared.map((r) => [(r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]]) }]).rows;
  const u = unusedColumns({ popup: { title: 'loka_name' } }, old);
  check('a column whose words stand under answers counts as drawn on, even when another column has them too', u.drawnOn.slice().sort(), ['description', 'festival_comment']);
  fs.mkdirSync(path.join(root, 'fest'), { recursive: true });
  fs.writeFileSync(path.join(root, 'fest', 'manifest.json'), '{}');
  fs.writeFileSync(path.join(root, 'fest', 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'tags', type: 'marker', source: 'user-tags.geojson', popup: { title: 'loka_name' } }] }));
  const plainOld = RULES.shapeReading(rows, [{ question: 'What sort of place is it?', counts: SORTS.map((x) => ({ name: x })),
    categories: rows.map((r) => (r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]),
    why: rows.map((r) => [(r.description.match(/hotel|gallery|church|garden|school|theatre/) || [''])[0]]) }]).rows;
  fs.writeFileSync(path.join(root, 'fest', 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection',
    features: plainOld.map((p) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [0, 0] } })) }));
  const qf = path.join(TMP, 'q.json'), rf = path.join(TMP, 'registry.json');
  fs.writeFileSync(rf, JSON.stringify({ instances: { fest: { email: 'setup@x', ownerAccount: 'owner@x' } } }));
  const { spawnSync } = await import('node:child_process');
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'queue-question-rereads.mjs'), '--apply', '--queue', qf, '--registry', rf, root], { encoding: 'utf8' });
  run();
  const first = createQueue({ file: qf }).get('fest', 'tags');
  check('the first run puts it on the list, charged to the owner\'s account, not the setup email', [first.state, first.payer], ['queued', 'owner@x']);
  createQueue({ file: qf }).remember('fest', 'tags', { state: 'done' });
  const second = run();
  check('run again after the re-read: not added again', /already re-read for these columns at this version/.test(second.stdout) && /^0 put on the list/m.test(second.stdout), true);
  check('the record is untouched', createQueue({ file: qf }).get('fest', 'tags').state, 'done');
  const { alreadyReread } = await import('../deploy/queue-question-rereads.mjs');
  const w = { sig: 's', unused: [{ column: 'a' }, { column: 'b' }] };
  check('the same columns at the same version: already done', alreadyReread({ sig: 's', addColumns: ['a', 'b'] }, w), true);
  check('fewer columns wanted than were asked: already done', alreadyReread({ sig: 's', addColumns: ['a', 'b', 'c'] }, w), true);
  check('a column not asked then: not done', alreadyReread({ sig: 's', addColumns: ['a'] }, w), false);
  check('a new version of the places: not done', alreadyReread({ sig: 't', addColumns: ['a', 'b'] }, w), false);
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log('\n  9. the right account is charged, everywhere work is queued');
{
  const { payerOf } = await import('../api/lib/atlas/questions-queue.js');
  check('the owner\'s account first', payerOf({ ownerAccount: 'owner@x', email: 'setup@x' }), 'owner@x');
  check('the setup email only when there is no account', payerOf({ email: 'setup@x' }), 'setup@x');
  check('nobody: empty', payerOf(null), '');
  const srv = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  const scripts = ['queue-question-rereads', 'queue-question-readings', 'queue-place-names', 'queue-short-labels']
    .map((n) => [n, fs.readFileSync(ROOT + '/deploy/' + n + '.mjs', 'utf8')]);
  for (const [n, src] of scripts) {
    check(n + ' charges payerOf(the atlas)', /const owner = payerOf\(instances\[w\.dataset\]\);/.test(src) && !/instances\[w\.dataset\]\.email/.test(src), true);
  }
  check('the server never charges a bare setup email', /payer: \(inst && inst\.email\)|const payer = \(inst && inst\.email\)/.test(srv), false);
  check('the server\'s readings, short names and place names charge payerOf',
    (srv.match(/payerOf\(inst\)/g) || []).length >= 5, true);
  check('a retry of an owed reading is charged to the owner, not the server', /payer: o\.payer \|\| payerOf\(reg\.getInstance\(o\.dataset\)\)/.test(srv), true);
  check('and the owed list keeps who pays', /payer: payer \|\| \(had && had\.payer\) \|\| ''/.test(fs.readFileSync(ROOT + '/api/lib/atlas/owed.js', 'utf8')), true);
}

console.log('\n  the server keeps the column, the lines and the stop, read from its code');
{
  const srv = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  const qsrc = fs.readFileSync(ROOT + '/api/lib/atlas/questions-queue.js', 'utf8');
  check('the write carries each question\'s column to the layer', /keyLabels: labels, keyKinds: kinds, keyColumns: froms,/.test(srv), true);
  check('the ingest keeps it', /keyColumns: \(b\.keyColumns && typeof b\.keyColumns === 'object'\)/.test(srv), true);
  check('the commit replaces it with the labels, so a stale column never names a new question', /const cols = dropStale\(frag\.stanza\.keyColumns, session\.keyColumns \|\| \{\}\);/.test(srv), true);
  check('the kept copy of the answers keeps it', /keyColumns: only\(layer\.keyColumns\)/.test(srv), true);
  check('and a layer that lost its own gets it back', /columns: \(\(kept\.keyColumns \|\| \{\}\)\[c\] \|\| \[\]\)\.slice\(\)/.test(srv) && /keyColumns: kept\.keyColumns,/.test(srv), true);
  check('a reading is handed the record\'s earlier lines', /const previousColumns = \(\(QUESTIONS\.get\(dataset, layerId\) \|\| \{\}\)\.columns\) \|\| \[\];/.test(srv) && /\n    previousColumns,\n/.test(srv), true);
  check('the operator\'s re-read puts its lines on the record', /QUESTIONS\.remember\(dataset, layerId, \{ columns: out\.columns \}\);/.test(srv), true);
  check('the list carries the lines to a new line on it', /\['names', 'from', 'by', 'off', 'columns'\]/.test(qsrc), true);
  check('a re-read that added nothing ends as done, without writing', /if \(out\.verdict === 'nothing_new'\) \{[\s\S]{0,500}return \{ state: 'done'/.test(srv), true);
  check('the comment no longer claims a reading stays within 24 calls', /one ATTEMPT at a reading may not exceed this/.test(srv), true);
}

console.log('\n  10. plain words on the owner\'s page');
{
  const all = [r1, r2, r3, r4, r6].flatMap((x) => x.columns || []).map((c) => c.line);
  check('no line says "kinds"', all.filter((l) => /\bkinds?\b/.test(l)), []);
  check('no line counts calls', all.filter((l) => /\bcalls?\b|allowance/.test(l)), []);
  const reserved = { question: 'What is it about?', kinds: [{ name: 'Culture', definition: 'Places that', examples: [1, 2, 3] }, { name: 'Nature', definition: 'Places that', examples: [4, 5, 6] }] };
  const r = await read({}, { perColumn: { description: found([reserved]) } });
  check('a suggestion whose answers fall away says so plainly', /^Description: no question kept — it suggested 1 question, but it did not have two answers that each fit three or more places$/.test((r.columns.find((c) => c.column === 'description') || {}).line), true);
  const plan2 = { groups: [{ label: 'a', columns: ['a'], kinds: ['text'] }], passed: [] };
  check('and when there is nothing more to say: too vague', E.columnReport(plan2, { a: { state: 'asked', proposed: 1, dropped: 0, twice: 0 } }, [])[0].line,
    'A: no question kept — what it suggested was too vague to sort the places');
  const threeShort = { groups: [{ label: 'x + tree + keeper', columns: ['x', 'tree', 'keeper'], kinds: ['short', 'short', 'short'] }], passed: [] };
  check('a short column read with two others names them plainly', E.columnReport(threeShort, { 'x + tree + keeper': { state: 'none' } }, [])[0].line,
    'X: no question kept — nothing in it sorts the places into groups (read with Tree and Keeper — each holds only a word or two)');
  const sq = E.columnReport(tight, { [tight.groups[0].label]: { state: 'none' } }, [], [], 0, {});
  check('a column squeezed in with others says why, without numbers', sq[0].line,
    'Festival comment: no question kept — nothing in it sorts the places into groups (read together with other columns, to keep the cost of one reading down: with Description, Address, Tree, Keeper and Labels)');
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
