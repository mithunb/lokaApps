/* Run me with: node test/run.mjs — or on my own with node.
 *
 * "Voices" (atlas/insight-mode.js storyDigest,
 * api/lib/atlas/insight-summary.js writeStory) — 5 November 2026, a MOCK-UP:
 * a short STORY of the places, one paragraph in plain sentences and two
 * quotes in the places' own words, with no numbers in it at all (Mithun:
 * "stats are less important because the questions cover it"). Nothing here is
 * on the visitor page yet; the shipped summary (SUMMARY_VERSION, writeSummary,
 * checkSentencesWithReasons) is untouched, and the last block holds that.
 *
 * These checks hold:
 *   - the digest: never a people question, never a tagger's name, never a
 *     credit line, a link, an email or a phone number in the words offered;
 *     words several places share are nobody's own; the sample is spread
 *     across the answers and capped;
 *   - the checks: a digit, a number in words or a word for how many drops the
 *     sentence; an id the model was not given drops it; under two ids drops
 *     it; a quote must be the place's own words, re-inserted by the code, and
 *     two quotes must come from two places;
 *   - the proofread: a sentence it will not vouch for is dropped, one it says
 *     nothing about is dropped, and with no proofread at all nothing is shown.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const IM = require(ROOT + '/atlas/insight-mode.js');
const SUM = await import(ROOT + '/api/lib/atlas/insight-summary.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

/* ---------------- a layer made for these checks ----------------
   Twenty places. pattern_5's answers are people (its keyColumns name
   created_by), so it is never read. One place's words are a credit line, one
   names the tagger who wrote them, one names a "creator" column nothing was
   read from, one holds an email address, one a phone number. */
const layer = {
  id: 'tiny',
  popup: { title: 'name' },
  keyLabels: { pattern_1: 'What kind of place is it?', pattern_2: 'What is it made of?', pattern_5: 'Who created this place?' },
  keyColumns: { pattern_5: ['created_by', 'created_by_user_id'] },
};
const place = (id, p1, p2, description, extra) => ({ type: 'Feature', properties: Object.assign({
  tag_id: id, name: 'Place ' + id, description, pattern_1: p1, pattern_1_why: '', pattern_2: p2, pattern_2_why: '',
  pattern_5: 'Pratham', created_by: 'Pratham', created_by_user_id: 'u-1' }, extra || {}) });
const features = [];
const corner = ['by the gate', 'behind the library', 'near the water tank', 'at the bus stand', 'under the flyover',
  'beside the school', 'off the main road', 'past the market', 'on the hill', 'where the lane bends'];
for (let i = 1; i <= 10; i++) features.push(place('g' + i, 'Garden', 'Natural elements', 'A quiet garden ' + corner[i - 1] + ' where the old rain tree still stands.'));
for (let i = 1; i <= 5; i++) features.push(place('s' + i, 'Shrine', 'Stone or masonry', 'A small stone shrine ' + corner[i - 1] + ', but somebody still keeps it clean.'));
// a place whose words only say what it is: offered to the story, never held up as a quote
features.push(place('lab1', 'Garden', 'Natural elements', 'table made with waste materials near the gate'));
// three with a feeling in them, so the code has something to group and to set against each other
features.push(place('d1', 'Garden', 'Natural elements', 'I love this garden and the shade here is wonderful on a hot day.'));
features.push(place('d2', 'Garden', 'Natural elements', 'A lovely corner, peaceful and green, and the benches are a treat.'));
features.push(place('w1', 'Garden', 'Natural elements', 'The trees here have been cut down for a building site and the shade is gone.'));
features.push(place('w2', 'Garden', 'Natural elements', 'Rubbish is dumped by the wall and the water in the tank is dirty.'));
features.push(place('q1', 'Shrine', 'Stone or masonry', 'Does anyone know who built this shrine, and when?'));
features.push(place('x1', 'Garden', '', 'Photo: J. H. Furneaux, Public domain, via Wikimedia Commons'));
features.push(place('x2', 'Garden', '', 'Pratham brought the whole class here to count the ants.'));
features.push(place('x3', 'Garden', '', 'beardcoded cleans this corner of the park every Sunday.', { creator: 'beardcoded' }));
features.push(place('x4', 'Garden', '', 'Write to hello@example.com before you visit this garden.'));
features.push(place('x5', 'Garden', '', 'Call +91 98450 12345 and somebody opens the gate for you.'));

const digest = IM.storyDigest(layer, features);
const all = JSON.stringify(digest);
const offeredIds = digest.offered.map((o) => o.id);

console.log('\n  the places the model is given');
check('the people question is not in it, and nor is the tagger', [/pattern_5/.test(all), /Pratham/i.test(all), /u-1/.test(all)], [false, false, false]);
check('it offers the places that have words of their own, with their answers in plain words',
  [digest.places, digest.questions.map((q) => q.id), digest.offered.length, digest.offered[0].answers],
  [26, ['pattern_1', 'pattern_2'], 21, [{ question: 'What kind of place is it?', answer: 'Garden' }, { question: 'What is it made of?', answer: 'Natural elements' }]]);
