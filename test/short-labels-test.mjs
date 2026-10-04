/* Run me with: node test/run.mjs — or on my own with node.
 *
 * A long column heading gets a short name, and the whole heading stays one
 * hover or one ⓘ away. The rule lives in atlas/label-rules.js and is read by
 * the viewer and the server alike; this runs it for real on a table of
 * headings — the live atlases' own columns, plus made-up ones in the styles a
 * spreadsheet actually arrives in — and reads the wiring in the viewer, the
 * server and the one-off script. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = createRequire(import.meta.url)(path.join(ROOT, 'atlas', 'label-rules.js'));
const S = await import('../api/lib/atlas/short-labels.js');
const atlas = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const script = fs.readFileSync(ROOT + '/deploy/queue-short-labels.mjs', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ------------------------------------------------------------------ *
 * The numbers, and why
 * ------------------------------------------------------------------ */
console.log('\n  the thresholds are the measured ones');
check('a heading is long past 36 characters (the drawer\'s line, measured)', R.LONG_HEADING, 36);
check('a stored short name aims at 32 (room for the ⓘ on the line)', R.SHORT_MAX, 32);
check('the reason is written beside the number', /209px — about 6\.2px a character/.test(fs.readFileSync(ROOT + '/atlas/label-rules.js', 'utf8')), true);

/* ------------------------------------------------------------------ *
 * The plain cut, on real and made-up headings
 * ------------------------------------------------------------------ */
console.log('\n  the plain-code short name, heading by heading');
/* [heading, long?, short name]. The first eight are the Multispecies survey's
   own columns; then Bengaluru's and Cubbon Park's slugs; then made-up ones in
   the styles a spreadsheet arrives in. Every short name is made only of the
   heading's own words, in order. */
