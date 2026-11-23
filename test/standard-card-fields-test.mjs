/* Run me with: node test/run.mjs — or on my own with node.
 *
 * A plain spreadsheet in Standard (Mithun, 23 Nov 2026: "The setting tab is
 * not loading. Each place is not data except a navigate button"). Two faults,
 * both general — nothing here is keyed to an atlas or to a column's name:
 *
 *   1. The Standard/Insight card drew a place the LOKA way (photo,
 *      description, answers, address) and none of the layer's own card
 *      fields, so a spreadsheet with no `description` column showed its
 *      answers and Navigate and nothing of its own. The card now carries the
 *      layer's card fields, drawn by the ordinary card's ONE copy of the rules
 *      and markup (atlas.js cardFieldsHTML, handed over on the viewer api).
 *   2. The owner's Settings tab looked its layer up by mode.layer alone. A
 *      Standard mode is often kept without one (the story written after a
 *      reading: { name: "standard", story }), so the tab waited for ever.
 *      Which layer a mode reads is now one rule (insight-mode.js modeLayer),
 *      asked by the visitor's panel, the owner's Settings and the server; and
 *      the wait ends in words.
 *
 * The page's own functions are run, lifted out of their files by name, with
 * a stand-in page; the route runs on a throwaway server. The places are
 * test/fixtures/plain-sheet/atlas.json — made up, nobody's data. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LR = require(ROOT + '/atlas/label-rules.js');
globalThis.LokaLabelRules = LR;                       // as on the page: insight-mode.js asks the shared people/id rule
const IM = require(ROOT + '/atlas/insight-mode.js');
const SUM = await import(ROOT + '/api/lib/atlas/insight-summary.js');
const FX = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/plain-sheet/atlas.json', 'utf8'));
const atlasJs = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const imSrc = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');
const ownerModes = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
// a function of the page, by name, as it stands in its file; and a one-line statement
function lift(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const oneLine = src.slice(i, src.indexOf('\n', i));
  if (/\}\s*$/.test(oneLine) && oneLine.split('{').length === oneLine.split('}').length) return oneLine + '\n';
  return src.slice(i, src.indexOf('\n  }\n', i) + 5);
}
function line(src, re) { const m = src.match(re); if (!m) throw new Error('no line ' + re); return m[0] + '\n'; }
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = (s, re) => (s.match(re) || []).length;

/* ---------------- which layer does a mode read: one rule ---------------- */
console.log('\n  which layer a mode reads: one rule for the panel, the Settings tab and the server');
const P = FX.plain, K = FX.loka;
{
  const read = P.layer, bare = { id: 'notes', group: 'userdata', type: 'marker', userLayer: true, source: 'user-notes.geojson' };
  const areas = { id: 'wards', group: 'userdata', type: 'fill', userLayer: true, source: 'user-wards.geojson', keyLabels: { pattern_1: 'What is this ward like?' } };
  const base = { id: 'admin', group: 'base', type: 'fill' };
  check('the fixture is the reported shape: a Standard mode with a story and no `layer`', [P.mode.name, 'layer' in P.mode, !!P.mode.story], ['standard', false, true]);
  const PANEL = { pinsOnly: true };   // as the panel and the owner's Settings ask
  const second = { ...read, id: 'second' }, bare2 = { ...bare, id: 'notes-2' };
  const who = { id: 'who', group: 'userdata', type: 'marker', userLayer: true, keyLabels: { pattern_1: 'Who added this place?' }, keyColumns: { pattern_1: ['created_by'] } };
  const unanswered = { id: 'empty', group: 'userdata', type: 'marker', userLayer: true, keyLabels: { pattern_9: 'What is it made of?' } };
  const places = { featsOf: () => P.features };   // as the server asks: each layer's places to hand
  check('a mode with no `layer`: the first of the owner\'s marker layers that can be read', [IM.modeLayer(P.mode, [base, bare, areas, read]).id, IM.modeLayer({ name: 'standard' }, [read, bare], PANEL).id], ['recordings', 'recordings']);
  check('…a marker layer that can be read comes before an areas layer that can, whichever is first in the file', [IM.modeLayer(P.mode, [base, areas, read]).id, IM.modeLayer(P.mode, [base, areas, read], PANEL).id], ['recordings', 'recordings']);
  check('(a) an areas-only atlas: its areas are read (the server: story, settings); the panel, which draws pins, takes none and leaves the ordinary layer list',
    [IM.modeLayer(P.mode, [base, areas]).id, IM.modeLayer(P.mode, [base, areas], PANEL), IM.viewer({ name: 'standard' }, { esc, el: () => ({}) }).layers([base, areas])], ['wards', null, null]);
  check('…unless the mode itself names the areas layer: then the panel takes it, as it did before', IM.modeLayer({ layer: 'wards' }, [base, areas, read], PANEL).id, 'wards');
  check('(b) the first marker layer\'s questions are all about people, or (its places to hand) answered by no place: the next layer that can be read',
    [IM.modeLayer(P.mode, [who, read], PANEL).id, IM.modeLayer(P.mode, [who, read], places).id, IM.modeLayer(P.mode, [unanswered, read], places).id], ['recordings', 'recordings', 'recordings']);
  check('(c) the mode names a layer that has no questions left, and another can be read: the other; named among layers that can all be read: the named one',
    [IM.modeLayer({ layer: 'notes' }, [bare, read], PANEL).id, IM.modeLayer({ layer: 'notes' }, [bare, read], places).id, IM.modeLayer({ layer: 'second' }, [read, second], PANEL).id], ['recordings', 'recordings', 'second']);
  check('nothing can be read yet: the layer the mode names if the atlas has it, else the first of the owner\'s marker layers, for its plain keys',
    [IM.modeLayer({ layer: 'notes' }, [bare2, bare], PANEL).id, IM.modeLayer({ layer: 'gone' }, [bare2, bare], PANEL).id, IM.modeLayer(P.mode, [base, bare], PANEL).id, IM.modeLayer(P.mode, [base, areas, bare], PANEL).id], ['notes', 'notes-2', 'notes', 'notes']);
  check('a layer the atlas no longer has falls back to the rule; no layer of the owner\'s at all: none (null, never a guess)',
    [IM.modeLayer({ layer: 'gone' }, [bare, read]).id, IM.modeLayer(P.mode, [base]), IM.modeLayer(P.mode, []), IM.modeLayer(null, null)], ['recordings', null, null, null]);
  check('the visitor\'s panel asks the rule (viewer.layers), and looks nowhere else for its layer',
    [/srcLayer = modeLayer\(mode, list, \{ pinsOnly: true \}\);/.test(imSrc), /L\.id === mode\.layer/.test(imSrc.slice(imSrc.indexOf('function viewer(mode, api)')))], [true, false]);
  check('the owner\'s Settings asks the rule exactly as the panel does (insightStanza), on drawing and on a press; Explore\'s own look-up is left to Explore',
    [/function insightStanza\(mode\) \{[\s\S]{0,160}return IM\(\)\.modeLayer\(mode, \(M && M\.layers\) \|\| \[\], \{ pinsOnly: true \}\);/.test(ownerModes),
      count(ownerModes, /insightStanza\(mode\)/g), /function drawInsightShelf\(host\) \{[\s\S]*?exploreStanza/.test(lift(ownerModes, 'drawInsightShelf'))], [true, 3, false]);
  check('the server asks the rule too, handing it each layer\'s places (insightSource), and for the link preview\'s story photo: no rule of its own',
    [/const L = INSIGHT\.modeLayer\(mode, ownLayers\(local\), \{ own: \(\) => true, featsOf \}\);/.test(server),
      /const storyLayer = INSIGHT\.modeLayer\(mode, layers, \{ own: \(\) => true \}\);/.test(server), /insightSource\(inst, [a-z.]+, [a-z]+\.layer\)/i.test(server)], [true, true, false]);
}

/* ---------------- the card ---------------- */
console.log('\n  the place\'s card: its answers, then the layer\'s own card fields');
/* atlas.js's own card code, lifted by name: the one copy of the field rules
   (cardFieldsHTML) and what it leans on. Only the photo strip and the ⓘ
   button are stand-ins. */
const DATA = {};
const page = new Function('LokaLabelRules', 'esc', 'DATA',
  lift(atlasJs, 'unbrace') + lift(atlasJs, 'cellShown') + lift(atlasJs, 'unquotePiece') + lift(atlasJs, 'tagArr') + lift(atlasJs, 'safeArr') +
  lift(atlasJs, 'linksIn') + lift(atlasJs, 'colLabel') + lift(atlasJs, 'sourceLine') + lift(atlasJs, 'sourceHTML') + line(atlasJs, /  var LOKA_ORDER = .*/) + lift(atlasJs, 'lokaFields') +
  line(atlasJs, /  var UUID_RE = .*/) + lift(atlasJs, 'lokaShaped') + lift(atlasJs, 'isLoka') + line(atlasJs, /  var LOKA_TAG_PAGE = .*/) + lift(atlasJs, 'lokaLinkHTML') +
  'function labelInfoHTML(full) { return "<i>" + esc(full) + "</i>"; }\n' +
  'function shotsHTML(links) { return links && links.length ? \'<div class="pop-shots">\' + links.map(esc).join("|") + "</div>" : ""; }\n' +
  lift(atlasJs, 'cardFieldsHTML') +
  'return { cardFieldsHTML: cardFieldsHTML, sourceHTML: sourceHTML, isLoka: isLoka, lokaLinkHTML: lokaLinkHTML, cellShown: cellShown, linksIn: linksIn, shotsHTML: shotsHTML };')(LR, esc, DATA);
const NAV = '<a class="pop-nav">Navigate</a>';
function viewerFor(fx, mode, without) {
  DATA[fx.layer.id] = { features: fx.features };
  const api = { esc, el: () => ({}), data: (id) => DATA[id] || null, markers: () => [], locPinEl: () => ({}), setLayerVisible() {}, onPhone: () => false, colourDiscs() {},
    shotsHTML: page.shotsHTML, linksIn: page.linksIn, cellShown: page.cellShown, navLinkHTML: () => NAV, lokaLinkHTML: page.lokaLinkHTML,
    cardFieldsHTML: page.cardFieldsHTML, sourceHTML: page.sourceHTML, isLoka: page.isLoka };
  (without || []).forEach((k) => { delete api[k]; });
  const v = IM.viewer(JSON.parse(JSON.stringify(mode)), api);
  const X = v.layers([{ id: 'admin', group: 'base', type: 'fill' }, fx.layer]).filter((L) => L._ev)[0];
  v.ready();
  return { v, X, card: (i) => v.cardHTML(X, fx.features[i].properties, fx.features[i]) };
}
{
  const { X, card } = viewerFor(P, P.mode);
  check('the panel draws the layer the rule names, with no `layer` in the mode', X && X.id, 'recordings');
  const one = card(0), many = card(1), silent = card(2), noTags = card(7);
  const own = (h) => (h.match(/<div class="in-own">([\s\S]*?)<\/div>(?=<div class="pop-src">|<p class="ev-addr">|<a class="pop-nav">)/) || ['', ''])[1];
  check('a place carries its own data after its answers: plain columns as label and value, in the layer\'s order',
    [/<span class="pop-lbl">Habitat<\/span> <span class="pop-val">Farmland<\/span>/.test(own(one)), /<span class="pop-lbl">Animal groups<\/span> <span class="pop-val">Birds<\/span>/.test(own(one)),
      one.indexOf('class="in-answers"') < one.indexOf('class="in-own"'), own(one).indexOf('>Habitat<') < own(one).indexOf('>Animal groups<')], [true, true, true, true]);
  check('…in the ordinary card\'s own markup (the two-column list of facts), not a second copy: insight-mode.js writes none of that markup itself, and the ordinary card calls the same function',
    [/<div class="pop-facts"><div class="pop-field pop-field-inline">/.test(own(one)), /class=\\?"pop-(field|facts|tags|tag|lbl|val|src)\b/.test(imSrc),
      /h \+= cardFieldsHTML\(L, props, \{ loka: loka, skip: function \(prop\) \{ return !!keyCols\[prop\]; \} \}\);/.test(atlasJs), count(atlasJs, /class="pop-tag" data-tag=/g)], [true, false, true, 1]);
  check('tags stay buttons that filter the map, each naming its layer; the count stands as the heading',
    [count(own(one), /<button type="button" class="pop-tag" data-tag="[^"]+" data-layer="recordings"/g), /data-tag="Brown Hawk Owl"/.test(own(one)), /<span class="pop-lbl">Animals heard<\/span> <span class="pop-fold-n">1<\/span>/.test(own(one))], [2, true, true]);
  check('77 species on one place: all 77 are there, twice (names and scientific names), wrapped by the tag list\'s own css — none cut',
    [count(many, /class="pop-tag" data-tag="Songbird \d+"/g), count(many, /class="pop-tag" data-tag="Avis cantans \d+"/g), /<span class="pop-fold-n">77<\/span>/.test(many)], [77, 77, true]);
  check('…and Navigate still closes the card, after the Source line', [many.lastIndexOf('<div class="pop-src">Source · Recordings</div>' + NAV + '</div>') === many.length - ('<div class="pop-src">Source · Recordings</div>' + NAV + '</div>').length], [true]);
  check('a column a question was read from is still shown when it says more than the answer ("Maharashtra" under "Other states")',
    [/Other states/.test(many), /<span class="pop-lbl">State<\/span> <span class="pop-val">Maharashtra<\/span>/.test(own(many))], [true, true]);
  check('…and is not said twice when its cell is exactly the answer printed above ("Kerala")', [/<div class="in-an">[\s\S]*?Kerala<\/div>/.test(one), />State</.test(own(one))], [true, false]);
  check('an empty cell is no row, an empty tag list no heading', [/>Habitat</.test(own(many)), /Animals heard|Scientific names/.test(noTags), />Habitat</.test(own(noTags))], [false, false, true]);
  check('a place that answers no question still shows its own data',
    [/says too little to answer any of the questions/.test(silent), count(own(silent), /class="pop-tag" data-tag=/g), /<span class="pop-val">Birds<\/span>/.test(own(silent))], [true, 4, true]);
  const all = P.features.map((f, i) => card(i)).join('\n');
  check('the machinery\'s columns never show, though they are ticked for the card (pattern_N, pattern_N_why)', [/Pattern 1/.test(all), P.layer.popup.fields.some((f) => f.property === 'pattern_1_why')], [false, true]);
  check('columns about people or ids never show, though they are ticked: by name (Recorded by, Contact email) and by what the column holds (Ref: ids)',
    [/Recorded by|Recorder \d/.test(all), /Contact email|@example\.test/.test(all), />Ref<|a1b2\d{4}-c3d4/.test(all), LR.whyNotRead('ref', []), LR.whyNotRead('ref', P.features.map((f) => f.properties.ref))], [false, false, false, '', 'id']);
  check('the Source line is the ordinary card\'s (the layer\'s name; never who uploaded it when the layer is named)', [count(all, /<div class="pop-src">Source · Recordings<\/div>/g), /Owner|owner@/.test(all)], [P.features.length, false]);
}
{
  // a spreadsheet that has a description, an address and a photo column ticked for the card: said once each
  const fx = JSON.parse(JSON.stringify(P));
  fx.layer.popup.fields = [{ label: 'Description', property: 'description' }, { label: 'Address', property: 'address' }, { label: 'Picture', property: 'picture', type: 'image' },
    { label: 'Link', property: 'picture' }, { label: 'Habitat', property: 'habitat' }];
  fx.features.forEach((f, i) => Object.assign(f.properties, { description: 'A quiet corner number ' + i, address: 'Lane ' + i, picture: 'https://example.test/pics/' + i + '.jpg' }));
  const c = viewerFor(fx, fx.mode).card(0);
  check('what the card leads with is not said again: its photograph (an image field, or a cell that is only that link), its description, its address',
    [count(c, /class="pop-shots"/g), count(c, /A quiet corner number 0/g), count(c, /Lane 0/g), count(c, /example\.test\/pics\/0\.jpg/g), />Habitat</.test(c)], [1, 1, 1, 1, true]);
}
console.log('\n  a LOKA-shaped layer');
{
  const now = viewerFor(K, { name: 'standard' }), was = viewerFor(K, { name: 'standard' }, ['cardFieldsHTML', 'sourceHTML', 'isLoka']);
  check('the fixture is LOKA-shaped (every place a UUID tag_id, labels and a description), and each place has its page in LOKA', [page.isLoka(K.layer), /class="pop-loka" href="https:\/\/loka\.place\/t\//.test(now.card(0))], [true, true]);
  check('a place with no labels: its card is, to the letter, the card a page without these rows draws — photo, caption, answers, address, Navigate, the LOKA link',
    [now.card(1) === was.card(1), /^<div class="pop ev-card in-card"><div class="pop-title">Old bund<\/div><div class="pop-shots">[^<]+<\/div><p class="pop-caption">[^<]+<\/p><div class="in-answers">[\s\S]*<\/div><p class="ev-addr">Ferry Road 2, Goa<\/p><a class="pop-nav">Navigate<\/a><a class="pop-loka"[^>]*>See this place in LOKA<\/a><\/div>$/.test(now.card(1))], [true, true]);
  const withLabels = now.card(0);
  const block = (withLabels.match(/<div class="in-own">[\s\S]*?<\/div><\/div><\/div>(?=<p class="ev-addr">)/) || [''])[0];
  check('a place with labels gains them as tags, between its answers and its address — and that is all it gains',
    [withLabels.replace(block, '') === was.card(0), count(block, /class="pop-tag" data-tag="(ferry|water-crossing)" data-layer="tags"/g), count(block, /pop-field-inline/g)], [true, 2, 0]);
  const all = K.features.map((f, i) => now.card(i)).join('\n');
  check('never on it: who tagged the place or their id, when it was added, the photo or the address a second time, a Source line (its page in LOKA is its source)',
    [/Tagger \d|Created by/.test(all), /Created at|2026-11-0\dT/.test(all), count(all, /class="pop-shots"/g), count(all, /Ferry Road 1, Goa/g), /pop-src/.test(all)], [false, false, 3, 1, false]);
}
console.log('\n  the ordinary card draws from the same copy');
{
  DATA.recordings = { features: P.features };
  const p = P.features[0].properties;
  const plain = page.cardFieldsHTML(P.layer, p, { loka: false, skip: (col) => col === 'habitat' });
  check('a column its key rows said is left out (the caller\'s skip), the machinery\'s names never show, tags are buttons',
    [/>Habitat</.test(plain), /Pattern 1/.test(plain), />State</.test(plain), count(plain, /class="pop-tag" data-tag=/g)], [false, false, true, 2]);
  const named = page.cardFieldsHTML({ ...P.layer, popup: { fields: [{ label: 'Set', property: 'set' }, { label: 'State', property: 'state' }] } }, { ...p, set: 'Recordings' }, {});
  check('a cell that only repeats the Source line is left out, as before', [/>Set</.test(named), />State</.test(named)], [false, true]);
  check('Event and Explore cards are untouched: neither asks for these rows', [/cardFieldsHTML/.test(fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8')), /cardFieldsHTML/.test(fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8'))], [false, false]);
}

/* ---------------- the owner's Settings tab ---------------- */
console.log('\n  the owner\'s Settings tab: it finds its layer, and a wait ends in words');
{
  /* owner-modes.js's own functions, lifted by name, on a stand-in page: a
     host that keeps what is written into it, and a clock the check turns. */
  function tab(manifest, dataFor) {
    const timers = [];
    const host = { innerHTML: '', hidden: false, _btn: null,
      querySelector(sel) { return sel === '[data-places-again]' && /data-places-again/.test(this.innerHTML) ? (this._btn = this._btn || {}) : null; } };
    const window = { LokaAtlas: { manifest, dataFor }, LokaInsightMode: IM };
    const made = new Function('window', 'setTimeout', 'esc', 'wireInsightShelf', 'pollInsight',
      line(ownerModes, /  var INS = \{.*\};/) + line(ownerModes, /  var PLACES_TRIES = .*/) + line(ownerModes, /  var PLACES_LATE = .*/) + line(ownerModes, /  var NO_PLACES_LAYER = .*/) +
      lift(ownerModes, 'IM') + lift(ownerModes, 'insightMode') + lift(ownerModes, 'insightStanza') + lift(ownerModes, 'writtenWhen') + lift(ownerModes, 'waitForPlaces') + lift(ownerModes, 'drawInsightShelf') +
      'return { draw: drawInsightShelf, INS: INS, LATE: PLACES_LATE, NONE: NO_PLACES_LAYER, TRIES: PLACES_TRIES };')(window, (fn) => { timers.push(fn); }, esc, () => {}, () => {});
    // turn the clock until nothing is waiting (or far past any honest wait)
    const run = () => { let n = 0; while (timers.length && n < 500) { n++; timers.shift()(); } return n; };
    return { host, made, timers, run };
  }
  const manifest = () => ({ mode: JSON.parse(JSON.stringify(P.mode)), layers: [{ id: 'admin', group: 'base', type: 'fill' }, P.layer] });
  {
    const t = tab(manifest(), (id) => (id === 'recordings' ? { features: P.features } : null));
    t.made.draw(t.host);
    check('a Standard mode with no `layer`: the tab draws at once — the story switch, and each question with how many places answer it',
      [/Story of the place/.test(t.host.innerHTML), /Questions visitors see/.test(t.host.innerHTML), /Which state is this place in\?/.test(t.host.innerHTML), /What kind of habitat is this place\?/.test(t.host.innerHTML),
        /Answered for 11 of 12 places/.test(t.host.innerHTML), /Loading the places/.test(t.host.innerHTML), t.timers.length], [true, true, true, true, true, false, 0]);
  }
  {
    let there = false;
    const t = tab(manifest(), (id) => (there && id === 'recordings' ? { features: P.features } : null));
    t.made.draw(t.host);
    check('the places not there yet: the calm wait line, and it asks again', [/Loading the places…/.test(t.host.innerHTML), t.timers.length], [true, 1]);
    const asked = t.run();
    check('the places never arrive: after its tries the wait is over — plain words and "Try again", no wait line, nothing left ticking',
      [asked, t.host.innerHTML.indexOf(esc(t.made.LATE)) >= 0, /<button class="share-btn" type="button" data-places-again>Try again<\/button>/.test(t.host.innerHTML), /Loading the places|wait-mark/.test(t.host.innerHTML), t.timers.length],
      [t.made.TRIES, true, true, false, 0]);
    check('the words are plain: no "layer", "error", "timeout" or "null"', /layer|error|time.?out|null|undefined|failed/i.test(t.made.LATE + t.made.NONE), false);
    there = true;
    t.host.querySelector('[data-places-again]').onclick();
    check('"Try again", once the places are there: the settings', [/Questions visitors see/.test(t.host.innerHTML), /Try again/.test(t.host.innerHTML)], [true, false]);
  }
  {
    const t = tab({ mode: { name: 'standard' }, layers: [{ id: 'admin', group: 'base', type: 'fill' }] }, () => null);
    t.made.draw(t.host);
    check('no layer the settings could be about: said at once in words, never a wait', [t.host.innerHTML.indexOf(esc(t.made.NONE)) >= 0, /Loading the places|wait-mark/.test(t.host.innerHTML), t.timers.length], [true, false, 0]);
    check('…in words that are true of a map of areas too, which may be full of places: never "no places"', [/no places/i.test(t.made.NONE), /pins/.test(t.made.NONE)], [false, true]);
  }
  check('Explore\'s Buttons tab waits the same way: its wait ends in the same words', /if \(!feats\) \{ waitForPlaces\(host, BTN, drawButtonShelf\); return; \}/.test(ownerModes), true);
}

/* ---------------- the route, on a throwaway server ---------------- */
const PORT = 9100 + Math.floor(Math.random() * 90);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const SLUG = 'plain-sheet-' + TAG, TWOSLUG = 'plain-two-' + TAG;
const DATADIR = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-plain-sheet-check-'));
const DIR = path.join(DATADIR, 'private-datasets', SLUG), TWO = path.join(DATADIR, 'private-datasets', TWOSLUG);
const OWNER = 'owner@example.test';
// the story a reading left, kept for these same places (its fingerprint is theirs), so a saved setting need not write it again
const STORY = { ...P.mode.story, sig: SUM.storySig(IM.storyDigest(P.layer, P.features)) };
function seed(dir, layers, mode) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Plain sheet check', basemaps: [{ id: 'plain', label: 'Plain', default: true, type: 'raster', tiles: [] }], layers: [], groups: [] }));
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers, mode }));
  layers.forEach((L) => fs.writeFileSync(path.join(dir, L.source), JSON.stringify({ type: 'FeatureCollection', features: L.id === 'recordings' ? P.features : P.features.slice(0, 3) })));
}
seed(DIR, [P.layer], { name: 'standard', story: STORY });
// two layers of the owner's own: areas with questions first, then notes with none, then the places that were read
const AREAS = { id: 'wards', group: 'userdata', type: 'fill', userLayer: true, source: 'user-wards.geojson', label: 'Wards', keyLabels: P.layer.keyLabels, keyColumns: P.layer.keyColumns };
const NOTES = { id: 'notes', group: 'userdata', type: 'marker', userLayer: true, source: 'user-notes.geojson', label: 'Notes' };
seed(TWO, [AREAS, NOTES, P.layer], { name: 'standard', story: STORY });
/* Three atlases the server accepted before the rule was shared, and must
   still: (a) areas only; (b) two read marker layers, the first with a
   question no place answers; (c) a mode naming a layer whose questions are
   gone while another layer has them. Every layer's file here holds places
   that answer pattern_1 and pattern_2 and none that answers pattern_9. */
const UNANSWERED = { id: 'empty', group: 'userdata', type: 'marker', userLayer: true, source: 'user-empty.geojson', label: 'Empty', keyLabels: { pattern_9: 'What is it made of?' } };
const CASES = [
  ['a', 'plain-areas-' + TAG, [AREAS], { name: 'standard', story: STORY }, 'wards'],
  ['b', 'plain-unanswered-' + TAG, [UNANSWERED, P.layer], { name: 'standard', story: STORY }, 'recordings'],
  ['c', 'plain-named-' + TAG, [NOTES, P.layer], { name: 'standard', layer: 'notes', story: STORY }, 'recordings'],
];
CASES.forEach(([, slug, layers, mode]) => seed(path.join(DATADIR, 'private-datasets', slug), layers, mode));
const rec = (slug) => ({ slug, title: 'Plain sheet check', visibility: 'private', status: 'built', ownerAccount: OWNER, email: OWNER, tier: 'india', layers: [], tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [] });
const SLUGS = [SLUG, TWOSLUG].concat(CASES.map((c) => c[1]));
fs.writeFileSync(path.join(DATADIR, 'registry.json'), JSON.stringify({ instances: Object.fromEntries(SLUGS.map((s) => [s, rec(s)])),
  accounts: { [OWNER]: { email: OWNER, instances: SLUGS, verifiedAt: 1 } }, drafts: {} }));
let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  try { fs.rmSync(DATADIR, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATADIR, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_FAKE_READING: '1', NODE_ENV: 'test', ATLAS_OWNER_EMAILS: 'nobody@example.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) throw new Error('server did not start:\n' + out.slice(-800));
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function signIn(email) {
  const before = out.length;
  let r = await fetch(BASEURL + '/api/atlas/auth/request-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!r.ok) throw new Error('request-link ' + r.status);
  const t0 = Date.now();
  let code = null;
  while (!code) {
    const m = /Subject: (\d{6}) is your LOKA Atlas sign-in code/.exec(out.slice(before));
    if (m) code = m[1];
    else if (Date.now() - t0 > 5000) throw new Error('no code in the log');
    else await new Promise((r) => setTimeout(r, 50));
  }
  r = await fetch(BASEURL + '/api/atlas/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  if (!r.ok) throw new Error('verify-code ' + r.status);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function call(method, p, { cookie, body } = {}) {
  const r = await fetch(BASEURL + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const fileOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.local.json'), 'utf8'));
async function settled(dir) {
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const f = fileOf(dir);
    if (f.mode && !f.mode.summaryPending) return f;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fileOf(dir);
}
try {
  console.log('\n  saving a setting on such an atlas, on a throwaway server (' + BASEURL + ')');
  await startServer();
  const cookie = await signIn(OWNER);
  const M = (slug) => `/api/atlas/instances/${slug}/mode`;
  const before = fs.readFileSync(path.join(DIR, 'manifest.local.json'), 'utf8');
  const g = await call('GET', M(SLUG), { cookie });
  check('the owner is answered for a mode with no `layer`, and looking writes nothing (no file is migrated)',
    [g.status, g.j.name, g.j.canInsight, g.j.mode && 'layer' in g.j.mode, fs.readFileSync(path.join(DIR, 'manifest.local.json'), 'utf8') === before], [200, 'standard', true, false, true]);
  const set = await call('POST', M(SLUG), { cookie, body: { insight: { shown: { pattern_2: false } } } });
  let f = fileOf(DIR);
  check('a setting is saved: the question is off, the mode now names the layer the rule gave, and the story is still there, whole',
    [set.status, f.mode.name, f.mode.shown.pattern_2, f.mode.layer, f.mode.story, set.j.mode.story], [200, 'standard', false, 'recordings', STORY, STORY]);
  const ord = await call('POST', M(SLUG), { cookie, body: { insight: { order: ['pattern_2', 'pattern_1'] } } });
  f = fileOf(DIR);
  check('…and the order after it: saved, the switch and the story kept', [ord.status, f.mode.order, f.mode.shown.pattern_2, f.mode.story], [200, ['pattern_2', 'pattern_1'], false, STORY]);

  const set2 = await call('POST', M(TWOSLUG), { cookie, body: { insight: { summaryOn: true } } });
  f = fileOf(TWO);
  check('three layers, the mode naming none: the server reads the very layer the page draws (the rule\'s), not the first with questions',
    [set2.status, f.mode.layer, IM.modeLayer({ name: 'standard' }, f.layers).id, f.mode.story], [200, 'recordings', 'recordings', STORY]);
  // the story written again on an atlas whose mode names no layer: from then on the mode says which layer it was written from
  const bare = fileOf(TWO); delete bare.mode.layer;
  fs.writeFileSync(path.join(TWO, 'manifest.local.json'), JSON.stringify(bare));
  const again = await call('POST', M(TWOSLUG), { cookie, body: { rewriteSummary: true } });
  f = await settled(TWO);
  check('"Write it again" there: written from that same layer, and the mode says so from now on', [again.status, f.mode.layer, !!f.mode.story, f.mode.summaryPending], [200, 'recordings', true, undefined]);

  console.log('\n  atlases the server accepted before the rule was shared are accepted still');
  for (const [name, slug, , , want] of CASES) {
    const dir = path.join(DATADIR, 'private-datasets', slug);
    const can = await call('GET', M(slug), { cookie });
    const save = await call('POST', M(slug), { cookie, body: { insight: { summaryOn: true } } });
    const saved = fileOf(dir).mode;
    await settled(dir);                         // a story for a layer other than the seeded one's may be written after the save
    const refresh = await call('POST', M(slug), { cookie, body: { rewriteSummary: true } });
    const after = await settled(dir);
    check('(' + name + ') Insight can be chosen, a setting saves (200, not 409) with the layer stamped, and the story is refreshed from it — never "no questions"',
      [can.j.canInsight, save.status, saved.layer, !!saved.story, refresh.status, refresh.j.by !== 'no questions' && !!refresh.j.by, after.mode.layer, !!after.mode.story],
      [true, 200, want, true, 200, true, want, true]);
  }
} catch (e) {
  fail++;
  console.log('  FAIL the route checks stopped: ' + (e && e.message) + '\n' + out.slice(-1500));
}
cleanup();

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
