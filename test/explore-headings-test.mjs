/* Run me with: node test/run.mjs — or on my own with node.
 *
 * "Version D" headings (Mithun, October 2026): a key's row reads "Explore
 * <place> by <noun>", with what it was made from in a small grey line under
 * it. The noun is the model's pick from the question's own words, and it is
 * kept only if every word of it IS the question's (atlas/label-rules.js). A
 * yes-or-no question, or one with no noun, is headed by its own wording. The
 * place is the owner's, from Settings, and left out until they set it.
 *
 * This runs the shared rule for real on the live atlases' questions and on
 * made-up ones, runs the reading's shaping, the one-off job's checks and
 * writing (on a folder made for the purpose and removed after), and reads
 * the wiring in the viewer, the owner's page, the server and the script. No
 * network, no model.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const L = req(path.join(ROOT, 'atlas', 'label-rules.js'));
const RULES = req(path.join(ROOT, 'atlas', 'reading-rules.js'));
const N = await import('../api/lib/atlas/key-nouns.js');
const enrich = await import('../api/lib/atlas/enrich.js');
const script = await import('../deploy/queue-key-nouns.mjs');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const atlas = read('atlas/atlas.js');
const page = read('atlas/index.html');
const owner = read('atlas/owner.js');
const server = read('api/apps/atlas.js');
const enrichSrc = read('api/lib/atlas/enrich.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ------------------------------------------------------------------ */
console.log('\n  the noun is the question\'s own words, or nothing');
const NOUNS = [
  // [question, the model's noun, kept]
  ['What is its primary function?', 'function', 'function'],
  ['What is its environmental impact?', 'environmental impact', 'environmental impact'],
  ['What is its primary material or design?', 'material or design', 'material or design'],
  ['What is its current status?', 'status', 'status'],
  ["What is this place's main feature?", 'feature', 'feature'],
  ['what species can be seen?', 'species', 'species'],
  ['What is this place used for?', 'use', ''],                          // "use" is not a word of it ("used")
  ["What is the place's condition?", 'Condition', 'condition'],         // brought to lower case
  ['What kind of place is it?', 'kind of place', 'kind of place'],
  ['What is its general location?', 'location', 'location'],
  // words the question does not have are refused, however apt
  ['What is its environmental impact?', 'effect on nature', ''],
  ['What is its primary material or design?', "what it's made of", ''],
  ['what species can be seen?', 'what lives there', ''],
  // singular or plural of the question's word is the same word
  ['Which categories does it fall in?', 'category', 'category'],
  ['What tree is it?', 'trees', 'trees'],
  ['Which city is it in?', 'cities', 'cities'],
  // a name keeps the capitals the question gave it; the sentence's first capital is not a name's
  ['Which part of Cubbon Park is it in?', 'part of Cubbon Park', 'part of Cubbon Park'],
  ['Which part of Cubbon Park is it in?', 'cubbon park', 'Cubbon Park'],   // a name's capitals put back
  ['Function?', 'function', 'function'],
  // only asking words name nothing; nor does a noun that starts by asking
  ['What is it?', 'what', ''],
  ['What is it?', 'is it', ''],
  ['Where is it?', 'where it is', ''],
  // too long
  ['What is the name of the main road or street it is on?', 'name of the main road or street', ''],
  // a yes-or-no question has no noun, whatever is offered
  ['Is it free to visit?', 'free', ''],
  ['Does it have shade?', 'shade', ''],
  ['Can you sit here?', 'sit', ''],
  ['Are dogs allowed?', 'dogs', ''],
  ['Was it built before 1950?', 'built', ''],
  ['Will it flood?', 'flood', ''],
  // nothing, or no question
  ['What is its primary function?', '', ''],
  ['What is its primary function?', null, ''],
  ['', 'function', ''],
  // punctuation the model wraps it in is not a word
  ['What is its primary function?', '"function."', 'function'],
  // Hindi: the same rule, letter for letter
  ['इसका मुख्य उपयोग क्या है?', 'उपयोग', 'उपयोग'],
  ['इसका मुख्य उपयोग क्या है?', 'काम', ''],
];
for (const [q, n, want] of NOUNS) check(JSON.stringify(q) + ' + ' + JSON.stringify(n), L.nounFromQuestion(n, q), want);