check('the model is shown the places and nothing tallied: no counts anywhere',
  [Object.keys(digest.offered[0]), /"count"/.test(all), /"count"/.test(SUM.storyPromptFor(digest))],
  [['id', 'name', 'words', 'sentences', 'answers'], false, false]);
const why = (id) => (digest.unquotable.find((u) => u.id === id) || {}).why;
check('a credit line is never offered', why('x1'), 'it is a credit line');
check('a sentence naming the tagger is never offered, and the reason does not name them either',
  [why('x2'), IM.quoteFault('Pratham brought the whole class here to count the ants.', ['Pratham'])],
  ['it names a person', 'it names a person (Pratham)']);
check('…nor one naming a plain "creator" column nothing was read from (the wider people rule)',
  [why('x3'), IM.isPeopleColumn('creator'), IM.isPeople(layer, 'pattern_1')], ['it names a person', true, false]);
check('an email or a phone number keeps the words out',
  [why('x4'), why('x5')], ['it has a link, an email, a phone number or an @handle', 'it has a link, an email, a phone number or an @handle']);
check('the sample is spread across the answers: the first two offered answer differently',
  [digest.offered.slice(0, 2).map((o) => o.answers[0].answer), digest.quality.withWords, digest.quality.offered],
  [['Garden', 'Shrine'], 21, 21]);
check('…and it is capped, taking from each answer in turn',
  (() => { const small = IM.storyDigest(layer, features, { cap: 4 }); return [small.offered.length, small.offered.map((o) => o.answers[0].answer)]; })(),
  [4, ['Garden', 'Shrine', 'Garden', 'Shrine']]);
check('a line break ends a sentence, and an initial or "St." does not',
  IM.splitSentences('Rising beside St. John’s Church, named for J. H. Furneaux.\nPhoto: somebody, via Wikimedia Commons'),
  ['Rising beside St. John’s Church, named for J. H. Furneaux.', 'Photo: somebody, via Wikimedia Commons']);

console.log('\n  words several places share are not anybody’s own words');
const shareLayer = { id: 'sp', keyLabels: { pattern_1: 'What kind of place is it?' }, keyColumns: { pattern_1: ['spaces'] } };
const shareF = [];
for (let i = 1; i <= 6; i++) shareF.push({ type: 'Feature', properties: { tag_id: 'sp' + i, pattern_1: 'Cubbon Park', pattern_1_why: 'Cubbon Park',
  spaces: 'Cubbon Park - Is this seat taken', description: 'A bench ' + corner[i - 1] + ' that nobody seems to sit on.' } });
const shareD = IM.storyDigest(shareLayer, shareF);
check('a space’s name, copied onto every place, is never offered; the place’s own line is',
  shareD.offered.map((o) => o.words.slice(0, 8)), ['A bench ', 'A bench ', 'A bench ', 'A bench ', 'A bench ', 'A bench ']);
check('…and when that is all a place has, it says why',
  IM.placeWords(shareLayer, shareF[0], 'pattern_1', { shared: () => true }).why,
  'those words stand on several places, so they are not this place’s own');
check('a keyColumn that is not free text (a space’s name) is no source of words either',
  IM.quoteSourcesOf({ keyColumns: { pattern_1: ['spaces'] } }, { spaces: 'Cubbon Park - Is this seat taken', description: 'A bench by the gate that nobody seems to sit on.' }, 'pattern_1'),
  ['A bench by the gate that nobody seems to sit on.']);

/* ---------------- the checks over the model's answer ---------------- */
const cand = digest.candidates;
const g = (key) => digest.groups.find((x) => x.feeling === key);
const delight = g('delight'), wonder = g('wonder'), worry = g('worry'), plain = g('describing');
const plain2 = digest.groups.filter((x) => x.feeling === 'describing')[1];
const good = () => ({
  sentences: [
    { text: 'People are fond of the gardens, the shade and the benches in them.', quotes: delight.quotes.slice(0, 2) },
    { text: 'People also write plainly about the shrines, kept clean by hand.', quotes: plain2.quotes.slice(0, 2) },
    { text: 'One person asks who built a shrine, and when.', quotes: wonder.quotes.slice(0, 1) },
  ],
});

console.log('\n  the quotes are grouped before the model sees them');
check('each pointed quote is tagged with what it feels',
  ['I love this garden and the shade here is wonderful on a hot day.', 'The trees here have been cut down for a building site and the shade is gone.',
    'Does anyone know who built this shrine, and when?', 'I wish there were cleaner watering holes.',
    'Hebbal serves as a quiet witness to the city\u2019s ancient origins.', 'A small stone shrine by the gate.'].map((t) => IM.feelingOf(t).key),
  ['delight', 'worry', 'wonder', 'annoyed', 'pride', 'describing']);
