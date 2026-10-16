/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An empty value, however it is written, is nothing — and a list reads as
   words. The Cubbon Park card for "Are we colonisers?!" printed its labels
   as "{}", which is how the tagging app sends a place with no labels.
   No network. */
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const grab = (name) => {
  const start = src.indexOf('\n  function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in atlas.js');
  const end = src.indexOf('\n  }\n', start);
  return src.slice(start, end + 5);
};
const fns = grab('unbrace') + grab('unquotePiece') + grab('cellShown') + grab('tagArr') +
  grab('splitTags') + grab('popupTitleText') +
  '\n function safeArr(v){try{return JSON.parse(v)}catch(e){return []}}\n';
const { unbrace, cellShown, tagArr, splitTags, popupTitleText } = new Function(fns +
  '; return {unbrace, cellShown, tagArr, splitTags, popupTitleText};')();

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  nothing, in every way it is written, reads as nothing');
for (const v of ['', '{}', '[]', '{ }', '[ ]', '  ', ',', '{,}', ';;', '""', '{""}', null, undefined, [], {}, ['', ' ']]) {
  check(JSON.stringify(v === undefined ? 'undefined' : v) + ' shows nothing', cellShown(v), '');
}
check('and is no tag', tagArr('{}'), []);
check('nor a tag in brackets', tagArr('[]'), []);
check('nor a word to search a key by', splitTags('{}'), []);
check('nor a kind in a key', unbrace('{}'), '');

console.log('\n  a list reads as words, with no braces or quotes');
check('the labels on a Cubbon Park place', cellShown('{subterranean,insect-architecture}'),
  'subterranean, insect-architecture');
check('one word', cellShown('{Nature}'), 'Nature');
check('a quoted piece', cellShown('{"dense shade",roots}'), 'dense shade, roots');
check('a list that arrived as a list', cellShown(['a', 'b']), 'a, b');

console.log('\n  everything else exactly as it was');
check('plain words', cellShown('Are we colonisers?!'), 'Are we colonisers?!');
check('words with commas, not braced, kept whole', cellShown('Bengaluru, Karnataka'), 'Bengaluru, Karnataka');
check('a number', cellShown(30), '30');
check('zero is an answer', cellShown(0), '0');
check('a record is not a list', cellShown('{"id":1}'), '{"id":1}');

console.log('\n  the card title never says "{}"');
const L = { popup: { title: 'labels', titleFallback: 'description' } };
check('falls back past an empty list', popupTitleText(L, { labels: '{}', description: 'Are we colonisers?!' }),
  'Are we colonisers?!');
check('a braced title reads as words', popupTitleText(L, { labels: '{a,b}' }), 'a, b');

console.log('\n  every place a value reaches a visitor goes through the same rule');
check('a card row is left out when it says nothing', /if \(!cellShown\(v\)\) return;/.test(src), true);
check('a card row reads as words', /var shown = cellShown\(v\);/.test(src), true);
// both go through labelNameOf, which reads a plain column with cellShown and
// the naming column through popupTitleText (itself cellShown on each part)
check('a pin’s name on the map', /var v = labelNameOf\(L, e\.f, t\);/.test(src), true);
check('a shape’s name on the map', /var nm = labelNameOf\(L, f, t\);/.test(src), true);
check('and a labelled column reads as words', /function labelNameOf\(L, f, t\) \{[\s\S]*?return cellShown\(f\.properties\[t\.property\]\);/.test(src), true);
check('the words under an answer', /cellShown\(why\)\.split/.test(src), true);
check('the line under a card title', /cellShown\(props\[spec\.subtitleProperty\]\)/.test(src), true);
check('a key never counts "{}" as an answer', /v = unbrace\(v\); if \(v\) nonEmpty\.push\(v\)/.test(src), true);
check('the old one-off test for "[]" is gone', /v === "\[\]"\) return;/.test(src), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