console.log('\n  yes-or-no questions');
for (const q of ['Is it free to visit?', 'Does it have shade?', 'Has it been restored?', 'Do people sit here?', 'Isn\'t it old?', '"Is it open?"'])
  check(q + ' is yes or no', L.isYesNo(q), true);
for (const q of ['What is its primary function?', 'Island or mainland?', 'Isolation level?', 'Doors or windows?', 'Which way does it face?'])
  check(q + ' is not', L.isYesNo(q), false);

console.log('\n  a spreadsheet column\'s name, made singular');
const COLS = [
  ['Categories', 'category'], ['Themes', 'theme'], ['Tag id', 'tag id'], ['Photo urls', 'photo url'],
  ['Languages', 'language'], ['Place tags', 'place tag'], ['Species', 'species'], ['Status', 'status'],
  ['Statuses', 'status'], ['Address', 'address'], ['Branches', 'branch'], ['Boxes', 'box'],
  ['GPS', 'GPS'], ['Arunachal Pradesh field notes', 'Arunachal Pradesh field note'],
  ['Name of Organisation or Collective', 'Name of Organisation or Collective'],
  ['How long have you been involved…', ''],          // a question cut short cannot follow "by"
  ['What is it for?', ''],
  ['गाँव का नाम', 'गाँव का नाम'],
];
for (const [c, want] of COLS) check(JSON.stringify(c), L.columnNoun(c), want);

console.log('\n  the heading and the line under it');
check('a question with a noun, no place set',
  L.keyHeading({ question: 'What is its primary function?', noun: 'function' }),
  { heading: 'Explore by function', sub: 'What is its primary function?' });
check('the same, once the owner calls the place Bengaluru',
  L.keyHeading({ question: 'What is its primary function?', noun: 'function', place: 'Bengaluru' }),
  { heading: 'Explore Bengaluru by function', sub: 'What is its primary function?' });
check('a question with no noun is headed by itself, with no second line saying it again',
  L.keyHeading({ question: 'what locations are human-friendly and why', noun: '', place: 'Cubbon Park' }),
  { heading: 'what locations are human-friendly and why', sub: '' });
check('a yes-or-no question is headed by itself even with a noun stored',
  L.keyHeading({ question: 'Is it free to visit?', noun: 'free', place: 'Goa' }),
  { heading: 'Is it free to visit?', sub: '' });
check('a stored noun that is not the question\'s words is not shown',
  L.keyHeading({ question: 'What is its environmental impact?', noun: 'effect on nature' }),
  { heading: 'What is its environmental impact?', sub: '' });
check('a spreadsheet column',
  L.keyHeading({ label: 'Categories', column: 'Categories' }),
  { heading: 'Explore by category', sub: 'Column: Categories' });
check('a long column: its short name in the heading, its whole heading under it',
  L.keyHeading({ label: 'Languages', column: 'What languages do you primarily work in? Feel free to mention all if there is more than one.', place: 'Goa' }),
  { heading: 'Explore Goa by language', sub: 'Column: What languages do you primarily work in? Feel free to mention all if there is more than one.' });
check('a column whose short name is a cut question keeps it as the heading',
  L.keyHeading({ label: 'How long have you been involved…', column: 'How long have you been involved in this work? Is the work ongoing/complete?' }).heading,
  'How long have you been involved…');
check('a place name is tidied and kept to forty letters',
  [L.cleanPlaceName('  North\n Goa  '), L.cleanPlaceName('x'.repeat(60)).length, L.cleanPlaceName('')], ['North Goa', 40, '']);
check('an empty place is no place', L.keyHeading({ question: 'What is its primary function?', noun: 'function', place: '   ' }).heading, 'Explore by function');

