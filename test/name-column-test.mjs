/* Run me with: node test/run.mjs — or on my own with node.
 *
 * IDENTIFY EACH PLACE BY (Mithun, October 2026). The server used to guess which
 * column names a place, the Add-data step asked it weakly ("Call each place by",
 * below the key, every text column, no preview), and once a layer was on the
 * atlas there was no screen to change it. Now the same question is asked in the
 * same words in both places — "Identify each place by" — directly under "Colour
 * places by" at add time and first in the layer's Settings fold on the atlas;
 * each column says what it holds; four real names show what the choice does;
 * a place may be identified by two columns joined ("Asha Rao · Western Ghats
 * Collective"); a place with nothing in them is called by its row ("Place 7")
 * everywhere; the map's names follow the choice on pins as well as areas; and
 * both halves of a split file are set together.
 *
 * The viewer's rules are lifted out of atlas.js and run on made-up layers; the
 * server's are imported and run on a throwaway data folder. No network. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const bench = fs.readFileSync(ROOT + '/atlas/databench.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const design = fs.readFileSync(ROOT + '/DESIGN.md', 'utf8');
const caps = fs.readFileSync(ROOT + '/LOKA-ATLAS-CAPABILITIES.md', 'utf8');

// the server's own modules, pointed at a folder that vanishes when this ends
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-name-column-'));
process.env.LOKA_DATA_DIR = DATA;
const fragment = await import(ROOT + '/api/lib/fragment.js');
const imports = await import(ROOT + '/api/lib/atlas/imports.js');
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} });

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// lift the viewer's naming rules out of atlas.js as they stand
function fn(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = js.indexOf('\n  }\n', i);
  return js.slice(i, j + 4) + '\n';
}
const body = ['unbrace', 'unquotePiece', 'cellShown', 'layerNoun', 'nounOne', 'joinNames',
  'popupTitleText', 'placeName', 'labelNameOf'].map(fn).join('') +
  '\nreturn { popupTitleText, placeName, labelNameOf };';
const V = new Function(body)();

/* ------------------------------------------------------------------ *
 * the words, the same in both places                                   *
 * ------------------------------------------------------------------ */
console.log('\n  the question is asked in the same words at add time and on the atlas');
const LABEL = 'Identify each place by';
const HELP = 'The name each place is known by — shown beside its pin, at the top of its card and in search. Choose which column it comes from.';
check('the Add-data step asks it', bench.includes('<label for="s-poptitle">' + LABEL + '</label>'), true);
check('with its one plain line', bench.includes('<span class="note">' + HELP + '</span>'), true);
check('and offers a second column', bench.includes('Add a second column <span class="hint">(optional)</span>'), true);
check('the layer\'s fold asks it', owner.includes('lbl.textContent = "' + LABEL + '";'), true);
check('with the same line', owner.includes('note.textContent = "' + HELP + '";'), true);
check('and the same second column', owner.includes('alsoText.textContent = "Add a second column ";') && owner.includes('opt.textContent = "(optional)";'), true);
check('the old wording is gone', /Call each place by/.test(bench) || /Call each place by/.test(owner), false);
check('it sits directly under "Colour places by" at add time',
  bench.indexOf('id="w-colour"') < bench.indexOf('id="w-poptitle"') && bench.indexOf('id="w-poptitle"') < bench.indexOf('id="w-palette"') &&
  bench.indexOf('id="w-poptitle"') < bench.indexOf('class="key-head"'), true);
check('and first in the fold, above "On every place\'s card"',
  /if \(showCard\) host\.appendChild\(buildNameChoice\(L, save\)\);[\s\S]{0,200}cardBox\.appendChild\(document\.createTextNode\("On every place's card"\)\);/.test(owner), true);
check('saving says what it is doing, then that it is done',
  owner.includes('LokaWait.html("Renaming the places on the map\u2026")') &&
  owner.includes('"Done. Everyone who opens the atlas sees the new names."'), true);
check('the Add-data step says the same while the preview is renamed', bench.includes('"Renaming the places on the map…"'), true);
check('the unused guess in owner.js is gone', /NAMEISH/.test(owner), false);
check('each option says what it holds — "every place" or "n of m places", and "k kinds, shared"',
  /"every place" : filled \+ " of " \+ total \+ " places"/.test(bench) && /", " \+ kinds \+ " kinds, shared"/.test(bench) &&
  /"every place" : c\.filled \+ " of " \+ c\.total \+ " places"/.test(owner) && /c\.kinds \+ " kinds, shared"/.test(owner), true);
check('ids, one-value columns and the questions\' answers are left out, in both',
  /\/\^pattern_\/\.test\(p\.name\) \|\| ID_LIKE\.test\(p\.name\)/.test(bench) && /p\.kinds <= 1\) return false/.test(bench) &&
  /\/\^pattern_\/\.test\(k\) \|\| ID_LIKE\.test\(k\)/.test(owner) && /c\.kinds > 1 && !c\.idLike/.test(owner), true);
