/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The question-finding scorecard (deploy/scorecard.mjs): each measure held
   to a hand-made case (how much two questions overlap, how often a thing
   asked about comes back, how far a question reaches and how its answers
   spread, how alike repeated filings are), its refusal of deoria-bioregion in
   any spelling and of a report folder inside this repository, and a whole
   scorecard with the stand-in model (no network) that writes its four files
   into its own folder and nothing into the atlases or the server's data. */
import { parseArgs, callCeiling, nmi, kappa, filingAgreement, pickModal, recurrence, spreadOf,
  aboutTheRecord, unfinished, sample, isPeopleColumn, outFolder, itemOf, personColumns, withoutCredit,
  answersArePeople } from '../deploy/scorecard.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const r2 = (x) => Math.round(x * 100) / 100;
const TOOL = path.join(ROOT, 'deploy', 'scorecard.mjs');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

console.log('\n  the options');
{
  const d = parseArgs(['--dataset=some-atlas', '--layer=places']);
  check('10 readings, 5 filings and 5 summaries by default', [d.dataset, d.layer, d.finderRuns, d.filingRuns, d.summaryRuns, d.stub], ['some-atlas', 'places', 10, 5, 5, false]);
  check('the runs stay in their bounds', [parseArgs(['--dataset=x', '--finder-runs=1']).finderRuns, parseArgs(['--dataset=x', '--finder-runs=99']).finderRuns,
    parseArgs(['--dataset=x', '--filing-runs=0']).filingRuns, parseArgs(['--dataset=x', '--summary-runs=50']).summaryRuns], [2, 20, 0, 10]);
  check('the default ceiling is room for every run at the server\'s caps (100 places: 560 + 35 + 20)',
    callCeiling({ places: 100, finderRuns: 10, filingRuns: 5, summaryRuns: 5 }), 615);
}

console.log('\n  goal 3: how much two questions say the same');
{
  check('the same sorting under other names: 1', r2(nmi(['a', 'a', 'b', 'b', 'c', 'c'], ['x', 'x', 'y', 'y', 'z', 'z']).nmi), 1);
  check('two sortings that cut across each other: 0', r2(nmi(['a', 'b', 'a', 'b'], ['x', 'x', 'y', 'y']).nmi), 0);
  check('places with no answer or "none of these" to either are left out',
    nmi(['a', 'a', 'b', 'b', '', 'other', 'a'], ['x', 'x', 'y', 'y', 'x', 'y', '']), { nmi: 1, places: 4 });
  // a: 4 a's then 4 b's; b agrees on 3 of each side: I = ln2 - H(0.75) ≈ 0.131, H = ln2 each
  check('a partial overlap, worked by hand: 0.19', r2(nmi(['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'], ['x', 'x', 'x', 'y', 'y', 'y', 'y', 'x']).nmi), 0.19);
  check('one answer only: nothing to share', nmi(['a', 'a', 'a'], ['x', 'y', 'x']).nmi, 0);
}

console.log('\n  goal 6: how alike repeated filings are');
{
  check('kappa: the same answers everywhere is 1', kappa(['a', 'b', 'other', ''], ['a', 'b', 'other', '']), 1);
  check('kappa: no better than chance is 0', kappa(['a', 'a', 'b', 'b'], ['a', 'b', 'a', 'b']), 0);
  check('kappa: a worked case (agree 3 of 4, chance 1 in 2) is 0.5', kappa(['a', 'a', 'a', 'b'], ['a', 'a', 'b', 'b']), 0.5);
  const base = ['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b', 'other', ''];
  const moved = base.slice(); moved[0] = 'b';
  const f = filingAgreement([base, base, moved, base, base]);
  check('five filings, one place moved once: 9 of 10 the same every time', [f.places, f.same, f.sameShare, f.pairs], [10, 9, 0.9, 10]);
  check('and the mean kappa over the 10 pairs is between', f.kappa > 0.8 && f.kappa < 1, true);
}

console.log('\n  goal 2: what comes back from one reading to the next');
{
  check('a question is told apart by its checklist item, or by its words for "something else" and none',
    [itemOf({ about: 4, question: 'X?' }), itemOf({ about: 8, question: 'What Is It?' }), itemOf({ about: 0, question: 'Y?' })],
    ['item 4', 'asks: what is it?', 'asks: y?']);
  const typical = ['item 1', 'item 2', 'item 4'];
  const runs = [typical, typical, typical, typical, typical, ['item 1', 'item 2'], ['item 1', 'item 2'], ['item 1', 'item 6'], ['item 1', 'item 6'], null];
  const m = pickModal(runs);
  check('the most typical reading is one with the set that comes up most', m, 0);
  const rec = recurrence(runs, m);
  // 9 measured: 7 needed. item 1 in 9, item 2 in 7, item 4 in 5
  check('a thing comes back when it is in 7 of every 10 measured readings', [rec.of, rec.need, rec.items.map((x) => x.runs)], [9, 7, [9, 7, 5]]);
  check('and the share that came back is 2 of 3', r2(rec.share), 0.67);
  check('a reading that could not be finished is never the typical one', pickModal([null, [], ['item 2']]), 2);
}