check('quotes that feel the same way about the same thing are put together, feelings before plain description',
  [delight.quotes.length >= IM.GROUP_MIN, delight.about, wonder.alone, digest.groups.filter((x) => x.feeling === 'describing').length <= 2,
    digest.groups.every((x) => x.quotes.length <= IM.GROUP_MAX)],
  [true, 'Garden', true, true, true]);
check('two groups that feel differently about one thing are offered as a tension',
  digest.tensions.some((t) => t.about === 'Garden' && t.groups.indexOf(delight.id) >= 0 && t.groups.indexOf(worry.id) >= 0), true);
check('the prompt hands over the groups, not a loose list of quotes',
  [SUM.storyPromptFor(digest).includes('Groups:'), SUM.storyPromptFor(digest).includes('gathering each group into ONE sentence'),
    SUM.storyPromptFor(digest).includes('table made with waste materials')], [true, true, false]);

console.log('\n  pointed quotes, not bare labels');
check('the code scores what is worth quoting: a question, a turn, a feeling, somebody speaking',
  ['Does anyone know who the artist is?', 'We have to drink water from this muddy pool.',
    'This place used to be empty and full of trees.', 'I wish there were cleaner watering holes!'].map((t) => IM.isPointed(t)),
  [true, true, true, true]);
check('…and a bare label is not worth quoting',
  ['table made with waste materials near the gate', 'The Bier Library in Sarjapur.', 'Ganesha idol with granite mandapam'].map((t) => [IM.quoteScore(t), IM.isPointed(t)]),
  [[-2, false], [-2, false], [-2, false]]);
check('a mark of feeling counts, and twenty quotes may be offered',
  [IM.quoteScore('Wonder how deep this hole goes?') < IM.quoteScore('Wonder how deep this hole goes??'), IM.STORY_CANDIDATES], [true, 20]);
check('only the pointed sentences are offered, one a place, the sharpest first',
  [cand.some((c) => c.id === 'lab1'), cand.length <= IM.STORY_CANDIDATES,
    cand.every((c, i, a) => i === 0 || a[i - 1].score >= c.score),
    new Set(cand.map((c) => c.id)).size === cand.length],
  [false, true, true, true]);

console.log('\n  what the code checks');
const ok0 = SUM.checkStory(digest, good());
check('a paragraph that gathers two groups passes, each sentence carrying its group\u2019s quotes',
  [ok0.sentences.length, ok0.dropped.length, ok0.sentences[0].quotes], [3, 0, delight.quotes.slice(0, 2)]);
const ev = SUM.evidenceFor(digest, ok0.sentences);

check('the evidence is the cited quotes, words put back by the code, one for each sentence first',
  [ev.length >= 2, ev.map((q) => q.id).includes(delight.quotes[0]), ev.map((q) => q.id).includes(plain2.quotes[0]),
    ev.every((q) => q.text === cand.find((c) => c.id === q.id).text)],
  [true, true, true, true]);
const mixed = good();
mixed.sentences[0] = { text: 'People write plainly about the gardens and about the shrines.', quotes: [plain.quotes[0], plain2.quotes[0]] };
check('a sentence mixing groups the code did not put together is dropped',
  SUM.checkStory(digest, mixed).dropped.map((d) => /^it mixes quotes from groups the code did not put together \(g\d+ \+ g\d+\)$/.test(d.why)),
  [true]);
const tension = good();
tension.sentences[0] = { text: 'People are fond of a garden, while others write that the trees went for a building site.',
  quotes: [delight.quotes[0], worry.quotes[0]] };
check('…but a tension pair may be held in one sentence', SUM.checkStory(digest, tension).sentences.length, 3);
const lonely = good();
lonely.sentences[0] = { text: 'People are fond of the shade in a garden.', quotes: [delight.quotes[0]] };
check('a sentence resting on one quote whose group holds more is dropped',
  SUM.checkStory(digest, lonely).dropped.map((d) => d.why), ['its group holds more voices saying the same thing, so gather them']);
const alone = good();
alone.sentences[0] = { text: 'One line here asks who built a shrine.', quotes: [wonder.quotes[0]] };
const aloneRan = SUM.checkStory(digest, alone);
check('…while a quote the code left on its own may stand alone', [aloneRan.sentences.length, aloneRan.dropped], [3, []]);

console.log('\n  not a list of feelings, and no advice');
const listy = SUM.checkStory(digest, { sentences: [
  { text: 'Somebody is fond of the gardens and the shade in them.', quotes: delight.quotes.slice(0, 2) },
  { text: 'Another person writes plainly about the shrines.', quotes: plain2.quotes.slice(0, 2) },
] });
check('one voice at a time, sentence after sentence, is dropped after the first',
  [listy.sentences.length, listy.dropped.map((d) => d.why)],
  [1, ['it starts like the one before it, and the story is not a list of feelings']]);
