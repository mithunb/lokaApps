/* Every check this product has, run in one go.
 *
 *   node test/run.mjs
 *
 * These used to live in a scratch directory outside the repo. The system
 * cleans that directory, and eight of them quietly disappeared partway through
 * a long day's work — so a count that had been reported as proof kept moving
 * for a reason nobody could see. Checks that can vanish are not checks. They
 * live here now, they are committed, and this runner says how many there are as
 * well as whether they pass, because a total that drops is itself a finding.
 *
 * Each check is a plain script that prints "N passed, M failed" and exits
 * non-zero if anything failed. Nothing here talks to the network or the disk
 * beyond reading the product's own source and the fixtures beside it.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];            // node test/run.mjs braces   → just that one

const files = readdirSync(HERE)
  .filter((f) => f.endsWith('-test.mjs'))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.log(only ? 'No check matches “' + only + '”.' : 'No checks found in test/.');
  process.exit(1);
}

let checks = 0, failedFiles = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/^\s*(\d+) passed, (\d+) failed\s*$/m);
  const passed = m ? Number(m[1]) : 0;
  const failed = m ? Number(m[2]) : 0;
  checks += passed;
  const ok = r.status === 0 && !failed;
  console.log((ok ? '  ok   ' : '  FAIL ') + f.replace('-test.mjs', '').padEnd(18) +
    (m ? passed + ' passed' + (failed ? ', ' + failed + ' failed' : '') : 'said nothing it should have'));
  if (!ok) { failedFiles.push(f); process.stdout.write(out.split('\n').filter((l) => /FAIL|Error/.test(l)).map((l) => '       ' + l).join('\n') + '\n'); }
}

console.log('');
console.log('  ' + files.length + ' files, ' + checks + ' checks' +
  (failedFiles.length ? ', ' + failedFiles.length + ' file(s) failing' : ', all passing'));
process.exit(failedFiles.length ? 1 : 0);
