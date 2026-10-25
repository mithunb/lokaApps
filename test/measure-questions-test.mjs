/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The measuring tool for question finding (deploy/measure-questions.mjs):
   its options, its refusal of deoria-bioregion in any spelling, and a whole
   fresh reading with the stand-in model (no network) that prints every
   column's line, what was dropped and why, and the questions kept with their
   answer counts, and writes nothing anywhere. */
import { parseArgs, refused } from '../deploy/measure-questions.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const TOOL = path.join(ROOT, 'deploy', 'measure-questions.mjs');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

console.log('\n  the options');
{
  const d = parseArgs(['--dataset=some-atlas', '--layer=places']);
  check('one run by default, with room for a reading\'s two attempts', [d.dataset, d.layer, d.runs, d.maxCalls, d.stub], ['some-atlas', 'places', 1, 56, false]);
  check('--runs sets the runs and the ceiling with them', [parseArgs(['--dataset=x', '--runs=2']).runs, parseArgs(['--dataset=x', '--runs=2']).maxCalls], [2, 112]);
  check('--max-calls is a ceiling of its own', parseArgs(['--dataset=x', '--runs=3', '--max-calls=10']).maxCalls, 10);
  check('runs stay between 1 and 5', [parseArgs(['--dataset=x', '--runs=0']).runs, parseArgs(['--dataset=x', '--runs=99']).runs], [1, 5]);
  check('deoria-bioregion is refused in any spelling, as a slug or a file', [refused('deoria-bioregion'), refused('Deoria-BIOREGION'), refused('/x/DEORIA-bioregion/places.json'), refused('cubbonpark')], [true, true, true, false]);
}

console.log('\n  refusals, from the command line');
{
  const deo = run('--dataset=deoria-bioregion', '--layer=x', '--stub');
  check('--dataset=deoria-bioregion: refused, nothing read', [deo.status, /refused: deoria-bioregion/.test(deo.stderr)], [1, true]);
  const deoCase = run('--dataset=Deoria-Bioregion', '--stub');
  check('…in any spelling', [deoCase.status, /refused: deoria-bioregion/.test(deoCase.stderr)], [1, true]);
  const deoFile = run('--file=/nowhere/DEORIA-BIOREGION.json', '--stub');
  check('…and as a file', [deoFile.status, /refused: deoria-bioregion/.test(deoFile.stderr)], [1, true]);
  const odd = run('--dataset=x', '--bogus');
  check('an unknown option is refused', [odd.status, /unknown option --bogus/.test(odd.stderr)], [1, true]);
  const both = run('--dataset=x', '--file=y.json');
  check('--dataset and --file together are refused', both.status, 1);
  const bad = run('--dataset=../atlas', '--stub');
  check('a name that is not an atlas\'s is refused', [bad.status, /not an atlas name/.test(bad.stderr)], [1, true]);
  const none = run();
  check('nothing named: the usage, and a failure', [none.status, /--dataset=<slug> --layer=<id>/.test(none.stdout)], [1, true]);
  const help = run('--help');
  check('--help: the usage, and no failure', [help.status, /--max-calls=N/.test(help.stdout), /Reads only; saves nothing/.test(help.stdout)], [0, true, true]);
}

console.log('\n  a whole fresh reading, with the stand-in model');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-questions-'));
try {
  const AREAS = ['Campal', 'Fontainhas', 'Miramar', 'Altinho'];
  const MATERIAL = ['stone', 'brick', 'timber'];
  const features = Array.from({ length: 24 }, (_, i) => ({ type: 'Feature', geometry: null, properties: {
    loka_name: 'Place ' + (i + 1),
    description: 'Shelter number ' + (i + 1) + ' is ' + (i % 2 ? 'large' : 'small') + ' and built of ' + MATERIAL[i % 3] + ' beside the river.',
    address: (i % 6 < 3 ? 'Rua ' : 'Avenida ') + (i + 1) + ', ' + AREAS[i % 4] + ', Panaji, Goa, India',
  } }));
  const file = path.join(dir, 'places.json');
  fs.writeFileSync(file, JSON.stringify({ layer: { id: 'places', popup: { title: 'loka_name' } }, features }));
  const before = fs.readdirSync(dir);
  const stamp = fs.statSync(file).mtimeMs;
  const r = run('--file=' + file, '--stub', '--runs=2');
  check('it runs', r.status, 0);
  check('two runs, each with every column\'s line and the questions kept', [(r.stdout.match(/^Run \d — questions/gm) || []).length,
    (r.stdout.match(/Every column \(what it gave, what was dropped and why\)/g) || []).length,
    (r.stdout.match(/^ {2}Questions kept \(\d+\)/gm) || []).length], [2, 2, 2]);
  check('both columns have a line', /- Address: /.test(r.stdout) && /- Description: /.test(r.stdout), true);
  check('the address is not asked, and its line says why',
    /- Address: not asked — an address: the map already shows where each place is/.test(r.stdout), true);
  check('each kept question says how far it reaches, and its answer counts',
    /— reaches \d+ of 24 places/.test(r.stdout) && /^ {8}\S+ \d+, \S+ \d+/m.test(r.stdout), true);
  check('no place\'s name is printed', /Place \d/.test(r.stdout), false);
  check('and whether the runs agree', /2 of 2 runs kept the same questions/.test(r.stdout), true);
  check('nothing written beside the places', fs.readdirSync(dir), before);
  check('and the places themselves untouched', fs.statSync(file).mtimeMs, stamp);
  const tight = run('--file=' + file, '--stub', '--runs=3', '--max-calls=1');
  check('the ceiling holds: past it no call is made, and the run says it could not finish',
    [tight.status, /^Run 1 — (unavailable|unread), 1 call$/m.test(tight.stdout), /Stopped: the 1 calls are used\./.test(tight.stdout)], [0, true, true]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
check('the tool has no way to write a file', /writeFileSync|appendFileSync|createWriteStream|mkdirSync|renameSync|writeFile\(|copyFile/.test(fs.readFileSync(TOOL, 'utf8')), false);
check('and asks the reading of nothing that writes: it calls enrichRows, never the server',
  /^import .*(api\/apps\/|registry\.js'|imports\.js'|questions-queue)/m.test(fs.readFileSync(TOOL, 'utf8')), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
