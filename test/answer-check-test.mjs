/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* An answer must fit its meaning, not only quote a word the place carries.
   Bengaluru, October 2026: a granite sculpture was answered "Negative or
   degraded" to "What is its environmental impact?" on the label "vandalized".
   Two guards: a stricter rule in the answering prompt, and a careful check by
   the reading model of every answer left standing. No network: the model is a
   stand-in. */
import * as E from '../api/lib/atlas/enrich.js';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name +
    (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const rows = [
  { name: 'Granite figure', description: 'A granite sculpture by the lake, vandalized last year' },
  { name: 'Lake edge', description: 'Reeds cut back and the lake bed dredged, habitat loss for the herons' },
  { name: 'Tree walk', description: 'A grove of old rain trees, protected and cared for by neighbours' },
  { name: 'Gallery', description: 'An exhibition about pollution in the city' },
  { name: 'Bench', description: '' },
];
const fields = ['description'];
const impact = { question: 'What is its environmental impact?', kinds: [
  { name: 'Positive or preserved', definition: 'Places that highlight environmental stewardship, conservation, or natural beauty.' },
  { name: 'Negative or degraded', definition: 'Places that show habitat loss, degradation, pollution or harm to nature.' }] };
// a describing question beside it, which neither the stricter rule nor the check may touch
const material = { question: 'What is its primary material?', kinds: [
  { name: 'Stone', definition: 'Places made of stone or granite.' },
  { name: 'Trees', definition: 'Places that are trees or groves.' }] };
const questions = () => E.settledForAnswering([impact, material], fields);
const digest = E.buildDigest(rows, fields);

// the cheap model's first pass: it files the sculpture under harm, on "vandalized"
const FIRST = {
  0: { q0: 'Negative or degraded', w0: ['vandalized'], q1: 'Stone', w1: ['granite'] },
  1: { q0: 'Negative or degraded', w0: ['habitat loss'], q1: 'other', w1: [] },
  2: { q0: 'Positive or preserved', w0: ['protected'], q1: 'Trees', w1: ['rain trees'] },
  3: { q0: 'Negative or degraded', w0: ['pollution'], q1: 'other', w1: [] },
};
function stub({ check = 'judge', log } = {}) {
  log.answer = []; log.check = []; log.models = [];
  return async (model, prompt, schema, o) => {
    log.models.push([model, Boolean(o && o.think), Boolean(schema.properties.checks)]);
    if (schema.properties.checks) {
      log.check.push(prompt);
      if (check === 'throw') throw new Error('the model refused (503)');
      if (check === 'empty') return {};
      if (check === 'yes') return { checks: [] };
      // the careful reader: damage to an object, or an exhibition's subject, is not the place's impact
      const lines = [...prompt.matchAll(/^c(\d+)\. Q\d+ answered "[^"]+" — because of the words (.*)$/gm)];
      return { checks: lines.map((m) => ({ c: Number(m[1]), call: /vandalized|pollution|granite|rain trees/.test(m[2]) ? 'misread' : 'keep' })) };
    }
    log.answer.push(prompt);
    const ids = [...prompt.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    return { rows: ids.map((i) => Object.assign({ i }, FIRST[i] || { q0: 'other', w0: [], q1: 'other', w1: [] })) };
  };
}
const run = (opts = {}, stubOpts = {}) => {
  const log = {};
  return E.answerQuestions(Object.assign({ digest, questions: questions(), title: 'Bengaluru',
    callJSON: stub(Object.assign({ log }, stubOpts)), model: 'lite', checkModel: 'careful' }, opts))
    .then((out) => Object.assign(out, { log }));
};

console.log('\n  which questions judge a place');
const fx = (f) => JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/insight/' + f + '.json', 'utf8')).layer;
const judgedIn = (L) => Object.keys(L.keyLabels).filter((k) => E.isJudgementQuestion({ question: L.keyLabels[k], kinds: L.keyKinds[k] || [] }));
check('Bengaluru: only the environmental impact question', judgedIn(fx('bengaluru')), ['pattern_3']);
check('Cubbon: only the condition question', judgedIn(fx('cubbon')), ['pattern_3']);
check('a question about condition judges, whatever its answers are called',
  E.isJudgementQuestion({ question: 'What condition is it in?', kinds: [{ name: 'Well kept' }, { name: 'Run down' }] }), true);
check('kinds called Good and Bad judge', E.isJudgementQuestion({ question: 'How is it?', kinds: [{ name: 'Good' }, { name: 'Bad' }] }), true);
check('kinds that only describe do not', E.isJudgementQuestion(material), false);
check('a theme question with "Climate impact" and "Clean cities" does not',
  E.isJudgementQuestion({ question: 'What theme does the session explore?', kinds: [{ name: 'Climate impact', definition: 'Sessions about climate change' }, { name: 'Clean cities', definition: 'Sessions about waste' }, { name: 'Heritage' }] }), false);
check('nor does "What does it offer?" with "Good food" and "Good views"',
  E.isJudgementQuestion({ question: 'What does it offer?', kinds: [{ name: 'Good food' }, { name: 'Good views' }, { name: 'Quiet' }] }), false);
// a topic word in the wording is not a judgement of the place (review, 25 Oct 2026)
for (const q of ['What health services does it offer?', 'What safety features does it have?', 'What kind of air quality monitor is it?', 'What special effects are used?', 'How well known is it?']) {
  check('"' + q + '" does not judge', E.isJudgementQuestion({ question: q, kinds: [{ name: 'Clinic' }, { name: 'Hospital' }] }), false);
}
check('"How safe is it at night?" judges', E.isJudgementQuestion({ question: 'How safe is it at night?', kinds: [{ name: 'Lit' }, { name: 'Dark' }] }), true);
check('two opposite kinds judge, whatever the wording',
  E.isJudgementQuestion({ question: 'What is it like?', kinds: [{ name: 'Safe' }, { name: 'Unsafe' }] }), true);
check('one evaluative kind alone does not',
  E.isJudgementQuestion({ question: 'What is it like?', kinds: [{ name: 'Healthy' }, { name: 'Busy' }] }), false);
check('nor does one "good" in a definition of a use',
  E.isJudgementQuestion({ question: 'What is it used for?', kinds: [{ name: 'Play', definition: 'Places good for play' }, { name: 'Food' }] }), false);

console.log('\n  the answering prompt carries the evidence rule, for the judging question only');
const strict = await run();
const rule = E.evidenceRule([0]);
check('the rule is in the prompt', strict.log.answer[0].includes(rule), true);
check('it names the judging question', /^- q0 judges a place/.test(rule), true);
check('and that damage to an object is not harm to the environment', /damage or vandalism to an object is not harm to the environment/.test(rule), true);
check('thin evidence about the right thing still counts', /Thin evidence that is about the right thing is still evidence/.test(rule), true);
check('and says a plain match is enough on the describing questions', /a plain match of what the place is or has \(the word "tree" for a kind called Trees\) is enough/.test(rule), true);
check('the old "other is a correct answer" rule is still there', /"other" is a correct answer, not a failure/.test(strict.log.answer[0]), true);
check('and so is the rule on copying words exactly', /COPIED EXACTLY/.test(strict.log.answer[0]), true);
{
  const log = {};
  await E.answerQuestions({ digest, questions: E.settledForAnswering([material], fields), callJSON: stub({ log }), model: 'lite', checkModel: 'careful' });
  check('with no judging question there is no rule and no check', [/judges a place/.test(log.answer[0]), log.check.length], [false, 0]);
}
const legacy = await run({ strict: false, checkModel: null });
check('the old step (for measuring) has neither the rule nor the check',
  [legacy.log.answer[0].includes(rule), legacy.log.check.length], [false, 0]);
check('and keeps the sculpture as the cheap model filed it', legacy.answers[0][0], 'Negative or degraded');

console.log('\n  the careful check');
check('one check call for four answers', strict.log.check.length, 1);
check('asked of the careful model, thinking on', strict.log.models.filter((m) => m[2]).map((m) => [m[0], m[1]]), [['careful', true]]);
const cp = strict.log.check[0];
check('it asks about misreading, not proof', /Look for one mistake only: an answer that MISREADS what the question is about/.test(cp), true);
check('thin evidence in the right sense is kept', /Thin, general or one-word evidence that is about the right thing is NOT a misread/.test(cp), true);
check('with worked examples: a graffitied statue misread, a tree\'s shade kept',
  /"graffitied".*→ misread/.test(cp) && /"shade".*→ keep/.test(cp) && E.CHECK_EXAMPLES.length >= 3 && E.CHECK_EXAMPLES.length <= 4, true);
check('made up, not copied from a real atlas', E.CHECK_EXAMPLES.some((x) => /environmental impact|Negative or degraded|Positive or preserved|vandalized|natural-shade|banyan|St\. John/i.test(x)), false);
check('two misreads and two keeps', [E.CHECK_EXAMPLES.filter((x) => /→ misread/.test(x)).length, E.CHECK_EXAMPLES.filter((x) => /→ keep/.test(x)).length], [2, 2]);
check('the check is shown the question and the answer\'s definition',
  /Q0 — What is its environmental impact\?/.test(cp) && /Negative or degraded — Places that show habitat loss/.test(cp), true);
check('and the quoted words with the line they came from',
  /answered "Negative or degraded" — because of the words "vandalized"\n    the place's line: A granite sculpture by the lake, vandalized last year/.test(cp), true);
check('inside the fence', cp.indexOf('----- BEGIN PLACES') < cp.indexOf('c0. ') && cp.indexOf('c0. ') < cp.indexOf('----- END PLACES'), true);
check('"other" and blank answers are not sent to the check', (cp.match(/^c\d+\. /gm) || []).length, 4);
check('nor is the describing question', /Q1|What is its primary material/.test(cp), false);
check('whose answers stand untouched', [strict.answers[1][0], strict.answers[1][2]], ['Stone', 'Trees']);
check('the tally says which questions were judged', strict.check.judged, [0]);
check('a "misread" blanks the answer', strict.answers[0][0], '');
check('and its words', strict.why[0][0], []);
check('the exhibition\'s subject is not the gallery\'s impact', [strict.answers[0][3], strict.why[0][3]], ['', []]);
check('a "keep" keeps answer and words', [strict.answers[0][1], strict.why[0][1]], ['Negative or degraded', ['habitat loss']]);
check('and the other kind too', strict.answers[0][2], 'Positive or preserved');
check('the tally says what it did', [strict.check.asked, strict.check.blanked, strict.check.calls, strict.check.failed], [4, 2, 1, 0]);
check('and lists what it took away', strict.check.blankedList.map((b) => b.i), [0, 3]);

console.log('\n  a check that cannot run never costs the reading its answers');
const warn = console.warn; console.warn = () => {};
const thrown = await run({}, { check: 'throw' });
const empty = await run({}, { check: 'empty' });
console.warn = warn;
check('a failed call keeps every first answer', thrown.answers[0].slice(0, 4), ['Negative or degraded', 'Negative or degraded', 'Positive or preserved', 'Negative or degraded']);
check('with its words', thrown.why[0][0], ['vandalized']);
check('and is counted as failed', [thrown.check.failed, thrown.check.blanked], [1, 0]);
check('an answer with no checks in it keeps them too', empty.answers[0][0], 'Negative or degraded');
const yes = await run({}, { check: 'yes' });
check('a stand-in that says nothing against them keeps them (the stub says yes)', yes.answers[0].slice(0, 4), thrown.answers[0].slice(0, 4));
check('no check model, no check', (await run({ checkModel: null })).log.check.length, 0);

console.log('\n  the check spends from the reading\'s allowance');
// a counted caller, shaped like aiCaller in api/apps/atlas.js: a cap, and what it has spent
function counted(inner, cap) {
  let spent = 0;
  const call = (...a) => { if (spent >= cap) throw new Error('this reading has used its share of the model'); spent += 1; return inner(...a); };
  call.spent = () => spent; call.cap = cap;
  return call;
}
{
  const log = {};
  const caller = counted(stub({ log }), 10);
  const out = await E.enrichRows({ rows, fields, title: 'Bengaluru', mode: 'questions', keepQuestions: [impact], seedSet: [],
    callJSON: caller, models: { flash: 'careful', flashLite: 'lite' } });
  check('a re-read of settled questions answers, then checks', [log.answer.length, log.check.length], [1, 1]);
  check('both calls are charged to the reading', caller.spent(), 2);
  check('the check is the reading model, not the cheap one', log.models.filter((m) => m[2]).map((m) => m[0]), ['careful']);
  const q = out.questions && out.questions[0];
  check('and what it took away is gone from the saved answers', q && q.categories[0], '');
}
{
  // many answers, little room: each call is handed more rather than the rest going unchecked
  const many = Array.from({ length: 120 }, (_, k) => ({ name: 'p' + k, description: 'Place ' + k + ' with old trees protected' }));
  const d = E.buildDigest(many, fields);
  const log = {};
  const inner = stub({ log, check: 'yes' });
  const answerAll = async (m, p, s, o) => {
    if (s.properties.checks) return inner(m, p, s, o);
    log.answer.push(p);
    return { rows: [...p.matchAll(/^(\d+)\. /gm)].map((x) => ({ i: Number(x[1]), q0: 'Positive or preserved', w0: ['protected'] })) };
  };
  const roomy = await E.answerQuestions({ digest: d, questions: questions(), callJSON: answerAll, model: 'lite', checkModel: 'careful' });
  check('120 answers with room to spare: 40 a call, three calls', [log.check.length, roomy.check.calls], [3, 3]);
  log.check.length = 0;
  const tight = await E.answerQuestions({ digest: d, questions: questions(), callJSON: answerAll, model: 'lite', checkModel: 'careful', checkRoom: 2 });
  check('with room for two calls: 60 a call, two calls', [log.check.length, (log.check[0].match(/^c\d+\. /gm) || []).length], [2, 60]);
  check('none left unchecked', tight.check.unchecked, 0);
  log.check.length = 0;
  console.warn = () => {};
  const none = await E.answerQuestions({ digest: d, questions: questions(), callJSON: answerAll, model: 'lite', checkModel: 'careful', checkRoom: () => 0 });
  console.warn = warn;
  check('with no room at all, no call, and every answer kept as first answered',
    [log.check.length, none.check.unchecked, none.answers[0].filter((a) => a === 'Positive or preserved').length], [0, 120, 120]);
}

console.log('\n  the caller\'s side, read from the code');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const enrichSrc = fs.readFileSync(ROOT + '/api/lib/atlas/enrich.js', 'utf8');
check('the allowance for columns is unchanged', /const AI_CALLS_PER_READING = 24;/.test(server), true);
check('the check has room of its own on top', /const ANSWER_CHECK_CALLS = 4;/.test(server) &&
  /const cap = perReading \|\| \(AI_CALLS_PER_READING \+ ANSWER_CHECK_CALLS\);/.test(server), true);
check('the caller says its cap', /call\.cap = cap;/.test(server), true);
check('a reading checks with the reading model and the room the caller has left',
  /checkModel: models\.flash \|\| null,/.test(enrichSrc) && /checkRoom: counted \? \(\) => callJSON\.cap - callJSON\.spent\(\) : Infinity/.test(enrichSrc), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
