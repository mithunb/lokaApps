/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Place names written in Devanagari reach the English boundary list.
 *
 * norm("देवरिया") used to be "" — a Hindi column placed nothing. Now a plain
 * table turns the letters into their Hunterian spelling, the spellings English
 * is known to use are tried as exact keys, and a lossy form both scripts
 * reduce to catches the rest. Measured here on 134 districts across ten
 * states against every district geoBoundaries has for India. No network. */
import { norm, canon, spellings, joinByName, fallbackRequest, applyFallback, FALLBACK_MAX, LOOSE_FLOOR } from '../api/lib/matching.js';
import { transliterate, variants, skeleton, hasDevanagari } from '../api/lib/devanagari.js';

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('  FAIL ' + name + '\n       got  ' + JSON.stringify(got) + '\n       want ' + JSON.stringify(want)); }
}

console.log('  the letters, one by one');
check('a plain name', transliterate('कुशीनगर'), 'kushingar');
check('the unwritten a at the end goes', transliterate('गोरखपुर'), 'gorakhpur');
check('and the one between two spoken vowels', transliterate('महाराजगंज'), 'maharajganj');
check('a conjunct keeps the vowel before it', transliterate('बस्ती'), 'basti');
check('nukta: ज़ is z, ग़ is gh, फ़ is f', transliterate('ग़ाज़ीपुर फ़िरोज़ाबाद'), 'ghazipur firozabad');
check('anusvara before a lip letter is m', transliterate('कौशाम्बी चम्पारण'), 'kaushambi champaran');
check('anusvara before ह is ng', transliterate('सिंह'), 'singh');
check('chandrabindu is a nasal too', transliterate('झाँसी'), 'jhansi');
check('Devanagari digits become digits', transliterate('वार्ड १२'), 'vard 12');
check('Latin text passes through untouched', transliterate('Ward 12 देवरिया'), 'Ward 12 devriya');
check('hasDevanagari says which script', [hasDevanagari('देवरिया'), hasDevanagari('Deoria'), hasDevanagari('')], [true, false, false]);

console.log('\n  the spellings English is known to give the same letters');
check('देव is written deo', variants('देवरिया').includes('deoria'), true);
check('व is written w as often as v', variants('सीवान').includes('siwan'), true);
check('-िया ends as -ia', variants('बलिया').includes('balia'), true);
check('गांव ends as gaon', variants('गुड़गांव').includes('gurgaon'), true);
check('the unwritten a may be kept', variants('कुशीनगर').includes('kushinagar'), true);
check('the list stays short', variants('मुज़फ़्फ़रनगर').length <= 64, true);

console.log('\n  the lossy form both scripts reduce to');
check('Deoria and devriya meet', skeleton('deoria'), skeleton('devriya'));
check('Bijnor and bijnaur meet', skeleton('bijnor'), skeleton('bijnaur'));
check('Etawah and itava meet', skeleton('etawah'), skeleton('itava'));
check('Rewa and riva meet', skeleton('rewa'), skeleton('riva'));
check('Jalgaon and jalgav meet', skeleton('jalgaon'), skeleton('jalgav'));
check('but Deoria and Gorakhpur do not', skeleton('deoria') === skeleton('gorakhpur'), false);

console.log('\n  the key a cell is filed under');
check('Devanagari no longer normalises to nothing', norm('देवरिया'), 'devriya');
check('a cell in both scripts keeps the English', norm('Deoria / देवरिया'), 'deoria');
check('a Latin cell is exactly what it was', norm('Sant Kabir Nagar'), 'santkabirnagar');
check('a Latin cell has one spelling', spellings('Deoria'), ['deoria']);
check('a Devanagari cell has several, the plain one first', spellings('देवरिया')[0], 'devriya');
check('the alias table still applies to a transliteration', canon('बिशुनपुरा'), 'vishunpura');