console.log('\n  goals 4 and 5: how far a question reaches, and how its answers spread');
{
  const s = spreadOf({ answered: 30, other: 10, counts: [{ name: 'a', count: 20 }, { name: 'b', count: 10 }] }, 50);
  check('answers 30 of 50 places; the top answer 20 of 30; "none of these" 10 of the 40 read', [s.cover, r2(s.biggest), s.none], [0.6, 0.67, 0.25]);
  check('a question nobody answered spreads nothing', spreadOf({ answered: 0, other: 0, counts: [] }, 10), { cover: 0, biggest: 0, none: 0 });
}

console.log('\n  goal 1: about the place, never the record');
{
  check('read from who made the record: about the record', aboutTheRecord({ question: 'Which name is given?', columns: ['created_by'] }), true);
  check('…or from any *_user_id column', aboutTheRecord({ question: 'Which one?', columns: ['notes', 'editor_user_id'] }), true);
  check('worded about who added it: about the record', aboutTheRecord({ question: 'Who added this place?', columns: ['description'] }), true);
  check('about the place: not', [aboutTheRecord({ question: 'What is it made of?', columns: ['description'] }),
    aboutTheRecord({ question: 'Which day is it on?', columns: [] })], [false, false]);
}

console.log('\n  goal 7: a sentence that stops part way');
{
  check('a whole sentence is finished', unfinished('Of the 12 places that answer it, 8 say stone.'), false);
  check('no full stop: unfinished', unfinished('Of the 12 places, 8 say'), true);
  check('a last word that needs another: unfinished', unfinished('Most of the 12 places are built of stone and.'), true);
  check('…unless it is an answer\'s own name', [unfinished('Of the 24 places, 10 say from.', ['from']), unfinished('Of the 24 places, 10 say from.')], [false, true]);
  check('a closing quote after the stop is fine', unfinished('Of the 9 places, 4 say “market.”'), false);
}

console.log('\n  the person check: the same places every time, never who made them');
{
  const all = Array.from({ length: 100 }, (_, i) => i);
  const a = sample(all, 30, 7), b = sample(all, 30, 7);
  check('30 places, all different, the same 30 for the same seed', [a.length, new Set(a).size, JSON.stringify(a) === JSON.stringify(b)], [30, 30, true]);
  check('all of them when there are fewer', sample([1, 2, 3], 30, 7).length, 3);
  check('columns about people are never copied', ['created_by', 'created_by_user_id', 'owner_user_id', 'author', 'Contributor', 'email'].map(isPeopleColumn),
    [true, true, true, true, true, true]);
  check('the place\'s own columns are', ['description', 'name', 'categories', 'tags', 'nearby'].map(isPeopleColumn), [false, false, false, false, false]);
  check('…nor anything ending in _by or _user_id, nor a collector or owner',
    ['edited_by', 'last_edited_by', 'collected_by', 'reviewed_by', 'approved_by_user_id', 'collector', 'Owner', 'username', 'user'].map(isPeopleColumn),
    [true, true, true, true, true, true, true, true, true]);
  check('only the columns the questions read, and LOKA\'s short name, are copied',
    personColumns([{ columns: ['description'] }, { columns: ['labels', 'created_by'] }, { columns: [] }], [{ loka_name: 'A', description: 'x' }]),
    ['loka_name', 'description', 'labels']);
  check('a credit line goes wherever it sits; the running text stays',
    withoutCredit('A banyan by the lake.\nPhoto: Kiran\nImage courtesy Ravi\nThe bark is grey.\n© Asha 2024\nPic by Leela\nCourtesy: BBMP\nwith credit to Meera'),
    'A banyan by the lake. The bark is grey.');
  check('a question read from who made the record has answers that are people', [answersArePeople({ columns: ['created_by'] }), answersArePeople({ columns: ['description'] })], [true, false]);
}