const TABLE = [
  // Multispecies Landscape Assessment 2026 — the survey's columns, verbatim
  ['Name of Organisation or Collective (if applicable)', true, 'Name of Organisation or Collective'],
  ['What best describes your work, profile, role or affiliation ? (Please select all that apply)', true, 'Work, profile, role or affiliation'],
  ['How long have you been involved in this work? Is the work ongoing/complete?', true, 'How long have you been involved…'],
  ['Which geographic areas do you work in? (Feel free to mention country, village, district, and state/province details.) You might be working in several geographical areas, so please mention all.', true, 'Geographic areas'],
  ['What languages do you primarily work in? Feel free to mention all if there is more than one.', true, 'Languages'],
  ['Please share links to any relevant resources to your work.', true, 'Links to any relevant resources…'],
  ['How would you like to be credited for your work in the database?', true, 'How would you like to be credited…'],
  ['Name', false, 'Name'],
  // Bengaluru on LOKA and Cubbon Park — slugs, which open out and get one capital
  ['tag_id', false, 'Tag id'],
  ['description', false, 'Description'],
  ['categories', false, 'Categories'],
  ['created_by_user_id', false, 'Created by user id'],
  ['created_at', false, 'Created at'],
  ['photo_urls', false, 'Photo urls'],
  ['thumbnail_url', false, 'Thumbnail url'],
  ['public_link', false, 'Public link'],
  ['address', false, 'Address'],
  ['place-tags', false, 'Place tags'],
  // a heading with a hyphen inside a word keeps it; its own capitals are kept
  ['what locations are human-friendly and why', true, 'What locations are human-friendly'],
  ['Arunachal Pradesh field notes (Tawang and West Kameng districts only)', true, 'Arunachal Pradesh field notes'],
  // shouted, in capitals: brought down to a sentence; a lone abbreviation is not
  ['NAME OF THE VILLAGE (AS PER CENSUS 2011)', true, 'Name of the village'],   // 40 letters: long, and the bracket ends the clause
  ['NAME OF THE BLOCK (AS PER CENSUS 2011) AND DISTRICT', true, 'Name of the block'],
  ['GPS', false, 'GPS'],
  ['NGO', false, 'NGO'],
  ['ID', false, 'ID'],
  // Hindi, and Hindi mixed with English
  ['गाँव का नाम (Name of the village)', false, 'गाँव का नाम (Name of the village)'],
  ['Which crops do you grow in the kharif season? कृपया सभी लिखें', true, 'Crops'],
  ['आपके गाँव में पीने के पानी का मुख्य स्रोत क्या है? (कृपया एक चुनें)', true, 'आपके गाँव में पीने के पानी का मुख्य…'],
  // only a parenthesis, and very short ones: left exactly alone
  ['(see note)', false, '(see note)'],
  ['Type', false, 'Type'],
  ['Email address', false, 'Email address'],
  ['Date of visit', false, 'Date of visit'],
  // the form's scaffolding is not the heading's meaning
  ['Please select all that apply: water sources used by the household', true, 'Water sources used by the household'],
  ['Tick one: Is the household below the poverty line (BPL card)?', true, 'Is the household below the poverty…'],
  ['Which of the following best describes the ownership of the land?', true, 'Ownership of the land'],
  // asking words come off; nouns stay
  ['What is the condition of the road leading to the village during the monsoon months?', true, 'Condition of the road leading…'],
  ['Do you have access to a functioning handpump within 500 metres of your house?', true, 'Access to a functioning handpump…'],
  ['Is there a primary school in the village? If yes, how many teachers?', true, 'Primary school in the village'],
  ['How many people live in this household?', true, 'How many people live…'],
  // brackets, colons and dashes end the first clause; a stop that leaves too little is passed over
  ['Type of forest (reserved, protected, community-managed, other)', true, 'Type of forest'],
  ['Primary occupation: main source of household income', true, 'Primary occupation'],
  ['Approx. no. of households in the hamlet - as reported by the sarpanch', true, 'Approx. no. of households…'],
  ['Remarks / Notes from the surveyor', false, 'Remarks / Notes from the surveyor'],
  // a cut never ends on a joining word, and never past the line
  ['Name of respondent and their relationship to the household head', true, 'Name of respondent'],
  ['a'.repeat(90), true, 'A' + 'a'.repeat(34) + '…'],
];
let sameWords = 0;
for (const [h, long, want] of TABLE) {
  check((long ? 'long  ' : 'short ') + JSON.stringify(h.length > 58 ? h.slice(0, 57) + '…' : h) + ' → ' + JSON.stringify(want),
    [R.isLong(h), R.shortHeading(h)], [long, want]);
  /* every word of the short name is a word of the heading (case aside,
     the ellipsis aside, a word cut at the end aside) */
  const words = R.shortHeading(h).replace(/…$/, '').toLowerCase().split(/\s+/).filter(Boolean);
  const own = R.headingCase(h).toLowerCase();
  if (words.every((w) => own.includes(w))) sameWords += 1;
}
check('the table has at least thirty headings', TABLE.length >= 30, true);
check('no short name uses a word the heading does not have', sameWords, TABLE.length);
check('no short name is longer than the line', TABLE.every(([h]) => R.shortHeading(h).length <= R.LONG_HEADING), true);
check('a heading that is not long is never changed beyond its casing',
  TABLE.filter(([, long]) => !long).every(([h]) => R.shortHeading(h) === R.headingCase(h)), true);

console.log('\n  casing: a heading keeps its own capitals');
check('"Feel free" is no longer "feel free"',
  R.headingCase('What languages do you primarily work in? Feel free to mention all'),
  'What languages do you primarily work in? Feel free to mention all');