console.log('\n  measured: districts across India, written in Devanagari');
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/devanagari-districts.json'), 'utf8'));
const targets = fx.targets.map((name, i) => ({ code: String(i), name }));
const res = joinByName(fx.districts.map((d) => ({ d: d.devanagari })), 'd', null, targets);
let right = 0, sameNameTwice = 0, wrong = 0;
const misses = [];
res.forEach((r, i) => {
  const want = canon(fx.districts[i].english);
  if (r.match != null) {
    if (canon(targets[Number(r.match)].name) === want) right++;
    else { wrong++; misses.push(fx.districts[i].devanagari + ' → ' + targets[Number(r.match)].name + ' (wanted ' + fx.districts[i].english + ')'); }
  } else if (r.candidates.length && r.candidates.every((c) => canon(c.name) === want)) sameNameTwice++;
  else misses.push(fx.districts[i].devanagari + ' → ' + (r.candidates.length ? 'ambiguous' : 'nothing') + ' (wanted ' + fx.districts[i].english + ')');
});
const hit = (right + sameNameTwice) / fx.districts.length;
console.log('       ' + fx.districts.length + ' districts: ' + right + ' placed, ' + sameNameTwice + ' narrowed to a name two states share, ' +
  (fx.districts.length - right - sameNameTwice - wrong) + ' left for the fix list, ' + wrong + ' placed wrongly — ' + (hit * 100).toFixed(1) + '%');
for (const m of misses) console.log('         ' + m);
check('at least nine in ten reach the right district', hit >= 0.9, true);
check('at most one in a hundred reaches a wrong one', wrong <= Math.ceil(fx.districts.length / 100), true);
check('nothing is placed twice over', res.filter((r) => r.match != null).length, right + wrong);

console.log('\n  a parent column tells two same-named districts apart, in either script');
const twins = [
  { code: 'a', name: 'Hamirpur', parent: 'Himachal Pradesh' }, { code: 'b', name: 'Hamirpur', parent: 'Uttar Pradesh' },
  { code: 'c', name: 'Deoria', parent: 'Uttar Pradesh' },
];
const one = (row, p) => joinByName([row], 'n', p ? 's' : null, twins)[0];
check('without one, a Devanagari twin is a question', one({ n: 'हमीरपुर' }).match, null);
check('and both twins are offered', one({ n: 'हमीरपुर' }).candidates.map((c) => c.code), ['a', 'b']);
check('with an English parent it is an answer', one({ n: 'हमीरपुर', s: 'Uttar Pradesh' }, true).match, 'b');
check('with a Devanagari parent too', one({ n: 'हमीरपुर', s: 'हिमाचल प्रदेश' }, true).match, 'a');
check('a Latin twin is exactly as before', one({ n: 'Hamirpur', s: 'Uttar Pradesh' }, true).match, 'b');
/* Raigad (Marathi ड) against geoBoundaries' "Raigarh" is a spelling apart, not
   a script apart: it stays a candidate, never an auto-match, parent or no. */
const rg = [{ code: 'a', name: 'Raigarh', parent: 'Chhattisgarh' }, { code: 'b', name: 'Raigarh', parent: 'Maharashtra' }];
check('a near-spelling with a parent is narrowed to one candidate, not placed',
  joinByName([{ n: 'रायगड', s: 'Maharashtra' }], 'n', 's', rg)[0].candidates.map((c) => c.code), ['b']);

console.log('\n  cells written in both scripts');
check('English and Hindi together place by the English', one({ n: 'Deoria / देवरिया' }).match, 'c');
check('Hindi first, English after', one({ n: 'देवरिया (Deoria)' }).match, 'c');
check('a stray Latin word does not stop the Hindi', joinByName([{ n: 'Block देवरिया' }], 'n', null, twins)[0].match, 'c');

console.log('\n  nothing changes for names that were never Devanagari');
const latin = ['Deoria', 'Kushinagar', 'Sant Kabir Nagar', 'Ward 12', 'Rampur 23', 'B.R.T. Wildlife Sanctuary', 'Bishunpura', 'Mahārāshtra', 'São Paulo', '', '  ', '123'];
check('norm on Latin text', latin.map(norm), ['deoria', 'kushinagar', 'santkabirnagar', 'ward12', 'rampur23', 'brtwildlifesanctuary', 'bishunpura', 'maharashtra', 'saopaulo', '', '', '123']);
check('canon on Latin text', latin.map(canon).slice(6, 7), ['vishunpura']);
const blocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'atlas/datasets/deoria-bioregion/blocks.geojson'), 'utf8')).features
  .map((f, i) => ({ code: String(i), name: f.properties.name, parent: f.properties.district }));
const asBefore = joinByName([{ n: 'Bishunpura', d: 'Kushinagar' }, { n: 'Rampur 23', d: 'Deoria' }, { n: 'Kasia', d: '' }, { n: 'Padrona', d: 'Kushinagar' }, { n: 'Nowhere', d: '' }], 'n', 'd', blocks);
check('the Deoria alias, serial-number and similarity cases still land where they did',
  asBefore.map((r) => (r.match == null ? null : blocks[Number(r.match)].name)), ['Vishunpura', null, 'Kasaya', null, null]);