console.log('\n  where the report may go');
{
  check('never this repository', Boolean(outFolder(ROOT, 'x').dir), false);
  check('never an atlas\'s folder', Boolean(outFolder(path.join(ROOT, 'atlas', 'datasets', 'cubbonpark', 'report'), 'x').dir), false);
  check('never the server\'s data', Boolean(outFolder(path.join(ROOT, 'api', 'data', 'scores'), 'x').dir), false);
  const shouting = ROOT.toUpperCase();
  check('never the repository spelled in other capitals, on a disk that does not tell them apart',
    fs.existsSync(shouting) ? Boolean(outFolder(path.join(shouting, 'atlas', 'report'), 'x').dir) : false, false);
  check('a folder elsewhere is fine', Boolean(outFolder(path.join(os.tmpdir(), 'scores'), 'x').dir), true);
  check('with none named, a new folder outside the repository', (() => { const d = outFolder('', 'cubbon').dir; return Boolean(d) && !d.startsWith(ROOT); })(), true);
}

console.log('\n  refusals, from the command line');
{
  const deo = run('--dataset=deoria-bioregion', '--layer=x', '--stub');
  check('--dataset=deoria-bioregion: refused, nothing read', [deo.status, /refused: deoria-bioregion/.test(deo.stderr)], [1, true]);
  const deoCase = run('--dataset=Deoria-Bioregion', '--stub');
  check('…in any spelling', [deoCase.status, /refused: deoria-bioregion/.test(deoCase.stderr)], [1, true]);
  const deoFile = run('--file=/nowhere/DEORIA-BIOREGION.json', '--stub');
  check('…and as a file', [deoFile.status, /refused: deoria-bioregion/.test(deoFile.stderr)], [1, true]);
  const inRepo = run('--file=/nowhere/places.json', '--stub', '--out=' + path.join(ROOT, 'atlas', 'scorecard-here'));
  check('a report folder inside the repository: refused before anything is read',
    [inRepo.status, /refused: the report never goes inside this repository/.test(inRepo.stderr), fs.existsSync(path.join(ROOT, 'atlas', 'scorecard-here'))], [1, true, false]);
  const odd = run('--dataset=x', '--bogus');
  check('an unknown option is refused', [odd.status, /unknown option --bogus/.test(odd.stderr)], [1, true]);
  const help = run('--help');
  check('--help: the usage, and no failure', [help.status, /--finder-runs=N/.test(help.stdout), /--out=DIR/.test(help.stdout)], [0, true, true]);
}

/* Every file under the atlases' and the server's data folders, with when it
   last changed: the same before and after a whole scorecard. */
function snapshot() {
  const seen = [];
  const walk = (d) => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { seen.push(p + ' ' + fs.statSync(p).mtimeMs); } catch { /* gone */ } }
    }
  };
  walk(path.join(ROOT, 'atlas', 'datasets'));
  walk(path.join(ROOT, 'api', 'data'));
  return seen.sort();
}

