/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The setup guess (which column is the place, how to draw the rows) is asked
 * with thinking off. With thinking left on, a 134-row, 20-column file ran the
 * model out of room before it answered (Bengaluru, October 2026) and the setup
 * quietly fell back to plain code. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the setup guess cannot run out of room before it answers');
check('it is asked through the no-thinking call', /inference = await geminiJSONFile\(getFlashModel\(\), prompt, INFER_SCHEMA\);/.test(api), true);
check('not through the call that leaves thinking on', /inference = await geminiJSON\(getFlashModel\(\), prompt, INFER_SCHEMA\);/.test(api), false);
check('the no-thinking call leaves room to answer and gives one answer each time',
  /maxOutputTokens: 24000,\s*temperature: FILE_TEMPERATURE,/.test(api) && /const FILE_TEMPERATURE = 0;/.test(api), true);
check('a cut-off answer is still named as one, never read as a model that failed',
  /throw new Error\('the answer stopped early \(' \+ cand\.finishReason \+ '\)'\);/.test(api), true);

check('a boundary layer the model names is used only if it was offered', /const offered = inference\.joinLayer && allOptions\.some\(\(o\) => o\.id === inference\.joinLayer\);/.test(api), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
