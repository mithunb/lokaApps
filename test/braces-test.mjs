/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A database's own idea of a list, opened. No network. */
import fs from 'node:fs';
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const grab = (name) => {
  const start = src.indexOf('\n  function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in atlas.js');
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end + 5);
};
const fns = grab('unbrace') + grab('unquotePiece') + grab('splitTags') + grab('tagArr') +
  '\n function safeArr(v){try{return JSON.parse(v)}catch(e){return []}}\n';
const { splitTags, tagArr, unbrace } = new Function(fns + '; return {splitTags, tagArr, unbrace};')();

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  what every place on the Cubbon Park atlas actually holds');
check('one category', tagArr('{Nature}'), ['Nature']);
check('two, which used to show as "{Activities" and "Nature}"',
  tagArr('{Activities,Nature}'), ['Activities', 'Nature']);
check('a row of labels',
  tagArr('{shaded,quiet,resting-place,peaceful,relaxing}'),
  ['shaded', 'quiet', 'resting-place', 'peaceful', 'relaxing']);

console.log('\n  the map keys and the search see the same words');
check('lower-cased for matching', splitTags('{Activities,Nature}'), ['activities', 'nature']);
check('and no brace survives', splitTags('{Nature}').join('').includes('{'), false);

console.log('\n  a piece the database had to quote');
check('loses its quotes with the braces', tagArr('{"a b",c}'), ['a b', 'c']);

console.log('\n  and everything else is left exactly as it was');
check('a record is not a list', unbrace('{"id":1}'), '{"id":1}');
check('plain words', tagArr('Nature'), ['Nature']);
check('already separated', tagArr('a; b'), ['a', 'b']);
check('nothing', tagArr(''), []);

console.log('\n  new data comes in already opened');
const ingest = fs.readFileSync(ROOT + '/atlas/ingest.js', 'utf8');
check('the way in knows the shape too', /charAt\(0\) === "\{" && s\.charAt\(s\.length - 1\) === "\}"/.test(ingest), true);
check('and stores it the way the rest of the product says several',
  /\.join\("; "\)/.test(ingest), true);

console.log('\n  every place a value is read, not just where tags are drawn');
check('the words a place shows under a key', /var text = unbrace\(v\);/.test(src), true);
check('and the kinds the key itself lists', /nonEmpty\.push\(unbrace\(v\)\)/.test(src), true);
check('no raw trim survives where a piece is taken',
  /s = String\(s\)\.trim\(\)\.slice\(0, 40\)/.test(src), false);

check('and a field typed as plain words, which is how labels arrived',
  /var shown = unbrace\(v\);/.test(src), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