check('the owner is told how many places have no name, and what they will be called',
  /" will be called by " \+[\s\S]{0,80}" row: "/.test(bench) && /" will be called by " \+[\s\S]{0,80}" row: "/.test(owner), true);
check('the docs say so', /Identify each place by/.test(design) && /Identify each place by/.test(caps) && !/Call each place by/.test(caps), true);

/* ------------------------------------------------------------------ *
 * the viewer: joining, the row, the map's names                        *
 * ------------------------------------------------------------------ */
console.log('\n  a place is called by one column, or two joined');
const one = { id: 'p', type: 'marker', userLayer: true, popup: { title: 'Name', fields: [] } };
const two = { id: 'p', type: 'marker', userLayer: true, popup: { title: 'Name', titleAlso: 'Org', fields: [] } };
const f = (row, props) => ({ _row: row, properties: props });
check('one column', V.popupTitleText(one, { Name: 'Asha Rao', Org: 'Western Ghats Collective' }), 'Asha Rao');
check('two columns, joined after a middle dot', V.popupTitleText(two, { Name: 'Asha Rao', Org: 'Western Ghats Collective' }), 'Asha Rao · Western Ghats Collective');
check('no organisation: just the name', V.popupTitleText(two, { Name: 'Asha Rao', Org: '' }), 'Asha Rao');
check('no name: just the organisation', V.popupTitleText(two, { Name: '', Org: 'Western Ghats Collective' }), 'Western Ghats Collective');
check('a braced cell reads as words in either part', V.popupTitleText(two, { Name: '{"Asha Rao"}', Org: '{}' }), 'Asha Rao');
check('"null" in a part is nothing', V.popupTitleText(two, { Name: 'null', Org: 'WGC' }), 'WGC');
check('the server joins the same way', fragment.placeNameOf({ Name: 'Asha Rao', Org: 'Western Ghats Collective' }, two.popup), 'Asha Rao · Western Ghats Collective');
check('and drops an empty part the same way', [fragment.placeNameOf({ Name: 'Asha Rao', Org: '' }, two.popup), fragment.placeNameOf({ Name: '', Org: '' }, two.popup)], ['Asha Rao', '']);

console.log('\n  a place with nothing in the chosen columns is called by its row');
check('"Place 7" on an added layer', V.placeName(two, f(6, { Name: '', Org: '' })), 'Place 7');
check('by the layer\'s own noun', V.placeName({ ...two, noun: 'tags' }, f(6, { Name: '' })), 'Tag 7');
check('an area the same', V.placeName({ ...two, type: 'fill' }, f(0, { Name: '' })), 'Area 1');
check('a feature the map handed back knows its row too', V.placeName(two, { properties: { Name: '', _srow: 11 } }), 'Place 12');
check('a named place is not renumbered', V.placeName(two, f(6, { Name: 'Asha Rao' })), 'Asha Rao');
check('a curated layer stays quiet', V.placeName({ id: 'c', type: 'marker', popup: { title: 'name' } }, f(3, { name: '' })), '');
check('the card heading, the pin, the hover and the list all ask the one rule',
  /var pinName = placeName\(L, f\);/.test(js) && /wireMarkerHint\(node, function \(\) \{ return placeName\(L, f\); \}/.test(js) &&
  /var title = f \? placeName\(L, f\) : popupTitleText\(L, props\);/.test(js) &&
  (js.match(/name: placeName\(L, e\.f\)/g) || []).length === 2, true);

console.log('\n  the names on the map follow the choice');
const t = { property: 'Name' };
check('a pin\'s name is both columns', V.labelNameOf(two, f(0, { Name: 'Asha Rao', Org: 'WGC' }), t), 'Asha Rao · WGC');
check('or its row', V.labelNameOf(two, f(4, { Name: '', Org: '' }), t), 'Place 5');
check('a label on some other column reads that column as it is', V.labelNameOf(two, f(0, { Name: 'Asha', Org: 'WGC', Ward: 'Ward 3' }), { property: 'Ward' }), 'Ward 3');
check('the map writes the names through it', /var v = labelNameOf\(L, e\.f, t\);/.test(js) && /var nm = labelNameOf\(L, f, t\);/.test(js) &&
  /joinNames\(f\._twins\.map\(function \(r\) \{ return labelNameOf\(L, gj\.features\[r\], t\); \}\)\)/.test(js), true);

console.log('\n  an old stanza reads exactly as it did');
const old = { id: 'o', type: 'marker', popup: { title: 'name', titleFallback: 'label' } };
check('one column, no second', V.popupTitleText(old, { name: 'Pond', label: 'x' }), 'Pond');
check('the fallback still stands in', V.popupTitleText(old, { name: '', label: 'Lake' }), 'Lake');
check('nothing is nothing', V.popupTitleText(old, { name: '' }), '');

/* ------------------------------------------------------------------ *
 * the server: the stanza, the relabel, the twins, the map's names      *
 * ------------------------------------------------------------------ */
console.log('\n  building a layer with two naming columns');
const pt = (i, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [77 + i / 100, 12.9] }, properties: props });
const people = [
  pt(0, { Name: 'Asha Rao', Org: 'Western Ghats Collective', Notes: 'a long note about the place that runs on and on and on past forty letters' }),
  pt(1, { Name: 'Vijay Ramesh', Org: '', Notes: 'short' }),
  pt(2, { Name: '', Org: '', Notes: 'nobody' }),
  pt(3, { Name: 'Meera', Org: 'Nilgiri Trust', Notes: 'x' }),
];
const built = fragment.buildFragment({ kind: 'markers', label: 'People', group: 'userdata', popupTitleColumn: 'Name', popupTitleAlso: 'Org', popupColumns: ['Org', 'Notes'] }, people, []);
check('the stanza names both', [built.stanza.popup.title, built.stanza.popup.titleAlso], ['Name', 'Org']);
check('neither is also a line on the card', built.stanza.popup.fields.map((x) => x.property), ['Notes']);
check('the pins get the name beside them', built.stanza.label_text, { property: 'Name' });
const plain = fragment.buildFragment({ kind: 'markers', label: 'People', group: 'userdata', popupTitleColumn: 'Name', popupColumns: ['Org'] }, people, []);
check('a spec with one column writes no second', 'titleAlso' in plain.stanza.popup, false);
check('a second column the rows do not carry is not written', 'titleAlso' in fragment.buildFragment({ kind: 'markers', label: 'P', popupTitleColumn: 'Name', popupTitleAlso: 'Gone' }, people, []).stanza.popup, false);
check('the same column twice is one column', 'titleAlso' in fragment.buildFragment({ kind: 'markers', label: 'P', popupTitleColumn: 'Name', popupTitleAlso: 'Name' }, people, []).stanza.popup, false);
check('a long column still names the pins — the map cuts it', fragment.buildFragment({ kind: 'markers', label: 'P', popupTitleColumn: 'Notes' }, people, []).stanza.label_text, { property: 'Notes' });
check('a layer whose rows hold no name leaves the pins bare', fragment.pinNamesFor([pt(0, { Name: '' }), pt(1, { Name: null })], { title: 'Name' }), undefined);

