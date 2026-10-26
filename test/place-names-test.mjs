/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Short names written by LOKA for places whose only name is a sentence
 * (api/lib/atlas/place-names.js). The rules run for real on the live
 * atlases' own descriptions — test/fixtures/place-descriptions.json, the
 * "description" column of Cubbon Park (33 places) and Bengaluru on LOKA
 * (134), fetched read-only from the public files on 17 Oct 2026 — then the
 * list, the file and the stanza are exercised in a throwaway folder, and the
 * whole road runs on a throwaway server with the stand-in model
 * (ATLAS_FAKE_READING=1, no key). The wiring inside the viewer, the owner's
 * fold, the data bench and the one-off script is read from their source. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const LABELS = req(path.join(ROOT, 'atlas', 'label-rules.js'));
const RULES = req(path.join(ROOT, 'atlas', 'reading-rules.js'));
const P = await import('../api/lib/atlas/place-names.js');
const { createQueue, signatureOf, fileSignatureOf } = await import('../api/lib/atlas/questions-queue.js');
const { survey } = await import('../deploy/queue-place-names.mjs');
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'place-descriptions.json'), 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(); }
  return false;
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-place-names-'));
let n = 0;
const freshFile = () => path.join(TMP, 'q' + (++n) + '.json');
// the LOKA export's shape, in short: an id, the sentence, tags, and where (a pin's row carries its coordinates)
const rowsOf = (descs) => descs.map((d, i) => ({ tag_id: 'id-' + i, description: d, labels: '{x}', lat: 12 + i / 1000, lng: 77 + i / 1000 }));
const CUBBON = rowsOf(FIX.cubbon), BLR = rowsOf(FIX.bengaluru);

/* ------------------------------------------------------------------ *
 * The numbers
 * ------------------------------------------------------------------ */
console.log('\n  the fixtures are the live layers, and the trigger is more than half');
check('Cubbon Park: 33 places, 19 descriptions over 32 characters', P.countLong(CUBBON, 'description'), { total: 33, filled: 33, long: 19 });
check('Bengaluru on LOKA: 134 places, 107 over 32', P.countLong(BLR, 'description'), { total: 134, filled: 134, long: 107 });
check('both want short names', [P.wantsNames(CUBBON, 'description'), P.wantsNames(BLR, 'description')], [true, true]);
check('a column long for exactly half does not', P.wantsNames(rowsOf(FIX.cubbon.slice(0, 2).concat(['a', 'b'])), 'description'), false);
check('nor one long for a third', P.wantsNames(rowsOf([FIX.cubbon[0], 'Tree', 'Tired']), 'description'), false);
check('the written column itself is never a source', P.wantsNames(CUBBON.map((r) => ({ loka_name: r.description })), 'loka_name'), false);
check('the rule is one number, 32, shared with the pin cut', [P.NAME_MAX, LABELS.NAME_MAX, LABELS.SHORT_MAX], [32, 32, 32]);
check('the column has one name everywhere', [P.NAME_FIELD, LABELS.NAME_FIELD, RULES.NAME_FIELD], ['loka_name', 'loka_name', 'loka_name']);

/* ------------------------------------------------------------------ *
 * The plain cut: the first words, standing in
 * ------------------------------------------------------------------ */
console.log('\n  the first words of each description stand in');
const allDescs = FIX.cubbon.concat(FIX.bengaluru);
check('every stand-in is at most 32 characters, on all 167 places', allDescs.every((d) => LABELS.firstWords(d).length <= 32), true);
check('a short description is used exactly as it is', allDescs.filter((d) => d.trim().length <= 32).every((d) => LABELS.firstWords(d) === d.replace(/\s+/g, ' ').trim()), true);
check('"squirrels" stays "squirrels"', LABELS.firstWords('squirrels'), 'squirrels');
check('"Are we colonisers?!" stays whole', LABELS.firstWords('Are we colonisers?!'), 'Are we colonisers?!');
check('a long one is cut at a word, with an ellipsis', LABELS.firstWords('Wonder how deep this Ant Mansion is?🐜🏚️'), 'Wonder how deep this Ant…');
check('a first clause that is a name\'s length is kept whole', LABELS.firstWords(FIX.cubbon[0]), 'Cubbon Park');
check('a sentence\'s question mark is kept, its full stop is not', [LABELS.firstWords('Is this seat taken? It was, by a crow, all afternoon long'), LABELS.firstWords('Granite sculpture by unknown artist. Does anyone know who the artist is?')],
  ['Is this seat taken?', 'Granite sculpture by unknown…']);
check('every word of a stand-in is the description\'s own, in order', allDescs.every((d) => {
  const s = LABELS.firstWords(d).replace(/…$/, '');
  return d.replace(/\s+/g, ' ').trim().startsWith(s);
}), true);

/* ------------------------------------------------------------------ *
 * The rules, checked on every answer
 * ------------------------------------------------------------------ */
