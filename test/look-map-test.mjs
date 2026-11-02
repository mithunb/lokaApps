/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* From a website's colours to an atlas's look (atlas/look-map.js), one rule
   for every site (docs/design-style-from-website.md §4). What these hold:
   each row of the mapping table with a hand-made palette; a dark page stays
   light; a brand colour too light for links becomes the pale shading; the
   ring round a chosen place is the site's warm colour unless it is one of
   the map's own key colours; an accent that would vanish into the water is
   darkened; titles never take a face; the map's colour lists are one list
   (atlas/map-colours.js) read by the viewer and the server alike. No network. */

const LM = require(ROOT + '/atlas/look-map.js');
const T = require(ROOT + '/atlas/theme.js');
const MC = require(ROOT + '/atlas/map-colours.js');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const c = (hex, weight, roles, extra) => Object.assign({ hex, weight, roles: roles || [], usedFor: '', bg: 0 }, extra || {});

console.log('\n  the mapping table, row by row');
const plain = LM.map({
  colours: [c('#1E5AA8', 40, ['link', 'button'], { bg: 10 }), c('#E04A2F', 12, []), c('#F2C94C', 9, [], { bg: 9 })],
  page: '#FFFFFF', text: '#1A1A1A', corners: 'square', logo: { width: 800, height: 120 },
});
check('page: the site’s light page', plain.theme.colors.page, '#FFFFFF');
check('surface: white when the page is off-white', plain.theme.colors.surface, '#FFFFFF');
check('text: the site’s near-black words', plain.theme.colors.text, '#1A1A1A');
check('textSecondary: the words mixed 22% toward the page', plain.theme.colors.textSecondary, T.over('#1A1A1A', '#FFFFFF', 0.22));
check('textMuted: 38%', plain.theme.colors.textMuted, T.over('#1A1A1A', '#FFFFFF', 0.38));
check('accent: the heaviest colour the site gives its links and buttons', plain.theme.colors.accent, '#1E5AA8');
check('accentDeep: the accent darkened 30%', plain.theme.colors.accentDeep, T.darken('#1E5AA8', 0.30));
check('highlight: the site’s warm strong colour, as the ring', plain.theme.colors.highlight, '#E04A2F');
check('highlightDeep: darkened by the guard until words read (4.5 to 1)', T.contrast(plain.theme.colors.highlightDeep, '#FFFFFF') >= 4.5, true);
check('and that change is said in plain words', plain.lines.some((l) => /Darkened the site’s red a little so warning words stay readable|Darkened the site's red a little so warning words stay readable/.test(l)), true);
check('surfaceAlt: the site’s big light colour (painted as a background) at 10% over the surface', plain.theme.colors.surfaceAlt, T.over('#FFFFFF', '#F2C94C', 0.10));
check('corners: square when the site’s buttons are', plain.theme.corners, 'square');
check('a wide wordmark (800 × 120) may be 180 wide', plain.theme.logoMaxWidth, 180);
check('a square mark 120, in between 150', [LM.map({ colours: [], logo: { width: 200, height: 200 } }).theme.logoMaxWidth, LM.map({ colours: [], logo: { width: 300, height: 150 } }).theme.logoMaxWidth], [120, 150]);
check('the block says its shape (version 1)', plain.theme.version, 1);
check('titles never take a face: no fonts at all in the output', plain.theme.fonts, undefined);
check('every colour is a colour the guard would accept as given', T.resolve(plain.theme).notes, []);
check('each slot says which of the site’s colours it came from, in plain words', [plain.from.accent.name, plain.from.highlight.name, plain.from.surfaceAlt.name], ['blue', 'red', 'yellow']);
check('with no shading colour, the accent at 10% is the shading', LM.map({ colours: [c('#1E5AA8', 40, ['link'])], page: '#FFFFFF' }).theme.colors.surfaceAlt, T.over('#FFFFFF', '#1E5AA8', 0.10));

console.log('\n  a dark page stays light');
const dark = LM.map({ colours: [c('#F2C94C', 30, ['link']), c('#2B6CB0', 20, ['button'])], page: '#111111', text: '#FAFAFA' });
check('the page is white tinted 3% toward the accent (the yellow is too light to be it), not the site’s dark', dark.theme.colors.page, T.over('#FFFFFF', dark.theme.colors.accent, 0.03));
check('the site’s light words are not used on it', dark.theme.colors.text, undefined);
check('both are said under “what we left out”', dark.leftOut.filter((l) => /dark page|reads too faintly/.test(l)).length, 2);
check('and theme.js would not refuse anything in it', T.resolve(dark.theme).notes.filter((n) => /too dark/.test(n)), []);

console.log('\n  a brand colour too light for links');
const light = LM.map({ colours: [c('#1DC254', 50, ['link', 'button'], { bg: 20 }), c('#6B1164', 30, ['link'])], page: '#FFFFFF', text: '#060606' });
check('is not darkened into something the site never used: the next candidate is the accent', light.theme.colors.accent, '#6B1164');
check('it becomes the pale shading instead', light.theme.colors.surfaceAlt, T.over('#FFFFFF', '#1DC254', 0.10));
check('and the sheet is told so', light.lines.some((l) => /too light for links and buttons, so it is used as a pale shading/.test(l)), true);
const onlyLight = LM.map({ colours: [c('#1DC254', 50, ['link'])], page: '#FFFFFF' });
check('with no deeper colour, LOKA’s green stays (no accent set)', onlyLight.theme.colors.accent, undefined);
check('and that is said', onlyLight.leftOut.some((l) => /LOKA’s green is kept|LOKA's green is kept/.test(l)), true);

console.log('\n  the two map rules');
const magenta = LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#AA4499', 20, [])], page: '#FFFFFF' });
check('a site colour that is one of the map’s own key colours is not the ring', magenta.theme.colors.highlight, undefined);
check('and the note says why', magenta.leftOut.some((l) => /is one of the map’s own, so the ring round a chosen place keeps LOKA’s|is one of the map's own, so the ring round a chosen place keeps LOKA's/.test(l)), true);
const keyish = MC.keyColours().filter((k) => !LM.isNeutral(k));
check('the rule reads the key colours from map-colours.js (the answers), not a copy', keyish.every((k) => LM.map({ colours: [c('#1E5AA8', 40, ['link']), c(k, 20, [])], page: '#FFFFFF' }).theme.colors.highlight === undefined), true);
check('the grey “other” has no hue to clash with, so a red ring is not refused for it', LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#FC3103', 20, [])], page: '#FFFFFF' }).theme.colors.highlight, '#FC3103');
const water = LM.map({ colours: [c(MC.BASE_WARM.waterway, 40, ['link'])], page: '#FFFFFF' });
check('an accent the colour of the water is darkened 15% first, so a pressed button over the map does not vanish', water.theme.colors.accent, T.darken(MC.BASE_WARM.waterway, 0.15));
check('and that is said', water.lines.some((l) => /stand out from the map’s own greens and blues|stand out from the map's own greens and blues/.test(l)), true);
check('the ring must be at least 40° of hue from the accent: a second blue is not the ring', LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#2A7FD0', 20, [])], page: '#FFFFFF' }).theme.colors.highlight, undefined);
check('a warm colour that is not saturated enough is passed over for a saturated cool one', LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#C9A58A', 20, []), c('#7B2CBF', 15, [])], page: '#FFFFFF' }).theme.colors.highlight, '#7B2CBF');

console.log('\n  the owner’s own swaps');
const swapped = LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#E04A2F', 12, []), c('#1B5E20', 10, [])], page: '#FFFFFF', text: '#1A1A1A', chosen: { accent: '#1B5E20' } });
check('a slot chosen from the found list wins over the rule', swapped.theme.colors.accent, '#1B5E20');
check('its deep shade follows', swapped.theme.colors.accentDeep, T.darken('#1B5E20', 0.30));
check('and the tile says “chosen by you”', swapped.from.accent.why, 'chosen by you');
const badSwap = LM.map({ colours: [c('#1E5AA8', 40, ['link'])], page: '#FFFFFF', chosen: { page: '#111111' } });
check('a dark page chosen by hand is refused, with a line', [badSwap.theme.colors.page, badSwap.lines.some((l) => /too dark for a page/.test(l))], ['#FFFFFF', true]);
check('a slot that is not a slot, or a colour that is not a colour, is ignored', LM.map({ colours: [], page: '#FFFFFF', chosen: { fonts: '#111111', accent: 'red; x' } }).theme.colors.accent, undefined);

console.log('\n  idempotence and robustness');
const once = LM.map({ colours: [c('#1E5AA8', 40, ['link']), c('#E04A2F', 12, [])], page: '#FFFFFF', text: '#1A1A1A' }).theme;
const again = LM.map({ colours: [c(once.colors.accent, 40, ['link']), c(once.colors.highlight, 12, [])], page: once.colors.page, text: once.colors.text }).theme;
check('mapping a theme’s own colours gives the same theme', again.colors, once.colors);
check('nothing in: a theme with no colours and no notes', LM.map(null), { theme: { version: 1, colors: {} }, lines: [], leftOut: [], from: {} });
check('rubbish in: not a colour, not a list', LM.map({ colours: 'x', page: 'blue', text: 7 }).theme.colors, {});
check('near-white and near-black are neutral (HSL calls #FFFDFD fully saturated)', [LM.isNeutral('#FFFDFD'), LM.isNeutral('#060606'), LM.isNeutral('#808080'), LM.isNeutral('#6B1164')], [true, true, true, false]);
check('a plain name for a colour', ['#6B1164', '#FC3103', '#1DC254', '#1E5AA8', '#F2C94C', '#FFFFFF', '#060606', '#808080', '#111B13', '#C97A06'].map(LM.colourName), ['purple', 'red', 'green', 'blue', 'yellow', 'white', 'black', 'grey', 'black', 'orange']);
check('ΔE: the same colour is 0, a near one small, far ones large', [LM.deltaE('#6B1164', '#6B1164'), LM.deltaE('#E8F7EC', '#E8F9EE') < 3, LM.deltaE('#6B1164', '#1DC254') > 50], [0, true, true]);

console.log('\n  the map’s colours are one list');
check('the viewer reads its key colours from map-colours.js', /var MAP_COLOURS = window\.LokaMapColours;\n\s*var KEY_COLORS = MAP_COLOURS\.KEY_COLORS;\n\s*var KEY_OTHER = MAP_COLOURS\.KEY_OTHER;/.test(viewer), true);
check('and the named single colours', /var ONE_COLORS = MAP_COLOURS\.ONE_COLORS;/.test(viewer), true);
check('and the warm base map', /var BASE_WARM = MAP_COLOURS\.BASE_WARM;/.test(viewer), true);
check('no colour list is left behind in the viewer', /var KEY_COLORS = \["#/.test(viewer) || /sindoor: "#C9402B", leaf: "#2A6B41"/.test(viewer) || /ground: "#F5F1E6", outside/.test(viewer), false);
check('the page loads map-colours.js before atlas.js', page.indexOf('src="./map-colours.js?v=dev"') > 0 && page.indexOf('src="./map-colours.js?v=dev"') < page.indexOf('src="./atlas.js?v=dev"'), true);
check('the list is what it was: eight key colours, the Bazaar names, the ring’s Sindoor', [MC.KEY_COLORS.length, MC.ONE_COLORS.sindoor, MC.ONE_COLORS.leaf, MC.ONE_COLORS.rust, MC.KEY_OTHER], [8, '#C9402B', '#2A6B41', '#C9402B', '#7a756c']);
check('the key colours are the eight and “other”', MC.keyColours().length, 9);
check('pinColours has no repeats and holds every key colour', [new Set(MC.pinColours()).size === MC.pinColours().length, MC.keyColours().every((k) => MC.pinColours().includes(k))], [true, true]);
check('the base map keeps its fifteen named colours', Object.keys(MC.BASE_WARM).length, 15);
check('theme.js can never set a map colour (the two lists do not meet)', Object.values(T.VARS).some((v) => /--map-|--ramp-|--point-/.test(v)), false);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
