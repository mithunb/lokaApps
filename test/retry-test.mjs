/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Being told what the last attempt missed. No network. */
import fs from 'node:fs';
import * as E from '../api/lib/atlas/enrich.js';
const feats = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/blr.geojson','utf8')).features;
const rows = feats.map((f) => { const p = {...f.properties}; for (const k of Object.keys(p)) if (/^pattern_/.test(k)) delete p[k]; return p; });
const fields = ['description', 'categories', 'labels'];

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

let sawPrompt = '';
function run(missed) {
  return E.enrichRows({ rows, fields, title: 'T', mode: 'questions', keepQuestions: [], seedSet: [],
    models: { flash: 'stub', flashLite: 'stub-lite' }, missed,
    callJSON: async (m, p, sc, o) => {
      if (o && o.think) { sawPrompt = p; return { verdict: 'no_clear_questions', note: 'stub' }; }
      return { rows: [] };
    } });
}

console.log('\n  a first attempt');
await run([]);
check('says nothing about a second attempt', /this is a second attempt/.test(sawPrompt), false);

console.log('\n  a second attempt, told what was missed');
await run([{ word: 'nature', places: 20, under: 'What kind of place is it?' },
           { word: 'heritage', places: 14, under: '' }]);
check('says plainly it is the second', /IMPORTANT, this is a second attempt/.test(sawPrompt), true);
check('names the question that left them blank, and how many',
  /"What kind of place is it\?" had no kind for the 20 places that say "nature"/.test(sawPrompt), true);
check('and a group no question asked about at all',
  /14 places say "heritage" and not one question asked about them/.test(sawPrompt), true);
check('an awkward group is still a group', /a group that is awkward to name is still a group/.test(sawPrompt), true);
check('it says those places are not marginal',
  /not unusual or marginal/.test(sawPrompt), true);
check('and forbids handing back the same set', /Do not return the same set again/.test(sawPrompt), true);

console.log('\n  the caller\'s side, read from the code');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('there is exactly one retry', /const second = await ask\(missedFirst\);/.test(server) &&
  (server.match(/await ask\(/g) || []).length === 2, true);
check('it only runs when the questions were freshly found',
  /if \(!asked\.length && out\.verdict === 'questions' && holesIn\(out\)\.length\)/.test(server), true);
/* The keep-rule changed deliberately. It used to compare hole counts, which is
   not the same question as "is this a better reading": measured over 90
   readings on three maps it chose wrongly about a third of the time, in both
   directions. It now compares the two things a reader would notice. */
check('the second set is judged on questions that speak for most of the map',
  /\(q\) => q\.coverage >= 0\.6/.test(server), true);
check('and on how many places are left with no answer at all',
  /!\(r\.questions \|\| \[\]\)\.some\(\(q\) => q\.categories\[i\] && q\.categories\[i\] !== 'other'\)/.test(server), true);
check('more strong questions wins, and a tie is broken by fewer places left out',
  /strongIn\(second\) !== strongIn\(out\)\s*\?\s*strongIn\(second\) > strongIn\(out\)\s*:\s*unspokenIn\(second\) < unspokenIn\(out\)/.test(server), true);
check('on a tie the first set stands, having cost nothing extra',
  /let better = false;/.test(server) && /if \(better\) \{/.test(server), true);
check('the old hole-counting rule is gone',
  /holesIn\(second\)\.length < missedFirst\.length/.test(server), false);
check('a hole is a question missing a kind, or a group nothing asked about',
  /r\.gaps \|\| \[\]/.test(server) && /r\.nobodyAsked \|\| \[\]/.test(server), true);
check('the reading\'s own account is written onto the layer',
  /if \(account\) frag\.stanza\.reading = account;/.test(server), true);
check('and the sorts of fact it found',
  /if \(sorts && sorts\.length\) frag\.stanza\.facts = sorts;/.test(server), true);
check('filing runs at no temperature at all', /const FILE_TEMPERATURE = 0;/.test(server), true);

console.log('\n  asking a model not to think, in the dialect it speaks');
check('there is more than one dialect to try',
  /const QUIET_DIALECTS = \[\{ thinkingBudget: 0 \}, \{ thinkingLevel: 'low' \}, null\]/.test(server), true);
check('and what worked is remembered per model',
  /thinkDialect\.set\(model, quiet\)/.test(server), true);
check('a dialect that later stops working is forgotten and found again',
  /thinkDialect\.delete\(model\); return geminiJSONFileImpl/.test(server), true);
check('a failure that is not about thinking is not retried', /if \(!refusedTheField\) throw e;/.test(server), true);

console.log('\n  what a rebuild must not lose');
check('the reading\'s account survives one', /reading: prior\.reading \|\| ''/.test(server), true);
check('so do the sorts of fact it listed', /facts: prior\.facts \|\| null/.test(server), true);
check('and the questions an owner took off the map', /hiddenKeys: prior\.hiddenKeys \|\| null/.test(server), true);
check('a fresh account wins over the one already there',
  /const account = session\.reading \|\| session\.replacingReading;/.test(server), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
