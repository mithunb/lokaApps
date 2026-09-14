/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The question-finder's inputs and instructions. No network. */
import fs from 'node:fs';
import * as E from '../api/lib/atlas/enrich.js';
const feats = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/blr.geojson','utf8')).features;
const rows = feats.map((f) => { const p = {...f.properties}; for (const k of Object.keys(p)) if (/^pattern_/.test(k)) delete p[k]; return p; });
const fields = ['description','categories','labels','address','creator','created_at'];

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// ---- an address is not a set of tags ----
console.log('\n  a column of addresses');
const d = E.buildDigest(rows, fields);
const words = [...d.tagCounts.keys()].map((w) => w.toLowerCase());
check('the city is not a recurring word', words.includes('bengaluru'), false);
check('nor the country', words.includes('india'), false);
check('nor a locality', words.includes('indiranagar'), false);
check('nor a postcode', words.some((w) => /\b56\d{4}\b/.test(w)), false);
check('but what the places ARE still is', words.includes('culture') && words.includes('nature'), true);
const addressed = d.entries.filter((e) => /bengaluru/i.test(e.text || '')).length;
check('and the address is still on the place\'s line as writing', addressed > 50, true);

console.log('\n  a real column of tags is untouched');
const tagged = rows.map((r) => ({ categories: r.categories, labels: r.labels }));
const d2 = E.buildDigest(tagged, ['categories', 'labels']);
const w2 = [...d2.tagCounts.keys()].map((w) => w.toLowerCase());
check('categories still splits into its own words', w2.includes('culture') && w2.includes('heritage'), true);
check('and labels too', w2.includes('botanical-specimen'), true);

console.log('\n  a made-up ordered list ending the same way');
const fake = Array.from({ length: 20 }, (_, i) => ({ where: 'Plot ' + i + ', Somewhere, Neverland' }));
const d3 = E.buildDigest(fake, ['where']);
check('is not split into tags', [...d3.tagCounts.keys()].some((w) => /neverland/i.test(w)), false);
const realTags = Array.from({ length: 20 }, (_, i) => ({ kind: ['red, round', 'blue, square', 'red, square'][i % 3] }));
const d4 = E.buildDigest(realTags, ['kind']);
check('while a shared few still are', [...d4.tagCounts.keys()].sort(), ['blue', 'red', 'round', 'square']);
const twoTags = Array.from({ length: 30 }, (_, i) => ({ kind: i % 2 ? 'hot, dry' : 'cold, dry' }));
check('even when every line ends the same way',
  [...E.buildDigest(twoTags, ['kind']).tagCounts.keys()].sort(), ['cold', 'dry', 'hot']);
const noDigits = Array.from({ length: 30 }, (_, i) => ({ where: 'Street ' + i + ', Indiranagar, Bengaluru' }));
check('and a place with no house number is still a place',
  [...E.buildDigest(noDigits, ['where']).tagCounts.keys()].some((w) => /indiranagar/i.test(w)), false);

// ---- the prompt ----
console.log('\n  what the finder is now told');
let prompt = '';
await E.enrichRows({ rows, fields, title: 'LOKA x Bengaluru', mode: 'questions',
  keepQuestions: [], seedSet: [], models: { flash: 'stub', flashLite: 'stub-lite' },
  callJSON: async (m, p, s, o) => {
    if (o && o.think) { prompt = p; return { verdict: 'no_clear_questions', note: 'stub' }; }
    return { rows: [] };
  } });
check('the borrowed "granite, hand-carved" example is gone', /granite, hand-carved/.test(prompt), false);
check('and the "dry since 2019" one', /dry since 2019/.test(prompt), false);
check('it is told what a question becomes', /turns into a switch beside the map/.test(prompt), true);
check('it is told the map already sorts by categories',
  /ALREADY sorts places by its categories \(Social, Culture, Heritage/.test(prompt), true);
check('and that those words cannot be a kind\'s name',
  /do not give a kind one of those words as its name/.test(prompt), true);
check('the half rule that fought the leave-a-home rule is gone',
  /no kind may fit more than about half/.test(prompt), false);
check('replaced by one that says split a large group rather than orphan it',
  /split it into narrower kinds/.test(prompt), true);
check('and there is a test for whether a question is worth asking',
  /at least two of its kinds must each fit three or more/.test(prompt), true);
check('the closed list is named as closed', /The categories column is a CLOSED list of 10/.test(prompt), true);
check('and it starts with culture, not the city',
  /CLOSED list of 10[^\n]*Culture \(32\), Nature \(20\)/.test(prompt), true);
check('the city and the country are still out of it',
  /bengaluru \(|india \(/i.test(prompt), false);

// ---- a long question keeps its mark ----
console.log('\n  a question the model wrote too long');
const long = await E.enrichRows({ rows, fields: ['description', 'categories', 'labels'],
  title: 'T', mode: 'questions', keepQuestions: [], seedSet: [],
  models: { flash: 'stub', flashLite: 'stub-lite' },
  callJSON: async (m, p, sc, o) => {
    if (o && o.think) return { verdict: 'questions', reading: 'r', facts: [], questions: [{
      question: 'What sort of material was this thing built out of?',   // 49 characters
      kinds: [{ name: 'Zephyr', definition: 'Places that', examples: [1, 2, 3] },
              { name: 'Quixote', definition: 'Places that', examples: [4, 5, 6] }] }] };
    const ids = [...p.matchAll(/^(\d+)\. (.*)$/gm)].map((x) => [Number(x[1]), x[2]]);
    return { rows: ids.map(([i, text], k) => {
      const own = (text.match(/[a-z][a-z-]{5,}/i) || ['place'])[0];
      return { i, q0: k % 2 ? 'Zephyr' : 'Quixote', w0: [own] };
    }) };
  } });
const asked = (long.questions || [])[0] || {};
check('it is asked at all rather than lost', long.verdict, 'questions');
check('it still ends in a question mark', /\?$/.test(asked.question || ''), true);
check('it is within the cap', (asked.question || '').length <= 40, true);
check('and it is not cut mid-word',
  (asked.question || '') , 'What sort of material was this thing?');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