console.log('\n  the server checks every answer against the rules');
const ANT = 'Wonder how deep this Ant Mansion is?🐜🏚️';
check('the tagger\'s own words pass', P.checkName('Ant Mansion', ANT), 'Ant Mansion');
check('joining words may be added', P.checkName('2 trees become one', 'There are 2 trees who have become one :)'), '2 trees become one');
check('the tagger\'s spelling is kept: Bifurcatree', P.checkName('Bifurcatree', 'I am bifurcatree because I always divide each branch in two'), 'Bifurcatree');
check('a possessive or plural of the tagger\'s word is still theirs', P.checkName('Hebbal\'s 1,300-year history', 'Hebbal serves as a quiet witness to Bengaluru\'s ancient origins, with a history stretching back 1,300 years'), 'Hebbal\'s 1,300-year history');
check('a word that is not in the description fails', P.checkName('A lovely ant palace', ANT), '');
check('a fact the tagger did not state fails', P.checkName('Ant Mansion near the bandstand', ANT), '');
check('five words fail', P.checkName('Overhead highway for a loris', 'To a slender loris, this canopy is an overhead highway'), '');
check('33 characters fail', P.checkName('Grooves on a tree bark from ants', 'Grooves on a tree bark, from an ant\'s pov, we are no less than caves'), '');
check('"no fair name" is not a name', P.checkName('No fair name.', ANT), '');
check('empty is not a name', P.checkName('   ', ANT), '');
check('an emoji the tagger did not write fails', P.checkName('Ant Mansion 🌳', ANT), '');
check('bare punctuation the tagger did not write fails', P.checkName('Ant Mansion !!', ANT), '');
check('an emoji the tagger wrote may stay', P.checkName('Ant Mansion 🐜🏚️', ANT), 'Ant Mansion 🐜🏚️');
check('a question mark the tagger wrote may stay', P.checkName('Are we colonisers?', 'Are we colonisers?! Said the squirrel to the crow, one afternoon'), 'Are we colonisers?');
check('ALL CAPS where the tagger wrote none fails', P.checkName('ANT MANSION', ANT), '');
check('a word re-cased in the middle fails', P.checkName('ant MANSION', ANT), '');
check('a first capital is allowed: Bifurcatree', P.checkName('Bifurcatree', 'I am bifurcatree because I always divide each branch in two'), 'Bifurcatree');
check('the tagger\'s own capitals stay as they are', P.checkName('KR PURAM DEVASANDRA MARKET', 'KR PURAM DEVASANDRA MARKET, on a Sunday morning, before the crowds arrive'), 'KR PURAM DEVASANDRA MARKET');
{
  const [a, b, c] = [ANT, FIX.cubbon[2], FIX.cubbon[1]].map(P.descHash);
  const items = [{ key: a, text: ANT }, { key: b, text: FIX.cubbon[2] }, { key: c, text: FIX.cubbon[1] }];
  const got = P.cleanAnswer({ names: [{ key: a, name: 'Ant Mansion' }, { key: b, name: 'Caves etched in a mountain of gold' }, { key: c, name: 'no fair name' }] }, items);
  check('a passing name is kept, a rule-breaker and a decline are kept as nothing', got.names, { [a]: 'Ant Mansion', [b]: '', [c]: '' });
  check('and counted', [got.fromModel, got.declined], [1, 2]);
  const named = P.namesFor([{ description: ANT }, { description: FIX.cubbon[2] }, { description: FIX.cubbon[1] }, { description: 'Tired' }], 'description', got.names);
  check('the model\'s name is used; the first words stand in for the rest; a short one is itself', named.values,
    ['Ant Mansion', 'Grooves on a tree bark, from…', 'A great spot for an afternoon…', 'Tired']);
  check('a declined place is not asked again, and nothing is waiting', [named.waiting, named.fromModel, named.long], [0, 1, 3]);
  check('a key the model left out is asked once more', P.cleanAnswer({ names: [] }, items).names, {});
}
{
  const items = P.wanting(CUBBON.concat(BLR), 'description', {});
  const stand = P.standInAnswer(items);
  const got = P.cleanAnswer(stand, items);
  // the walk's tags are part of Bengaluru on LOKA too, so the 19 + 107 long descriptions are 107 distinct ones
  check('the stand-in\'s answers pass the same check, for every long place on both layers', [items.length, got.fromModel, got.declined], [107, 107, 0]);
  check('the same description on two layers is one question', items.length < 19 + 107, true);
}
check('the prompt carries every rule in plain words', (() => {
  const p = P.promptFor([{ key: 'k', text: ANT }], 'description', 'Is This Seat Taken?');
  return ['Use only words that are in the entry', 'At most 4 words and at most 32 characters', 'language, voice and spelling',
    'Never add a fact, a species, a place or a judgement', 'no fair name'].every((s) => p.includes(s));
})(), true);
check('one call for every 40 long places, at most 24 calls an hour', [P.PER_CALL, P.CALLS_PER_HOUR], [40, 24]);
console.log('\n  what a job tells the list when it ends');
{
  const soon = (o) => o.notBefore > Date.now() + 3500 * 1000 && o.notBefore <= Date.now() + 3600 * 1000;
  check('nothing waiting: done', P.outcome({ waiting: 0, stopped: '' }), { state: 'done', reason: '' });
  const share = P.outcome({ waiting: 30, stopped: 'this reading has used its share of the model' });
  check('the hour\'s share spent: the rest wait for the next hour, not a try', [share.state, soon(share), share.tries, share.reason], ['queued', true, undefined, '30 places wait for the next hour']);
  const first = P.outcome({ waiting: 19, stopped: 'the model could not be reached' });
  check('the model could not be asked: tried again in an hour, counted', [first.state, soon(first), first.tries, first.reason], ['queued', true, 1, 'the model could not be asked (the model could not be reached); tried again in an hour']);
  const second = P.outcome({ waiting: 19, stopped: 'the model could not be reached', tries: 1 });
  check('a second time: still tried again', [second.state, second.tries], ['queued', 2]);
  const third = P.outcome({ waiting: 19, stopped: 'the model could not be reached', tries: 2 });
  check('the third time it ends, with a plain reason for the owner', [third.state, third.tries, third.notBefore, third.reason], ['failed', 3, undefined, 'the model could not be asked 3 times — the model could not be reached']);
  check('three tries, an hour apart', P.MAX_TRIES, 3);
}