check('a proper noun keeps its capital', R.headingCase('Villages in Arunachal Pradesh'), 'Villages in Arunachal Pradesh');
check('the first letter is capitalised', R.headingCase('what locations'), 'What locations');
check('"affiliation ?" loses the space before its mark', R.headingCase('affiliation ? (x)'), 'Affiliation? (x)');
check('a slug opens out: created_at', R.headingCase('created_at'), 'Created at');
check('a kebab slug too: place-tags', R.headingCase('place-tags'), 'Place tags');
check('but a hyphen inside a heading with spaces is a word\'s own', R.headingCase('human-friendly places'), 'Human-friendly places');
check('the viewer\'s prettyCol is now this rule', /function prettyCol\(name\) \{[\s\S]{0,900}return LokaLabelRules\.headingCase\(name\);/.test(atlas), true);
check('and the old lowercasing is gone from it', /\.trim\(\)\.toLowerCase\(\);\n    return t \? t\.charAt\(0\)\.toUpperCase\(\)/.test(atlas), false);

/* ------------------------------------------------------------------ *
 * Whose name wins
 * ------------------------------------------------------------------ */
console.log('\n  whose name wins: the owner, then the stored name, then the plain cut');
const LONGQ = 'What languages do you primarily work in? Feel free to mention all if there is more than one.';
check('a name the owner gave (keyLabels) wins, and is never marked shortened',
  R.labelFor(LONGQ, { keyLabels: { [LONGQ]: 'Working languages' }, shortLabels: { [LONGQ]: 'Languages' } }),
  { text: 'Working languages', full: 'Working languages', shortened: false });
check('a discovered question\'s wording is the owner\'s name: shown whole',
  R.labelFor('pattern_2', { keyLabels: { pattern_2: 'What is its primary material or design?' } }),
  { text: 'What is its primary material or design?', full: 'What is its primary material or design?', shortened: false });
check('the stored short name is next, with the whole heading beside it',
  R.labelFor(LONGQ, { shortLabels: { [LONGQ]: 'Languages used' } }),
  { text: 'Languages used', full: LONGQ, shortened: true });
check('a stored name that breaks the rule is passed over for the plain cut',
  R.labelFor(LONGQ, { shortLabels: { [LONGQ]: 'x'.repeat(60) } }),
  { text: 'Languages', full: LONGQ, shortened: true });
check('with nothing stored, the plain cut', R.labelFor(LONGQ, {}), { text: 'Languages', full: LONGQ, shortened: true });
check('a short heading is never shortened and carries no ⓘ',
  R.labelFor('Email address', {}), { text: 'Email address', full: 'Email address', shortened: false });
check('a stored name as long as the line is still accepted', R.acceptableShort('x'.repeat(35), 'h'), 'x'.repeat(35));
check('one past it is not', R.acceptableShort('x'.repeat(36), 'h'), '');
check('the heading itself is not a short name', R.acceptableShort('Email address', 'Email address'), '');

console.log('\n  which columns are asked about');
check('long headings only, never the machinery\'s, the private or the coordinates',
  R.longHeadingsOf(['name', 'lat', 'longitude', '_category', 'pattern_1', 'pattern_1_why', LONGQ, 'Email address']), [LONGQ]);
check('and never one the owner has named', S.headingsWanting({ keyLabels: { [LONGQ]: 'Working languages' } }, [{ [LONGQ]: 'x', 'created_at': 1 }]), []);
check('the columns are taken from the first rows, united',
  S.columnsOf([{ a: 1 }, { a: 1, b: 2 }]), ['a', 'b']);
check('the fingerprint is of the headings alone, in any order',
  S.headingSig(['b', 'a']) === S.headingSig(['a', 'b']), true);

/* ------------------------------------------------------------------ *
 * The model's answer, checked
 * ------------------------------------------------------------------ */
console.log('\n  the model\'s answer is checked name by name');
const ORG = 'Name of Organisation or Collective (if applicable)';
const got = S.cleanNames({ names: [
  { heading: LONGQ, short: 'Languages used' },
  { heading: ORG, short: 'This is far too long a name to be printed as a label anywhere at all' },
] }, [LONGQ, ORG]);
check('a good name is kept', got.names[LONGQ], 'Languages used');
check('a bad one is replaced by the plain cut', got.names[ORG], 'Name of Organisation or Collective');
check('and the count says how many the model named', got.fromModel, 1);
check('a heading the model tidied the spaces of still matches',
  S.cleanNames({ names: [{ heading: ' name  of organisation or collective (if applicable) ', short: 'Organisation' }] }, [ORG]).names[ORG], 'Organisation');
check('the prompt asks for the heading\'s own words and language', /Keep the heading's language/.test(S.promptFor(['x'], 't')) && /never add a meaning/.test(S.promptFor(['x'], 't')), true);
check('and for at most four words and SHORT_MAX characters', new RegExp('at most 4 words and at most ' + R.SHORT_MAX + ' characters').test(S.promptFor(['x'], '')), true);

/* ------------------------------------------------------------------ *
 * The wiring
 * ------------------------------------------------------------------ */
console.log('\n  the server asks once per layer, on the same list the questions use');
check('its own list, made with the questions\' queue', /createQueue\(\{ file: opts\.file \|\| path\.join\(DATA_DIR, 'short-labels\.json'\) \}\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/short-labels.js', 'utf8')), true);
check('every commit considers it, beside the questions', /considerShortLabels\(session\.dataset, id\);/.test(server), true);
check('the job runs off the list at start-up, and pumps once a minute',
  /shortLabels\.queue\.start\(shortLabelsJob/.test(server) && /setInterval\(\(\) => shortLabels\.queue\.pump\(\), 60 \* 1000\)/.test(server), true);
check('one call, through the budgeted caller, charged to the owner', /aiCaller\(job\.payer \? \{ payer: job\.payer \} : 'server', 1, stub\)/.test(server), true);
check('the stand-in answers without a model', /const stub = FAKE_READING \? async \(\) => \(\{ names: headings\.map/.test(server), true);
check('without a model nothing is queued: the viewer\'s own cut serves', /if \(!ai && !FAKE_READING\) return 'no model';   \/\/ the viewer's own plain cut serves/.test(server), true);
check('the names are kept on the list too, so a re-commit gets them back free', /return \{ state: 'done', reason: '', calls: 1, names, by, sig/.test(server), true);
check('and consider() puts them back from the list without a call', /if \(dir && writeNames\(dir, layerId, names, had\.by \|\| 'model'\)\) return 'put back';/.test(fs.readFileSync(ROOT + '/api/lib/atlas/short-labels.js', 'utf8')), true);
check('the one-off script is a dry run unless --apply', /const apply = argv\.includes\('--apply'\);/.test(script) && /Dry run — nothing is changed/.test(script), true);
check('it never touches Deoria', /NEVER_READ\.has\(slug\)/.test(script), true);
check('it looks at any contributed layer with a source, points or areas', /if \(!L\.source\) continue;/.test(script) && !/L\.type !== 'marker'/.test(script), true);

console.log('\n  the viewer prints the short name and keeps the whole heading a hover or a ⓘ away');
check('the page loads the shared rule before atlas.js', page.indexOf('label-rules.js?v=dev') > 0 && page.indexOf('label-rules.js?v=dev') < page.indexOf('atlas.js?v=dev'), true);
check('a key option carries the whole heading and whether it was shortened', /opts\.push\(\{ col: col, label: shown, full: lab\.full, shortened: lab\.shortened,/.test(atlas), true);
check('the key\'s name wears the heading as its hover, and the ⓘ goes on the row', /if \(opt\.shortened\) \{\n        tname\.title = opt\.full;\n        var parts = labelInfo\(opt\.full\);\n        lab\.appendChild\(parts\.btn\);/.test(atlas), true);
check('the opened heading is a line under the row, not inside the label', /list\.appendChild\(host \|\| lab\);\n[^\n]*\n      if \(fullHeading\) list\.appendChild\(fullHeading\);/.test(atlas), true);
check('the legend\'s header too', /if \(it\.full\) head\.title = it\.full;/.test(atlas), true);
check('and a card\'s key rows and field names', /kname\.title = opt\.full;/.test(atlas) && /var labHTML = '<span class="pop-lbl"' \+ \(fl\.shortened \? ' title="' \+ esc\(fl\.full\) \+ '"' : ""\)/.test(atlas), true);
check('the ⓘ is a real button with the heading as its aria-label', /<button type="button" class="lbl-info" aria-expanded="false" aria-controls="' \+ id \+\n      '" aria-label="' \+ esc\(full\) \+ '"/.test(atlas), true);
check('only where the label was shortened', (atlas.match(/labelInfoHTML\(fl\.full\)/g) || []).length === 1 && /\(fl\.shortened \? " " \+ labelInfoHTML\(fl\.full\) : ""\)/.test(atlas), true);
check('one delegated listener works every ⓘ, and never flips the switch beside it', /closest\(".lbl-info\[aria-controls\]"\);[\s\S]{0,120}e\.stopPropagation\(\);/.test(atlas), true);
check('the ⓘ sits at the key row\'s end, like the layer rows\' own', /\.key-toggle \.lbl-info \{ margin-left:auto; flex:0 0 auto; \}/.test(page), true);
check('and the opened heading is set in under the row, aligned with the name', /\.key-list \.lbl-full \{ margin:-\.05rem 0 \.3rem 1\.6rem; \}/.test(page), true);
check('the ⓘ can be reached by keyboard', /\.lbl-info:focus-visible \{ outline:2px solid var\(--color-leaf\)/.test(page), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
