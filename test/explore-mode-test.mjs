/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Explore mode (atlas/explore-mode.js), first for Bengaluru on LOKA, October
 * 2026: a city's places by button and by what is near the middle of the map.
 * What these hold:
 *   - buttons are data: a place belongs to a button when one of its own words
 *     (split on ";", any case) is one of the button's words; several or none;
 *   - the map opens on the share of the places nearest their middle;
 *   - it is built from Event mode's pieces and Event mode is as it was;
 *   - "Around here" is ordered from the middle of the map, re-ordered when the
 *     map stops moving, each row with its small photo;
 *   - the switch-on script refuses deoria-bioregion and an atlas in Event mode.
 * The places are test/fixtures/blr.geojson (66 Bengaluru tags). No network. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const XM = require(ROOT + '/atlas/explore-mode.js');
const EV = require(ROOT + '/atlas/event-mode.js');
const cfg = JSON.parse(fs.readFileSync(ROOT + '/deploy/explores/bengaluru-on-loka.json', 'utf8'));
const mode = cfg.mode;
const blr = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/blr.geojson', 'utf8'));
const src = fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8');
const atlas = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  buttons are data');
check('the mode is "explore" or nothing', [XM.isOn({}), XM.isOn({ mode: { name: 'event' } }), XM.isOn({ mode: { name: 'explore' } })], [false, false, true]);
check('Bengaluru: Nature · Art & history · Things to do · Street life', mode.buttons.map((b) => b.label), ['Nature', 'Art & history', 'Things to do', 'Street life']);
check('Street life is Civic and Learning', mode.buttons[3].words, ['Civic', 'Learning']);
check('a place\'s words are split on ";", trimmed, any case', XM.placeButtons({ categories: ' culture ;NATURE' }, mode), ['nature', 'art']);
check('a place may belong to several buttons', XM.placeButtons({ categories: 'Civic; Nature; Social' }, mode), ['nature', 'do', 'street']);
check('…or to none ("Others")', XM.placeButtons({ categories: 'Others' }, mode), []);
check('the column is a setting (tagColumn)', XM.placeButtons({ kinds: 'Nature' }, Object.assign({}, mode, { tagColumn: 'kinds' })), ['nature']);
check('"Food and Drink" is one word, not split on its spaces', XM.placeButtons({ categories: 'Food and Drink' }, mode), ['do']);
const counts = XM.countButtons(blr.features, mode);
const byHand = (words) => blr.features.filter((f) => String(f.properties.categories || '').split(';').map((s) => s.trim().toLowerCase()).some((w) => words.map((x) => x.toLowerCase()).includes(w))).length;
check('the counts on 66 Bengaluru tags agree with a count by hand', mode.buttons.map((b) => counts[b.id]), mode.buttons.map((b) => byHand(b.words)));
check('…and every place without a button is counted as such', counts.none, blr.features.filter((f) => !XM.placeButtons(f.properties, mode).length).length);
globalThis.window = globalThis.window || globalThis;
require(ROOT + '/atlas/iconkit.js');
const kit = globalThis.LokaIcons && globalThis.LokaIcons.ICONS;
check('every button has an icon from the icon kit', mode.buttons.filter((b) => !kit || !kit[b.icon]).map((b) => b.id), []);
check('no second row, no OpenStreetMap, no walks in the settings', ['groups', 'around', 'osm', 'walks'].filter((k) => JSON.stringify(mode).includes('"' + k + '"')), []);

console.log('\n  the opening view');
const pts = blr.features.map((f) => f.geometry.coordinates);
const box = XM.frameBox(pts, 0.8);
const inBox = (p, b) => p[0] >= b[0][0] && p[0] <= b[1][0] && p[1] >= b[0][1] && p[1] <= b[1][1];
check('the box holds at least 80% of the places', pts.filter((p) => inBox(p, box)).length >= Math.ceil(pts.length * 0.8), true);
const all = XM.frameBox(pts, 1);
check('…and is no bigger than the box of them all', box[0][0] >= all[0][0] && box[0][1] >= all[0][1] && box[1][0] <= all[1][0] && box[1][1] <= all[1][1], true);
check('the same places give the same box, in any order', JSON.stringify(XM.frameBox(pts.slice().reverse(), 0.8)) === JSON.stringify(box), true);
const far = pts.concat([[76.65, 12.30]]);   // one place tagged on a trip to Mysuru
check('one far place does not move the box', JSON.stringify(XM.frameBox(far, 0.8)[0][0] > 77), 'true');
check('the share is a setting (frameShare), 0.8 when not given', [mode.frameShare, JSON.stringify(XM.frameBox(pts)) === JSON.stringify(box)], [0.8, true]);
check('no places, no box; one place, its own point', [XM.frameBox([], 0.8), XM.frameBox([[77.6, 12.9]], 0.8)], [null, [[77.6, 12.9], [77.6, 12.9]]]);
const vapi = { esc: String, el: () => ({}), data: () => null, markers: () => [], locPinEl: () => ({}), onPhone: () => false };
check('the explore viewer hands atlas.js the 80% box; an event guide hands none, so it frames as before',
  [JSON.stringify(XM.viewer(mode, vapi).frameBox(pts)) === JSON.stringify(box), typeof EV.viewer({ layer: 'x', categories: [] }, vapi).frameBox], [true, 'undefined']);