/* ------------------------------------------------------------------ */
console.log('\n  the reading stores the noun beside the wording, and keeps it');
{
  const rows = [{ d: 'a' }, { d: 'b' }];
  const shaped = RULES.shapeReading(rows, [
    { question: 'What is its primary function?', noun: 'function', counts: [{ name: 'Park' }], categories: ['Park', ''], why: [['park'], []] },
    { question: 'Is it free?', noun: '', counts: [{ name: 'Yes' }], categories: ['Yes', 'Yes'], why: [[], []] },
  ]);
  check('keyNouns beside keyLabels, one per question that has one', shaped.keyNouns, { pattern_1: 'function' });
  const layer = { keyLabels: shaped.keyLabels, keyKinds: shaped.keyKinds, keyNouns: shaped.keyNouns };
  check('a settled question comes back with its noun, so a later reading keeps it',
    RULES.settledQuestions(layer, shaped.rows).map((q) => q.noun), ['function', '']);
}
check('the finder\'s schema asks for the noun after the question, before the kinds',
  /required: \['question', 'noun', 'kinds'\],\n\s*propertyOrdering: \['question', 'noun', 'kinds'\]/.test(enrichSrc), true);
check('the finder is told the rule, with no example to borrow', /NOUN_RULE,\n/.test(enrichSrc) && !/NOUN_RULE = [^\n]*function/.test(enrichSrc), true);
check('the finder\'s noun is checked against its own question',
  /noun: LABELS\.nounFromQuestion\(q\.noun, clipQuestion\(q\.question\)\)/.test(enrichSrc), true);