check('a near miss is still offered, not taken', asBefore[3].candidates.map((c) => c.name), ['Padrauna']);
check('a Latin miss carries no look-alikes above the old floor', asBefore[4].candidates, []);
check('the join is a pure function of its inputs (same call, same answer)',
  JSON.stringify(joinByName([{ n: 'देवरिया' }], 'n', null, twins)), JSON.stringify(joinByName([{ n: 'देवरिया' }], 'n', null, twins)));

console.log('\n  the model, on a short leash');
const report = {
  ambiguous: [{ row: 3, name: 'रायगड', candidates: [{ code: 'a', name: 'Raigarh', parent: 'Chhattisgarh', score: 0.9 }, { code: 'b', name: 'Raigarh', parent: 'Maharashtra', score: 0.9 }] }],
  unmatched: [
    { row: 5, name: 'लखनऊ', candidates: [], loose: [{ code: 'x', name: 'Lucknow', parent: '', score: 0.4 }] },
    { row: 6, name: 'लखनऊ', candidates: [], loose: [{ code: 'x', name: 'Lucknow', parent: '', score: 0.4 }] },
    { row: 7, name: 'Somewhere', candidates: [] },
    { row: 8, name: 'row 9', reason: 'no geometry' },
  ],
};
const ask = fallbackRequest(report);
check('it is asked about names, each once, with candidates', ask.map((q) => q.sourceName), ['रायगड', 'लखनऊ']);
check('a name with nothing to choose from is not asked', ask.some((q) => q.sourceName === 'Somewhere'), false);
check('it is handed a code, a name and a parent — no row, no score', Object.keys(ask[0].candidates[0]).sort(), ['code', 'name', 'parent']);
check('and nothing else about the row', Object.keys(ask[0]).sort(), ['candidates', 'sourceName']);
check('at most forty names a call', FALLBACK_MAX, 40);
const many = { ambiguous: Array.from({ length: 60 }, (_, i) => ({ row: i, name: 'n' + i, candidates: [{ code: 'c', name: 'C' }] })), unmatched: [] };
check('a longer list is cut there', fallbackRequest(many).length, 40);
const chosen = applyFallback(report, { matches: [
  { sourceName: 'रायगड', chosenCode: 'b' },
  { sourceName: 'लखनऊ', chosenCode: 'x' },
  { sourceName: 'Somewhere', chosenCode: 'zzz' },
  { sourceName: 'रायगड', chosenCode: 'made-up' },
] });
check('a code that was offered for that name is kept', chosen[3], 'b');
check('and reaches every row with that name', [chosen[5], chosen[6]], ['x', 'x']);
check('a code that was never offered is dropped', chosen[7], undefined);
check('an answer that names a place of its own is ignored', Object.keys(chosen).length, 3);
check('an empty or broken answer chooses nothing', [applyFallback(report, null), applyFallback(report, { matches: 'no' })], [{}, {}]);
check('look-alikes for the model start at a lower floor than candidates', LOOSE_FLOOR < 0.5, true);

console.log('\n  and the server keeps it there');
const server = fs.readFileSync(path.join(ROOT, 'api/apps/atlas.js'), 'utf8');
check('no key, no call: the whole step sits behind the model handle', /if \(ai && !b\.manual\) \{\s*\n\s*const ask = fallbackRequest\(result\.matchReport\);/.test(server), true);
check('the call is budgeted like every other', /if \(ask\.length && geminiAllowed\(who\)\)/.test(server), true);
check('the model is sent what fallbackRequest built, nothing else', /JSON\.stringify\(ask\),\s*\n\s*\]\.join/.test(server), true);
check('its answer goes through applyFallback', /const chosen = applyFallback\(result\.matchReport, adj\);/.test(server), true);
check('each pick is recorded as a suggestion', /session\.suggested\[row\] = chosen\[row\];/.test(server), true);
check('and listed for the owner with the place it chose', /report\.suggested = report\.suggested \|\| \[\]\)\.push\(\{ row: res\.row, name: res\.name, code, place: target\.name \}\)/.test(server), true);
check('a manual fix takes the row off that list', /if \(session\.suggested\) delete session\.suggested\[f\.row\];/.test(server), true);
check('look-alikes ride on the unmatched entry for the model to see', /\.\.\.\(res\.loose && res\.loose\.length \? \{ loose: res\.loose \} : \{\}\)/.test(server), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