/* ------------------------------------------------------------------ *
 * The fingerprint: writing names is not a change to anybody's data
 * ------------------------------------------------------------------ */
console.log('\n  writing names never looks like a change');
{
  const sig = signatureOf(CUBBON, RULES.isAnswerColumn);
  const named = CUBBON.map((r) => Object.assign({}, r, { loka_name: LABELS.firstWords(r.description) }));
  check('the reading fingerprint is the same with the names on', signatureOf(named, RULES.isAnswerColumn), sig);
  check('and the whole-file fingerprint too', fileSignatureOf([{ layer: { id: 'a' }, rows: named }], RULES.isAnswerColumn), fileSignatureOf([{ layer: { id: 'a' }, rows: CUBBON }], RULES.isAnswerColumn));
  check('a changed description still is a change', signatureOf(named.map((r, i) => i ? r : Object.assign({}, r, { description: 'x' })), RULES.isAnswerColumn) === sig, false);
  check('a reading never reads the names as words', RULES.wordColumns(named).includes('loka_name'), false);
  check('a reading\'s write clears them (the list puts them back)', Object.keys(RULES.withoutAnswers(named)[0]).includes('loka_name'), false);
  check('not a label', LABELS.isLabelColumn('loka_name'), false);
  check('not a long heading wanting a short label', LABELS.longHeadingsOf(['loka_name', 'description']), []);
  check('the server\'s fragment builder keeps it off cards', /isAnswerColumn\(col\) \{ return \/\^pattern_\/\.test\(String\(col\)\) \|\| String\(col\) === 'loka_name'; \}/.test(fs.readFileSync(ROOT + '/api/lib/fragment.js', 'utf8')), true);
}

/* ------------------------------------------------------------------ *
 * A re-upload keeps every unchanged place's name
 * ------------------------------------------------------------------ */
console.log('\n  a re-upload keeps the names of unchanged places');
{
  const kept = {};
  for (const it of P.wanting(CUBBON, 'description', {})) kept[it.key] = 'Name ' + it.key.slice(0, 4);
  const again = CUBBON.map((r, i) => i === 18 ? Object.assign({}, r, { description: 'A new sentence about a new thing by the pond' }) : r)
    .concat([{ tag_id: 'new', description: 'Another long description of a brand new place', labels: '' }]);
  const got = P.namesFor(again, 'description', kept);
  check('the same 18 long places keep their names', got.fromModel, 18);
  check('only the changed one and the new one wait', got.waiting, 2);
  check('and only they are asked', P.wanting(again, 'description', kept).map((it) => it.text.slice(0, 14)), ['A new sentence', 'Another long d']);
  check('a name is keyed by its description, not its row', P.descHash('  Wonder how  deep '), P.descHash('wonder how deep'));
  check('the same places again are the same job', P.sigFor(CUBBON, 'description'), P.sigFor(CUBBON.slice().reverse(), 'description'));
  check('changed places are a new job', P.sigFor(again, 'description') === P.sigFor(CUBBON, 'description'), false);
}

/* ------------------------------------------------------------------ *
 * The list: an hour's share, and what travels to a new version
 * ------------------------------------------------------------------ */
console.log('\n  a job that stops at its hour\'s share waits on the same line');
{
  const q = createQueue({ file: freshFile() });
  const runs = [];
  q.start(async (job) => {
    runs.push(job.names || null);
    if (runs.length === 1) return { state: 'queued', notBefore: Date.now() + 120, reason: '2 places wait', names: { a: 'A' } };
    return { state: 'done', reason: '', names: Object.assign({}, job.names, { b: 'B' }) };
  });
  q.offer({ dataset: 'd', layerId: 'l', sig: 's1', payer: 'o@x' });
  await until(() => runs.length === 1);
  await tick(40);
  q.pump();
  await tick(20);
  check('not run again before its time', runs.length, 1);
  check('it says so on the list', [q.get('d', 'l').state, q.get('d', 'l').reason], ['queued', '2 places wait']);
  await tick(120);
  q.pump();
  await until(() => runs.length === 2);
  check('run again after it, with the names it already had', runs[1], { a: 'A' });
  await until(() => q.get('d', 'l').state === 'done');
  check('a new version of the places carries the names, the column and the owner\'s choice forward', (() => {
    q.remember('d', 'l', { from: 'description', off: false });
    q.offer({ dataset: 'd', layerId: 'l', sig: 's2', payer: 'o@x' });
    const r = q.get('d', 'l');
    return [r.names, r.from, r.off, r.sig];
  })(), [{ a: 'A', b: 'B' }, 'description', false, 's2']);
  await until(() => q.idle());
}

/* ------------------------------------------------------------------ *
 * On a layer in a folder: the file, the stanza, the list
 * ------------------------------------------------------------------ */