check('a settled question\'s noun goes through the reading and out with its counts',
  /noun: LABELS\.nounFromQuestion\(q && q\.noun, wording\)/.test(enrichSrc) &&
  /const one = \{ question: q\.question, noun: q\.noun \|\| ''/.test(enrichSrc) && /noun: q\.noun \|\| '',\n\s*\/\/ which column/.test(enrichSrc), true);

console.log('\n  the owner\'s own question gets its noun in the call that finds its answers');
{
  const rows = Array.from({ length: 12 }, (_, i) => ({ d: (i % 2 ? 'a park with trees and a lake ' : 'a busy market with shops ') + i }));
  const digest = enrich.buildDigest(rows, ['d']);
  const answer = (noun) => async () => ({ verdict: 'kinds', noun, kinds: [
    { name: 'Park', definition: 'Places that are parks', examples: [1, 3, 5] },
    { name: 'Market', definition: 'Places that are markets', examples: [0, 2, 4] }] });
  const ok = await enrich.proposeKinds({ digest, question: 'What is its main purpose?', title: 't', callJSON: answer('purpose'), model: 'm' });
  check('a noun of the question\'s words is handed back', ok.noun, 'purpose');
  const no = await enrich.proposeKinds({ digest, question: 'What is its main purpose?', title: 't', callJSON: answer('reason for being'), model: 'm' });
  check('one with words of its own is not', no.noun, '');
}
check('the page hands the noun back when it tries and keeps the question',
  /ask\("try", \{ kinds: named\(\), noun: noun \}\)/.test(owner) && /ask\("keep", \{ kinds: named\(\), token: token, noun: noun \}\)/.test(owner), true);
check('the server checks it again before it goes on the question',
  /const noun = shortLabels\.LABELS\.nounFromQuestion\(b\.noun, question\);/.test(server) &&
  /keepQuestions: \[\{ question, kinds, noun \}\]/.test(server), true);
check('the try shows the heading before anything is kept',
  /kindsBox\.appendChild\(el\("p", "own-q-heading", headingLine\(r\.question \|\| box\.value\.trim\(\), r\.noun \|\| ""\)\)\);/.test(owner), true);
check('the questions already on the layer keep their nouns when one is added', /\/\/ its heading's noun, kept as it was[^\n]*\n\s*noun: q\.noun \|\| '',/.test(server), true);

console.log('\n  the server stores only nouns that pass');
check('ingest keeps a noun only if it is its question\'s words',
  /keyNouns: \(b\.keyNouns && typeof b\.keyNouns === 'object' && b\.keyLabels/.test(server) &&
  /shortLabels\.LABELS\.nounFromQuestion\(v, b\.keyLabels\[k\]\)/.test(server), true);
check('a re-commit keeps the old noun only where the wording is word for word the same',
  /const n = given\[c\] \|\| \(wasLabels\[c\] === labels\[c\] \? was\[c\] : ''\);/.test(server), true);
check('the kept copy of the answers carries the nouns, and a put-back restores them',
  /keyNouns: only\(layer\.keyNouns\),/.test(server) && /keyColumns: kept\.keyColumns, keyNouns: kept\.keyNouns,/.test(server), true);
check('a reading written by the server writes the nouns', /keyLabels: labels, keyKinds: kinds, keyColumns: froms, keyNouns: nouns,/.test(server), true);

/* ------------------------------------------------------------------ */
console.log('\n  the one-off job for questions found before nouns');
{
  const layer = { id: 'user-x', keyLabels: {
    pattern_1: 'What is its primary function?', pattern_2: 'Is it free to visit?',
    pattern_3: 'What is its current status?', categories: 'Kinds' }, keyNouns: { pattern_3: 'status' } };
  const want = N.questionsWanting(layer);
  check('asks only about questions with no noun, and never a yes-or-no one', want.map((w) => w.col), ['pattern_1']);
  check('the same questions, the same fingerprint', N.questionsSig(want), N.questionsSig(N.questionsWanting(layer)));
  check('the prompt lists the questions and says to copy their words',
    /copied from the\nquestion itself/.test(N.promptFor(want, 'Bengaluru')) && N.promptFor(want, '').includes('What is its primary function?'), true);
  check('a passing noun is kept, matched by wording', N.cleanNouns({ nouns: [{ question: 'What is its primary function?', noun: 'function' }] }, want), { pattern_1: 'function' });
  check('matched by order when the model tidied the wording', N.cleanNouns({ nouns: [{ question: 'what is its function', noun: 'function' }] }, want), { pattern_1: 'function' });
  check('a failing noun is dropped', N.cleanNouns({ nouns: [{ question: 'What is its primary function?', noun: 'purpose' }] }, want), {});
  check('nothing back, nothing kept', N.cleanNouns(null, want), {});

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-nouns-'));
  try {
    fs.writeFileSync(path.join(tmp, 'manifest.local.json'), JSON.stringify({ placeName: 'Goa', layers: [layer, { id: 'other', label: 'x' }] }));
    check('written onto the layer beside the nouns it had', N.writeNouns(tmp, 'user-x', { pattern_1: 'function' }, want), 1);
    const back = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.local.json'), 'utf8'));
    check('the layer now has both nouns, and nothing else moved',
      [back.layers[0].keyNouns, back.placeName, back.layers[1]], [{ pattern_3: 'status', pattern_1: 'function' }, 'Goa', { id: 'other', label: 'x' }]);
    // the question changed while the call was out: its noun is not written
    back.layers[0].keyLabels.pattern_1 = 'What is it made of?';
    delete back.layers[0].keyNouns.pattern_1;
    fs.writeFileSync(path.join(tmp, 'manifest.local.json'), JSON.stringify(back));
    check('a noun for a question that has since changed is not written', N.writeNouns(tmp, 'user-x', { pattern_1: 'function' }, want), 0);

    // the script's survey, on a made-up pair of atlases
    const root = path.join(tmp, 'root');
    for (const slug of ['an-atlas', 'deoria-bioregion']) {
      fs.mkdirSync(path.join(root, slug), { recursive: true });
      fs.writeFileSync(path.join(root, slug, 'manifest.json'), '{}');
      fs.writeFileSync(path.join(root, slug, 'manifest.local.json'), JSON.stringify({ layers: [layer] }));
    }
    const sv = script.survey([root]);
    check('the script finds the layer that wants nouns', sv.want.map((w) => w.dataset + '/' + w.layerId), ['an-atlas/user-x']);
    check('and never deoria-bioregion, which it names as skipped', sv.skipped.map((s) => s.dataset), ['deoria-bioregion']);
    const q = N.createKeyNounsQueue({ file: path.join(tmp, 'key-nouns.json') });
    check('put on the list once', q.offer({ dataset: 'an-atlas', layerId: 'user-x', sig: sv.want[0].sig, payer: 'o@x' }), true);
    check('and not twice', q.offer({ dataset: 'an-atlas', layerId: 'user-x', sig: sv.want[0].sig, payer: 'o@x' }), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const scriptSrc = read('deploy/queue-key-nouns.mjs');
check('the script is a dry run unless told --apply', /const apply = argv\.includes\('--apply'\);/.test(scriptSrc) && /if \(apply && queue\.offer/.test(scriptSrc), true);
check('it charges the atlas\'s owner', /const owner = payerOf\(instances\[w\.dataset\]\);/.test(scriptSrc), true);
check('the server runs the list, one call per layer, out of the payer\'s allowance',
  /keyNouns\.queue\.start\(keyNounsJob\);/.test(server) && /const call = aiCaller\(job\.payer \? \{ payer: job\.payer \} : 'server', 1, stub\);\n\s*let answer;\n\s*try \{\n\s*answer = await call\(getFlashLiteModel\(\), keyNouns\.promptFor/.test(server), true);
check('the job never touches deoria-bioregion', /async function keyNounsJob[\s\S]{0,200}if \(NEVER_READ\.has\(dataset\)\) return/.test(server), true);

/* ------------------------------------------------------------------ */
console.log('\n  the place\'s name: the owner\'s, set in Settings, used only once saved');
check('Settings has one plain field for it', /'<label class="own-fld">Call this place /.test(owner) && /id="own-placename"/.test(owner), true);
check('it opens with the saved name, or the region as a suggestion',
  /if \(typeof INST\.placeName === "string" && INST\.placeName\) return INST\.placeName;\n\s*var r = String\(INST\.regionLabel/.test(owner), true);
check('the region is only a greyed suggestion, never a value, so Save cannot keep it by accident', /value="' \+\s*esc\(placeNameSaved\(\)\) \+ '"' \+ \(placeNameSaved\(\) \? '' : ' placeholder="'/.test(owner) && /scrim\.querySelector\("#own-placename"\)\.value\.trim\(\) !== placeNameSaved\(\)/.test(owner), true);
check('an editor\'s question is shown as text, never markup', /el\("span", "own-q-name", esc\(q\.label\)\)/.test(owner), true);
check('Save sends it with the rest of the details', /placeName: LokaLabelRules\.cleanPlaceName\(scrim\.querySelector\("#own-placename"\)\.value\),/.test(owner), true);
check('the server tidies it and writes it beside the layers',
  /placeName: has\('placeName'\) \? shortLabels\.LABELS\.cleanPlaceName\(b\.placeName\)/.test(server) &&
  /if \(has\('placeName'\)\) writePlaceName\(updated\);/.test(server) && /function writePlaceName\(inst\)/.test(server), true);
check('the viewer reads it from there', /if \(typeof local\.placeName === "string"\) manifest\.placeName = local\.placeName;/.test(atlas), true);

console.log('\n  the rows wear it, everywhere the rows are drawn');
check('the row\'s name is the heading, with the grey line under it',
  /var hd = keyHeadingOf\(L, opt\);\n\s*var tname = el\("span", "key-tname"\);\n\s*tname\.appendChild\(el\("span", "key-head", esc\(hd\.heading\)\)\);\n\s*if \(hd\.sub\) tname\.appendChild\(el\("span", "key-asked", esc\(hd\.sub\)\)\);/.test(atlas), true);
check('the heading uses the shared rule and the owner\'s place',
  /var place = \(MANIFEST && MANIFEST\.placeName\) \|\| "";/.test(atlas) && /LokaLabelRules\.keyHeading\(\{ question: opt\.full \|\| opt\.label,/.test(atlas), true);
check('a split file\'s noun is read off whichever half carries its question', /face\.keyNouns = nouns;/.test(atlas), true);
check('the grey line is styled quiet, under the heading', /\.key-asked \{ display:block; font-size:var\(--t-label\); font-weight:400;/.test(page), true);
check('one list builder for desktop and the phone sheet', (atlas.match(/buildKeyToggles\(L\)/g) || []).length >= 2, true);
check('the reach order and the six-question cap are where they were',
  /return \(b\.isQuestion \? 1 : 0\) - \(a\.isQuestion \? 1 : 0\)\n\s*\|\| \(b\.reach - a\.reach\)/.test(atlas) && /const MAX_QUESTIONS = 6;/.test(enrichSrc), true);
check('the owner\'s Questions tab shows each question\'s heading beside it',
  /line\.appendChild\(el\("div", "own-q-heading", headingLine\(q\.label, q\.noun\)\)\);/.test(owner), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
