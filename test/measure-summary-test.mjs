/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The measuring tool for the Insight summary (deploy/measure-summary.mjs):
   its options, its refusal of deoria-bioregion in any spelling, and a whole
   run with the stand-in model (no network) that prints what the cell check
   kept, what the proofread dropped and why, and the final sentences, and
   writes nothing anywhere. */
import { parseArgs, refused } from '../deploy/measure-summary.mjs';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const TOOL = path.join(ROOT, 'deploy', 'measure-summary.mjs');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

console.log('\n  the options');
{
  const d = parseArgs(['--dataset=some-atlas']);
  check('three runs by default, and four calls a run at most', [d.dataset, d.runs, d.maxCalls, d.stub], ['some-atlas', 3, 12, false]);
  check('--runs sets the runs and the ceiling with them', [parseArgs(['--dataset=x', '--runs=2']).runs, parseArgs(['--dataset=x', '--runs=2']).maxCalls], [2, 8]);
  check('--max-calls is a ceiling of its own', parseArgs(['--dataset=x', '--runs=5', '--max-calls=4']).maxCalls, 4);
  check('runs stay between 1 and 10', [parseArgs(['--dataset=x', '--runs=0']).runs, parseArgs(['--dataset=x', '--runs=99']).runs], [1, 10]);
  check('deoria-bioregion is refused in any spelling, as a slug or a file', [refused('deoria-bioregion'), refused('Deoria-BIOREGION'), refused('/x/DEORIA-bioregion/places.json'), refused('cubbonpark')], [true, true, true, false]);
}

console.log('\n  refusals, from the command line');
{
  const deo = run('--dataset=Deoria-Bioregion', '--stub');
  check('--dataset=Deoria-Bioregion: refused, nothing read', [deo.status, /refused: deoria-bioregion/.test(deo.stderr)], [1, true]);
  const deoFile = run('--file=/nowhere/DEORIA-BIOREGION.json', '--stub');
  check('…and as a file', [deoFile.status, /refused: deoria-bioregion/.test(deoFile.stderr)], [1, true]);
  const odd = run('--dataset=x', '--bogus');
  check('an unknown option is refused', [odd.status, /unknown option --bogus/.test(odd.stderr)], [1, true]);
  const both = run('--dataset=x', '--file=y.json');
  check('--dataset and --file together are refused', both.status, 1);
  const none = run();
  check('nothing named: the usage, and a failure', [none.status, /--dataset=<slug>/.test(none.stdout)], [1, true]);
  const help = run('--help');
  check('--help: the usage, and no failure; four calls a run', [help.status, /--runs=N/.test(help.stdout), /default four a run/.test(help.stdout) && /one re-write/.test(help.stdout)], [0, true, true]);
}

console.log('\n  a whole run, with the stand-in model');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-summary-'));
try {
  const file = path.join(dir, 'places.json');
  fs.copyFileSync(path.join(ROOT, 'test', 'fixtures', 'insight', 'cubbon.json'), file);
  const before = fs.readdirSync(dir);
  const r = run('--file=' + file, '--stub', '--runs=2');
  check('it runs', r.status, 0);
  check('two runs, each with the three parts', [(r.stdout.match(/^Run \d/gm) || []).length, (r.stdout.match(/Kept by the cell check/g) || []).length,
    (r.stdout.match(/Dropped by the proofread \(1\)/g) || []).length, (r.stdout.match(/^ {2}Final \(\d+\)/gm) || []).length], [2, 2, 2, 2]);
  check('the drop says why', /— stand-in: the last sentence is always questioned/.test(r.stdout), true);
  check('two calls a run: the write and the proofread', (r.stdout.match(/^Run \d — model, 2 calls$/gm) || []).length, 2);
  check('and whether the runs agree', /2 of 2 runs gave the same final sentences as the first\./.test(r.stdout), true);
  check('nothing written beside the places', fs.readdirSync(dir), before);
  const tight = run('--file=' + file, '--stub', '--runs=3', '--max-calls=2');
  check('the ceiling holds: it stops when the calls are used', [tight.status, /Stopped: the 2 calls are used\./.test(tight.stdout)], [0, true]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
check('the tool has no way to write a file', /writeFileSync|appendFileSync|createWriteStream|mkdirSync|renameSync/.test(fs.readFileSync(TOOL, 'utf8')), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
