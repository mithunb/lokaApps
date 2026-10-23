/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* Event mode (atlas/event-mode.js), first used for a festival's atlas in
   October 2026: a festival guide drawn from an atlas's own places, switched
   on by `mode` in manifest.local.json. What these hold:
     - every venue's programme is read, all of it (the festival's data: 7
       venues, 36 sessions), and a programme that cannot be read with
       certainty is shown as written rather than lost;
     - each venue's card carries its whole programme, with day tabs and
       "All days";
     - nearby places from OpenStreetMap are within 400 m of a venue, at most
       8 to eat and drink per venue, and always credited;
     - an atlas with no mode is exactly as it was;
     - nothing in the code knows which festival it is.
   The fixtures are copies of the festival's public files as they stood on 22
   Oct 2026, the spreadsheet its places were exported from, and one answer
   from OpenStreetMap. No network. */

const EV = require(ROOT + '/atlas/event-mode.js');
const lib = await import(ROOT + '/deploy/event-mode-lib.mjs');
const FIX = ROOT + '/test/fixtures';
const SLUG = 'emergence-festival-of-future-cities';
const ATLAS = FIX + '/event-atlas/private-datasets/' + SLUG;
const cfg = lib.loadConfig(SLUG);
const mode = cfg.mode;
const readTags = () => JSON.parse(fs.readFileSync(ATLAS + '/user-tags.geojson', 'utf8'));
const exportTexts = lib.readFullTexts(FIX + '/event-tags-export.csv', cfg.programmeFrom);
const osm = JSON.parse(fs.readFileSync(FIX + '/event-osm.json', 'utf8'));
const viewerSrc = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  reading a programme');
const one = EV.parseProgramme('FESTIVAL · 29–31 Oct 2026\nFestival venue · 3 sessions\n\nALL THREE DAYS\n  Exhibition on Wetlands · Biopod+Co.\n\nFRI 30 OCT\n  19:30–21:30 Mixer: City Climate Stories · Asar\n  9:30-11:00 Opening Ceremony\n\nTimes and registration: example.org', mode.days);
check('a session: day, times, title, and who runs it after the last " · "', one.sessions[1], { day: '2026-10-30', start: '19:30', end: '21:30', title: 'Mixer: City Climate Stories', organiser: 'Asar' });
check('"ALL THREE DAYS" is a thing with no time that runs every day', one.sessions[0], { day: 'all', start: '', end: '', title: 'Exhibition on Wetlands', organiser: 'Biopod+Co.' });
check('a session with no organiser keeps its whole title; a single-digit hour is written 09:30', [one.sessions[2].title, one.sessions[2].organiser, one.sessions[2].start], ['Opening Ceremony', '', '09:30']);
check('the frame (the festival’s name, the count, where to register) is not a session', [one.sessions.length, one.ok], [3, true]);
check('a heading on a day that is not the festival’s is not trusted', EV.parseProgramme('SUN 2 NOV\n  10:00–11:00 Talk', mode.days).ok, false);
check('a line in a day that does not read as a session is not trusted', EV.parseProgramme('THU 29 OCT\n  some words', mode.days).ok, false);
check('a count that disagrees with the sessions found is not trusted (a text cut short)', EV.parseProgramme('Festival venue · 4 sessions\n\nTHU 29 OCT\n  10:00–11:00 Talk', mode.days).ok, false);
check('a place that is not a venue has no programme', EV.parseProgramme('FESTIVAL · 29–31 Oct 2026\nNot a venue. A short walk between sessions.', mode.days).sessions.length, 0);

console.log('\n  the festival’s venues and their programmes');
const cut = readTags();
const cutVenues = lib.deriveVenueFields(cut, cfg, mode);
const cutShort = cutVenues.filter((v) => v.programmeText).map((v) => v.name).sort();
check('the atlas holds only 500 characters of a cell: two long programmes arrive cut off', cutShort, ['Old Secretariat', 'Sunaparanta Goa Centre']);
check('…and a cut programme is kept whole as it stands (programme_text), never quietly shortened',
  cut.features.filter((f) => f.properties.programme_text).length, 2);
