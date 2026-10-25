/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The measuring tool's sample of disagreements (deploy/measure-answer-check.mjs
   --stability --sample=N): pairs where the quick and careful models answered
   differently, spread over the questions, never a question about people, and
   never a tagger's name anywhere in the file. Run with the stand-in model, so
   no network; the files go to a temporary folder. */
import { pickSample, peopleQuestions, isAboutPeople } from '../deploy/measure-answer-check.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const TAGGERS = ['Asha Rao', 'Vikram Shenoy'];
const SORTS = ['pond lake', 'tree grove', 'stone wall', 'tree lake', 'pond grove', 'stone tree'];
const features = Array.from({ length: 30 }, (_, k) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.5, 12.9] },
  properties: {
    loka_name: 'Spot ' + k,
    description: 'A ' + SORTS[k % SORTS.length] + ' spot, noted by ' + TAGGERS[k % 2] + ', clean and safe, sometimes dirty',
    labels: 'nature; ' + SORTS[k % SORTS.length].split(' ')[0],
    created_by: TAGGERS[k % 2],
  } }));
const layer = {
  id: 'spots',
  keyLabels: { pattern_1: 'What is it mostly?', pattern_2: 'What condition is it in?', pattern_3: 'Who added it?', pattern_4: 'Whose tag is it?' },
  keyKinds: {
    pattern_1: [{ name: 'Pond', definition: 'Places with a pond' }, { name: 'Tree', definition: 'Places with trees' }, { name: 'Stone', definition: 'Places of stone' }],
    pattern_2: [{ name: 'Clean', definition: 'Places described as clean' }, { name: 'Dirty', definition: 'Places described as dirty' }],
    pattern_3: [{ name: 'Asha Rao', definition: 'Added by Asha Rao' }, { name: 'Vikram Shenoy', definition: 'Added by Vikram Shenoy' }],
    pattern_4: [{ name: 'Asha', definition: 'Tagged by Asha' }, { name: 'Vikram', definition: 'Tagged by Vikram' }],
  },
  keyColumns: { pattern_4: ['created_by'] },
};

console.log('\n  questions about people');
const people = peopleQuestions(layer, []);
check('a question drawn from created_by is about people', isAboutPeople('Whose tag is it?', people), true);
check('a "Who …" question is about people', isAboutPeople('Who added it?', people), true);
check('a question about the place is not', isAboutPeople('What condition is it in?', people), false);
check('nor is a column ending in _user_id left out',
  isAboutPeople('Which account?', peopleQuestions({ keyLabels: { pattern_1: 'Which account?' }, keyColumns: { pattern_1: ['owner_user_id'] } }, [])), true);

console.log('\n  the pick, on made-up runs');
{
  const questions = [{ question: 'What is it mostly?', kinds: layer.keyKinds.pattern_1 }, { question: 'Who added it?', kinds: layer.keyKinds.pattern_3 }];
  const rows = features.slice(0, 6).map((f) => f.properties);
  const quick = { answers: [['Pond', 'Tree', 'Stone', 'Tree', '', 'other'], ['Asha Rao', 'Asha Rao', '', '', '', '']],
                  why: [[['pond'], ['tree'], ['stone'], ['tree'], [], []], [['Asha Rao'], ['Asha Rao'], [], [], [], []]] };
  const careful = { answers: [['Pond', 'Stone', '', 'Tree', 'Pond', 'other'], ['Vikram Shenoy', '', '', '', '', '']],
                    why: [[['pond'], ['stone'], [], ['tree'], ['pond'], []], [['Vikram Shenoy'], [], [], [], [], []]] };
  const names = rows.map((r) => r.loka_name);
  const got = pickSample({ questions, quick, careful, rows, names, n: 10, people: peopleQuestions(layer, []) });
  check('only the pairs that differ, one side blank included', got.map((x) => x.place).sort(), ['Spot 1', 'Spot 2', 'Spot 4']);
  check('no question about people', got.every((x) => x.question === 'What is it mostly?'), true);
  const two = got.find((x) => x.place === 'Spot 2');
  check('a blank side says "no answer"', [two.quick.answer, two.careful.answer], ['Stone', 'no answer']);
  check('each side carries its words and its definition', got.find((x) => x.place === 'Spot 1').careful, { answer: 'Stone', words: ['stone'], definition: 'Places of stone' });
  check('the same seed picks the same order', JSON.stringify(pickSample({ questions, quick, careful, rows, names, n: 10, people })), JSON.stringify(got));
  check('n caps it', pickSample({ questions, quick, careful, rows, names, n: 2, people }).length, 2);
}

console.log('\n  the whole run, with the stand-in model');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-sample-'));
try {
  const file = path.join(dir, 'spots.json');
  fs.writeFileSync(file, JSON.stringify({ layer, features }));
  const out = path.join(dir, 'out');
  const run = () => spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'measure-answer-check.mjs'),
    '--file=' + file, '--stub', '--stability', '--sample=8', '--out=' + out], { encoding: 'utf8' });
  const r1 = run();
  check('it runs', r1.status, 0);
  const sampleFile = path.join(out, 'sample-spots.json');
  const raw1 = fs.existsSync(sampleFile) ? fs.readFileSync(sampleFile, 'utf8') : '';
  const s1 = raw1 ? JSON.parse(raw1) : { items: [] };
  check('it writes sample-<slug>.json with the pairs asked for', s1.items.length, 8);
  const qs = [...new Set(s1.items.map((x) => x.question))].sort();
  check('spread over the questions about the place, none about people', qs, ['What condition is it in?', 'What is it mostly?']);
  check('evenly: four of each', qs.map((q) => s1.items.filter((x) => x.question === q).length), [4, 4]);
  check('no tagger\'s name anywhere in the file', TAGGERS.some((t) => raw1.includes(t)) || /Asha|Vikram/.test(raw1), false);
  check('each pair: the place, its words (at most 400 characters) and labels, the question, both answers',
    s1.items.every((x) => x.place && typeof x.text === 'string' && x.text.length <= 400 && Array.isArray(x.labels) && x.question &&
      ['answer', 'words', 'definition'].every((k) => k in x.quick && k in x.careful)), true);
  check('every pair is a disagreement', s1.items.every((x) => x.quick.answer !== x.careful.answer), true);
  const r2 = run();
  const s2 = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
  check('the same places twice: the same pick', [r2.status, JSON.stringify(s2.items)], [0, JSON.stringify(s1.items)]);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'measure-answer-check.mjs'), '--file=' + file, '--stub', '--sample=3'], { encoding: 'utf8' });
  check('--sample without --stability is refused', bad.status, 1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