check('a paragraph cannot open with “Another”',
  SUM.checkStory(digest, { sentences: [{ text: 'Another is fond of the gardens and their shade.', quotes: delight.quotes.slice(0, 2) }] }).dropped.map((d) => d.why),
  ['a paragraph cannot open with “Another”']);
const advice = good();
advice.sentences[0] = { text: 'Preserving these gardens requires looking after the trees in them.', quotes: delight.quotes.slice(0, 2) };
check('advice in the writer’s own voice is dropped',
  SUM.checkStory(digest, advice).dropped.map((d) => d.why),
  ['it gives advice, which is the writer talking and not what anybody wrote']);
const numbered = good();
numbered.sentences[0] = { text: 'There are 15 gardens that people are fond of.', quotes: delight.quotes.slice(0, 2) };
check('a digit, an amount or a ranking still drops the sentence',
  [SUM.checkStory(digest, numbered).dropped.map((d) => d.why),
    ['Most of them are fond of the gardens.', 'A handful are curious about the shrine.', 'Gardens come first in what people like.'].map((t) => IM.hasAmountWords(t))],
  [['it writes a number, and the story says no numbers at all'], [true, true, true]]);
check('…while gathering words like people, others and one person are fine',
  ['People are fond of the gardens and the shade in them.', 'Others write plainly about the shrines.',
    'One person asks who built a shrine.'].map((t) => IM.hasAmountWords(t)), [false, false, false]);
const strange = good();
strange.sentences[1].quotes = ['no-such-quote'];
check('a quote id it was not given drops the sentence', SUM.checkStory(digest, strange).dropped.map((d) => d.why),
  ['it cites a quote it was not given (no-such-quote)']);
const proto = good();
proto.sentences[1].quotes = ['__proto__'];
check('an id borrowed from the language itself is no quote',
  [SUM.checkStory(digest, proto).dropped.map((d) => d.why), typeof IM.offeredById(digest).constructor],
  [['it cites a quote it was not given (__proto__)'], 'undefined']);
const twice = good();
twice.sentences[1] = { text: 'people are fond of the gardens, the shade and the benches in them.', quotes: plain2.quotes.slice(0, 2) };
check('the same sentence twice is dropped', SUM.checkStory(digest, twice).dropped.map((d) => d.why),
  ['it says again what another sentence says']);

console.log('\n  LOKA’s filing words, unless a quote says them');
const echoed = good();
echoed.sentences[0] = { text: 'People are fond of the natural elements in these gardens.', quotes: delight.quotes.slice(0, 2) };
check('a sentence borrowing a two-word answer label no cited quote says is dropped',
  SUM.checkStory(digest, echoed).dropped.map((d) => d.why),
  ['it uses the question’s filing words “Natural elements”, which no quote it cites says']);

console.log('\n  the proofread');
const verdicts = (f) => ({ sentences: ok0.sentences.map((s, i) => f(i)), quotes: ev.map((q, i) => ({ index: i, namesPerson: false, why: '' })) });
const read = SUM.applyStoryProofread(digest, ok0.sentences, verdicts((i) => ({ index: i, shows: i !== 1, why: i === 1 ? 'the quote does not say that' : '' })));
check('a sentence its quotes do not show is dropped, with its reason',
  [read.sentences.map((s) => s.text.slice(0, 10)), read.dropped.map((d) => [d.what, d.why])],
  [['People are', 'One person'], [['sentence', 'the quote does not say that']]]);
check('a sentence the proofread says nothing about is dropped too',
  SUM.applyStoryProofread(digest, ok0.sentences, { sentences: [{ index: 0, shows: true, why: '' }], quotes: [] }).dropped.map((d) => d.why),
  ['the proofread does not vouch for it', 'the proofread does not vouch for it']);
check('a quote said to name a person takes the sentences resting on it with it',
  (() => { const r = SUM.applyStoryProofread(digest, ok0.sentences, { sentences: ok0.sentences.map((s, i) => ({ index: i, shows: true, why: '' })),
    quotes: [{ index: 0, namesPerson: true, why: 'it names somebody' }, { index: 1, namesPerson: false, why: '' }] });
    return [r.sentences.map((s) => s.text.slice(0, 10)), r.dropped.map((d) => d.what)]; })(),
  [['People als', 'One person'], ['quote', 'sentence']]);
check('an answer with no verdict in it is no proofread at all',
  SUM.applyStoryProofread(digest, ok0.sentences, { sentences: [], quotes: [] }).skipped, 'no usable answer');
check('the proofread is shown each sentence beside the very quotes it cites, and asks one strict question',
  (() => { const p = SUM.storyProofreadPromptFor(digest, ok0.sentences);
    return [/do these quotes show this feeling about this thing/i.test(p), /no benefit of the doubt/i.test(p), p.includes(cand[0].text)]; })(),
  [true, true, true]);

