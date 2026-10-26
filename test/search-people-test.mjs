/* Run me with: node test/search-people-test.mjs — or through node test/run.mjs.
 * Who made a record is never searchable: the search words, the vocabulary and
 * the meaning-vector text leave out answers to questions about people and the
 * raw created_by / *_user_id columns, while place answers stay; the search
 * route also drops them from an old index. Paths come from where this file sits. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { featureSearchText, layerVocabTerms, peopleTerms, tagTerms, isNeverTouched, vecVersionOk, indexVersionOk } from '../api/lib/atlas/search-text.js';
import { rebuild } from '../deploy/rebuild-search-index.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

const stanza = { id: 'spots', source: 'user-spots.geojson', userLayer: true,
  keyColumns: { pattern_1: ['description'], pattern_2: ['created_by'], pattern_3: ['added_user_id', 'description'] } };
const props = { loka_name: 'Spot', description: 'A quiet pond with benches', pattern_1: 'Pond', pattern_2: 'Asha Rao',
  pattern_3: 'Vikram Shenoy', created_by: 'Asha Rao', created_by_user_id: 'u-77', city: 'Bengaluru' };

const text = featureSearchText(props, stanza);
check('place answer stays in the search text', text.indexOf('pond') >= 0 && text.indexOf('bengaluru') >= 0, true);
check('a people question\'s answer is left out', text.indexOf('asha') < 0 && text.indexOf('vikram') < 0, true);
check('the created_by column is left out', text.indexOf('rao') < 0, true);

const terms = layerVocabTerms(stanza, [{ properties: props }], 300);
check('vocabulary keeps the place answers', terms.indexOf('pond') >= 0 && terms.indexOf('bengaluru') >= 0, true);
check('vocabulary has no person', terms.some((t) => /asha|rao|vikram|shenoy/.test(t)), false);
const asTag = layerVocabTerms(Object.assign({}, stanza, { markerBy: 'pattern_2' }), [{ properties: props }], 300);
check('a people column named as the tag column is not used', asTag.some((t) => /asha|rao/.test(t)), false);

check('what an old index could hold of people is found for the route', [...peopleTerms(stanza, [{ properties: props }])].sort(),
  ['asha rao', 'u-77', 'vikram shenoy']);
check('no keyColumns: a pattern column that cannot be judged is kept (as the map keeps it)',
  featureSearchText({ pattern_1: 'Pond' }, { id: 'x' }).indexOf('pond') >= 0, true);

// the vectors are built from this same text: unit level, the texts handed to the embedder
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('row vectors are made from the filtered text, in both places',
  /rows\.map\(\(r\) => r\.text\)/.test(server) && /featureSearchText\(p, stanza\)/.test(server) &&
  /featureSearchText\(\(f && f\.properties\) \|\| \{\}, stanza\)/.test(server), true);
check('old vector files and old words are not trusted', /vecVersionOk\(h\.v, ROW_VEC_V, dir\)/.test(server) && /indexVersionOk\(cur\.v, SEARCH_INDEX_V, dataset\)/.test(server), true);
check('the route uses the filter on the index it reads',
  /searchText\.tagTerms\(built\.idx\[L\.id\], ofPeople\)/.test(server) && /layerPeopleTerms\(built\.dir/.test(server), true);
const oldIndex = { v: 2, sig: 'old', terms: [{ t: 'asha rao' }, { t: 'pond' }, { t: 'u-77' }, { t: 'bengaluru' }] };
check('an old index with names: the filter keeps only place words',
  tagTerms(oldIndex, peopleTerms(stanza, [{ properties: props }])), ['pond', 'bengaluru']);
check('no index at all gives no words', tagTerms(null, new Set()), []);
check('deoria is recognised by name in any case, and by path', [isNeverTouched('deoria-bioregion'), isNeverTouched('Deoria-Bioregion'), isNeverTouched('/x/DEORIA-bioregion/y'), isNeverTouched('plain')], [true, true, true, false]);
check('the search write and queue paths are guarded for deoria',
  /isNeverTouched\(dataset\)\) continue;\s*\n\s*try \{ imports\.writeSearchIndex/.test(server) &&
  /embedInFlight\.has\(dataset\) \|\| searchText\.isNeverTouched\(dataset\)/.test(server) && /isNeverTouched\(dir\)\) return;/.test(server) &&
  /deoria-bioregion\/i\.test\(String\(datasetId\)\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/imports.js', 'utf8')), true);
const imp = await import('../api/lib/atlas/imports.js');
const wtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-write-'));
const wd = path.join(wtmp, 'Deoria-Bioregion'), wp = path.join(wtmp, 'plain');
fs.mkdirSync(wd); fs.mkdirSync(wp);
imp.writeSearchIndexIn(wd, 'spots', { v: 3, terms: [] });
imp.writeSearchIndexIn(wp, 'spots', { v: 3, terms: [] });
check('writing the search words refuses a deoria folder (any case) and writes nowhere', fs.readdirSync(wd), []);
check('and an ordinary folder is written', fs.readdirSync(wp), ['search.local.json']);
fs.rmSync(wtmp, { recursive: true, force: true });
check('a version 1 meaning file is accepted for deoria and rejected for others',
  [vecVersionOk(1, 2, '/x/deoria-bioregion'), vecVersionOk(1, 2, 'Deoria-Bioregion'), vecVersionOk(1, 2, '/x/plain'), vecVersionOk(2, 2, '/x/plain')], [true, true, false, true]);
check('an old saved-words version is accepted for deoria and rebuilt for others',
  [indexVersionOk(2, 3, 'deoria-bioregion'), indexVersionOk(2, 3, 'plain'), indexVersionOk(3, 3, 'plain')], [true, false, true]);

// the rebuild: an old index with a name in it is replaced; deoria is never touched
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'search-people-'));
function atlas(slug) {
  const d = path.join(tmp, slug); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'manifest.json'), '{"layers":[]}');
  fs.writeFileSync(path.join(d, 'manifest.local.json'), JSON.stringify({ layers: [stanza] }));
  fs.writeFileSync(path.join(d, 'user-spots.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: null }] }));
  fs.writeFileSync(path.join(d, 'search.local.json'), JSON.stringify({ spots: { v: 2, sig: 'old', terms: [{ t: 'asha rao' }, { t: 'pond' }] } }));
  fs.writeFileSync(path.join(d, 'search-spots.vec'), JSON.stringify({ v: 1 }) + '\n');
  return d;
}
const dirA = atlas('plain'), dirD = atlas('deoria-bioregion');
const before = fs.readFileSync(path.join(dirD, 'search.local.json'), 'utf8');
const dry = rebuild([tmp], false);
check('dry run writes nothing', fs.readFileSync(path.join(dirA, 'search.local.json'), 'utf8').indexOf('asha rao') >= 0, true);
rebuild([tmp], true);
const after = JSON.parse(fs.readFileSync(path.join(dirA, 'search.local.json'), 'utf8')).spots;
check('rebuilt words have no person and the new version', after.v === 3 && !after.terms.some((t) => /asha/.test(t.t)) && after.terms.some((t) => t.t === 'pond'), true);
check('the old meaning file is removed so it is built again', fs.existsSync(path.join(dirA, 'search-spots.vec')), false);
check('deoria is left exactly as it was', fs.readFileSync(path.join(dirD, 'search.local.json'), 'utf8') === before && fs.existsSync(path.join(dirD, 'search-spots.vec')), true);
check('a second run changes nothing', rebuild([tmp], true).filter((r) => !r.skipped).length, 0);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
