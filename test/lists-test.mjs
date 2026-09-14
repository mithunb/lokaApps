/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A column that holds several things at once. No network. */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../atlas/reading-rules.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  a column holding a list of words');
const words = [
  { name: 'a', labels: ['bamboo wall', 'string lights'] },
  { name: 'b', labels: ['vintage lanterns', 'cosy nook'] },
  { name: 'c', labels: ['mural', 'bench'] },
];
check('is read, not passed over', R.wordColumns(words).includes('labels'), true);

console.log('\n  a column holding a list of web addresses');
const shots = [
  { name: 'a', image_urls: ['https://x/1.jpg', 'https://x/2.jpg'] },
  { name: 'b', image_urls: ['https://x/3.jpg'] },
  { name: 'c', image_urls: ['https://x/4.jpg', 'https://x/5.jpg'] },
];
check('is still left out, each address seen on its own',
  R.wordColumns(shots).includes('image_urls'), false);

console.log('\n  the shape the browser stores a list as');
const joined = [
  { name: 'a', labels: 'bamboo wall; string lights' },
  { name: 'b', labels: 'vintage lanterns; cosy nook' },
  { name: 'c', labels: 'mural; bench' },
];
check('reads the same either way',
  R.wordColumns(joined).includes('labels'), R.wordColumns(words).includes('labels'));

console.log('\n  an empty or ragged list');
check('a list of nothing does not make a column',
  R.wordColumns([{ n: 'a', x: [] }, { n: 'b', x: [null, ''] }]).includes('x'), false);

console.log('\n  nothing moves on the places we actually have');
const real = JSON.parse(fs.readFileSync(
  new URL('./fixtures/blr.geojson', import.meta.url),
  'utf8')).features.map((f) => f.properties);
check('the Bengaluru columns are unchanged', R.wordColumns(real),
  ['description', 'categories', 'labels', 'address', 'creator']);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