console.log('\n  changing it on a layer already on the atlas, and on both halves of a split file');
const SLUG = 'name-check';
const dir = path.join(DATA, 'private-datasets', SLUG);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Name check', layers: [] }));
const sq = (i) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[77 + i, 12], [77.5 + i, 12], [77.5 + i, 12.5], [77 + i, 12]]] }, properties: people[i].properties });
fs.writeFileSync(path.join(dir, 'user-areas.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [sq(0), sq(1), sq(2)] }));
fs.writeFileSync(path.join(dir, 'user-areas-points.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [people[3]] }));
fs.writeFileSync(path.join(dir, 'user-old.geojson'), JSON.stringify({ type: 'FeatureCollection', features: people }));
const layers = [
  { id: 'areas', type: 'fill', source: 'user-areas.geojson', label: 'Areas', userLayer: true, sameFileAs: 'areas-points', centreMarks: true,
    label_text: { property: 'Name', size: 12, color: '#33402B', haloColor: '#ffffff', haloWidth: 2, offset: [0, 1.1] },
    popup: { title: 'Name', fields: [{ label: 'Org', property: 'Org' }, { label: 'Notes', property: 'Notes' }] },
    spec: { kind: 'polygon', popupTitleColumn: 'Name', popupColumns: ['Org', 'Notes'] } },
  { id: 'areas-points', type: 'marker', source: 'user-areas-points.geojson', label: 'Areas · as points', userLayer: true, sameFileAs: 'areas',
    popup: { title: 'Name', fields: [{ label: 'Org', property: 'Org' }, { label: 'Notes', property: 'Notes' }] } },
  { id: 'old', type: 'marker', source: 'user-old.geojson', label: 'Old', userLayer: true,
    popup: { title: 'Name', fields: [{ label: 'Org', property: 'Org' }] }, hiddenKeys: ['pattern_2'] },
];
fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers }, null, 1));
const local = () => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8')).layers;
const by = (id) => local().find((l) => l.id === id);

const out = imports.relabelLayer(SLUG, 'areas', { titleColumn: 'Name', titleAlso: 'Org' });
check('the relabel answers with both', [out.titleColumn, out.titleAlso], ['Name', 'Org']);
check('the areas carry both', [by('areas').popup.title, by('areas').popup.titleAlso], ['Name', 'Org']);
check('and the spec the fix page reads', [by('areas').spec.popupTitleColumn, by('areas').spec.popupTitleAlso], ['Name', 'Org']);
check('the organisation is no longer a line on the card', by('areas').popup.fields.map((x) => x.property), ['Notes']);
check('the area\'s name on the map keeps its size and colour', by('areas').label_text, { property: 'Name', size: 12, color: '#33402B', haloColor: '#ffffff', haloWidth: 2, offset: [0, 1.1] });
// the route sets the twin as well; here the same call the route makes
imports.relabelLayer(SLUG, 'areas-points', { titleColumn: 'Name', titleAlso: 'Org' });
check('the twin of points carries both too', [by('areas-points').popup.title, by('areas-points').popup.titleAlso], ['Name', 'Org']);
check('and its pins now get the name beside them', by('areas-points').label_text, { property: 'Name' });
check('the route sends the naming to the other half',
  /if \(naming\.titleColumn !== undefined \|\| naming\.titleAlso !== undefined\) Object\.assign\(twin, naming\);/.test(server) &&
  /imports\.relabelLayer\(dataset, layer\.sameFileAs, twin\);/.test(server), true);
check('an invited editor may change it as before: naming is not "only hiding"', /&& typeof b\.titleAlso !== 'string'\s*\n\s*&& !Array\.isArray\(b\.cardColumns\);/.test(server), true);
check('the untouched layer is exactly as it was', by('old'), layers[2]);

const back = imports.relabelLayer(SLUG, 'areas', { titleAlso: '' });
check('an empty second column takes it off', ['titleAlso' in by('areas').popup, 'popupTitleAlso' in by('areas').spec, back.titleAlso], [false, false, '']);
imports.relabelLayer(SLUG, 'areas', { titleColumn: 'Org', titleAlso: 'Name' });
imports.relabelLayer(SLUG, 'areas', { titleColumn: 'Notes' });
check('a new first column starts with no second', [by('areas').popup.title, 'titleAlso' in by('areas').popup], ['Notes', false]);
check('and the map label follows it', by('areas').label_text.property, 'Notes');
imports.relabelLayer(SLUG, 'areas-points', { titleColumn: 'Org' });
check('a pin layer told to name by a column its rows do not have goes bare rather than wrong', 'label_text' in by('areas-points'), true);
imports.relabelLayer(SLUG, 'old', { titleColumn: 'Org' });
check('a pin layer whose chosen column is empty for some places still names the rest', by('old').label_text, { property: 'Org' });
check('a relabel that does not mention naming leaves it alone', (imports.relabelLayer(SLUG, 'old', { label: 'Older' }), [by('old').popup.title, by('old').label_text]), ['Org', { property: 'Org' }]);
check('the card list leaves both naming columns out', (imports.relabelLayer(SLUG, 'areas', { titleColumn: 'Name', titleAlso: 'Org', cardColumns: ['Name', 'Org', 'Notes'] }), by('areas').popup.fields.map((x) => x.property)), ['Notes']);

console.log('\n  the search index and the fix page see both');
check('a search hit is titled by both columns', /const alsoProp = \(stanza\.popup && stanza\.popup\.titleAlso\) \|\| '';/.test(server) && /\.filter\(Boolean\)\.join\(' · '\)/.test(server), true);
check('the apply schema accepts the second column', /popupTitleAlso: \{ type: Type\.STRING \},/.test(server), true);
check('a layer opened for editing hands the second column back', /popupTitleAlso: \(layer\.popup && layer\.popup\.titleAlso\) \|\| undefined,/.test(server), true);
check('the Add-data step is handed four real rows and the blank rows per column', /peekRows: \(session\.rows \|\| \[\]\)\.slice\(0, 4\)/.test(server) && /emptyRows: emptyRowsByColumn\(/.test(server), true);
check('and sends the second column', /popupTitleAlso: \(\$\("#s-poptitle"\)\.value && \$\("#s-poptitle2"\)\.value\) \|\| undefined,/.test(bench), true);
/* Seen on the dev server: a reading (no model key, so the rule-based path)
   handed the layer back with a guessed spec and the second column was gone.
   The model path and the shapes path already let the layer's own choices win;
   now the rule-based path does too. */
check('a layer handed back for a reading keeps its naming on every path',
  (server.match(/Object\.assign\(\{\}, (fresh|session\.spec|inference\.layer), (kept|session\.replacingSpec)\)/g) || []).length, 3);

check('search shows a renamed place at once: the naming columns are in its cache key',
  /const key = dir \+ '\|' \+ stanza\.source \+ '\|' \+ sig \+ '\|' \+\s*\(\(stanza\.popup && stanza\.popup\.title\) \|\| ''\) \+ '\|' \+ \(\(stanza\.popup && stanza\.popup\.titleAlso\) \|\| ''\)/.test(server), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