console.log('\n  consider(): the stand-in goes on at once, the model is asked once, the owner can say no');
function layerDir(slug, descs, extra) {
  const dir = path.join(TMP, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: slug, layers: [] }));
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [Object.assign({
    id: 'tags', type: 'marker', source: 'user-tags.geojson', label: 'Tags', userLayer: true,
    popup: { title: 'description', fields: [{ label: 'Labels', property: 'labels' }] },
    spec: { kind: 'markers', popupTitleColumn: 'description' } }, extra || {})] }));
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection',
    features: rowsOf(descs).map((p, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77 + i / 100, 12] }, properties: p })) }));
  return dir;
}
const readLayer = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8')).layers[0];
const readFeats = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'user-tags.geojson'), 'utf8')).features;
{
  const q = createQueue({ file: freshFile() });
  const dir = layerDir('cubbon', FIX.cubbon);
  const before = readFeats(dir).map((f) => JSON.stringify(f));
  const args = () => ({ dataset: 'cubbon', layerId: 'tags', layer: readLayer(dir), rows: readFeats(dir).map((f) => f.properties), dir, payer: 'o@x', q });
  check('a layer named by a sentence is put on the list', P.consider(args()), 'queued');
  const L = readLayer(dir), F = readFeats(dir);
  check('the written column names each place now', L.popup.title, 'loka_name');
  check('the pin\'s name follows it', L.label_text.property, 'loka_name');
  check('the stanza says where the names come from and that the first words stand in', [L.lokaNames.from, L.lokaNames.by, L.lokaNames.waiting, L.lokaNames.long, L.lokaNames.total], ['description', 'first words', 19, 19, 33]);
  check('every feature carries a name', F.every((f) => typeof f.properties.loka_name === 'string'), true);
  check('a short description is its own name', F[11].properties.loka_name, 'squirrels');
  check('a long one has its first words', F[0].properties.loka_name, 'Cubbon Park');
  check('and NOTHING else on any feature changed — the description is never touched', F.map((f) => {
    const p = Object.assign({}, f.properties); delete p.loka_name; return JSON.stringify(Object.assign({}, f, { properties: p }));
  }), before);
  check('the same version is not put on twice', P.consider(args()), 'not queued');
  check('the owner is carried to the job, to be charged', q.get('cubbon', 'tags').payer, 'o@x');
  // the model's names land (as the job writes them)
  const kept = {};
  for (const it of P.wanting(F.map((f) => f.properties), 'description', {})) kept[it.key] = 'N ' + it.key.slice(0, 3);
  P.writeNames(dir, 'tags', { from: 'description', kept, by: 'model' });
  q.remember('cubbon', 'tags', { state: 'done', names: kept, by: 'model', from: 'description' });
  const L2 = readLayer(dir);
  check('with the model\'s names on, nothing is waiting', [L2.lokaNames.by, L2.lokaNames.waiting], ['model', 0]);
  check('a re-commit of the same places asks for nothing', P.consider(args()), 'has them');
  // the stanza was rebuilt by a commit that did not carry the names (as a reading's write does)
  const F2 = readFeats(dir); F2.forEach((f) => { delete f.properties.loka_name; });
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features: F2 }));
  check('a file put back without the names gets them back from the list, no call', [P.consider(args()), readFeats(dir)[11].properties.loka_name, readFeats(dir)[0].properties.loka_name.startsWith('N ')], ['has them', 'squirrels', true]);
  q.remember('cubbon', 'tags', { off: true });
  check('an owner who chose another column is left alone', P.consider(args()), 'switched off');
  check('the operator\'s own atlas is never touched', P.consider(Object.assign(args(), { dataset: 'deoria-bioregion' })), 'never');
  const short = layerDir('short', ['Tree', 'Tired', 'Green pond', FIX.cubbon[0]]);
  check('a layer whose names are short is left exactly as it is', [P.consider({ dataset: 'short', layerId: 'tags', layer: readLayer(short), rows: readFeats(short).map((f) => f.properties), dir: short, q }),
    readLayer(short).popup.title, 'loka_name' in readFeats(short)[0].properties], ['none', 'description', false]);
}

/* ------------------------------------------------------------------ *
 * The one-off script
 * ------------------------------------------------------------------ */
