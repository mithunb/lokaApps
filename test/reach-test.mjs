/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Can the server actually reach the helpers it calls? No network.

   "Ask a question of your own" shipped broken and stayed broken: enrich.js
   defined keyKindsByColumn without exporting it, and atlas.js called it by its
   bare name. That is a ReferenceError on the first step of the flow, every
   time, and nothing caught it — the checks all read source text, and the
   browser never exercises the route. This reads the two files against each
   other instead. */
import fs from 'node:fs';
import * as enrich from '../api/lib/atlas/enrich.js';

const ATLAS = ROOT + '/api/apps/atlas.js';
const ENRICH = ROOT + '/api/lib/atlas/enrich.js';
const atlas = fs.readFileSync(ATLAS, 'utf8');
const enrichSrc = fs.readFileSync(ENRICH, 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* strip comments and strings so a name inside prose is not mistaken for a call */
const code = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""');

const atlasCode = code(atlas);
const enrichCode = code(enrichSrc);

console.log('\n  every helper atlas.js reaches for through enrich is really there');
const reached = [...new Set([...atlasCode.matchAll(/\benrich\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))].sort();
check('at least a few are used', reached.length > 0, true);
const missing = reached.filter((n) => typeof enrich[n] !== 'function');
check('and none of them is missing', missing, []);
console.log('        reached: ' + reached.join(', '));

console.log('\n  nothing private to enrich.js is called by its bare name');
const defined = new Set([...enrichCode.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
const exported = new Set([...enrichCode.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
const privateOnes = [...defined].filter((n) => !exported.has(n));
check('enrich.js does keep some to itself', privateOnes.length > 0, true);
/* a bare call in atlas.js to one of those is the bug that shipped */
const bare = privateOnes.filter((n) => new RegExp('(?<![.\\w$])' + n + '\\s*\\(').test(atlasCode));
check('and atlas.js calls none of them bare', bare, []);

console.log('\n  the one that actually broke');
check('keyKindsByColumn is exported', typeof enrich.keyKindsByColumn === 'function', true);
check('and atlas.js reaches it through enrich',
  /enrich\.keyKindsByColumn\(rows, fields\)/.test(atlasCode), true);
check('and never bare', /(?<![.\w$])keyKindsByColumn\s*\(/.test(atlasCode), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