console.log('\n  the whole pipeline');
const Type = { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', NUMBER: 'NUMBER' };
const yes = (n) => ({ sentences: Array.from({ length: n }, (x, i) => ({ index: i, shows: true, why: '' })),
  quotes: [0, 1, 2, 3, 4].map((i) => ({ index: i, namesPerson: false, why: '' })) });
const caller = (write, proof) => async (model, prompt, schema, o) => (o && o.proofread ? proof : write);
const whole = await SUM.writeStory({ layer, features, Type, model: 'a stand-in', call: caller(good(), yes(3)) });
check('a paragraph that passes everything is shown with its evidence under it, and every call is named',
  [whole.by, whole.story.sentences.length, whole.story.quotes.length >= 3, whole.calls.map((c) => [c.what, c.model])],
  ['model', 3, true, [['write', 'a stand-in'], ['proofread', 'a stand-in']]]);
check('every quote shown is cited by a sentence that stands',
  whole.story.quotes.every((q) => whole.story.sentences.some((s) => s.quotes.includes(q.id))), true);
check('the write and the proofread may run on different models',
  (await SUM.writeStory({ layer, features, Type, model: 'one', proofreadModel: 'another', call: caller(good(), yes(3)) })).calls.map((c) => c.model), ['one', 'another']);

let n = 0;
const rewriting = async (m, prompt, schema, o) => {
  if (o && o.proofread) return yes(3);
  n += 1;
  if (n === 1) return { sentences: [good().sentences[0], { text: 'Most of the rest are gardens.', quotes: plain.quotes.slice(0, 2) }] };
  return { sentences: [{ text: 'Others wonder who built a shrine, and when.', quotes: wonder.quotes.slice(0, 1) }] };
};
const again = await SUM.writeStory({ layer, features, Type, model: 'a stand-in', call: rewriting });
check('what was dropped goes back once with its reasons, and the rewrite is checked the same way',
  [again.by, again.story.sentences.map((s) => s.text.slice(0, 12)), again.calls.map((c) => c.what)],
  ['model', ['People are f', 'Others wonde'], ['write', 'proofread', 'rewrite', 'proofread (rewrite)']]);
check('the rewrite is told what was thrown out and why, and is never asked a third time',
  [/YOU HAVE WRITTEN THIS ONCE/.test(SUM.storyRewritePromptFor(digest, [{ what: 'sentence', text: 'Most of the rest are gardens.', why: 'it says how many in words' }], ok0.sentences.slice(0, 1))),
    again.calls.filter((c) => c.what === 'rewrite').length], [true, 1]);
const thin = await SUM.writeStory({ layer, features, Type, model: 'a stand-in',
  call: caller({ sentences: [good().sentences[0]] }, yes(1)) });
check('one sentence is no paragraph: their own words are shown instead (Mithun, 5 Nov 2026)',
  [thin.story && thin.story.ownWords, thin.story && thin.story.sentences.length, thin.story && thin.story.quotes.length >= 2, thin.by],
  [true, 0, true, 'under two sentences were vouched for; their own words instead']);
const noProof = await SUM.writeStory({ layer, features, Type, model: 'a stand-in',
  call: async (m, p, s, o) => { if (o && o.proofread) throw new Error('the model refused (503)'); return good(); } });
check('with no proofread, no written sentence is shown — only their own words, never unchecked text',
  [noProof.story && noProof.story.ownWords, noProof.story && noProof.story.sentences.length, /^the proofread could not be had \(/.test(noProof.by)], [true, 0, true]);
const few = [place('f1', 'Garden', 'Natural elements', 'I love this corner and the shade here is wonderful.'),
  place('f2', 'Garden', 'Natural elements', 'Does anyone know who planted these trees?'),
  place('f3', 'Shrine', 'Stone or masonry', 'A small stone shrine by the gate, but somebody still keeps it clean.')];
const quiet = await SUM.writeStory({ layer, features: few, Type, model: 'a stand-in',
  call: async () => { throw new Error('the model should never be asked here'); } });
check('too few voices: their own words, chosen by the code, and no model asked',
  [quiet.by, quiet.story.ownWords, quiet.story.sentences, quiet.story.quotes.length >= 2, quiet.calls.length,
    quiet.story.quotes.every((q) => few.some((f) => f.properties.tag_id === q.id))],
  ['few voices: their own words, with nothing written over them', true, [], true, 0, true]);
check('…and under two quotable voices there is nothing at all',
  (await SUM.writeStory({ layer, features: few.slice(0, 1), Type, model: 'a stand-in', call: async () => ({}) })).by,
  'no place has words worth quoting');
check('the proofread is told to mark broken grammar false',
  /grammar is broken/.test(SUM.storyProofreadPromptFor(digest, ok0.sentences)), true);

check('the story gets longer than the shipped summary to answer in, and keeps a fingerprint of its own',
  [SUM.STORY_TIMEOUT_MS, SUM.TIMEOUT_MS, SUM.STORY_VERSION,
    SUM.storySig(digest) === SUM.storySig(IM.storyDigest(layer, features)),
    SUM.storySig(digest) === SUM.storySig(IM.storyDigest(layer, features, { shownCols: ['pattern_1'] }))],
  [90000, 25000, 2, true, false]);
const MS = await import(ROOT + '/deploy/measure-story.mjs');
check('the mock-up writes nowhere but --out: the name it builds file names from cannot walk a path',
  [MS.safeName('../../etc/passwd'), MS.parseArgs(['--file=/tmp/x.json', '--name=../../etc/passwd']).name, MS.refused('Deoria-Bioregion')],
  ['etc-passwd', 'etc-passwd', true]);

console.log('\n  the visitor card');
{
  const mode = { summaryOn: true, story: SUM.storyKept(whole) };
  const shown = IM.storyToShow(mode, layer, features);
  const card = IM.storyCardHTML(shown);
  check('the paragraph, then the quotes it rests on, then the small print — a writer\u2019s name only after a quote, never their id',
    [shown.ownWords, shown.sentences.length, shown.quotes.length === whole.story.quotes.length,
      card.indexOf('in-story') < card.indexOf('in-quotes'),
      /Written by AI from what people wrote about these places\. The counts are in the questions\./.test(card),
      /u-1/.test(card), /Pratham/.test(card.replace(/<span class="in-by-name">[^<]*<\/span>/g, ''))],
    [false, 3, true, true, true, false, false]);
  check('each quote is a button to its place, by the row the question lists use, and names the place in plain words (a name that is a person\u2019s, a credit or a category is no name: "Show this place")',
    [(card.match(/data-in="place" data-i="\d+"/g) || []).length, /See “Place /.test(card),
      IM.storyCardHTML({ sentences: [], quotes: [{ id: 'x', text: 'a line somebody wrote', name: '', at: 0 }], ownWords: true }).includes('Show this place on the map'),
      IM.storyToShow({ summaryOn: true, story: { sig: 'x', ownWords: true, sentences: [],
        quotes: [{ id: 'g1', text: features[0].properties.description, name: 'Pratham' },
          { id: 'g2', text: features[1].properties.description, name: 'Pratham' }] } },
      layer, features).quotes.map((q) => q.name)],
    [shown.quotes.length, true, true, ['Place g1', 'Place g2']]);
  const gone = (id) => features.filter((f) => f.properties.tag_id !== id);
  const edited = (id) => features.map((f) => (f.properties.tag_id === id
    ? { ...f, properties: { ...f.properties, description: 'Somebody has rewritten this line since.' } } : f));
  const first = whole.story.quotes[0].id;
  check('a quote whose place the owner has hidden is not shown; nor is one whose words have changed since',
    [IM.storyToShow(mode, layer, gone(first)).quotes.some((q) => q.id === first),
      IM.storyToShow(mode, layer, edited(first)).quotes.some((q) => q.id === first)], [false, false]);
  check('…and the sentence left with no quote of its own goes with it',
    IM.storyToShow(mode, layer, gone(first)).sentences.every((x) => (x.quotes || []).some((id) => IM.storyToShow(mode, layer, gone(first)).quotes.some((q) => q.id === id))), true);
  const keep2 = features.filter((f) => whole.story.quotes.slice(0, 2).some((q) => q.id === f.properties.tag_id));
  check('under two sentences or under two quotes left: their own words, from what still holds',
    (() => { const s2 = IM.storyToShow(mode, layer, keep2); return [s2.ownWords, s2.sentences.length, s2.quotes.length]; })(), [true, 0, 2]);
  check('under two quotes left: nothing at all — no heading, no card, and the questions stand alone',
    [IM.storyToShow(mode, layer, keep2.slice(0, 1)), IM.storyCardHTML(null)], [null, '']);
  const own = { summaryOn: true, story: SUM.storyKept(thin) };
  check('their own words: the heading and the quotes, with no small print under them',
    (() => { const c = IM.storyCardHTML(IM.storyToShow(own, layer, features)); return [/Story of the place in their own words/.test(c) && !/<b>In their own words<\/b>/.test(c),
      whole.story.sentences.some((x) => c.indexOf(x.text) >= 0), /What people wrote about these places\./.test(c), /Written by AI/.test(c)]; })(),
    [true, false, false, false]);
  check('a story that says nothing shows nothing, and switching it off shows nothing either',
    [IM.storyToShow({ summaryOn: true, story: { sig: 'x', sentences: [], quotes: [] } }, layer, features),
      IM.storyToShow({ summaryOn: false, story: mode.story }, layer, features)], [null, null]);
  /* An older atlas keeps its summary until a story with something in it
     stands in its place: a run that found nothing must not empty the card. */
  const legacy = { sentences: [{ text: 'a', questions: ['pattern_1'] }, { text: 'b', questions: ['pattern_1'] }] };
  check('an atlas written before the story shows its summary inside Voices, and goes on showing it after a run that found nothing',
    [IM.visibleSentences(legacy, ['pattern_1']).length,
      IM.storyToShow({ summaryOn: true, story: { sig: 'x', sentences: [], quotes: [] }, summary: legacy }, layer, features),
      /in their own words">' \+ voiceHead\(\) \+\s*\n\s*sents\.map/.test(fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8'))], [2, null, true]);
  /* Mithun, 5 Nov 2026: a question switched off takes its quotes with it —
     even when its column is the longest thing the place says. */
  const hidden = { id: 'tags', popup: { title: 'name' },
    keyLabels: { pattern_1: 'What kind of place is it?', pattern_3: 'What did somebody notice?' },
    keyColumns: { pattern_3: ['noticed'] } };
  const noticed = [0, 1].map((i) => ({ type: 'Feature', properties: { tag_id: 'n' + i, name: 'Place n' + i,
    description: 'A garden by the gate, number ' + i + '.',
    noticed: 'The water in the tank is dirty and nobody has cleaned it for months, and the children still play there ' + i + '.',
    pattern_1: 'Garden', pattern_3: 'Water' } }));
  const noticedStory = { sig: 'x', sentences: [], ownWords: true,
    quotes: noticed.map((f) => ({ id: f.properties.tag_id, text: f.properties.noticed, name: '' })) };
  const seeN = (cols) => IM.storyToShow({ summaryOn: true, story: noticedStory }, hidden, noticed, cols);
  check('a quote from a question the owner has since switched off is not shown, though its column is the longest the place says',
    [(seeN(['pattern_1']) || {}).quotes, seeN(['pattern_1', 'pattern_3']).quotes.length, IM.quoteSourcesOf(hidden, noticed[0].properties, 'pattern_1')[0].slice(0, 9)],
    [undefined, 2, 'The water']);
  check('…and a quote from the place’s own line, which no question is read from, stands whatever is on show',
    (() => { const own = { sig: 'x', sentences: [], ownWords: true,
      quotes: noticed.map((f) => ({ id: f.properties.tag_id, text: f.properties.description, name: '' })) };
      return [IM.storyToShow({ summaryOn: true, story: own }, hidden, noticed, ['pattern_1']).quotes.length,
        IM.storyToShow({ summaryOn: true, story: own }, hidden, noticed, []).quotes.length]; })(), [2, 2]);
  check('which questions show is no part of the story’s fingerprint, so switching one off never asks the model again',
    SUM.storySig(IM.storyDigest(layer, features)) === SUM.storySig(IM.storyDigest(layer, features, { shownCols: null })), true);
  const noModel = await SUM.writeStory({ layer, features, Type, model: 'a stand-in', call: null });
  const refused = await SUM.writeStory({ layer, features, Type, model: 'a stand-in', call: async () => { throw new Error('the model refused (503)'); } });
  const noProofread = await SUM.writeStory({ layer, features, Type, model: 'a stand-in',
    call: async (m, pr, sc, o) => { if (o && o.proofread) throw new Error('the model refused (503)'); return good(); } });
  check('a run the model could not be had for says so; one the checks threw out does not',
    [!!noModel.failed, refused.failed.slice(0, 9), /^the proofread could not be had/.test(noProofread.failed), thin.failed, whole.failed],
    [true, 'no answer', true, '', '']);
  check('what the server keeps always carries the fingerprint, so a run that found nothing is not run again',
    (() => { const k = SUM.storyKept({ sig: 'abc', story: null }); return [k.sig, k.sentences, k.quotes, k.ownWords, typeof k.at]; })(), ['abc', [], [], false, 'number']);
}

console.log('\n  the shipped summary is untouched');
const tables = IM.summaryTables(layer, features);
const sent = (text, cell) => Object.assign({ text }, cell);
const stone = { text: 'Of the 26 places that say what kind of place they are, 6 say Shrine.', questions: ['pattern_1'], answers: ['Shrine'], count: 6, of: 26 };
check('the cell check still hides a lone sentence (the two-sentence floor)',
  IM.checkSentences([sent('Of the 26 places that say what kind of place they are, 20 say Garden.', { questions: ['pattern_1'], answers: ['Garden'], count: 20, of: 26 })], tables), []);
check('…and still keeps two', IM.checkSentences([
  sent('Of the 26 places that say what kind of place they are, 20 say Garden.', { questions: ['pattern_1'], answers: ['Garden'], count: 20, of: 26 }),
  sent('Of the 26 places that say what kind of place they are, 6 say Shrine.', { questions: ['pattern_1'], answers: ['Shrine'], count: 6, of: 26 })], tables).length, 2);
check('it still insists the sentence names its answer', IM.checkSentencesWithReasons([
  sent('Of the 26 places that say what kind of place they are, 6 are small roadside corners.', { questions: ['pattern_1'], answers: ['Shrine'], count: 6, of: 26 }), stone], tables).dropped.map((d) => d.why),
  ['it does not name Shrine']);
check('"at all" followed by a number is still the sentence saying all',
  IM.checkSentencesWithReasons([{ text: 'Garden is at all 20 of the 26 places that say what kind of place they are.', questions: ['pattern_1'], answers: ['Garden'], count: 20, of: 26 }, stone], tables).dropped.map((d) => d.why),
  ['it says all but the count is a part (20 of 26)']);
check('…while the idiom still passes', IM.checkSentencesWithReasons([
  { text: '5 of the 26 places say nothing at all about what they are made of.', questions: ['pattern_2'], answers: [], count: 5, of: 26 }, stone], tables).kept.length, 2);
check('a cell whose count and group are swapped cannot hide its 0',
  IM.checkSentencesWithReasons([{ text: '26 of the places say nothing about what kind of place they are.', questions: ['pattern_1'], answers: [], count: 26, of: 0 }, stone], tables).dropped.map((d) => d.why),
  ['number 0 of its cell is not in it']);
check('the summary version and its fingerprint have not moved', [SUM.SUMMARY_VERSION, SUM.summarySig(tables) === SUM.summarySig(tables)], [4, true]);

{ // every sentence keeps one visible quote before any sentence gets a second (Mithun, 5 Nov 2026)
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: 'q' + i, name: 'Q' + i, words: 'w', sentences: ['Why is this ' + i + '?'] }));
  const d = { places: mk(10), candidates: mk(10).map((p) => ({ id: p.id, text: p.sentences[0] })) };
  const s5 = [{ quotes: ['q0', 'q1', 'q2'] }, { quotes: ['q3', 'q4'] }, { quotes: ['q5'] }, { quotes: ['q6', 'q7'] }, { quotes: ['q8'] }];
  check('five sentences, five quotes: one for each sentence, in citation order', SUM.evidenceFor(d, s5).map((q) => q.id), ['q0', 'q3', 'q5', 'q6', 'q8']);
  check('room left over goes to further citations, still in citation order', SUM.evidenceFor(d, s5.slice(0, 2)).map((q) => q.id), ['q0', 'q1', 'q2', 'q3', 'q4']);
}

{ // 5 Nov 2026 Gemini run: a tension needs a shared thing, not only a shared wide label
  const IMX = SUM.IM;
  const ga = { id: 'a', feeling: 'delight', about: 'Natural feature', words: IMX.thingWords('The tree canopy gives relief from the traffic') };
  const gb = { id: 'b', feeling: 'wonder', about: 'Natural feature', words: IMX.thingWords('Wonder how deep this Ant Mansion is?') };
  const gc = { id: 'c', feeling: 'worry', about: 'Natural feature', words: IMX.thingWords('They cut the trees along the canopy road') };
  check('two feelings under one wide label but about different things are no tension', IMX.tensionsOf([ga, gb]).length, 0);
  check('two feelings about the same trees are a tension', IMX.tensionsOf([ga, gc]).length, 1);
  check('the shared thing ignores glue words and plurals', IMX.thingWords('The trees and a tree near this place'), ['tree']);
}

{ // Mithun, 5 Nov 2026: each quote names who wrote it (their LOKA name, never an id/email/phone); quotes in plain type
  const IMX = SUM.IM;
  const f = (p) => ({ properties: p });
  check('the writer is the name they post under', IMX.authorOf(f({ created_by: 'Pratham', created_by_user_id: '8e7ac8ed-54bb-4586-a446-326f5ce5d07e' })), 'Pratham');
  check('never an id, an email or a phone number', [IMX.authorOf(f({ created_by: '8e7ac8ed-54bb-4586-a446-326f5ce5d07e' })), IMX.authorOf(f({ created_by: 'a@b.org' })), IMX.authorOf(f({ created_by: '9845012345' })), IMX.authorOf(f({}))], ['', '', '', '']);
  const card = IMX.storyCardHTML({ sentences: [], ownWords: true, quotes: [{ id: 'x', text: 'Why is this here?', name: '', by: 'Pratham', at: 0 }, { id: 'y', text: 'Lovely shade.', name: '', by: '', at: 1 }] });
  check('the card shows the name after the quote, and nothing when there is none', [/Why is this here\?<\/q> <span class="in-by-name">\u2014 Pratham<\/span>/.test(card), (card.match(/in-by-name">/g) || []).length], [true, 1]);
  check('quotes are plain type: no italics, no display face', /\.in-fq q\{[^}]*(italic|font-display)/.test(IMX.CSS), false);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
