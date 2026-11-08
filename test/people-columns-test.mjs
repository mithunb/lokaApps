/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it.
 *
 * People and id columns are never read (Mithun, 8 Nov 2026: "stop reading
 * people columns" — and the rule must hold on data that is not LOKA's). One
 * shared rule (atlas/label-rules.js whyNotRead) passes a column over when its
 * NAME says it is about a person or an id, or when its VALUES are mostly
 * emails, phone numbers or opaque ids. The reader (enrich.js textColumns,
 * planColumns, enrichRows), the search index (search-text.js), Insight, the
 * scorecard and the measuring script all ask that one rule. Checked on a
 * LOKA export, a KoboToolbox/ODK-style export and a plain spreadsheet. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const L = require(ROOT + '/atlas/label-rules.js');
import * as E from '../api/lib/atlas/enrich.js';
import { isPeopleRawColumn, searchSkipProp } from '../api/lib/atlas/search-text.js';
import { isPeopleColumn as scorecardPeople } from '../deploy/scorecard.mjs';
import { peopleQuestions } from '../deploy/measure-answer-check.mjs';
import fs from 'node:fs';

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  by NAME: a generic list, whole words, separators and case aside');
const people = ['created_by', 'created_by_user_id', 'owner_user_id', 'Recorded by', '_submitted_by', 'Enumerator', 'Surveyor',
  'Respondent phone', 'Email', 'E-mail', 'Name of respondent', 'Contact', 'WhatsApp number', 'Mobile', 'contributor',
  'Collector', 'editor_user_id', 'username', 'user', 'Owner', 'collected_by', 'Volunteer', 'Observer', 'uploader',
  'Reporter', 'submittedBy', 'author'];
check('every one of these is about a person', people.map((n) => L.whyNameNotRead(n)), people.map(() => 'people'));
const place = ['name', 'loka_name', 'description', 'categories', 'labels', 'address', 'spaces', 'status', 'tree', 'keeper', 'nearby',
  'Crops grown by block', 'People visiting', 'Cell', 'created_at', 'likes', 'comments', 'Byway', 'Members of the household (count)'];
check('and none of these is — "name" is the place\'s own; "grown by block" is about the crops', place.map((n) => L.whyNameNotRead(n)), place.map(() => ''));
check('an id column is named as one', ['tag_id', '_uuid', 'ID', 'objectid', 'Place identifier'].map(L.whyNameNotRead), ['id', 'id', 'id', 'id', 'id']);
check('the viewer\'s one-word tests agree', [L.isPeopleName('Enumerator'), L.isIdName('_uuid'), L.isPeopleName('name')], [true, true, false]);

console.log('\n  by VALUES: mostly emails, phones or opaque ids');
check('emails', L.whyValuesNotRead(['a@b.com', 'c@d.org', '', 'x@y.in']), 'people');
check('phones, however written', L.whyValuesNotRead(['+91 98765 43210', '9876543210', '080-2345-6789', '(080) 2345 678']), 'people');
check('uuids', L.whyValuesNotRead(['8e7ac8ed-54bb-4586-a446-326f5ce5d07e', '8E7AC8ED-54BB-4586-A446-326F5CE5D07F']), 'id');
check('long hex, long digit runs, long mixed tokens', [L.whyValuesNotRead(['0123456789abcdef0123']), L.whyValuesNotRead(['1699999999999']), L.whyValuesNotRead(['ab12cd34ef56gh78'])], ['id', 'id', 'id']);
check('a minority is not "mostly": two emails among five remarks', L.whyValuesNotRead(['a@b.com', 'a shady lane', 'c@d.org', 'the old well', 'a tank']), '');
check('counts, years, coordinates, dates and words are read', ['1234567', '2021', '12.9716', '04-03-2021', '2021-03-04', 'a mango tree', 'khazan-survey-on-divar-island'].map((v) => L.whyValuesNotRead([v, v])), ['', '', '', '', '', '', '']);
check('an empty column says nothing', L.whyValuesNotRead(['', null]), '');
check('either is enough', [L.whyNotRead('notes', ['a@b.com', 'c@d.org']), L.whyNotRead('Enumerator', ['a shady lane']), L.isPeopleColumn('notes', ['a shady lane'])], ['people', 'people', false]);

console.log('\n  a question read from such a column is a people question (viewer and Insight)');
check('by the column\'s name', [L.isPeopleQuestion({ keyColumns: { p: ['Enumerator'] } }, 'p'), L.isPeopleQuestion({ keyColumns: { p: 'description' } }, 'p')], [true, false]);
check('by its values when the places are given', L.isPeopleQuestion({ keyColumns: { p: ['code'] } }, 'p', [{ properties: { code: 'a@b.com' } }, { properties: { code: 'c@d.in' } }]), true);
check('the old LOKA names still count', ['created_by', 'created_by_user_id', 'owner_user_id'].map((c) => L.isPeopleQuestion({ keyColumns: { p: [c] } }, 'p')), [true, true, true]);

/* Three fixtures of the same places: LOKA's export, a KoboToolbox/ODK-style
   export, and a plain spreadsheet. The place's own words are the same in all
   three; only the people and id columns differ in name and shape. */
const SORTS = ['tank', 'well', 'spring', 'stream', 'pond', 'bund'];
const N = 18;
const rowsOf = (shape) => Array.from({ length: N }, (_, i) => {
  const sort = SORTS[i % SORTS.length];
  const USE = ['washing clothes', 'watering cattle', 'drinking water', 'irrigating the paddy', 'a festival bath', 'nothing any more'];
  const own = {
    description: 'A ' + sort + ' at km ' + (i + 1) + ' below the ridge near the ' + ['school', 'temple', 'bus stop', 'market', 'grove', 'bridge'][(i * 5) % 6] +
      ' which the hamlet keeps for ' + USE[i % 6] + ' and the ' + ['herons', 'children', 'elders', 'goats'][i % 4] + ' use at dusk',
    condition: ['silted', 'clear', 'fenced'][i % 3],
    notes: ['Repaired by the panchayat', 'Overgrown at the edges', 'Dry since March', 'Fed by a canal', 'Steps on the east side', 'Shared with the next hamlet',
      'A pump beside it', 'Weeds cleared yearly', 'Lined with laterite', 'Never dries'][i % 10] + ' (' + (i + 1) + ')',
  };
  if (shape === 'loka') return Object.assign({ loka_name: 'Place ' + (i + 1), tag_id: 'TAG' + String(100000 + i),
    created_by: ['Asha', 'Ravi', 'Meera'][i % 3], created_by_user_id: '8e7ac8ed-54bb-4586-a446-326f5ce5d0' + String(10 + i),
    categories: ['Water', 'Nature'][i % 2] }, own);
  if (shape === 'kobo') return Object.assign({ name: 'Place ' + (i + 1), Enumerator: ['Asha', 'Ravi', 'Meera'][i % 3],
    _submitted_by: 'field' + (i % 3), _uuid: 'c2f5e1d0-1b2a-4c3d-8e9f-00000000' + String(1000 + i),
    'Respondent phone': '+91 98765 ' + String(43210 + i) }, own);
  return Object.assign({ Name: 'Place ' + (i + 1), 'Recorded by': ['Asha', 'Ravi', 'Meera'][i % 3],
    Email: ['asha', 'ravi', 'meera'][i % 3] + '@example.org', 'Ref no': String(9000000000000 + i * 7) }, own);
});
const read = (rows, nameCol) => {
  const fields = Object.keys(rows[0]);
  const tc = E.textColumns(rows, fields, { nameCol });
  return { asked: tc.ask.map((a) => a.column).sort(), passed: Object.fromEntries(tc.passed.map((p) => [p.column, p.why])), plan: E.planColumns(rows, fields, { nameCol }) };
};

console.log('\n  the reader passes them over, on every shape of data');
const loka = read(rowsOf('loka'), 'loka_name');
check('LOKA: only the place\'s own words are asked (condition is a key the map already offers)', loka.asked, ['description', 'notes']);
check('LOKA: the record says why, in the owner\'s words', [loka.passed.created_by, loka.passed.created_by_user_id, loka.passed.tag_id],
  ['not read — it is about who added the place', 'not read — it is about who added the place', 'not read — it is an id, not something about the place']);
const kobo = read(rowsOf('kobo'), 'name');
check('KoboToolbox: Enumerator, _submitted_by, _uuid and Respondent phone are passed over', kobo.asked, ['description', 'notes']);
check('…each with its reason', [kobo.passed.Enumerator, kobo.passed._submitted_by, kobo.passed._uuid, kobo.passed['Respondent phone']],
  ['not read — it is about who added the place', 'not read — it is about who added the place', 'not read — it is an id, not something about the place', 'not read — it is about who added the place']);
const sheet = read(rowsOf('sheet'), 'Name');
check('a plain spreadsheet: Recorded by, Email and a column of long numbers are passed over', sheet.asked, ['description', 'notes']);
check('…the numbers by their values alone (the name "Ref no" says nothing)', [L.whyNameNotRead('Ref no'), sheet.passed['Ref no']], ['', 'not read — it is an id, not something about the place']);
check('the plan never groups a people column with the short columns', [loka, kobo, sheet].map((r) => r.plan.groups.flatMap((g) => g.columns).sort()),
  [['description', 'notes'], ['description', 'notes'], ['description', 'notes']]);

console.log('\n  the record\'s line, and a question an earlier reading took from such a column');
const plan = E.planColumns(rowsOf('loka'), Object.keys(rowsOf('loka')[0]), { nameCol: 'loka_name' });
const lines = E.columnReport(plan, {}, [], [], N, {});
const lineOf = (c) => (lines.find((x) => x.column === c) || {}).line || '';
check('"Created by user id: not read — it is about who added the place"', lineOf('created_by_user_id'), 'Created by user id: not read — it is about who added the place');
check('an id column likewise', lineOf('tag_id'), 'Tag id: not read — it is an id, not something about the place');
const retiredLines = E.columnReport(plan, {}, [], [], N, { retired: [{ question: 'Who added this place?', columns: ['created_by'], col: 'pattern_2' }] });
check('a question an earlier reading took from it is retired, and the line says so',
  (retiredLines.find((x) => x.column === 'created_by') || {}).line,
  'Created by: not read — it is about who added the place; “Who added this place?”, which an earlier reading took from it, is now off the map');
check('enrichRows retires it the way it retires an address question — on a strong signal only', /p\.address \|\| \(p\.notRead && p\.strong\)/.test(fs.readFileSync(ROOT + '/api/lib/atlas/enrich.js', 'utf8')), true);
check('and the whole-record digest never holds a people column', /const readable = fields\.filter\(\(f\) => !LABELS\.whyNotRead/.test(fs.readFileSync(ROOT + '/api/lib/atlas/enrich.js', 'utf8')), true);

console.log('\n  the same rule in the search index, the scorecard and the measuring script');
check('search: Enumerator and _uuid are never searchable', [isPeopleRawColumn('Enumerator'), isPeopleRawColumn('_uuid'), isPeopleRawColumn('description')], [true, true, false]);
check('search: and so skipped when a place is indexed', [searchSkipProp('Recorded by', {}), searchSkipProp('notes', {})], [true, false]);
check('scorecard: the person check leaves them out', ['Enumerator', 'Respondent phone', 'created_by', 'notes'].map(scorecardPeople), [true, true, true, false]);
check('measure: a question read from one is about people', [...peopleQuestions({ keyLabels: { p: 'Who surveyed it?' }, keyColumns: { p: ['Enumerator'] } }, [])], ['Who surveyed it?']);

console.log('\n  Insight asks the shared rule, with values where it has them');
const im = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');
check('isPeopleColumn hands the name and values to the shared rule', /LokaLabelRules\.isPeopleColumn;\n\s*if \(typeof shared === "function"\) return !!shared\(name, values\);/.test(im), true);
check('Other keys ask it with the places\' values', /isPeopleColumn\(o\.col, fs\.map\(/.test(im), true);
check('quotes and words ask it with the place\'s own value', (im.match(/isPeopleColumn\(k, \[p\[k\]\]\)/g) || []).length >= 3 && /isPeopleColumn\(c, \[p\[c\]\]\)/.test(im), true);
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
check('the map\'s keys: a plain people or id column is never offered unless the owner committed it (source check: computeKeyOptions needs a browser)',
  /if \(!isQuestion && !committed && typeof LokaLabelRules[\s\S]{0,200}LokaLabelRules\.isPeopleColumn\(col, feats\.map/.test(viewer), true);
check('…and a question\'s values are asked too', /LokaLabelRules\.isPeopleQuestion\(L, col, feats\)/.test(viewer), true);

console.log('\n  the list does not over-reach (Opus review, 8 Nov 2026)');
const stayRead = ['Owner occupied?', 'contact type', 'mobile network coverage', 'Mobile clinic', 'Storm water collector', 'collector area',
  'credit access', 'Bank account access', 'Photo credit', 'login attempts', 'constructor', 'toString', 'hasOwnProperty', '__proto__'];
check('company words beside a place word, credit, login, account — and the object\'s own property names — stay read',
  stayRead.map((n) => L.whyNameNotRead(n)), stayRead.map(() => ''));
const companyPeople = ['Owner', 'Owner name', 'contact number', 'contact person', 'mobile no', 'Mobile number', 'phone number', 'Collector', 'Contact'];
check('a company word alone, or beside a person or contact word, is a person', companyPeople.map((n) => L.whyNameNotRead(n)), companyPeople.map(() => 'people'));
check('coordinates and measurements with a dot are read: 12.971600, 1234.567890',
  [L.whyValuesNotRead(['12.971600', '77.594600']), L.whyValuesNotRead(['1234.567890', '2345.678901']), L.isPersonValue('12.971600')], ['', '', false]);
check('a 10–12-digit run is an id (a census or LGD code), never "about who added the place"',
  [L.whyValuesNotRead(['123456789012', '123456789013']), L.whyValuesNotRead(['9876543210', '9876543211'])], ['id', 'id']);
check('a phone written as one — a +, or separators — is a person', L.whyValuesNotRead(['+91 98765 43210', '080-2345-6789']), 'people');

console.log('\n  only a strong signal retires a question an earlier reading found');
check('strong: an explicit people name, or values mostly emails, phones or UUIDs',
  ['created_by', 'Recorded by', 'owner_user_id', 'Enumerator', 'Respondent', 'Email', 'Phone number'].map((n) => L.strongNotRead(n)).concat([
    L.strongNotRead('code', ['a@b.com', 'c@d.in']), L.strongNotRead('code', ['8e7ac8ed-54bb-4586-a446-326f5ce5d07e', '8e7ac8ed-54bb-4586-a446-326f5ce5d07f']), L.strongNotRead('Owner', ['a@b.com', 'c@d.in'])]),
  ['people', 'people', 'people', 'people', 'people', 'people', 'people', 'people', 'id', 'people']);
check('weak: a company word, an id name, long numbers — passed over, never retired',
  [L.strongNotRead('Owner'), L.strongNotRead('tag_id'), L.strongNotRead('Ref no', ['9000000000001', '9000000000002']), L.whyNotRead('Owner'), L.whyNotRead('tag_id')], ['', '', '', 'people', 'id']);
const tcs = E.textColumns(rowsOf('loka'), Object.keys(rowsOf('loka')[0]), { nameCol: 'loka_name' });
const strongOf = (c) => (tcs.passed.find((p) => p.column === c) || {}).strong;
check('the reader marks which passed-over columns are strong', [strongOf('created_by'), strongOf('created_by_user_id'), strongOf('tag_id')], [true, true, false]);

console.log('\n  the viewer\'s search (atlas.js, run here) never finds an enumerator, an email or a phone');
import vm from 'node:vm';
const viewerSrc = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const cutA = viewerSrc.indexOf('  function skipSearchProp(n) {');
const cutB = viewerSrc.indexOf('    return f._stext;\n  }', cutA) + '    return f._stext;\n  }'.length;
const ctx = { LokaLabelRules: L, DATA: {}, peopleQuestion: (Lr, k, feats) => L.isPeopleQuestion(Lr, k, feats) };
vm.createContext(ctx);
vm.runInContext(viewerSrc.slice(cutA, cutB) + '\nthis.featureText = featureText; this.skipSearchProp = skipSearchProp; this.skipSearchValue = skipSearchValue;', ctx);
const koboPlace = { properties: { name: 'Place 1', Enumerator: 'Asha Rao', 'Recorded by': 'Ravi Kumar', Email: 'asha@example.org', 'Respondent phone': '+91 98765 43210',
  notes: 'Overgrown at the edges', condition: 'silted', code: 'a@b.com' } };
const text = ctx.featureText({ id: 'x' }, koboPlace);
check('the search text holds the place\'s words', /overgrown at the edges/.test(text) && /silted/.test(text), true);
check('…and none of the people: not by column name, not by value shape', ['asha', 'ravi', 'example.org', '98765', 'a@b.com'].some((w) => text.indexOf(w) >= 0), false);
const codePlace = { properties: { pattern_1: 'Meera', code: 'm@x.org' } };
ctx.DATA.y = { features: [codePlace] };   // the layer's places, as the page holds them
check('a people question\'s answer column is skipped by its values too', ctx.featureText({ id: 'y', keyColumns: { pattern_1: ['code'] } }, codePlace), '');

console.log('\n  Insight\'s scrub and credit, run here');
globalThis.LokaLabelRules = L;   // as the page has it: label-rules.js is loaded before insight-mode.js
const IM = require(ROOT + '/atlas/insight-mode.js');
const scrub = IM.peopleValuesOf({}, { Enumerator: 'Asha', 'Recorded by': 'Ravi Kumar', Owner: 'Yes', Contact: 'Good', 'Owner name': 'Piped water', Email: 'a@b.org', notes: 'Overgrown' });
check('scrubbed: names from strongly named columns, display names, emails', ['Asha', 'Ravi Kumar', 'a@b.org'].every((v) => scrub.indexOf(v) >= 0), true);
check('never an answer — "Yes", "Good", "Piped water" — nor the place\'s own words', ['Yes', 'Good', 'Piped water', 'Overgrown'].some((v) => scrub.indexOf(v) >= 0), false);
const fe = (p) => ({ properties: p });
check('credit: a LOKA-shaped layer names the writer; "From LOKA" kept', [IM.authorOf({ _loka: true }, fe({ created_by: 'Pratham' })), IM.authorOf({ _loka: true }, fe({ created_by: 'LOKA Finds' }))], ['Pratham', 'From LOKA']);
check('credit: no names on non-LOKA quotes — not an enumerator, a surveyor, a "recorded by", a respondent',
  [fe({ Enumerator: 'Asha Rao' }), fe({ Surveyor: 'Asha Rao' }), fe({ 'Recorded by': 'Asha Rao' }), fe({ Respondent: 'Asha Rao' }), fe({ created_by: 'Asha Rao' })].map((f) => IM.authorOf({}, f)), ['', '', '', '', '']);
check('credit: a column that plainly means the author is credited on any data', [IM.authorOf({}, fe({ Author: 'Asha Rao' })), IM.authorOf({}, fe({ 'Written by': 'Ravi' }))], ['Asha Rao', 'Ravi']);

console.log('\n  photos found by what the cells hold, not by LOKA\'s names');
const { photoSource } = await import('../deploy/make-small-photos.mjs');
const sheetPhotos = [{ Name: 'A', Photo: 'https://img.example.org/a.jpg', Website: 'https://example.org/' }, { Name: 'B', Photo: 'https://img.example.org/b.PNG?w=800' }, { Name: 'C', Photo: '' }];
check('a plain spreadsheet\'s "Photo" column', L.photoColumnOf(sheetPhotos), 'Photo');
check('"Image URL" likewise, from features, with two links in a cell', L.photoLinksOf({ properties: { 'Image URL': 'https://a.b/c.webp; https://a.b/d.gif' } }), ['https://a.b/c.webp', 'https://a.b/d.gif']);
check('LOKA\'s own columns are preferred when filled', L.photoColumnOf([{ photo_1_url: 'https://loka.place/api/images/x', Photo: 'https://a.b/c.jpg' }]), 'photo_1_url');
check('a website, a thumbnail, an icon are not the photograph', [L.photoColumnOf([{ Website: 'https://example.org/' }]), L.photoColumnOf([{ thumbnail_url: 'https://loka.place/api/images/thumb_x.jpg' }]), L.photoColumnOf([{ logo: 'https://a.b/l.png' }])], ['', '', '']);
check('an http (not https) link is never used', L.photoColumnOf([{ Photo: 'http://a.b/c.jpg' }]), '');
console.log('\n  …and never a spoof, nor a link pasted into prose (Opus re-check, 8 Nov 2026)');
check('the extension must end the URL\'s PATH: the query is never looked at',
  ['https://x/a.exe?x=.png', 'https://evil/pwn?x=.png', 'https://evil.org/api/images/abc', 'not a url .jpg'].map(L.isImageLink), [false, false, false, false]);
check('a path that ends in an image, with a query, and LOKA\'s /api/images/ on loka.place alone',
  ['https://a.b/c.JPG?w=1', 'https://loka.place/api/images/abc', 'https://a.b/dir/photo.webp'].map(L.isImageLink), [true, true, true]);
check('one place alone: a description with a link in it is never the photo', L.photoLinksOf({ description: 'A tree, see https://a.b/c.jpg for a photo', notes: 'x' }), []);
check('…nor a website cell beside prose; a links-only cell is', [L.photoLinksOf({ Website: 'home: https://a.b/c.jpg' }), L.photoLinksOf({ Photo: 'https://a.b/c.jpg; https://a.b/d.png' })], [[], ['https://a.b/c.jpg', 'https://a.b/d.png']]);
check('the whole layer decides when its rows are given: prose columns with links are not the column',
  [L.photoColumnOf([{ description: 'see https://a.b/c.jpg', notes: 'x' }, { description: 'https://a.b/d.jpg too' }]), L.photoLinksOf({ Photo: 'https://a.b/c.jpg', description: 'see https://a.b/z.jpg' }, [{ Photo: 'https://a.b/c.jpg' }, { Photo: 'https://a.b/d.jpg' }])], ['', ['https://a.b/c.jpg']]);
check('LOKA\'s own photo columns still come first, one place alone too', L.photoLinksOf({ Photo: 'https://a.b/c.jpg', photo_1_url: 'https://loka.place/api/images/x' }), ['https://loka.place/api/images/x']);
check('the small-photos script never fetches a link from prose', photoSource({ description: 'see https://a.b/c.jpg' }, '/nonexistent'), null);
check('the script loads the shared rule through fileURLToPath', /createRequire\(import\.meta\.url\)\(fileURLToPath\(new URL\('\.\.\/atlas\/label-rules\.js'/.test(fs.readFileSync(ROOT + '/deploy/make-small-photos.mjs', 'utf8')), true);
check('small photos: the script takes the "Photo" column as a source', (photoSource({ Photo: 'https://img.example.org/a.jpg' }, '/nonexistent') || {}).url, 'https://img.example.org/a.jpg');
check('…and LOKA\'s photo_1_url first, as before', (photoSource({ photo_1_url: 'https://loka.place/api/images/x.jpg', Photo: 'https://img.example.org/a.jpg' }, '/nonexistent') || {}).url, 'https://loka.place/api/images/x.jpg');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('the link preview asks the same rule after photo_1_url', /photo_1_url[\s\S]{0,300}shortLabels\.LABELS\.photoLinksOf\(props\)\[0\]/.test(server), true);
check('Explore and Insight cards fall back to it', [fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8'), im].map((src) => /LokaLabelRules\.photoLinksOf\(props\)/.test(src)), [true, true]);
check('and the place card on the map', /LokaLabelRules\.photoLinksOf\(props\)/.test(viewerSrc), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