console.log('\n  a whole scorecard, with the stand-in model');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-'));
try {
  const AREAS = ['Campal', 'Fontainhas', 'Miramar', 'Altinho'];
  const MATERIAL = ['stone', 'brick', 'timber'];
  const WHO = ['Asha Rao', 'Vikram Naik', 'Leela Kamat'];
  const features = Array.from({ length: 24 }, (_, i) => ({ type: 'Feature', geometry: null, properties: {
    loka_name: 'Place ' + (i + 1),
    description: 'Shelter number ' + (i + 1) + ' is ' + (i % 2 ? 'large' : 'small') + ' and built of ' + MATERIAL[i % 3] + ' beside the river.\nPhoto: Kiran Desai',
    address: (i % 6 < 3 ? 'Rua ' : 'Avenida ') + (i + 1) + ', ' + AREAS[i % 4] + ', Panaji, Goa, India',
    created_by: WHO[i % 3],
  } }));
  const file = path.join(dir, 'places.json');
  fs.writeFileSync(file, JSON.stringify({ layer: { id: 'places', popup: { title: 'loka_name' } }, features }));
  const stamp = fs.statSync(file).mtimeMs;
  const out = path.join(dir, 'report');
  const before = snapshot();
  const r = run('--file=' + file, '--stub', '--out=' + out);
  check('it runs', r.status, 0);
  check('every goal has a line, and the calls used are said', [(r.stdout.match(/^ {2}[1-7]\. /gm) || []).length, /Calls used: \d+ of at most \d+\./.test(r.stdout)], [7, true]);
  check('four files, in its own folder only', fs.readdirSync(out).sort(),
    ['person-check-ai-answers.json', 'person-check-places.json', 'scorecard.json', 'scorecard.md']);
  check('nothing beside the places, and the places untouched', [fs.readdirSync(dir).sort(), fs.statSync(file).mtimeMs], [['places.json', 'report'], stamp]);
  check('nothing in the atlases or the server\'s data changed', JSON.stringify(snapshot()) === JSON.stringify(before), true);
  const card = JSON.parse(fs.readFileSync(path.join(out, 'scorecard.json'), 'utf8'));
  check('ten readings, the same two questions each time (the stand-in is steady)', [card.runs.length, card.runs.every((x) => x.questions.length === 2)], [10, true]);
  check('goals 1, 2, 3, 6 and 7 pass on the stand-in; the covering mark is the small atlas\'s',
    [1, 2, 3, 6, 7].map((n) => card.goals[n - 1].result).concat([card.small, card.goals[3].mark]),
    ['PASS', 'PASS', 'PASS', 'PASS', 'PASS', true, 'at least 60% each (small atlas)']);
  check('"none of these" on a third of the places read fails goal 5', card.goals[4].result, 'FAIL');
  check('no place\'s own words, and no answer list, in the scorecard', /Shelter number|"categories"|"_raw"/.test(fs.readFileSync(path.join(out, 'scorecard.json'), 'utf8')), false);
  const md = fs.readFileSync(path.join(out, 'scorecard.md'), 'utf8');
  check('the Markdown has the table, each reading\'s questions, and the summaries to rate',
    [/\| # \| Goal \| Measured \| Pass mark \| Result \|/.test(md), (md.match(/^\*\*Reading \d+\*\*/gm) || []).length, (md.match(/^Your rating: ____$/gm) || []).length], [true, 10, 5]);
  const people = fs.readFileSync(path.join(out, 'person-check-places.json'), 'utf8');
  const pc = JSON.parse(people);
  check('the person check: every place (fewer than 30), two questions, with their kinds', [pc.places.length, pc.questions.length, pc.questions.every((q) => q.kinds.length >= 2)], [24, 2, true]);
  check('a note says who it is for, and only LOKA\'s name and the column the questions read are copied',
    [/^For the atlas owner only; descriptions are as published/.test(pc.note), [...new Set(pc.places.flatMap((p) => Object.keys(p.words)))].sort()], [true, ['description', 'loka_name']]);
  check('with the places\' own words but never who made them, nor a photo credit',
    [/Shelter number/.test(people), /Asha|Vikram|Leela|created_by|Kiran/.test(people), /"reading"|"filed"/.test(people)], [true, false, false]);
  const ai = JSON.parse(fs.readFileSync(path.join(out, 'person-check-ai-answers.json'), 'utf8'));
  check('the model\'s answers are kept apart, place by place', [ai.answers.length, ai.answers.map((a) => a.id).join() === pc.places.map((p) => p.id).join(), Object.keys(ai.answers[0].answers)], [24, true, ['q1', 'q2']]);

  const tight = run('--file=' + file, '--stub', '--out=' + path.join(dir, 'tight'), '--max-calls=3');
  check('the ceiling holds: 3 calls, and what could not be reached is said to be not measured',
    [tight.status, /Calls used: 3 of at most 3\./.test(tight.stdout), /6\. Same answers when asked again\s+NOT MEASURED/.test(tight.stdout)], [0, true, true]);
  const proofless = run('--file=' + file, '--stub', '--out=' + path.join(dir, 'proofless'), '--finder-runs=2', '--filing-runs=0', '--summary-runs=1', '--max-calls=5');
  check('a summary whose proofread the ceiling stopped is not measured, not failed',
    [proofless.status, /7\. A useful summary\s+NOT MEASURED/.test(proofless.stdout), /Calls used: 5 of at most 5\./.test(proofless.stdout)], [0, true, true]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
const src = fs.readFileSync(TOOL, 'utf8');
check('the tool writes in one place only, the report\'s folder', (src.match(/writeFileSync|appendFileSync|createWriteStream|renameSync|copyFile/g) || []).length, 1);
check('and asks nothing of the server: no api/apps/ code is loaded',
  /^import .*(api\/apps\/|registry\.js'|imports\.js'|questions-queue)/m.test(src + fs.readFileSync(path.join(ROOT, 'deploy', 'lib-measure.mjs'), 'utf8')), false);
check('the shared helpers write nothing at all',
  /writeFileSync|appendFileSync|createWriteStream|mkdirSync|renameSync|writeFile\(|copyFile/.test(fs.readFileSync(path.join(ROOT, 'deploy', 'lib-measure.mjs'), 'utf8')), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
