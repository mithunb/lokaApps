/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The two systemic fixes. No network. */
import fs from 'node:fs';
import * as enrich from '../api/lib/atlas/enrich.js';

const feats = JSON.parse(fs.readFileSync(new URL('./fixtures/blr.geojson', import.meta.url), 'utf8')).features;
const rows = feats.map((f) => {
  const p = Object.assign({}, f.properties);
  for (const k of Object.keys(p)) if (/^pattern_/.test(k)) delete p[k];
  return p;
});
const fields = ['description', 'categories', 'labels'];

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// --- 1. is the question-finder now told what recurs, on a small set? ---
let sawPrompt = '';
async function peek(model, prompt, schema, o) {
  if (o && o.think) {
    sawPrompt = prompt;
    return { verdict: 'questions', reading: '', facts: [], questions: [
      { question: 'Who tends it?', kinds: [
        { name: 'Alpha', examples: [1, 2, 3] }, { name: 'Beta', examples: [4, 5, 6] }] }] };
  }
  /* Words have to be really present in the line or the existing check drops
     them before mine ever sees them. So each place cites a word taken from its
     own line, plus "culture" — which is on many lines and is offered here for
     BOTH kinds, which is the contradiction being staged. */
  const lines = [...prompt.matchAll(/^(\d+)\. (.*)$/gm)].map((m) => [Number(m[1]), m[2]]);
  return { rows: lines.map(([i, text], k) => {
    const own = (text.match(/[a-z][a-z-]{5,}/i) || ['place'])[0];
    return k % 2 ? { i, q0: 'Alpha', w0: [own, 'culture'] }
                 : { i, q0: 'Beta', w0: [own, 'culture'] };
  }) };
}
const out = await enrich.enrichRows({ rows, fields, title: 'LOKA x Bengaluru',
  mode: 'questions', keepQuestions: [], seedSet: [], callJSON: peek,
  models: { flash: 'stub', flashLite: 'stub-lite' } });

console.log('\n  the question-finder, on a set of ' + rows.length + ' places');
check('is told the categories column is a closed list',
  /The categories column is a CLOSED list of 10/.test(sawPrompt), true);
check('with every one of its words and how many places carry it',
  /Culture \(32\), Nature \(20\), Heritage \(14\)/.test(sawPrompt), true);
check('and the open words kept separate from them',
  /an OPEN list, anyone may say anything/.test(sawPrompt), true);
check('and "nature" is named with its count', /Nature \(20\)/.test(sawPrompt), true);
check('commonest first', /CLOSED list of 10[^\n]*Culture \(32\)/.test(sawPrompt), true);
check('and told the kinds must leave it a home',
  /must leave a home for the common ones/.test(sawPrompt), true);

console.log('\n  a word offered as the reason for two different answers');
if (out.verdict !== 'questions') { console.log('  verdict:', out.verdict, JSON.stringify(out).slice(0, 200)); }
else {
  const q = out.questions[0];
  const allWords = (q.why || []).flat().map((w) => w.toLowerCase());
  check('"culture" argued for both kinds, so it is gone', allWords.includes('culture'), false);
  check('words each place owns are untouched', allWords.length > 20, true);
  const naked = q.categories.filter((c, i) => c && c !== 'other' && !(q.why[i] || []).length).length;
  check('no answer is left standing on nothing', naked, 0);
  console.log('        kinds surviving: ' + JSON.stringify(q.counts.map((c) => c.name + '=' + c.count)));
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
