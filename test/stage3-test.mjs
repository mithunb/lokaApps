/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* The counting that happens after the model answers. No network. */
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

/* One stub, two questions, and a filing pattern I control exactly:
   q0 gets a big kind, a medium one, and a kind of two places.
   q1 gets a kind sharing q0's name, held by fewer places. */
function run({ plan, keepQuestions = [] }) {
  return E.enrichRows({
    rows, fields, title: 'T', mode: 'questions', keepQuestions, seedSet: [],
    models: { flash: 'stub', flashLite: 'stub-lite' },
    callJSON: async (m, p, sc, o) => {
      if (o && o.think) return { verdict: 'questions', reading: 'r', facts: [], questions: [
        { question: 'First question?', kinds: [
          { name: 'Bigly', definition: 'Places that', examples: [1,2,3] },
          { name: 'Middling', definition: 'Places that', examples: [4,5,6] },
          { name: 'Tiny', definition: 'Places that', examples: [7,8,9] }] },
        { question: 'Second question?', kinds: [
          { name: 'Bigly', definition: 'Places that', examples: [1,2,3] },
          { name: 'Elsewise', definition: 'Places that', examples: [4,5,6] }] },
      ] };
      const lines = [...p.matchAll(/^(\d+)\. (.*)$/gm)].map((x) => [Number(x[1]), x[2]]);
      /* Each place cites a word only IT has. A word shared by two places that
         got different answers is dropped by the rule against a word arguing two
         ways — correctly — so a stub that hands out shared words tests that rule
         instead of this one. */
      const seenIn = new Map();
      const wordsOf = lines.map(([, text]) => {
        const ws = [...new Set((text.toLowerCase().match(/[a-z][a-z-]{5,}/g) || []))];
        for (const w of ws) seenIn.set(w, (seenIn.get(w) || 0) + 1);
        return ws;
      });
      const out = { rows: [] };
      /* Indexed by the PLACE, not by where it fell in the batch. Filing goes 40
         at a time and the ids run 0-39 then 40-65, so a plan read off the
         position inside the batch is applied twice. */
      lines.forEach(([i], k) => {
        const mine = wordsOf[k].find((w) => seenIn.get(w) === 1) || wordsOf[k][0] || 'place';
        const r = { i };
        const a = plan(i);
        if (a[0]) { r.q0 = a[0]; r.w0 = [mine]; }
        if (a[1]) { r.q1 = a[1]; r.w1 = [mine]; }
        out.rows.push(r);
      });
      return out;
    },
  });
}

console.log('\n  a kind that took only two places');
// q0: 40 Bigly, 22 Middling, 2 Tiny (indices 62,63) ; q1: 4 Bigly, 20 Elsewise
const r1 = await run({ plan: (k) =>
  [k < 40 ? 'Bigly' : k < 62 ? 'Middling' : k < 64 ? 'Tiny' : '',
   k < 4 ? 'Bigly' : k < 24 ? 'Elsewise' : ''] });
if (r1.verdict !== 'questions') {
  console.log('        verdict: ' + r1.verdict + '  reason: ' + (r1.reason || r1.note || r1.trouble || '-'));
  console.log('        batches: ' + r1.batches + '  unread: ' + r1.unread);
}
check('the reading still lands', r1.verdict, 'questions');
const q0 = r1.questions.find((q) => q.question === 'First question?');
check('the two-place kind is gone from the key', q0.counts.map((c) => c.name), ['Bigly', 'Middling']);
check('and it is said which was folded', (r1.folded || []).map((f) => f.kind + '=' + f.count), ['Tiny=2']);
check('those two places are unanswered, not mis-filed',
  q0.categories.filter((c) => c === 'Tiny').length, 0);
check('and their words went with the answer',
  q0.categories.map((c, i) => (!c && q0.why[i] && q0.why[i].length) ? 'orphan' : 'ok').includes('orphan'), false);
