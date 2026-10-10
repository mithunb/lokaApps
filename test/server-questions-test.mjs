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
  /if \(opts && opts\.fromReading\) \{\n\s*QUESTIONS\.remember\(/.test(server), true);
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
check('the payer is the atlas owner', /const payer = \(inst && inst\.email\) \|\| '';/.test(server), true);
check('each reading still has its own ceiling', /if \(spent >= cap\) throw new Error\('this reading has used its share of the model'\);/.test(server), true);
check('the stand-in pays out of the same allowance', /if \(stub\) return stub\(model, prompt, schema, o\);/.test(server) &&
  /await pay\('fake', 'find', null, \{\}\);/.test(server), true);

console.log('\n  the stand-in model cannot be switched on by accident');
check('it needs the flag, the local static mode, no key and not production',
  /const FAKE_READING = process\.env\.ATLAS_FAKE_READING === '1' &&\n\s*!!process\.env\.LOKA_DEV_STATIC && !process\.env\.GEMINI_API_KEY &&\n\s*process\.env\.NODE_ENV !== 'production';/.test(server), true);
const live = fs.readFileSync(ROOT + '/api/ecosystem.config.cjs', 'utf8') + fs.readFileSync(ROOT + '/deploy/deploy.sh', 'utf8');
check('nothing that starts the live server sets either flag', /ATLAS_FAKE_READING|LOKA_DEV_STATIC/.test(live), false);

console.log('\n  the owner\'s page reports, and starts nothing');
check('the browser no longer reads', /askQuestions|keepQuestions|rememberNothingHere|layers\/enrich/.test(ownerCode), false);
check('the status comes on /layers/list, per layer', /questions: reading\[l\.id\] \|\| null,/.test(server), true);
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

console.log('\n  the design notes');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
check('DESIGN.md says where the questions are found now', /### Questions are found on the server \(October 2026\)/.test(design), true);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
