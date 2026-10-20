/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The questions in a layer are found on the server now, as the layer is added,
   instead of in the owner's browser the first time they open the atlas. The
   list itself is exercised for real here, on a file in a throwaway folder; the
   parts that live inside the 6,000-line router are read from its source. No
   network, no model. */
import { createQueue, signatureOf, NEVER_READ } from '../api/lib/atlas/questions-queue.js';
const RULES = createRequire(import.meta.url)(ROOT + '/atlas/reading-rules.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(); }
  return false;
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-questions-'));
let n = 0;
const freshFile = () => path.join(TMP, 'q' + (++n) + '.json');

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ownerCode = owner.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

console.log('\n  the version of a layer\'s places');
const rows = [{ name: 'A', description: 'a pond by the school', pop: 12 },
              { name: 'B', description: 'market square', pop: 40 }];
const sig = signatureOf(rows, RULES.isAnswerColumn);
const answered = RULES.shapeReading(rows, [{ question: 'Q?', counts: [{ name: 'x' }],
  categories: ['x', 'other'], why: [['pond'], []] }]).rows;
check('writing the answers on does not make it a new version', signatureOf(answered, RULES.isAnswerColumn), sig);
check('nor does saving numbers as words', signatureOf(rows.map((r) => Object.assign({}, r, { pop: String(r.pop) })), RULES.isAnswerColumn), sig);
check('nor a blank column a place never had', signatureOf(rows.map((r) => Object.assign({}, r, { extra: '' })), RULES.isAnswerColumn), sig);
check('a changed row is a new version',
  signatureOf([rows[0], Object.assign({}, rows[1], { description: 'old market square' })], RULES.isAnswerColumn) === sig, false);
check('a row added is a new version', signatureOf(rows.concat([{ name: 'C' }]), RULES.isAnswerColumn) === sig, false);

console.log('\n  queued once per version, read once, one at a time');
{
  const q = createQueue({ file: freshFile() });
  let live = 0, most = 0; const seen = [];
  q.start(async (job) => {
    live += 1; most = Math.max(most, live); seen.push(job.dataset + '/' + job.layerId + '@' + job.sig);
    await tick(); await tick();
    live -= 1;
    return { state: 'done', reason: '' };
  });
  check('a new layer goes on the list', q.offer({ dataset: 'a', layerId: 'l1', sig: 's1', payer: 'o@x' }), true);
  check('the same version again does not', q.offer({ dataset: 'a', layerId: 'l1', sig: 's1', payer: 'o@x' }), false);
  q.offer({ dataset: 'a', layerId: 'l2', sig: 's1', payer: 'o@x' });
  q.offer({ dataset: 'b', layerId: 'l1', sig: 's1', payer: 'p@x' });
  check('while waiting it says so to the owner\'s page', ['queued', 'running'].includes(q.forDataset('a').l1.state), true);
  await until(() => q.idle() && seen.length === 3);
  check('all three were read', seen.length, 3);
  check('never two at once', most, 1);
  check('each is marked done', q.all().map((r) => r.state), ['done', 'done', 'done']);
  check('a re-commit of the same places does not read again', q.offer({ dataset: 'a', layerId: 'l1', sig: 's1' }), false);
  check('a re-commit with changed places does', q.offer({ dataset: 'a', layerId: 'l1', sig: 's2' }), true);
  await until(() => q.idle() && seen.length === 4);
  check('and it is read, once', seen.filter((s) => s.startsWith('a/l1@')), ['a/l1@s1', 'a/l1@s2']);
  check('the owner is carried to the job, to be charged', q.get('b', 'l1').payer, 'p@x');
}

console.log('\n  a failure says why and stops');
{
  const q = createQueue({ file: freshFile() });
  let tries = 0;
  q.start(async () => { tries += 1; throw new Error('the model said no'); });
  q.offer({ dataset: 'a', layerId: 'l1', sig: 's1' });
  await until(() => q.idle() && tries === 1);
  await tick(); q.pump(); await tick(); await tick();
  check('tried once', tries, 1);
  check('marked failed, with the reason', [q.get('a', 'l1').state, q.get('a', 'l1').reason], ['failed', 'the model said no']);
  check('the same version is not put back on the list', q.offer({ dataset: 'a', layerId: 'l1', sig: 's1' }), false);
  check('the owner\'s page is told', q.forDataset('a').l1.state, 'failed');
}

console.log('\n  a restart picks up where it was');
{
  const file = freshFile();
  fs.writeFileSync(file, JSON.stringify({
    'a|l1': { dataset: 'a', layerId: 'l1', sig: 's1', state: 'running', queuedAt: 1 },
    'a|l2': { dataset: 'a', layerId: 'l2', sig: 's1', state: 'queued', queuedAt: 2 },
    'a|l3': { dataset: 'a', layerId: 'l3', sig: 's1', state: 'done', queuedAt: 0 },
  }));
  const q = createQueue({ file });
  const order = [];
  q.start(async (job) => { order.push(job.layerId); return { state: 'done' }; });
  await until(() => q.idle() && order.length === 2);
  check('the one cut off mid-reading is read again, then the one waiting; the finished one is left',
    order, ['l1', 'l2']);
  check('the list is a file: a fresh queue on it sees the same', createQueue({ file }).get('a', 'l2').state, 'done');
  check('written through a temporary file', fs.existsSync(file + '.tmp'), false);
}

console.log('\n  places changed while they were being read');
{
  const q = createQueue({ file: freshFile() });
  let release; const gate = new Promise((r) => { release = r; });
  const rechecked = [];
  q.start(async () => { await gate; return { state: 'failed', reason: 'the places changed while they were being read' }; },
    { recheck: (d, l) => rechecked.push(d + '/' + l) });
  q.offer({ dataset: 'a', layerId: 'l1', sig: 's1' });
  await until(() => q.get('a', 'l1').state === 'running');
  check('a newer version while one is being read waits for it', q.offer({ dataset: 'a', layerId: 'l1', sig: 's2' }), false);
  release();
  await until(() => rechecked.length === 1);
  check('and is looked at again once it lands', rechecked, ['a/l1']);
}

console.log('\n  the same places put back without their answers');
{
  const q = createQueue({ file: freshFile() });
  const jobs = [];
  q.start(async (job) => { jobs.push(job.restore ? 'restore' : 'read'); return { state: 'done', restore: false }; });
  q.offer({ dataset: 'a', layerId: 'l1', sig: 's1' });
  await until(() => q.idle() && jobs.length === 1);
  q.saveAnswers('a', 'l1', { sig: 's1', answers: [{ pattern_1: 'x' }], keyLabels: { pattern_1: 'Q?' } });
  check('the answers are kept beside the list', q.loadAnswers('a', 'l1').answers, [{ pattern_1: 'x' }]);
  check('a restore of the same version is the one thing allowed twice', q.offer({ dataset: 'a', layerId: 'l1', sig: 's1', restore: true }), true);
  await until(() => q.idle() && jobs.length === 2);
  check('and it is a restore, not a reading', jobs, ['read', 'restore']);
  q.forget('a', 'l1');
  check('a removed layer takes its kept answers with it', q.loadAnswers('a', 'l1'), null);
}
check('the router puts answers back for the same version instead of reading',
  /if \(had\.state === 'done'\) \{\n\s*QUESTIONS\.offer\(\{ dataset, layerId, sig, restore: true \}\);/.test(server), true);
check('putting answers back asks no model', /async function restoreAnswers[\s\S]{0,1500}?\n\}/.exec(server)[0].includes('runReading'), false);
check('a changed version is asked the questions it was last asked',
  /keep: keptQuestions\(QUESTIONS\.loadAnswers\(dataset, layerId\)\)/.test(server) &&
  /const asked = afresh \? \[\] : \(settled\.length \? settled : \(opts\.keep \|\| \[\]\)\);/.test(server), true);

console.log('\n  never the operator\'s own atlas');
{
  const q = createQueue({ file: freshFile() });
  check('deoria-bioregion is on the never list', NEVER_READ.has('deoria-bioregion'), true);
  check('and cannot be put on the list', q.offer({ dataset: 'deoria-bioregion', layerId: 'x', sig: 's' }), false);
  check('the router refuses it before looking', /if \(NEVER_READ\.has\(dataset\)\) return 'never';/.test(server), true);
}

console.log('\n  every commit offers its layers, and a reading\'s own write does not');
check('commitLayer looks at both the outlines and the points it wrote',
  /for \(const id of \[layerId, pointsLayerId\]\) \{\n\s*if \(!id\) continue;\n\s*try \{ considerReading\(session\.dataset, id, opts\); \}/.test(server), true);
check('the wizard, adding data and re-commits all come through it',
  /res\.json\(commitLayer\(\{ importId: b\.importId, dataset: b\.dataset \}, req\)\)/.test(server), true);
check('so does a repair', /const out = commitLayer\(\{ importId: session\.id, dataset: session\.dataset \}, req\);/.test(server), true);
check('a reading\'s own write says so, and is noted as read',
  /return commitLayer\(\{ importId: ing\.importId, dataset \}, 'server', \{ fromReading: true \}\);/.test(server) &&
  /if \(opts && opts\.fromReading\) \{\n\s*keepAnswers\([\s\S]{0,900}?if \(!QUESTIONS\.isBusy\(dataset, layerId\)\) \{\n\s*QUESTIONS\.remember\(/.test(server), true);
check('but not while the list is on that layer: a split file\'s pins are written before its outlines, and the reading\'s own ending writes the record',
  server.indexOf('if (!QUESTIONS.isBusy(dataset, layerId)) {') > server.indexOf('if (opts && opts.fromReading) {') &&
  server.indexOf('if (!QUESTIONS.isBusy(dataset, layerId)) {') < server.indexOf("return 'written by a reading';"), true);
check('the same tests the browser made, by the shared rule: places that wear a marker, words of their own',
  /if \(!RULES\.wearsMarks\(layer\)\) return 'no marks';/.test(server) &&
  /if \(!rows\.length \|\| !RULES\.worthReading\(layer, rows\)\) return 'no words';/.test(server), true);
check('nothing is gated on "marker" by hand any more', /layer\.type !== 'marker'\) return 'not points'/.test(server), false);
check('a layer already read in a browser is noted and left untouched',
  /if \(!had && \(hasQuestions \|\| layer\.patternsNone\)\) \{\n\s*QUESTIONS\.remember\(dataset, layerId, \{ sig, state: layer\.patternsNone \? 'none' : 'done', reason: '', adopted: true \}\);/.test(server), true);
check('the list starts with the server', /QUESTIONS\.start\(readingJob, \{ recheck: \(d, l\) => considerReading\(d, l\) \}\);/.test(server), true);
check('nothing found is written onto the layer, as the browser used to',
  /patternsNone: true,\n\s*schema: RULES\.schemaFor\(out\),/.test(server), true);
check('an unreachable model goes to the existing patient list, not a loop',
  /if \(cannotReach\(out\.verdict\)\) \{[\s\S]{0,400}owed\.owe\(\{ dataset, layerId,/.test(server), true);
check('places that moved under a reading are not overwritten',
  /if \(now !== sigAtStart\) return \{ wrote: false, verdict: 'changed'/.test(server), true);

console.log('\n  no key, no reading');
check('nothing is put on the list without a model',
  /if \(!ai && !FAKE_READING\) return 'no model';/.test(server), true);
check('and a job that finds none stops quietly',
  /if \(!ai && !FAKE_READING\) return \{ state: 'skipped', reason: 'no model on this server' \};/.test(server), true);

console.log('\n  the owner\'s allowance pays');
check('the limits are as they were',
  [/const AI_CALLS_PER_HOUR = 150;/, /const AI_CALLS_PER_HOUR_IP = 40;/, /const AI_CALLS_PER_READING = 24;/]
    .map((r) => r.test(server)), [true, true, true]);
check('a reading for an owner is charged to their account',
  /if \(req && typeof req === 'object' && req\.payer\) \{\n\s*return \{ key: 'acct:' \+ req\.payer, cap: AI_CALLS_PER_HOUR \};/.test(server), true);
check('runReading spends through that payer',
  /const payer = opts\.payer \? \{ payer: opts\.payer \} : 'server';/.test(server) &&
  /const c = aiCaller\(payer, null,/.test(server), true);
check('the payer is the atlas owner', /const payer = payerOf\(inst\);/.test(server), true);
check('each reading still has its own ceiling', /if \(spent >= cap\) throw new Error\('this reading has used its share of the model'\);/.test(server), true);
check('the stand-in pays out of the same allowance', /if \(stub\) return stub\(model, prompt, schema, o\);/.test(server) &&
  /await pay\('fake', 'find ' \+ g\.label, null, \{\}\);/.test(server), true);

console.log('\n  the stand-in model cannot be switched on by accident');
check('it needs the flag, the local static mode, no key and not production',
  /const FAKE_READING = process\.env\.ATLAS_FAKE_READING === '1' &&\n\s*!!process\.env\.LOKA_DEV_STATIC && !process\.env\.GEMINI_API_KEY &&\n\s*process\.env\.NODE_ENV !== 'production';/.test(server), true);
const live = fs.readFileSync(ROOT + '/api/ecosystem.config.cjs', 'utf8') + fs.readFileSync(ROOT + '/deploy/deploy.sh', 'utf8');
check('nothing that starts the live server sets either flag', /ATLAS_FAKE_READING|LOKA_DEV_STATIC/.test(live), false);

console.log('\n  the owner\'s page reports, and starts nothing');
check('the browser no longer reads', /askQuestions|keepQuestions|rememberNothingHere|layers\/enrich/.test(ownerCode), false);
check('the status comes on /layers/list, per layer', /questions: stateOf\(l\),/.test(server) && /return pins && \(pins\.state === 'queued' \|\| pins\.state === 'running'\) \? pins : \(reading\[l\.id\] \|\| null\);/.test(server), true);
check('the note shows only while the server is at work',
  /if \(busyReading\(q\)\) \{\n\s*\/\/[^\n]*\n\s*wrap\.appendChild\(el\("p", "own-note",\n\s*"Finding questions in your data/.test(owner), true);
check('it no longer asks for the page to be kept open', /Keep this page open/.test(owner), false);
check('it looks again every few seconds while anything is being read',
  /var WATCH_EVERY = 5000;/.test(owner) && /api\("layers\/list\?dataset=" \+ encodeURIComponent\(SLUG\)\)\.then\(function \(r\) \{\n\s*var now/.test(owner), true);
check('and stops looking when nothing is',
  /if \(!now\.some\(function \(m\) \{ return busyReading\(m\.questions\); \}\)\) \{\n\s*clearInterval\(WATCH\); WATCH = null;/.test(owner), true);
check('when questions land the map reads the layer again, without a reload',
  /if \(window\.LokaAtlas\.dataChanged\) window\.LokaAtlas\.dataChanged\(\);\n\s*return preview\(SLUG\)\.then\(refreshLayers\);/.test(owner), true);

console.log('\n  the one-off for atlases read before this');
{
  // a copy of an atlas folder, made here, never the repo's own
  const roots = path.join(TMP, 'datasets');
  const mk = (slug, layers, files) => {
    const d = path.join(roots, slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ layers: [] }));
    fs.writeFileSync(path.join(d, 'manifest.local.json'), JSON.stringify({ layers }));
    for (const [f, props] of Object.entries(files)) {
      fs.writeFileSync(path.join(d, f), JSON.stringify({ type: 'FeatureCollection',
        features: props.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p })) }));
    }
  };
  const words = [{ name: 'A', description: 'a pond by the old school' }, { name: 'B', description: 'busy market square at dawn' }];
  // u2: areas with words and the mark at their middle — read, since October 2026
  // u3: areas without the mark (an old layer) — the viewer gives them no marker, so no key could show
  // u4: outlines joined by name and carrying nothing else — no words of their own
  const bare = [{ name: 'North Ward' }, { name: 'South Ward' }];
  mk('unread-one', [{ id: 'u1', type: 'marker', label: 'Ponds', source: 'user-u1.geojson' },
                    { id: 'u2', type: 'fill', label: 'Outlines', source: 'user-u2.geojson', centreMarks: true },
                    { id: 'u3', type: 'fill', label: 'Old outlines', source: 'user-u3.geojson' },
                    { id: 'u4', type: 'fill', label: 'Wards', source: 'user-u4.geojson', centreMarks: true, popup: { title: 'name', fields: [] } }],
     { 'user-u1.geojson': words, 'user-u2.geojson': words, 'user-u3.geojson': words, 'user-u4.geojson': bare });
  mk('read-one', [{ id: 'r1', type: 'marker', label: 'Read', source: 'user-r1.geojson', keyLabels: { pattern_1: 'Q?' } }],
     { 'user-r1.geojson': words.map((w) => Object.assign({ pattern_1: 'x' }, w)) });
  mk('none-one', [{ id: 'n1', type: 'marker', label: 'Nothing', source: 'user-n1.geojson', patternsNone: true }],
     { 'user-n1.geojson': words });
  mk('deoria-bioregion', [{ id: 'd1', type: 'marker', label: 'Deoria', source: 'user-d1.geojson' }],
     { 'user-d1.geojson': words });
  const reg = path.join(TMP, 'registry.json');
  fs.writeFileSync(reg, JSON.stringify({ instances: { 'unread-one': { email: 'owner@example.org' } } }));
  const qf = path.join(TMP, 'script-queue.json');
  const run = (...extra) => spawnSync(process.execPath,
    [ROOT + '/deploy/queue-question-readings.mjs', roots, '--registry', reg, '--queue', qf, ...extra], { encoding: 'utf8' });
  const dry = run();
  check('a dry run lists the unread layer of points', /unread-one\/u1 — Ponds — 2 places, reading /.test(dry.stdout), true);
  check('and the unread layer of areas, said as areas', /unread-one\/u2 — Outlines — 2 areas, reading /.test(dry.stdout), true);
  check('not areas with no mark, not bare outlines, not one with questions, not one already found empty',
    /u3|u4|read-one|none-one/.test(dry.stdout.replace(/unread-one/g, '')), false);
  check('it says it skipped Deoria, by name', /skipped deoria-bioregion — never touched/.test(dry.stdout), true);
  check('and lists nothing from it', /deoria-bioregion\/d1/.test(dry.stdout), false);
  check('a dry run writes nothing', fs.existsSync(qf), false);
  const wet = run('--apply');
  check('--apply puts both on the list', /2 added/.test(wet.stdout), true);
  const list = JSON.parse(fs.readFileSync(qf, 'utf8'));
  check('queued, charged to the owner', [list['unread-one|u1'].state, list['unread-one|u1'].payer], ['queued', 'owner@example.org']);
  check('the areas too, to the same owner', [list['unread-one|u2'].state, list['unread-one|u2'].payer], ['queued', 'owner@example.org']);
  check('only those two', Object.keys(list).sort(), ['unread-one|u1', 'unread-one|u2']);
  check('a second --apply adds nothing', /0 added/.test(run('--apply').stdout), true);
  check('the atlas folders are untouched by it',
    JSON.parse(fs.readFileSync(path.join(roots, 'unread-one', 'manifest.local.json'), 'utf8')).layers[0].keyLabels, undefined);
}

console.log('\n  a reading LOKA turned down says why, in plain words');
{
  const enrich = await import('../api/lib/atlas/enrich.js');
  const gate = enrich.gateShape({ counts: { Pond: 5, Lake: 4 }, other: 30, withText: 39 });
  check('the check turns down a set most places did not fit', gate.verdict, 'refused');
  check('and its reason becomes a sentence for the owner', enrich.whyNothingKept(gate),
    "No questions were kept: most places didn't fit any theme.");
  check('one theme taking nearly every place, said plainly',
    enrich.whyNothingKept(enrich.gateShape({ counts: { Pond: 50, Lake: 4 }, other: 0, withText: 54 })),
    'No questions were kept: one theme covered nearly every place.');
  check('the counting reason is put in plainer words',
    /^No questions were kept: no question sorted the places into enough groups/.test(
      enrich.whyNothingKept({ verdict: 'refused', reason: 'no question survived the counting' })), true);
  check('so is "kinds"', enrich.whyNothingKept({ verdict: 'refused', reason: 'no question had enough kinds that fit' }),
    'No questions were kept: none of the suggested questions had enough answers that fit these places.');
  check('a turned-down reading with no reason still gets a sentence',
    enrich.whyNothingKept({ verdict: 'refused' }), 'No questions were kept: they did not pass LOKA’s own check.');
  const thin = await enrich.enrichRows({ rows: [{ d: '' }, { d: '' }], fields: ['d'], title: 'T', mode: 'questions', callJSON: null, models: {} });
  check('a layer with no words at all is said plainly (one place with words is read)', [thin.verdict, enrich.whyNothingKept(thin)],
    ['too_thin', 'No questions were kept: no place has any words written about it.']);
  check('questions written, or a model out of reach, are not "kept nothing"',
    [enrich.whyNothingKept({ verdict: 'questions' }), enrich.whyNothingKept({ verdict: 'unavailable' }),
     enrich.whyNothingKept({ verdict: 'unread' }), enrich.whyNothingKept(null)], ['', '', '', '']);
  const serverCode = server.replace(/\/\*[\s\S]*?\*\//g, ' ');
  check('the reading hands the reason on to whoever ran it',
    /reason: out\.reason \|\| '', withText: out\.withText,/.test(serverCode), true);
  const job = serverCode.slice(serverCode.indexOf('async function readingJob'), serverCode.indexOf('function cannotReach'));
  check('a turned-down reading ends as "looked, nothing kept", like the model\'s own no',
    /const nothingKept = enrich\.whyNothingKept\(out\);\s*if \(out\.verdict === 'no_clear_questions' \|\| nothingKept\)/.test(job), true);
  check('it is noted on the layer, so it is not read again for the same places',
    /if \(out\.verdict === 'no_clear_questions' \|\| nothingKept\)[\s\S]*?writeNothingHere/.test(job), true);
  check('the plain reason is what the record keeps', /return \{ state: 'none', reason: why,/.test(job), true);
  check('and what the server log says', /console\.log\('\[questions\] ' \+ where \+ ' — ' \+ why\);/.test(job), true);
  check('"failed" is left for what really went wrong',
    (job.match(/state: 'failed'/g) || []).length >= 5 && !/'refused'/.test(job), true);
  check('the owner sees why under "Analysed once"',
    /said\.state === "none" \? plainWhy\(said\.reason\)/.test(ownerCode) &&
    /replace\(\/\^No questions were kept:\\s\*\/, ""\)/.test(ownerCode), true);
  const plainWhy = new Function(ownerCode.match(/function plainWhy\(reason\) \{[\s\S]*?\n  \}/)[0] + '; return plainWhy;')();
  check('as "Why: …"', plainWhy("No questions were kept: most places didn't fit any theme."),
    "Why: most places didn't fit any theme.");
  check('the bare stand-in is left out, not said', [plainWhy('no clear question'), plainWhy('')], ['', '']);
}

/* A reading the AI could not be reached for is retried later, off the owed
   list. Whatever the retry finds, it must end exactly as a first reading
   would: the record the owner's page reads says so, with the reason. It used
   to keep saying "could not be reached ... will be tried again" for ever once
   a retry kept nothing. Played out on a real server with the stand-in reading,
   in a throwaway data folder, told by ATLAS_FAKE_READING_PLAN to be out of
   reach first. Needs api/node_modules; where that is missing these count as
   failed rather than being quietly skipped. */
console.log('\n  a retry after an unreachable first try ends the way a first reading would');
await (async () => {
  const want = ['the server started', 'the first tries were out of reach', 'the retries ran'];
  if (!fs.existsSync(path.join(ROOT, 'api', 'node_modules'))) {
    for (const w of want) check(w + ' (api/node_modules is missing, so this could not run)', false, true);
    return;
  }
  const { spawn } = await import('node:child_process');
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-owed-retry-'));
  const SLUG = 'retry-check', OWNER = 'owner@example.test';
  const dir = path.join(DATA, 'private-datasets', SLUG);
  fs.mkdirSync(dir, { recursive: true });
  const NOTES = ['a pond by the old school, dry by March', 'busy market square at dawn', 'the lake path is walked every evening',
    'a row of old houses and a temple', 'the well is shared by six families', 'a stream runs under the main road'];
  const rowsOf = (tag) => NOTES.map((n, i) => ({ name: tag + ' ' + (i + 1), notes: n }));
  // three layers of pins: kept nothing on retry, found questions on retry, still out of reach
  const IDS = ['ponds', 'wells', 'lakes'];
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Retry check', center: [77.6, 12.95], zoom: 10,
    groups: [{ id: 'userdata', label: 'Your data', open: true }],
    basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [] }));
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: IDS.map((id) => ({
    id, group: 'userdata', type: 'marker', source: 'user-' + id + '.geojson', label: id, default: true, userLayer: true,
    popup: { title: 'name', fields: [{ label: 'Notes', property: 'notes' }] } })) }, null, 1));
  for (const [k, id] of IDS.entries()) {
    fs.writeFileSync(path.join(dir, 'user-' + id + '.geojson'), JSON.stringify({ type: 'FeatureCollection',
      features: rowsOf(id).map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77.5 + i * 0.01, 12.9 + k * 0.01] },
        properties: Object.assign({ latitude: 12.9 + k * 0.01, longitude: 77.5 + i * 0.01 }, p) })) }));
  }
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
    instances: { [SLUG]: { slug: SLUG, title: 'Retry check', visibility: 'private', status: 'published', email: OWNER, tier: 'india', layers: [], createdAt: 1 } },
    accounts: { [OWNER]: { email: OWNER, instances: [SLUG], verifiedAt: 1 } }, drafts: {} }));
  // all three waiting on the list, as considerReading would have put them
  const qf = path.join(DATA, 'question-readings.json');
  const t = Date.now();
  fs.writeFileSync(qf, JSON.stringify(Object.fromEntries(IDS.map((id, i) => [SLUG + '|' + id, {
    dataset: SLUG, layerId: id, sig: signatureOf(rowsOf(id), RULES.isAnswerColumn), payer: OWNER,
    state: 'queued', reason: '', queuedAt: t + i, at: t + i, restore: false }]))));
  const of = path.join(DATA, 'owed.json');
  const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

  const PORT = 8900 + Math.floor(Math.random() * 300);
  let out = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', ATLAS_FAKE_READING_MS: '0', NODE_ENV: 'test',
      ATLAS_FAKE_OWED_EVERY_MS: '150',
      ATLAS_FAKE_READING_PLAN: JSON.stringify({ [SLUG + '|ponds']: ['unreachable', 'refused'],
        [SLUG + '|wells']: ['unreachable'], [SLUG + '|lakes']: ['unreachable', 'unreachable'] }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    const started = await until(() => /listening on/.test(out) || child.exitCode != null, 15000);
    check('the server started', started && /listening on/.test(out), true);
    if (!/listening on/.test(out)) { console.log(out.slice(-600)); return; }

    // the first tries: all three out of reach, all three owed, the page says "will be tried again"
    const firstDone = await until(() => {
      const q = readJSON(qf);
      return IDS.every((id) => q[SLUG + '|' + id] && q[SLUG + '|' + id].state === 'failed') && Object.keys(readJSON(of)).length === 3;
    }, 15000);
    check('the first tries were out of reach', firstDone, true);
    const page1 = createQueue({ file: qf }).forDataset(SLUG);
    check('each first try is recorded as out of reach, for the page to say it will be tried again',
      IDS.map((id) => [page1[id].state, page1[id].unreachable, /^the AI could not be reached/.test(page1[id].reason)]),
      IDS.map(() => ['failed', true, true]));

    // due now, rather than in a minute
    const owedNow = readJSON(of);
    for (const o of Object.values(owedNow)) o.nextAt = 1;
    fs.writeFileSync(of, JSON.stringify(owedNow, null, 2));
    const retried = await until(() => {
      const o = readJSON(of);
      return !o[SLUG + '|ponds'] && !o[SLUG + '|wells'] && o[SLUG + '|lakes'] && o[SLUG + '|lakes'].attempts === 2;
    }, 15000);
    check('the retries ran', retried, true);
    if (!retried) console.log(out.split('\n').filter((l) => /owed|questions/.test(l)).slice(-12).join('\n'));

    const page2 = createQueue({ file: qf }).forDataset(SLUG);
    const layers = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8')).layers;
    const L = (id) => layers.find((l) => l.id === id) || {};

    // what became of each column travels with the record (columns-test.mjs has the lines themselves)
    const sansColumns = (r) => { const o = Object.assign({}, r); delete o.columns; return o; };
    check('a retry that keeps nothing ends as "none", with the plain reason',
      sansColumns(page2.ponds), { state: 'none', reason: "No questions were kept: most places didn't fit any theme.", unreachable: false });
    check('and says what became of each column', (page2.ponds.columns || []).length > 0 && page2.ponds.columns.every((c) => c.column && c.line), true);
    check('and the layer is marked as looked at, as a first reading marks it', L('ponds').patternsNone, true);
    check('it is off the owed list', !!readJSON(of)[SLUG + '|ponds'], false);
    check('the owner is told it was read and nothing kept, with why',
      /Subject: Your atlas has been read[\s\S]{0,400}no questions were kept for it[\s\S]{0,200}most places didn't fit any theme/.test(out), true);
    check('the retry checks the record against the file\'s fingerprint, the one the record was written with, so a split file is updated too',
      /const fileSig = fileSigOf\(o\.dataset, o\.layerId\);[\s\S]*?noteRetry\(o\.dataset, o\.layerId, patch, fileSig \|\| out\.sig\);/.test(fs.readFileSync(path.join(ROOT, 'api', 'apps', 'atlas.js'), 'utf8')), true);

    check('a retry that finds questions ends as "done", no longer out of reach',
      sansColumns(page2.wells), { state: 'done', reason: '', unreachable: false });
    // the stand-in reports every column like the real reading does (on this tiny
    // fixture the one word column is already a key, so every line is "not asked")
    check('with a line for each column', (page2.wells.columns || []).length > 0 && page2.wells.columns.every((c) => c.column && /^[A-Z][^:]*: /.test(c.line)), true);
    check('and the questions are on the layer',
      Object.keys(L('wells').keyLabels || {}).filter((k) => /^pattern_\d+$/.test(k)).length > 0, true);
    check('it is off the owed list too', !!readJSON(of)[SLUG + '|wells'], false);

    check('a retry still out of reach stays owed, and the page still says it will be tried again',
      [page2.lakes.state, page2.lakes.unreachable], ['failed', true]);
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    fs.rmSync(DATA, { recursive: true, force: true });
  }
})();

console.log('\n  the retry\'s ending is the first reading\'s, read from the source');
{
  const code = server.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const retry = code.slice(code.indexOf('async function retryOne'), code.indexOf('async function sweepOwed'));
  check('the retry ends through the same endReading as the list', /const patch = await endReading\(o\.dataset, o\.layerId, out\);/.test(retry), true);
  check('and writes that ending onto the record the page reads', /noteRetry\(o\.dataset, o\.layerId, patch, fileSig \|\| out\.sig\);/.test(retry), true);
  check('the list ends through it too', /return endReading\(dataset, layerId, out\);/.test(code), true);
  check('a reading given up on after a week stops promising another try',
    /for \(const o of owed\.expired\(\)\) \{\s*owed\.settle\(o\.dataset, o\.layerId\);[\s\S]{0,120}?noteRetry\(/.test(code), true);
  check('the stand-in plan and the quick sweep only exist with the stand-in on',
    /const planned = FAKE_READING \? fakePlanFor\(dataset, layerId\) : '';/.test(code) &&
    /const RETRY_EVERY = \(FAKE_READING && Number\(process\.env\.ATLAS_FAKE_OWED_EVERY_MS\)\) \|\| 60 \* 1000;/.test(code), true);
}

console.log('\n  the design notes');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
check('DESIGN.md says where the questions are found now', /### Questions are found on the server \(October 2026\)/.test(design), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