console.log('\n  deploy/queue-place-names.mjs: dry run by default, both roots, never Deoria');
{
  const root = path.join(TMP, 'root');
  fs.mkdirSync(root, { recursive: true });
  for (const [slug, descs] of [['cubbon-park-is-this-space-taken', FIX.cubbon], ['bengaluru-on-loka', FIX.bengaluru], ['deoria-bioregion', FIX.cubbon]]) {
    fs.cpSync(layerDir('tmp-' + slug, descs), path.join(root, slug), { recursive: true });
  }
  fs.mkdirSync(path.join(root, 'short-names'), { recursive: true });
  fs.cpSync(layerDir('tmp-short', ['Tree', 'Tired', 'Green pond', FIX.cubbon[0]]), path.join(root, 'short-names'), { recursive: true });
  const q = createQueue({ file: freshFile() });
  const s = survey([root, path.join(TMP, 'no-such-root')], q);
  check('it lists the two live layers, and only them', s.want.map((w) => w.dataset + '/' + w.layerId + ' ' + w.long + '/' + w.places),
    ['bengaluru-on-loka/tags 107/134', 'cubbon-park-is-this-space-taken/tags 19/33']);
  check('Deoria is skipped, out loud', s.skipped, [{ dataset: 'deoria-bioregion', why: 'never touched (standing rule)' }]);
  const scriptFile = path.join(ROOT, 'deploy', 'queue-place-names.mjs');
  const run = (...a) => spawnSync(process.execPath, [scriptFile, ...a], { encoding: 'utf8' });
  const dry = run('--queue', q.FILE, '--registry', path.join(TMP, 'none.json'), root);
  check('a dry run says so and changes nothing', [/Dry run — nothing is changed: 2 layers/.test(dry.stdout), fs.existsSync(q.FILE)], [true, false]);
  check('it names the calls each will cost', /3 calls to the model/.test(dry.stdout) && /1 call to the model/.test(dry.stdout), true);
  const applied = run('--apply', '--queue', q.FILE, '--registry', path.join(TMP, 'none.json'), root);
  check('--apply puts them on the list', [/2 added/.test(applied.stdout), q.all().map((r) => r.dataset + ' ' + r.state).sort()], [true, ['bengaluru-on-loka queued', 'cubbon-park-is-this-space-taken queued']]);
  check('nothing in any atlas folder was written', readLayer(path.join(root, 'cubbon-park-is-this-space-taken')).popup.title, 'description');
  check('running it twice adds nothing', /0 added/.test(run('--apply', '--queue', q.FILE, '--registry', path.join(TMP, 'none.json'), root).stdout), true);
  const src = fs.readFileSync(scriptFile, 'utf8');
  check('both roots by default: public and private', /atlas', 'datasets'\)/.test(src) && /'private-datasets'\)/.test(src), true);
}

/* ------------------------------------------------------------------ *
 * The wiring, read from the source
 * ------------------------------------------------------------------ */
console.log('\n  the wiring: server, viewer, owner\'s fold, data bench, docs');
{
  const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
  const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
  const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
  const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
  const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
  const imports = fs.readFileSync(ROOT + '/api/lib/atlas/imports.js', 'utf8');
  check('every way a layer reaches an atlas considers its place names', /try \{ considerPlaceNames\(session\.dataset, id\); \}/.test(server), true);
  check('the names go on before the stanza is built, so preview and commit both show them', /const named = preparePlaceNames\(session, spec, feats, keep\);\n\s*const frag = buildFragment\(spec, feats, existingIds\);/.test(server), true);
  check('on by default, and an owner\'s "no" is remembered', /if \(had && had\.off\) return null;\s*\/\/ the owner switched it off/.test(server), true);
  check('the job pays out of the owner\'s hourly allowance, thinking off, as the short-labels job', /aiCaller\(job\.payer \? \{ payer: job\.payer \} : 'server', placeNames\.CALLS_PER_HOUR, stub\)/.test(server) && /placeNames\.schemaFor\(Type\), \{ file: true \}/.test(server), true);
  check('the rest wait for the next hour; a failure too, three times, then it ends', /placeNames\.outcome\(\{ waiting: wrote\.waiting, stopped, tries: job\.tries \}\)/.test(server) &&
    /notBefore: Date\.now\(\) \+ 3600 \* 1000/.test(fs.readFileSync(ROOT + '/api/lib/atlas/place-names.js', 'utf8')), true);
  check('the list is started with the others, and pumped once a minute', /placeNames\.queue\.start\(placeNamesJob/.test(server) && /setInterval\(\(\) => placeNames\.queue\.pump\(\), PUMP_EVERY\)/.test(server) &&
    /const PUMP_EVERY = \(FAKE_READING && Number\(process\.env\.ATLAS_QUEUE_PUMP_MS\)\) \|\| 60 \* 1000;/.test(server), true);
  check('Settings: choosing the written column switches on; choosing another switches off', /switchOnPlaceNames\(dataset, layerId, from\)/.test(server) && /switchOffPlaceNames\(dataset, layerId\)/.test(server), true);
  check('a split file\'s other half follows', /if \(layer\.sameFileAs\) switchOnPlaceNames\(dataset, layer\.sameFileAs, from\)/.test(server), true);
  check('the owner\'s page is told where the names have got to', /placeNames: placeNames\.stateFor\(l, placeNames\.queue\.get\(dataset, l\.id\)\)/.test(server), true);
  check('the bench is told how many places each column is a sentence for', /longValues: placeNames\.countLong/.test(server), true);
  check('search does not count the name twice, on the server or in the browser', /if \(n === placeNames\.NAME_FIELD\) return true;/.test(fs.readFileSync(ROOT + '/api/lib/atlas/search-text.js', 'utf8')) && /if \(n === LokaLabelRules\.NAME_FIELD\) return true;/.test(viewer), true);
  check('a written name is never a key', /if \(col === LokaLabelRules\.NAME_FIELD\) return;/.test(viewer), true);
  check('never a card column either', /c !== 'loka_name'\)/.test(imports), true);
  check('the LOKA card gets the name as its heading, above the photo', /if \(title && title\.trim\(\) !== caption\.trim\(\)\) h \+= '<div class="pop-title">' \+ esc\(title\) \+ "<\/div>" \+ byLoka;\n\s*h \+= lokaLead\(L, props, caption, krows\);/.test(viewer), true);
  check('the whole description stays as the caption', /var caption = cellShown\(props\.description\) \|\| title;/.test(viewer), true);
  check('the approved line under the heading, once, in both card shapes', (viewer.match(/Short name by LOKA, from the tagger’s words/g) || []).length, 1);
  check('and only when the name is shorter than what it was made from', /if \(whole && whole\.trim\(\) !== title\.trim\(\)\) byLoka =/.test(viewer), true);
  check('the line has its style', /\.pop-byline \{/.test(page), true);
  check('the heading is the display face (Lora)', /\.pop-title \{ font-family:var\(--font-display\)/.test(page), true);
  check('Settings offers the choice at the top, by the column\'s name', /"Short names written by LOKA — from " \+ src\.from/.test(owner), true);
  check('only when most places are long, or the names are already on', /if \(src && \(src\.wanted \|\| L\.lokaNames\)\)/.test(owner) && /wanted: long > 0 && long > feats\.length \/ 2/.test(owner), true);
  check('the calm wait line, with the stand-in explained', /"Writing short names for " \+ n \+ " place" \+ \(n === 1 \? "" : "s"\) \+\n\s*"\. Until they arrive, the first words of each " \+ src\.from \+ " stand in\."/.test(owner), true);
  check('and when they land', /"Short names written for " \+ n \+ " place"/.test(owner), true);
  check('it waits with LokaWait', /state\.innerHTML = LokaWait\.html\("Writing short names for "/.test(owner), true);
  check('the choice carries which column the names come from', /patch\.namesFrom = src\.from/.test(owner), true);
  check('the written column is not offered as a plain column', /if \(k === NAME_FIELD\) return false;/.test(owner) && /p\.name === NAME_FIELD\) return false;/.test(bench), true);
  check('Add data offers the same choice, in the same words', /label: "Short names written by LOKA — from " \+ src\.from/.test(bench), true);
  check('and sends which column it comes from', /placeNamesFrom: \(\$\("#s-poptitle"\)\.value === NAME_FIELD/.test(bench), true);
  check('the bench\'s pages load the shared rule', ['add-data', 'setup'].every((p) => /label-rules\.js\?v=dev/.test(fs.readFileSync(ROOT + '/atlas/' + p + '/index.html', 'utf8'))), true);
  const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
  const caps = fs.readFileSync(ROOT + '/LOKA-ATLAS-CAPABILITIES.md', 'utf8');
  check('DESIGN.md and the capabilities say so', /Short names written by LOKA/.test(design) && /Short names written by LOKA/.test(caps), true);
}

/* ------------------------------------------------------------------ *
 * The whole road, on a throwaway server with the stand-in model
 * ------------------------------------------------------------------ */
console.log('\n  the whole road, on a throwaway server (stand-in model, no key)');
const PORT = 8600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const PUBSLUG = 'names-check-' + TAG, PRIVSLUG = 'names-private-' + TAG, RETRYSLUG = 'names-retry-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-names-data-'));
const PUB = path.join(ROOT, 'atlas', 'datasets', PUBSLUG);
const PRIV = path.join(DATA, 'private-datasets', PRIVSLUG);
const RETRY = path.join(DATA, 'private-datasets', RETRYSLUG);
const OWNER = 'owner@example.test';
let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [PUB, DATA, TMP]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
process.on('exit', cleanup);
function atlasDir(dir, slug, descs) {
  fs.cpSync(layerDir('tmp-' + slug, descs), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: slug, basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [] }));
}
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log',
      GEMINI_API_KEY: '', ATLAS_OWNER_EMAILS: 'nobody@example.test', ATLAS_FAKE_READING: '1', ATLAS_FAKE_READING_MS: '200',
      // the stand-in cannot be reached twice for one atlas, three times for another; the list looks every half second
      ATLAS_FAKE_NAMES_FAIL: PRIVSLUG + ':2,' + RETRYSLUG + ':3', ATLAS_QUEUE_PUMP_MS: '500',
      NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) throw new Error('server did not start:\n' + out.slice(-800));
    await tick(100);
  }
}
async function signIn(email) {
  const before = out.length;
  let r = await fetch(BASE + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('request-link ' + r.status);
  const t0 = Date.now();
  let code = null;
  while (!code) {
    const m = /Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(out.slice(before));
    if (m) code = m[1];
    else if (Date.now() - t0 > 5000) throw new Error('no code in the log');
    else await tick(50);
  }
  r = await fetch(BASE + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  if (!r.ok) throw new Error('verify-code ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function call(method, p, { cookie, body } = {}) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const qfile = path.join(DATA, 'place-names.json');
const record = (slug) => { try { return JSON.parse(fs.readFileSync(qfile, 'utf8'))[slug + '|tags'] || null; } catch { return null; } };
try {
  atlasDir(PUB, PUBSLUG, FIX.cubbon);
  atlasDir(PRIV, PRIVSLUG, FIX.cubbon);
  atlasDir(RETRY, RETRYSLUG, FIX.cubbon);
  fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
    instances: {
      [PUBSLUG]: { slug: PUBSLUG, title: 'Names check', visibility: 'public', status: 'published', publishedAt: 1, ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [], tokenHash: 'x', viewKeyHash: null, createdAt: 1 },
      [PRIVSLUG]: { slug: PRIVSLUG, title: 'Names private', visibility: 'private', status: 'published', publishedAt: 1, ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [], tokenHash: 'x', viewKeyHash: 'y', createdAt: 1 },
      [RETRYSLUG]: { slug: RETRYSLUG, title: 'Names retry', visibility: 'private', status: 'published', publishedAt: 1, ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [], tokenHash: 'x', viewKeyHash: 'y', createdAt: 1 },
    },
    accounts: { [OWNER]: { email: OWNER, instances: [PUBSLUG, PRIVSLUG, RETRYSLUG], verifiedAt: 1 } },
    drafts: {},
  }));
  // the one-off script puts both on the list before the server starts, as a deploy would
  const applied = spawnSync(process.execPath, [path.join(ROOT, 'deploy', 'queue-place-names.mjs'), '--apply', '--queue', qfile,
    '--registry', path.join(DATA, 'registry.json'), path.join(ROOT, 'atlas', 'datasets'), path.join(DATA, 'private-datasets')], { encoding: 'utf8' });
  check('the script lists the public copy and the private copy alike', [/names-check-/.test(applied.stdout), /names-private-/.test(applied.stdout)], [true, true]);
  await startServer();
  const stateOf = (slug) => (record(slug) || {});
  const done = await until(() => stateOf(PUBSLUG).state === 'done' && stateOf(PRIVSLUG).tries === 1 && stateOf(RETRYSLUG).tries === 1, 15000);
  check('the server names the public copy within seconds (stand-in model)', done && stateOf(PUBSLUG).state, 'done');
  /* The retry road: the stand-in could not be reached for two atlases. Each
     is tried again an hour later — the hour is brought forward here by
     editing the line, and the list looks every half second. */
  console.log('\n  a one-off failure is tried again; three failures end with a reason');
  check('a failure waits for the next hour on the same line, counted, with the first words standing in',
    [stateOf(PRIVSLUG).state, stateOf(PRIVSLUG).tries, stateOf(PRIVSLUG).notBefore > Date.now() + 3500 * 1000, /tried again in an hour/.test(stateOf(PRIVSLUG).reason),
      readLayer(PRIV).popup.title, readLayer(PRIV).lokaNames.by, readFeats(PRIV)[0].properties.loka_name],
    ['queued', 1, true, true, 'loka_name', 'first words', 'Cubbon Park']);
  const bringForward = (slug) => { const db = JSON.parse(fs.readFileSync(qfile, 'utf8')); db[slug + '|tags'].notBefore = Date.now() - 1; fs.writeFileSync(qfile, JSON.stringify(db)); };
  bringForward(PRIVSLUG); bringForward(RETRYSLUG);
  check('the hour comes: both are tried again, and fail again', await until(() => stateOf(PRIVSLUG).tries === 2 && stateOf(RETRYSLUG).tries === 2 && stateOf(PRIVSLUG).state === 'queued', 8000), true);
  bringForward(PRIVSLUG); bringForward(RETRYSLUG);
  check('the third time: one succeeds, the other ends', await until(() => stateOf(PRIVSLUG).state === 'done' && stateOf(RETRYSLUG).state === 'failed', 8000), true);
  check('the one that failed three times says why, plainly', [stateOf(RETRYSLUG).tries, stateOf(RETRYSLUG).reason], [3, 'the model could not be asked 3 times — the stand-in model could not be reached']);
  check('its places keep the first words', [readLayer(RETRY).lokaNames.by, readLayer(RETRY).lokaNames.waiting], ['first words', 19]);
  for (const [what, dir] of [['public', PUB], ['private', PRIV]]) {
    const L = readLayer(dir), F = readFeats(dir);
    check(what + ': the written column names each place, pin and card alike', [L.popup.title, L.label_text && L.label_text.property], ['loka_name', 'loka_name']);
    check(what + ': the stanza says the names are written, none waiting', [L.lokaNames.by, L.lokaNames.waiting, L.lokaNames.long], ['stand-in', 0, 19]);
    check(what + ': every long place has a checked name, no ellipsis', F.filter((f) => f.properties.description.trim().length > 32).every((f) => f.properties.loka_name && !/…/.test(f.properties.loka_name) && f.properties.loka_name.length <= 32), true);
    check(what + ': the descriptions are untouched', F.map((f) => f.properties.description), FIX.cubbon);
  }
  check('one call for 19 places', record(PUBSLUG).calls, 1);
  check('nothing was put on the questions list by writing names', fs.existsSync(path.join(DATA, 'question-readings.json')), false);
  const ownerC = await signIn(OWNER);
  const list = await call('GET', '/api/atlas/layers/list?dataset=' + PUBSLUG, { cookie: ownerC });
  check('the owner\'s page is told: written, 19 places', [list.j.layers[0].placeNames.state, list.j.layers[0].placeNames.long, list.j.layers[0].placeNames.from], ['done', 19, 'description']);
  const plist = await call('GET', '/api/atlas/layers/list?dataset=' + PRIVSLUG, { cookie: ownerC });
  check('and for the private atlas too', plist.j.layers[0].placeNames.state, 'done');
  const rlist = await call('GET', '/api/atlas/layers/list?dataset=' + RETRYSLUG, { cookie: ownerC });
  check('and told why the other one could not be named', [rlist.j.layers[0].placeNames.state, rlist.j.layers[0].placeNames.reason], ['failed', 'the model could not be asked 3 times — the stand-in model could not be reached']);
  check('the owner\'s fold shows that reason', /"The short names could not be written" \+ \(pn\.reason \? " \(" \+ pn\.reason \+ "\)" : " just now"\)/.test(fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8')), true);
  // search finds a place by its short name, titles the hit with it
  const s = await call('POST', '/api/atlas/layers/search', { body: { dataset: PUBSLUG, q: 'squirrels' } });
  check('a search hit is titled by the short name', ((s.j && s.j.hits) || []).flatMap((h) => h.features.map((f) => f.title)).includes('squirrels'), true);
  // the owner switches back, then on again
  const off = await call('POST', '/api/atlas/layers/relabel', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags', titleColumn: 'description', titleAlso: '' } });
  check('Settings: choosing the description again switches the names off', [off.status, readLayer(PUB).popup.title, 'lokaNames' in readLayer(PUB), record(PUBSLUG).off], [200, 'description', false, true]);
  const on = await call('POST', '/api/atlas/layers/relabel', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags', titleColumn: 'loka_name', namesFrom: 'description', titleAlso: '' } });
  check('and choosing the short names again switches them on, from what was kept, with no new call', [on.status, on.j.placeNames, readLayer(PUB).popup.title, readLayer(PUB).lokaNames.by, record(PUBSLUG).off, record(PUBSLUG).calls], [200, 'has them', 'loka_name', 'stand-in', false, 1]);
  // a re-commit of the same layer (reopen + commit) keeps every name and does not read it again
  const re = await call('POST', '/api/atlas/layers/reopen', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags' } });
  check('a reopened layer starts from the written names', [re.status, re.j.spec.popupTitleColumn, re.j.spec.placeNamesFrom, re.j.fragment.popup.title, re.j.fragment.lokaNames.from], [200, 'loka_name', 'description', 'loka_name', 'description']);
  check('and the bench is told how many are long', (re.j.profiles.find((p) => p.name === 'description') || {}).longValues, 19);
  check('the written column is not a column to tick', re.j.columns.some((c) => c.name === 'loka_name'), false);
  const namesBefore = readFeats(PUB).map((f) => f.properties.loka_name);
  const c1 = await call('POST', '/api/atlas/layers/commit', { cookie: ownerC, body: { importId: re.j.importId, dataset: PUBSLUG } });
  check('committed in place', [c1.status, c1.j.layerId], [200, 'tags']);
  check('every place keeps its name', readFeats(PUB).map((f) => f.properties.loka_name), namesBefore);
  check('the stanza still says so', [readLayer(PUB).popup.title, readLayer(PUB).lokaNames.by, readLayer(PUB).lokaNames.waiting], ['loka_name', 'stand-in', 0]);
  check('no second call was made', record(PUBSLUG).calls, 1);
  // the commit asks for a reading (the layer has words), which writes answers and re-commits: the names survive that too
  const qr = path.join(DATA, 'question-readings.json');
  const read = await until(() => { try { const r = JSON.parse(fs.readFileSync(qr, 'utf8'))[PUBSLUG + '|tags']; return r && (r.state === 'done' || r.state === 'failed'); } catch { return false; } }, 15000);
  const rec1 = JSON.parse(fs.readFileSync(qr, 'utf8'))[PUBSLUG + '|tags'];
  check('the reading the commit asked for lands', [read, rec1.state, rec1.reason], [true, 'done', '']);
  await tick(300);
  check('a reading\'s write puts the names back, unchanged', readFeats(PUB).map((f) => f.properties.loka_name), namesBefore);
  const sigAfter = JSON.parse(fs.readFileSync(qr, 'utf8'))[PUBSLUG + '|tags'].sig;
  const re2 = await call('POST', '/api/atlas/layers/reopen', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags' } });
  await call('POST', '/api/atlas/layers/commit', { cookie: ownerC, body: { importId: re2.j.importId, dataset: PUBSLUG } });
  await tick(400);
  const rec2 = JSON.parse(fs.readFileSync(qr, 'utf8'))[PUBSLUG + '|tags'];
  check('a second commit carrying the names is the same version: not read again', [rec2.sig === sigAfter, rec2.state], [true, 'done']);
  /* The owner's own pick wins. In the bench, choosing a plain column by hand
     (titleChosen) is a "no" to short names: nothing is written, the layer
     is left alone, and the "no" is remembered for every later write. */
  console.log('\n  the owner\'s pick in Add data is theirs');
  const re3 = await call('POST', '/api/atlas/layers/reopen', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags' } });
  const chosen = Object.assign({}, re3.j.spec, { popupTitleColumn: 'description', placeNamesFrom: undefined, titleChosen: true });
  const ap = await call('POST', '/api/atlas/layers/apply', { cookie: ownerC, body: { importId: re3.j.importId, spec: chosen } });
  check('the preview names places by the column the owner picked, no short names', [ap.status, ap.j.fragment.popup.title, 'lokaNames' in ap.j.fragment, ap.j.spec.popupTitleColumn], [200, 'description', false, 'description']);
  const c3 = await call('POST', '/api/atlas/layers/commit', { cookie: ownerC, body: { importId: re3.j.importId, dataset: PUBSLUG } });
  check('committed so', [c3.status, readLayer(PUB).popup.title, 'lokaNames' in readLayer(PUB), 'loka_name' in readFeats(PUB)[0].properties], [200, 'description', false, false]);
  check('and the "no" is on the list', record(PUBSLUG).off, true);
  const re4 = await call('POST', '/api/atlas/layers/reopen', { cookie: ownerC, body: { dataset: PUBSLUG, layerId: 'tags' } });
  check('a later write starts from that choice', [re4.j.spec.titleChosen, re4.j.spec.popupTitleColumn, re4.j.fragment.popup.title], [true, 'description', 'description']);
  await call('POST', '/api/atlas/layers/commit', { cookie: ownerC, body: { importId: re4.j.importId, dataset: PUBSLUG } });
  check('and keeps it: still no short names', [readLayer(PUB).popup.title, 'lokaNames' in readLayer(PUB), record(PUBSLUG).off], ['description', false, true]);
  check('the bench marks the owner\'s own pick', /if \(sel === "#s-poptitle"\) S\.titleChosen = true;/.test(fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8')) && /titleChosen: \(S\.titleChosen/.test(fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8')), true);
  check('and the server honours it before the stanza is built', /if \(spec\.titleChosen\) return null;/.test(fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8')), true);
} catch (e) {
  fail++;
  console.log('  FAIL  the server run — ' + (e && e.stack || e) + '\n' + out.slice(-1500));
} finally {
  try { if (child) child.kill('SIGKILL'); } catch {}
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
