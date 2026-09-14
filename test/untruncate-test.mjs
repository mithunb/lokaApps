/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Keeping whole addresses through the cut. No network. */
import fs from 'node:fs';
import { justTheLinks } from '../api/lib/fragment.js';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const url = (n) => 'https://loka.place/api/images/17892072124' + n + '_0820732cf38240af8a319d3b92f064d5.jpg';
const wrap = (list) => JSON.stringify(list.map((u, i) => ({ id: 'id-' + i + '-4625-a2b2-700630dc0c44', image_url: u })));

console.log('\n  the shape a Cubbon Park place is stored in');
const four = [url(1), url(2), url(3), url(4)];
check('wrapped, it does not fit in five hundred characters', wrap(four).length > 500, true);
check('as plain addresses it does', justTheLinks(wrap(four)).length <= 500, true);
check('and all four survive', justTheLinks(wrap(four)).split('; ').length, 4);

console.log('\n  whole addresses only, never half of one');
const many = Array.from({ length: 20 }, (_, i) => url(i));
const kept = justTheLinks(wrap(many));
check('what is kept fits the cap', kept.length <= 500, true);
check('every piece kept is a whole address',
  kept.split('; ').every((u) => /^https:\/\/\S+\.jpg$/.test(u)), true);
check('some were dropped rather than halved', kept.split('; ').length < 20, true);

console.log('\n  values that are not pictures are left alone');
check('plain words', justTheLinks('a banyan tree covering a large area'), null);
check('nothing', justTheLinks(''), null);
check('missing', justTheLinks(null), null);

console.log('\n  the shapes it already handled');
check('one bare address', justTheLinks(url(1)), url(1));
check('two by semicolon', justTheLinks(url(1) + '; ' + url(2)), url(1) + '; ' + url(2));
check('a real list', justTheLinks([url(1), url(2)]), url(1) + '; ' + url(2));
check('the same address twice counts once', justTheLinks(url(1) + '; ' + url(1)), url(1));

console.log('\n  and the server rewrites the picture column before the cut');
const atlas = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('the column comes from the layer\'s own spec',
  /var pictureCol = String\(\(spec && spec\.imageColumn\) \|\| ''\);/.test(atlas), true);
check('and it happens before anything is trimmed',
  atlas.indexOf('justTheLinks(had)') < atlas.indexOf('const clean = sanitizeFeatures'), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