check('the share beside the switch counts only what is left',
  q0.answered, q0.counts.reduce((t, c) => t + c.count, 0));
check('and the two folded places are not in it',
  q0.answered, q0.categories.filter((c) => c && c !== 'other').length);

console.log('\n  one name under two questions');
const q1 = r1.questions.find((q) => q.question === 'Second question?');
check('it stays where it holds more places', q0.counts.some((c) => c.name === 'Bigly'), true);
check('which is reported, naming where it was kept',
  (r1.renamedAway || []).map((x) => x.kind + ' kept under ' + x.keptUnder),
  ['Bigly kept under First question?']);
/* Losing the shared name left the second question with one kind, and one kind
   is not a colouring — so the whole question goes. That is the right end: a
   switch offering a single colour tells a reader nothing. */
check('and the question it was taken from falls below two kinds, so it goes',
  q1, undefined);
check('leaving only the question that could carry itself',
  r1.questions.map((q) => q.question), ['First question?']);

console.log('\n  whether a question sorts anything');
// q0: Bigly 40 of 62 answers = 65% -> flat.  q1: Elsewise 20 of 20 = 100% -> flat
check('a question mostly one answer is marked flat', q0.flat, true);
check('with the answer that says why', q0.biggest, 'Bigly');
check('and its count is the biggest of them', q0.biggestCount, Math.max(...q0.counts.map((c) => c.count)));
check('the share is that count over its own answers',
  Math.round(q0.lopsided * 100), Math.round(q0.biggestCount / q0.answered * 100));
check('and it is over the threshold that makes it flat', q0.lopsided >= 0.6, true);

console.log('\n  an evenly split question');
const r2 = await run({ plan: (k) => [['Bigly', 'Middling', 'Tiny'][k % 3], k % 2 ? 'Elsewise' : ''] });
const even = r2.questions.find((q) => q.question === 'First question?');
check('is not marked flat', even.flat, false);
check('and keeps all three kinds', even.counts.length, 3);
check('its commonest answer takes about a third', Math.round(even.lopsided * 100) <= 34, true);

console.log('\n  a question the layer had already settled on');
const settled = [{ question: 'First question?', kinds: [
  { name: 'Bigly', definition: '' }, { name: 'Middling', definition: '' }, { name: 'Tiny', definition: '' }] }];
const r3 = await run({ keepQuestions: settled, plan: (k) =>
  [k < 40 ? 'Bigly' : k < 62 ? 'Middling' : k < 64 ? 'Tiny' : '', ''] });
const kept3 = r3.questions[0];
check('its two-place kind is left alone', kept3.counts.map((c) => c.name), ['Bigly', 'Middling', 'Tiny']);
check('because its keys are on a map somebody may have linked to', (r3.folded || []).length, 0);

console.log('\n  a hole, found in the places a question left blank');
// r1's plan answers nearly everything, so there is little to repair
check('a reading that answers nearly everything has few gaps',
  (r1.gaps || []).length <= 1, true);

// and one that answers almost nobody
const r4 = await run({ plan: (i) => [i < 4 ? 'Bigly' : i < 8 ? 'Middling' : '', ''] });
check('one that leaves most places blank is caught', (r4.gaps || []).length > 0, true);
check('and it names the question, not just a word',
  (r4.gaps || []).every((g) => g.question && g.missing.length), true);
check('each missing kind is shared by at least three of the blank places',
  (r4.gaps || []).every((g) => g.missing.every((m) => m.places >= 3)), true);
/* the old test asked whether a WORD was well served across the whole map, which
   could not see a word that is fine overall and absent from one question */
check('the count is of blank places, not of the whole map',
  (r4.gaps || []).every((g) => g.blank > 0 && g.blank <= 66), true);
console.log('        ' + (r4.gaps || []).map((g) =>
  '"' + g.question + '" left ' + g.blank + ' blank; they share ' +
  g.missing.map((m) => m.word + ' (' + m.places + ')').join(', ')).join('\n        '));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