const tags = readTags();
const venues = lib.deriveVenueFields(tags, cfg, mode, exportTexts);
const byName = Object.fromEntries(venues.map((v) => [v.name, v.sessions]));
check('7 venues', venues.length, 7);
check('36 sessions, read from the export the places came from', venues.reduce((s, v) => s + v.sessions, 0), 36);
check('per venue', byName, { 'Taj Vivanta Miramar': 2, 'Dayanand Bandodkar Marg': 1, 'MDR2': 1, 'Kala Academy Cafeteria': 5, 'Goa State Central Library': 1, 'Old Secretariat': 16, 'Sunaparanta Goa Centre': 10 });
check('no programme left as text: every one read', tags.features.filter((f) => f.properties.programme_text).length, 0);
check('venue is true on the 7 and false on the other 17', [tags.features.filter((f) => f.properties.venue === true).length, tags.features.filter((f) => f.properties.venue === false).length], [7, 17]);
const merges = lib.applyMerges(tags, cfg.merges);
const kala = tags.features.find((f) => f.properties.loka_name === 'Kala Academy').properties;
const cafe = tags.features.find((f) => f.properties.loka_name === 'Kala Academy Cafeteria').properties;
check('the Cafeteria’s 5 sessions move onto Kala Academy, which becomes the venue (Mithun, 2026-10-22)', [kala.venue, EV.sessionsOf(kala).length], [true, 5]);
check('…and the Cafeteria leaves the guide, kept in the data', [cafe.venue, 'sessions' in cafe, cafe.merged_into, EV.placeCategory(cafe, mode)], [false, false, kala.tag_id, null]);
check('Kala Academy keeps its own photograph (it has one)', [kala.photo_urls === readTags().features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_urls, merges[0].photo], [true, 'its own']);
const nophoto = readTags();
nophoto.features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_urls = '';
nophoto.features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_1_url = '';
lib.deriveVenueFields(nophoto, cfg, mode, exportTexts);
lib.applyMerges(nophoto, cfg.merges);
check('a target with no photograph takes the source’s', nophoto.features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_urls, cafe.photo_urls);
check('still 7 venues after the merge (Kala Academy takes the Cafeteria’s place), still 36 sessions', [tags.features.filter((f) => EV.placeCategory(f.properties, mode) === 'venues').length,
  tags.features.reduce((s, f) => s + (EV.placeCategory(f.properties, mode) === 'venues' ? EV.sessionsOf(f.properties).length : 0), 0)], [7, 36]);
const again = JSON.parse(JSON.stringify(tags));
lib.deriveVenueFields(again, cfg, mode, exportTexts);
lib.applyMerges(again, cfg.merges);
check('the refresh does it again from the same fixes file: the same 7 venues', again.features.filter((f) => f.properties.venue).map((f) => f.properties.loka_name).sort(),
  tags.features.filter((f) => f.properties.venue).map((f) => f.properties.loka_name).sort());
const prefer = readTags();
lib.deriveVenueFields(prefer, cfg, mode, exportTexts);
lib.applyMerges(prefer, [Object.assign({}, cfg.merges[0], { photo: 'from' })]);
check('"photo": "from" takes the source’s photograph even over the target’s own', prefer.features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_urls, cafe.photo_urls);
check('a merge whose place is gone is reported, not guessed', lib.applyMerges(readTags(), [{ from: 'Nowhere', into: 'Kala Academy' }])[0].missing, 'Nowhere');
const fixes = lib.applyPinFixes(tags, cfg.placeFixes);
check('the Vivanta venue’s pin is at Vivanta Goa, Panaji (OpenStreetMap way 405337939)', tags.features.find((f) => f.properties.tag_id === cfg.placeFixes[0].tag_id).geometry.coordinates, [73.820275, 15.493958]);
check('…where it already stood: it moves less than a metre', fixes[0].moved < 1, true);
check('its programme text is left as written (it never said "if confirmed")',
  /if confirmed/i.test(tags.features.find((f) => f.properties.tag_id === cfg.placeFixes[0].tag_id).properties[cfg.programmeFrom]), false);

