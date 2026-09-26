/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The district indicators (NFHS-5) share one ramp, darker = a higher number,
 * so the colour alone cannot say which end is good. The key says it, at both
 * ends. Runs the builder's own table through Python. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const src = fs.readFileSync(ROOT + '/api/atlas-builders/recipes.py', 'utf8');
const i = src.indexOf('NFHS_LAYERS = {'), j = src.indexOf('\n}\n', i) + 3;
let ends = null;
try {
  ends = JSON.parse(execFileSync('python3', ['-c', '_GREEN=_RUST=1\n' + src.slice(i, j) +
    '\nimport json\nout={}\nfor k,(label,unit,br,c,info) in NFHS_LAYERS.items():\n' +
    '  low="Lower is better" in info\n  lo,hi=("better","worse") if low else ("worse","better")\n' +
    '  out[k]=[lo,hi]\nprint(json.dumps(out))'], { encoding: 'utf8' }));
} catch (e) { ends = 'python3 unavailable: ' + e.message; }

console.log('\n  the key says which end is good');
check('stunting: fewer is better, more is worse', ends && ends.stunting, ['better', 'worse']);
check('institutional births: more is better', ends && ends.births, ['worse', 'better']);
check('literacy and clean fuel read the same way as births', ends && [ends.literacy, ends.cleanfuel], [['worse', 'better'], ['worse', 'better']]);
check('the key labels carry the word at both ends',
  /\(\{lo_word\}\)"\}\]/.test(src) && /\(\{hi_word\}\)"\}\)/.test(src), true);
check('stunting\'s info line says what a dark district means', /a darker district has more stunted children/.test(src), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