check('…and atlas.js asks for it only behind "EV &&"', /var most = EV && EV\.frameBox \? EV\.frameBox\(pts\) : null;/.test(atlas), true);

console.log('\n  the viewer');
const L = [{ id: 'admin', type: 'fill', source: 'admin.geojson' },
  { id: 'bengaluru-tags', type: 'marker', source: 'user-bengaluru-tags.geojson', userLayer: true, popup: { title: 'loka_name' }, label_text: { property: 'loka_name' }, markerBy: '_category' }];
const api = { esc: (s) => String(s), el: () => ({}), data: () => null, markers: () => [], locPinEl: (c, i) => ({ c, i }), shotsHTML: () => '', linksIn: () => [], cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false };
const v = XM.viewer(mode, api);
const made = v.layers(L.slice());
check('the places stay one layer, under the same id, marked for the mode', made.map((x) => [x.id, !!x._ev]), [['admin', false], ['bengaluru-tags', true]]);
check('…the manifest\'s own layer object is left as it was', !!L[1]._ev, false);
const gj = made[1].rowsFrom(JSON.parse(JSON.stringify(blr)));
check('a pin wears its first button\'s colour and icon', v.pinEl(made[1], { _exB: ['art', 'street'] }), { c: '#C9402B', i: 'landmark' });
check('a place with no button gets the plain pin', v.pinEl(made[1], { _exB: [] }).i, null);
check('every place is kept (rowsFrom adds, never filters)', gj.features.length, blr.features.length);
check('no layer to draw from: no mode', XM.viewer(mode, api).layers([L[0]]), null);
check('the list is "Around here", nearest the middle of the map first', /label: "Around here"/.test(src) && /metres\(mid, e\.f\.geometry\.coordinates\)/.test(src) && /, nearest the middle of the map first\./.test(src), true);
check('"Around here" is said once: the panel\'s head, not again over the list (Fable, 24 Oct)', /"ev-h", esc\("Around here/.test(src), false);
check('a small photo that will not load gives way to the place\'s mark; no button, a plain pin mark', /img\.addEventListener\("error"/.test(src) && /NO_BUTTON_ICON = "pin"/.test(src) && !!kit.pin, true);
check('a phone: the "Tap a pin" line sits above the credit, which sits above the buttons', /\.atlas-stage\.ex-on \.atlas-cue\{bottom:calc\(var\(--sheet-h,0px\) \+ 112px\)\}/.test(src), true);
check('…re-ordered when the map stops moving (once, a moment after)', /api\.onMoveEnd\(function \(\) \{\s*clearTimeout\(moveTimer\);\s*moveTimer = setTimeout/.test(src), true);
check('each row says how far in plain words (Event mode\'s distanceWords)', /distanceWords = EVM\.distanceWords/.test(src) && /d\.textContent = mid \? distanceWords\(r\.m\)/.test(src), true);
check('a row shows the small photo through the data address (like photo_file); none, the button\'s icon — never the full photo',
  /p\.photo_small && api\.dataUrl/.test(src) && /api\.dataUrl\(String\(p\.photo_small\)\)/.test(src) && !/rowOf[\s\S]{0,600}photo_1_url/.test(src), true);
check('the card keeps the full photograph', /function photoHTML\(props\) \{\s*if \(!props\.photo_file[^\n]*photo_1_url/.test(src), true);
check('the card has "What’s around here" and "See this place in LOKA"', /What’s around here/.test(src) && /api\.lokaLinkHTML\(srcLayer \|\| L, props\)/.test(src), true);
check('"What’s around here" centres the map on the place (no OpenStreetMap)', /api\.centreOn\(f\.geometry\.coordinates\)/.test(src) && !/overpass|osm/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), true);
check('one button at a time; the chosen one again shows every place', /state\.chosen = state\.chosen === c\.id \? null : c\.id;/.test(src), true);
check('no "All" button', /label: "All"/.test(src), false);
check('it reuses Event mode\'s look: the same chips, rows and phone layout', /EVM\.injectStyle\(doc\)/.test(src) && /el\("div", "ev-chips"\)/.test(src) && /stage\.classList\.add\("ev-on"\)/.test(src), true);

console.log('\n  wired into the page; Event mode as it was');
check('explore-mode.js loads after event-mode.js and before atlas.js',
  page.indexOf('event-mode.js?v=dev') < page.indexOf('explore-mode.js?v=dev') && page.indexOf('explore-mode.js?v=dev') < page.indexOf('src="./atlas.js?v=dev"'), true);
check('atlas.js starts it only when LokaExploreMode says the mode is on', /if \(window\.LokaExploreMode && LokaExploreMode\.isOn\(m\)\) \{/.test(atlas), true);
check('"Where am I" comes with any mode (the same EV line)', /if \(EV && window\.LokaLocate\) map\.addControl/.test(atlas), true);
check('the page gives the mode the middle of the map, its moveend, and a move to one place', /center: function \(\) \{[\s\S]{0,200}?var box = map\.getContainer\(\), pad = viewPadding\(\);/.test(atlas) && /onMoveEnd: function \(fn\)/.test(atlas) && /centreOn: function \(pt\)/.test(atlas), true);
check('event-mode.js only gained two exports', Object.keys(EV), ['isOn', 'parseProgramme', 'placeCategory', 'osmCategory', 'isVenue', 'sessionsOf', 'venueOrder', 'programmeHTML', 'openingTab', 'dayLabel', 'todayIn', 'metres', 'distanceWords', 'kindWord', 'wordOf', 'groupOf', 'KIND_WORDS', 'viewer', 'injectStyle', 'iconSvg']);
check('nothing here knows which city it is', ['atlas/explore-mode.js', 'deploy/apply-explore-mode.mjs', 'deploy/make-small-photos.mjs'].filter((f) => /bengaluru/i.test(fs.readFileSync(ROOT + '/' + f, 'utf8'))), []);

console.log('\n  switching it on');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-explore-'));
const pub = path.join(tmp, 'datasets');
const A = path.join(pub, 'explore-test-copy');
fs.mkdirSync(A, { recursive: true });
fs.writeFileSync(A + '/manifest.json', JSON.stringify({ id: 'bengaluru-on-loka', layers: [] }));
const local = { layers: [{ id: 'bengaluru-tags', group: 'userdata', source: 'user-bengaluru-tags.geojson', userLayer: true, type: 'marker' }] };
fs.writeFileSync(A + '/manifest.local.json', JSON.stringify(local));
fs.writeFileSync(A + '/user-bengaluru-tags.geojson', JSON.stringify(blr));
const env = Object.assign({}, process.env, { LOKA_DATA_DIR: tmp, LOKA_PUBLIC_DATASETS: pub });
const run = (args) => spawnSync(process.execPath, [ROOT + '/deploy/apply-explore-mode.mjs', ...args], { encoding: 'utf8', env });
const dry = run(['explore-test-copy']);
check('a dry run finds the settings by the id the copy carries, and counts the buttons', [dry.status, /DRY RUN/.test(dry.stdout), /deploy\/explores\/bengaluru-on-loka\.json/.test(dry.stdout), new RegExp('\\s' + counts.nature + '  Nature').test(dry.stdout)], [0, true, true, true]);
check('…and writes nothing', JSON.parse(fs.readFileSync(A + '/manifest.local.json', 'utf8')).mode, undefined);
const wet = run(['explore-test-copy', '--apply', '--server-is-stopped']);
const after = JSON.parse(fs.readFileSync(A + '/manifest.local.json', 'utf8'));
check('--apply writes the mode into manifest.local.json, with a backup', [wet.status, after.mode && after.mode.name, after.mode && after.mode.buttons.length, fs.readdirSync(path.join(tmp, 'backups')).some((d) => /^explore-explore-test-copy-/.test(d))], [0, 'explore', 4, true]);
check('…and leaves the layers as they were', after.layers, local.layers);
fs.writeFileSync(A + '/manifest.local.json', JSON.stringify(Object.assign({}, local, { mode: { name: 'event' } })));
const ev = run(['explore-test-copy', '--apply', '--server-is-stopped']);
const evAfter = JSON.parse(fs.readFileSync(A + '/manifest.local.json', 'utf8'));
check('an atlas in Event mode: the event settings are put aside in modeKept, never overwritten', [ev.status, evAfter.mode && evAfter.mode.name, evAfter.modeKept], [0, 'explore', { event: { name: 'event' } }]);
const deo = run(['deoria-bioregion']);
check('deoria-bioregion is never touched', [deo.status, /never touched/.test(deo.stderr)], [1, true]);
fs.writeFileSync(A + '/manifest.local.json', JSON.stringify(Object.assign({}, local, { mode: after.mode })));
const refresh = spawnSync(process.execPath, [ROOT + '/deploy/refresh-event-atlas.mjs', 'explore-test-copy', '--apply', '--server-is-stopped', '--keep-osm'], { encoding: 'utf8', env });
check('the event refresh refuses an explore atlas, and leaves it as it was', [refresh.status, /^Stopped: /m.test(refresh.stderr), JSON.parse(fs.readFileSync(A + '/manifest.local.json', 'utf8')).mode.name], [1, true, 'explore']);
fs.writeFileSync(A + '/manifest.local.json', JSON.stringify({ layers: [{ id: 'bengaluru-tags', group: 'userdata', source: '../outside.geojson' }] }));
fs.writeFileSync(path.join(pub, 'outside.geojson'), JSON.stringify(blr));
const out = run(['explore-test-copy']);
check('a layer whose file name points out of the atlas\'s folder is not read', [out.status, /could not find a layer/.test(out.stderr)], [1, true]);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