const viv = tags.features.find((f) => f.properties.tag_id === cfg.placeFixes[0].tag_id).properties;
check('the Vivanta venue is renamed Vivanta Goa, Panaji, with its Campal address', [viv.loka_name, /Campal/.test(viv.address), /Miramar/.test(viv.address)], ['Vivanta Goa, Panaji', true, false]);
const kalaFixed = tags.features.find((f) => f.properties.loka_name === 'Kala Academy').properties;
check('Kala Academy shows the Wikipedia photograph, with its credit, in place of the drawn marker',
  [kalaFixed.photo_file, /Wikimedia Commons/.test(kalaFixed.photo_credit), /^https:\/\/commons\.wikimedia\.org\//.test(kalaFixed.photo_credit_link), kalaFixed.photo_urls], ['kala-academy.jpg', true, true, '']);
check('…and the photograph is there to copy beside the atlas', !!lib.photoSrc(SLUG, 'kala-academy.jpg'), true);
check('a photo name the data route would refuse is not taken', [lib.photoSrc(SLUG, '../x.jpg'), lib.photoSrc(SLUG, 'x.svg')], [null, null]);
// in the scripts the fixes come first: a merge then keeps the photograph the fix gave
const order = readTags();
lib.deriveVenueFields(order, cfg, mode, exportTexts);
lib.applyPinFixes(order, cfg.placeFixes);
lib.applyMerges(order, cfg.merges);
check('fixes before the merge: Kala Academy keeps the Wikipedia photograph, not the Cafeteria’s', order.features.find((f) => f.properties.loka_name === 'Kala Academy').properties.photo_file, 'kala-academy.jpg');
// a merge adds to the target's sessions; one listed in both is kept once
const own = readTags();
lib.deriveVenueFields(own, cfg, mode, exportTexts);
const kOwn = own.features.find((f) => f.properties.loka_name === 'Kala Academy').properties;
const cOwn = own.features.find((f) => f.properties.loka_name === 'Kala Academy Cafeteria').properties;
kOwn.sessions = [{ day: '2026-10-30', start: '18:00', end: '19:00', title: 'A session of its own' }, Object.assign({}, cOwn.sessions[0])];
kOwn.venue = true;
lib.applyMerges(own, cfg.merges);
check('a merge adds the Cafeteria’s sessions to Kala Academy’s own (5 + 1 of its own, the shared one once)', kOwn.sessions.length, cOwn.sessions === undefined ? 6 : -1);
check('…its own session is still there', kOwn.sessions.some((x) => x.title === 'A session of its own'), true);

console.log('\n  the four categories');
const cats = {};
tags.features.forEach((f) => { const c = EV.placeCategory(f.properties, mode); cats[c] = (cats[c] || 0) + 1; });
check('Venues 7, See & Do 7, Essentials 9 from the places’ own words (Kala Academy is a venue now; the Cafeteria is out)', cats, { venues: 7, see: 7, utils: 9, null: 1 });
check('a place marked venue is a venue whatever its words', EV.placeCategory({ venue: true, categories: 'Services' }, mode), 'venues');
check('OpenStreetMap kinds: a café is Eat & Drink, a bus stop Utils, a bank nothing', [EV.osmCategory('cafe', mode), EV.osmCategory('bus_stop', mode), EV.osmCategory('bank', mode)], ['eat', 'utils', null]);

console.log('\n  nearby places from OpenStreetMap');
const vpts = tags.features.filter((f) => f.properties.venue).map((f) => ({ name: f.properties.loka_name, pt: f.geometry.coordinates }));
const around = lib.buildAround(vpts, osm, mode);
const feats = around.fc.features;
const nearest = (pt) => Math.min(...vpts.map((v) => EV.metres(v.pt, pt)));
check('every nearby place is within 400 m of a venue', feats.every((f) => nearest(f.geometry.coordinates) <= 400), true);
check('at most 8 to eat and drink per venue (Mithun, 2026-10-22)', around.perVenue.every((p) => p.eat <= 8), true);
check('…nearest first: no venue has a closer one left out', vpts.every((v, i) => {
  const kept = feats.filter((f) => f.properties.category === 'eat').map((f) => EV.metres(v.pt, f.geometry.coordinates)).filter((m) => m <= 400).sort((a, b) => a - b);
  const all = osm.elements.filter((e) => e.tags && e.tags.name && EV.osmCategory(e.tags.amenity, mode) === 'eat')
    .map((e) => EV.metres(v.pt, e.lon != null ? [e.lon, e.lat] : [e.center.lon, e.center.lat])).filter((m) => m <= 400).sort((a, b) => a - b);
  return kept.slice(0, around.perVenue[i].eat).every((m, k) => Math.abs(m - all[k]) < 0.01);
}), true);
check('every place to eat and drink has a name', feats.filter((f) => f.properties.category === 'eat').every((f) => !!f.properties.name), true);
check('toilets, pharmacies, ATMs, bus stops and taxi stands are all in, a nameless one called by its kind',
  feats.some((f) => f.properties.kind === 'toilets') && feats.filter((f) => f.properties.category === 'utils').every((f) => !!f.properties.name), true);
check('no banks (spec: skip banks)', feats.some((f) => f.properties.kind === 'bank'), false);
check('the file carries OpenStreetMap’s credit and licence', [/OpenStreetMap contributors/.test(around.fc.attribution), around.fc.license], [true, 'ODbL-1.0']);
check('no opening hours are written', feats.some((f) => 'opening_hours' in f.properties), false);
check('the query asks each venue on its own (one around per point; several points make a line)',
  (lib.overpassQuery(vpts.map((v) => v.pt), 400, lib.osmKinds(mode)).match(/around:400,/g) || []).length, 7 * 6);
check('…one line per OpenStreetMap key: amenity, highway (bus stops, as points), natural, tourism, leisure, historic',
  ['"amenity"', 'node["highway"', '"natural"~"^(beach)$"', '"tourism"', '"leisure"~"^(park|garden)$"', '"historic"'].every((k) => lib.overpassQuery([vpts[0].pt], 400, lib.osmKinds(mode)).includes(k)), true);

console.log('\n  See & Do');
const see = mode.categories.find((c) => c.id === 'see');
check('the chips read Venues · Eat & Drink · See & Do · Essentials', mode.categories.map((c) => c.label), ['Venues', 'Eat & Drink', 'See & Do', 'Essentials']);
check('What’s around here opens Eat & Drink by setting, not by the chips’ order', mode.aroundOpens, 'eat');
const grp = (name, description) => (EV.groupOf({ loka_name: name, description }, see, false) || {}).label;
check('the team’s places find their heading by the words of their name, not their description',
  [grp('Panjim city view point'), grp('Miramar Beach'), grp('National Museum of Customs'), grp('Mario de Miranda Gallery'), grp('Henry the Navigator Marker', 'A stone marker on the Campal promenade'), grp('Panaji Market')],
  ['Parks & views', 'Parks & views', 'Museums & galleries', 'Museums & galleries', 'Landmarks', 'Markets']);
check('a map place goes by its kind; a church is a landmark', ['park', 'beach', 'gallery', 'marketplace', 'place_of_worship', 'memorial'].map((k) => EV.groupOf({ kind: k }, see, true).label),
  ['Parks & views', 'Parks & views', 'Museums & galleries', 'Markets', 'Landmarks', 'Landmarks']);
console.log('\n  icons and the second row');
globalThis.window = globalThis.window || globalThis;
require(ROOT + '/atlas/iconkit.js');
const kit = globalThis.LokaIcons.ICONS;
const named = [];
mode.categories.forEach((c) => { named.push(c.icon); (c.groups || []).forEach((g) => named.push(g.icon)); });
check('every button has an icon, and every icon is in the icon kit', named.filter((n) => !n || !kit[n]), []);
const ess = mode.categories.find((c) => c.id === 'utils');
check('Essentials has its own second row: Toilets · Cash · Health · Transport · Other', ess.groups.map((g) => g.label), ['Toilets', 'Cash', 'Health', 'Transport', 'Other']);
const eg = (name) => (EV.groupOf({ loka_name: name }, ess, false) || {}).label;
check('the team’s Essentials find their row by name', [eg('HDFC Bank'), eg('CMM Hospital'), eg('Taj Medical Stores'), eg('Panjim KTC Bus Stand'), eg('Auto Stand'), eg('Patto Circle')],
  ['Cash', 'Health', 'Health', 'Transport', 'Transport', 'Other']);
const egd = (name, description) => (EV.groupOf({ loka_name: name, description }, ess, false) || {}).label;
check('a place named for its street or shop goes by the opening of its description (Mithun: these are toilets and a pharmacy)',
  [egd('Patto Circle', 'Public toilets at Patto Circle, on the east side of the city.'), egd('Dr TB Cunha Road', 'Public toilets on Dr T B Cunha Road in the city centre.'),
   egd('Rua Conde de Redondo', 'Public toilets on Rua Conde de Redondo in Mala.'), egd('Neha', 'Neha, a pharmacy on Rua 31 de Janeiro in Mala, Fontainhas.')],
  ['Toilets', 'Toilets', 'Toilets', 'Health']);
check('…but only up to where it starts saying where the place is: a marker on a promenade is not a park',
  (EV.groupOf({ loka_name: 'Henry the Navigator Marker', description: 'A stone marker to Henry the Navigator on the Campal promenade.' }, see, false) || {}).label, 'Landmarks');
check('bus stops say what they are: a bay letter, a route line, a stop named for its place',
  [lib.transportName('bus_stop', 'G'), lib.transportName('bus_stop', 'V: To St. Inez'), lib.transportName('bus_stop', 'Kala Academy'), lib.transportName('bus_stop', 'Panjim KTC Bus Stand'), lib.transportName('taxi', 'Auto Stand'), lib.transportName('taxi', 'Miramar')],
  ['Bus stop G', 'Bus stop V (to St. Inez)', 'Kala Academy bus stop', 'Panjim KTC Bus Stand', 'Auto Stand', 'Miramar taxi stand']);
check('…and the row under the name does not say "Bus stop" again', EV.wordOf({ kind: 'bus_stop' }) && /indexOf\(w\.toLowerCase\(\)\) >= 0/.test(fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8')), true);
const atlasSrc = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
check('a pin put away by the second row is hidden, and so is its name', [/!e\.away && !e\.subOff/.test(atlasSrc), /if \(e\.away \|\| e\.subOff\) return;/.test(atlasSrc)], [true, true]);
const evSrc = fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8');
check('choosing another category starts its second row at "All"', /function choose\(id\) \{\n.*\n\s*state\.sub = null;/.test(evSrc), true);

const V = [{ name: 'V', pt: [73.83, 15.50] }];
const at = (dLng) => ({ lon: 73.83 + dLng, lat: 15.50 });
const fake = { osm3s: {}, elements: [
  Object.assign({ type: 'node', id: 1, tags: { amenity: 'place_of_worship', religion: 'christian', name: 'Plain Chapel' } }, at(0.0005)),
  Object.assign({ type: 'node', id: 2, tags: { amenity: 'place_of_worship', religion: 'christian', name: 'Landmark Church', wikidata: 'Q1' } }, at(0.0006)),
  Object.assign({ type: 'node', id: 3, tags: { amenity: 'place_of_worship', religion: 'hindu', name: 'Old Temple', heritage: '2' } }, at(0.0007)),
  Object.assign({ type: 'node', id: 4, tags: { tourism: 'viewpoint', name: 'Hill View' } }, at(0.0008)),
  Object.assign({ type: 'node', id: 5, tags: { leisure: 'park', name: 'Riverside Park' } }, at(0.0009)),
  Object.assign({ type: 'node', id: 6, tags: { tourism: 'museum', name: 'City Museum Annexe' } }, at(0.0010)),
] };
const got = lib.buildAround(V, fake, mode, [{ name: 'City Museum', pt: [73.8301, 15.50], cat: 'see', group: see.groups[2] }]).fc.features.map((f) => f.properties);
check('churches and temples come in only when the data marks them notable (Wikipedia/Wikidata, heritage, a sight)', got.filter((p) => p.kind === 'place_of_worship').map((p) => p.name).sort(), ['Landmark Church', 'Old Temple']);
check('…and say Church or Temple, not "place of worship"', got.filter((p) => p.kind === 'place_of_worship').map((p) => EV.wordOf(p)).sort(), ['Church', 'Temple']);
check('a map place within 100 m of a team place under the same heading is the same place twice: left out', got.some((p) => p.name === 'City Museum Annexe'), false);
check('…a park and a viewpoint beside it still come in', ['Hill View', 'Riverside Park'].every((n) => got.some((p) => p.name === n)), true);

console.log('\n  each venue’s card');
const sess = (f) => EV.sessionsOf(f.properties);
let shown = 0;
const vfeats = tags.features.filter((f) => f.properties.venue);
vfeats.forEach((f) => {
  const html = EV.programmeHTML(f.properties, mode, '2026-10-22', esc);
  const all = html.split('data-ev-day="all"')[1] || '';
  const n = (all.match(/class="ev-s"/g) || []).length;
  shown += n;
  check(f.properties.loka_name + ': its whole programme under "All days" (' + sess(f).length + ')', n, sess(f).length);
});
check('36 sessions shown across the 7 cards', shown, 36);
const sun = vfeats.find((f) => f.properties.loka_name === 'Sunaparanta Goa Centre');
const tabsOf = (html) => (html.match(/data-ev-tab="[^"]+"[^>]*>[^<]+/g) || []).map((s) => s.replace(/.*>/, ''));
check('day tabs, then "All days"', tabsOf(EV.programmeHTML(sun.properties, mode, '2026-10-22', esc)), ['Thu 29', 'Fri 30', 'Sat 31', 'All days']);
check('before the festival the card opens on the first day the venue has something', EV.openingTab(sess(vfeats.find((f) => f.properties.loka_name === 'MDR2')), mode.days, '2026-10-22'), '2026-10-31');
check('during it, on today', EV.openingTab(sess(sun), mode.days, '2026-10-30'), '2026-10-30');
check('a thing that runs every day sits on each day too', (EV.programmeHTML(sun.properties, mode, '2026-10-22', esc).split('data-ev-day="2026-10-29"')[1].split('data-ev-day=')[0].match(/Exhibition on Wetlands/g) || []).length, 1);
check('a programme left as text is shown whole', /pre-line|ev-prog-text/.test(EV.programmeHTML({ programme_text: 'THU\n  a' }, mode, '2026-10-22', esc)), true);

console.log('\n  what’s around each venue');
const tagged = tags.features.filter((f) => ['see', 'utils'].includes(EV.placeCategory(f.properties, mode)));
const aroundCount = vpts.map((v) => [...feats, ...tagged].filter((f) => EV.metres(v.pt, f.geometry.coordinates) <= 400).length);
check('every venue has something around it', aroundCount.every((n) => n >= 1), true);

console.log('\n  the viewer');
const L = [{ id: 'admin', type: 'fill', source: 'admin.geojson' },
  { id: 'tags', type: 'marker', source: 'user-tags.geojson', userLayer: true, popup: { title: 'loka_name' }, label_text: { property: 'loka_name' }, contentHash: 'abc' }];
const api = { esc, el: () => ({}), data: () => null, markers: () => [], locPinEl: () => ({}), shotsHTML: () => '', linksIn: () => [], cellShown: (v) => String(v || ''), setLayerVisible() {}, onPhone: () => false };
const made = EV.viewer(Object.assign({ layer: 'tags' }, mode), api).layers(L.slice());
check('the venues’ layer becomes one layer per category, and two from OpenStreetMap', made.map((x) => x.id), ['admin', 'ev-venues', 'ev-eat-osm', 'ev-see', 'ev-see-osm', 'ev-utils', 'ev-utils-osm']);
check('only Venues is on at first', made.filter((x) => x._ev && x.default).map((x) => x.id), ['ev-venues']);
check('the OpenStreetMap layers carry the credit', made.filter((x) => x.osmPlaces).every((x) => x.credits && /OpenStreetMap/.test(x.credits[0].name)), true);
check('the venues are numbered most sessions first', made[1].rowsFrom(tags).features.map((f) => f._evNo + ' ' + f.properties.loka_name).slice(0, 3), ['1 Old Secretariat', '2 Sunaparanta Goa Centre', '3 Kala Academy']);
check('no layer to draw from: no guide, the atlas is left as it is', EV.viewer(mode, api).layers([L[0]]), null);
check('the mode is "event" or nothing', [EV.isOn({}), EV.isOn({ mode: { name: 'other' } }), EV.isOn({ mode: { name: 'event' } })], [false, false, true]);

console.log('\n  no mode, no change');
check('the mode reaches the viewer only from manifest.local.json, when it is there',
  /if \(local\.mode && typeof local\.mode === "object"\) manifest\.mode = local\.mode;/.test(viewerSrc), true);
check('the guide starts only when LokaEventMode says the mode is on', /if \(!window\.LokaEventMode \|\| !LokaEventMode\.isOn\(m\)\) return m;/.test(viewerSrc), true);
const srcLines = viewerSrc.split('\n');
const hooks = srcLines.map((l, i) => ({ l, prev: srcLines[i - 1] || '' })).filter((x) => /\bEV\.[a-zA-Z]/.test(x.l) && !/^\s*(\/\/|\*|\/\*)/.test(x.l));
check('every call into the guide is behind "if (EV)" or "EV &&"', hooks.length > 0 && hooks.every((x) => /if \(EV\)|EV &&/.test(x.l) || /if \(EV\) \{\s*$/.test(x.prev)), true);
check('the questions are hidden in Event mode, not deleted: initLayerKeys steps aside', /function initLayerKeys\(L\) \{\s*var H = keyHost\(L\);\s*if \(!H\.userLayer \|\| !hasPins\(L\)\) return;\s*\/\/[^\n]*\n\s*if \(EV\) return;/.test(viewerSrc), true);
check('event-mode.js loads before atlas.js', page.indexOf('src="./event-mode.js?v=dev"') > 0 && page.indexOf('src="./event-mode.js?v=dev"') < page.indexOf('src="./atlas.js?v=dev"'), true);
check('a rebuild keeps around.geojson', /\/\^around\\\.geojson\$\//.test(fs.readFileSync(ROOT + '/api/lib/atlas/jobs.js', 'utf8')), true);

console.log('\n  nothing knows which festival it is');
for (const f of ['atlas/event-mode.js', 'deploy/event-mode-lib.mjs', 'deploy/apply-event-mode.mjs', 'deploy/refresh-event-atlas.mjs']) {
  check(f + ' never names it', /emergence/i.test(fs.readFileSync(ROOT + '/' + f, 'utf8')), false);
}
check('atlas.js never checks for it either', viewerSrc.split('\n').some((l) => /emergence/i.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)), false);

console.log('\n  the commands');
const env = Object.assign({}, process.env, { LOKA_DATA_DIR: FIX + '/event-atlas', LOKA_PUBLIC_DATASETS: FIX + '/no-such-folder' });
const run = (script, args) => spawnSync(process.execPath, [ROOT + '/deploy/' + script, ...args], { encoding: 'utf8', env });
const before = fs.readFileSync(ATLAS + '/user-tags.geojson', 'utf8');
const dry = run('apply-event-mode.mjs', [SLUG, '--osm-file=' + FIX + '/event-osm.json', '--full-text=' + FIX + '/event-tags-export.csv']);
check('a dry run says what it would do', [dry.status, /DRY RUN/.test(dry.stdout), /sessions in all: 36/.test(dry.stdout)], [0, true, true]);
check('…and writes nothing', fs.readFileSync(ATLAS + '/user-tags.geojson', 'utf8') === before && !fs.existsSync(ATLAS + '/around.geojson'), true);
const dryCut = run('apply-event-mode.mjs', [SLUG, '--osm-file=' + FIX + '/event-osm.json']);
check('without the export, the dry run says which programmes are cut and how to give them whole', /holds only the first 500 characters; give --full-text/.test(dryCut.stdout), true);
const deoria = run('apply-event-mode.mjs', ['deoria-bioregion']);
check('deoria-bioregion is never touched', [deoria.status, /never touched/.test(deoria.stderr)], [1, true]);
const refresh = run('refresh-event-atlas.mjs', [SLUG, '--osm-file=' + FIX + '/event-osm.json']);
check('the refresh asks for an atlas already in Event mode', [refresh.status, /not in event mode yet/.test(refresh.stderr)], [1, true]);
check('both write only after pm2 says lokaApps is stopped (as apply-theme does)',
  /pm2 jlist/.test(fs.readFileSync(ROOT + '/deploy/event-mode-lib.mjs', 'utf8')) && /lokaApps is running: stop it first/.test(fs.readFileSync(ROOT + '/deploy/event-mode-lib.mjs', 'utf8')), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
