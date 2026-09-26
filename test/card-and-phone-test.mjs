/* Run me with: node test/run.mjs — or on my own with node.
 *
 * What a card says, and what a phone can reach.
 *
 * These come from a visual inspection that found the atlas trustworthy on a
 * desktop right up to the moment somebody tapped a shape, and not yet
 * trustworthy on a phone at all. Each check below names the measurement that
 * prompted it, so a later change that undoes one says what it is undoing.
 *
 * No network. Reads the product's own files, and runs the naming rule for real.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettify, LABEL_MAX } from '../api/lib/fragment.js';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const atlas = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const ownerCss = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
const imports = fs.readFileSync(ROOT + '/api/lib/atlas/imports.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ------------------------------------------------------------------ *
 * A question keeps its words
 * ------------------------------------------------------------------ */
console.log('\n  a question on a card is not cut in the middle of a word');
/* These are the eight questions from the survey this was found on. Every one
   of them used to arrive cut at forty letters: "Name of Organisation or
   Collective (if a", "Which geographic areas do you work in? (". */
const ASKED = {
  'Name of Organisation or Collective (if applicable)':
    'Name of Organisation or Collective (if applicable)',
  'What best describes your work, profile, role or affiliation ? (Please select all that apply)':
    'What best describes your work, profile, role or affiliation?',
  'How long have you been involved in this work? Is the work ongoing/complete?':
    'How long have you been involved in this work?',
  'Which geographic areas do you work in? (Feel free to mention country, village, district, and state/province details.) You might be working in several geographical areas, so please mention all.':
    'Which geographic areas do you work in?',
  'What languages do you primarily work in? Feel free to mention all if there is more than one.':
    'What languages do you primarily work in?',
  'Please share links to any relevant resources to your work.':
    'Please share links to any relevant resources to your work.',
  'How would you like to be credited for your work in the database?':
    'How would you like to be credited for your work in the database?',
};
for (const [asked, want] of Object.entries(ASKED)) {
  check('“' + want.slice(0, 44) + (want.length > 44 ? '…' : '') + '”',
    prettify(asked), want);
}
check('none of them ends mid-word',
  Object.keys(ASKED).map(prettify).filter((t) => /[a-z],?…$/.test(t) && !/\s\S*…$/.test(t)), []);

console.log('\n  and a truly long one is shortened at a word, visibly');
const huge = 'A column with an extremely long name that simply keeps going and going past any reasonable limit at all';
check('it ends in an ellipsis', /…$/.test(prettify(huge)), true);
/* Whole words means: drop the ellipsis, and what is left must be how the
   original starts, ending at a space. Compared without regard to case, because
   the rule also puts a capital on the first letter. */
const short = prettify(huge).replace(/\u2026$/, '');
check('it breaks at a space, not inside a word',
  huge.toLowerCase().startsWith(short.toLowerCase()) &&
  huge.charAt(short.length) === ' ', true);
check('and stays within the limit', prettify(huge).length <= LABEL_MAX + 1, true);

console.log('\n  words that contain a hyphen keep it');
check('human-friendly survives', prettify('what locations are human-friendly and why'),
  'What locations are human-friendly and why');
check('but a slug still opens out', prettify('created_at'), 'Created at');
check('and so does a hyphenated slug with no spaces', prettify('place-tags'), 'Place tags');

console.log('\n  the rule has one home');
check('the import path uses it rather than keeping a copy',
  /import \{ detectDelimiter, prettify \} from '\.\.\/fragment\.js';/.test(imports), true);
check('and no second copy of the old cut survives there',
  /slice\(0, 40\)[\s\S]{0,40}\n\s*const f = \{ label/.test(imports), false);

/* ------------------------------------------------------------------ *
 * The card's shape
 * ------------------------------------------------------------------ */
console.log('\n  a card of questions stacks instead of squeezing');
/* Measured before this: the question column took 222 pixels of a 338-pixel
   card and the answer got 56, so "Foundation for research on socio economic
   development" came out over eight lines with words split in the middle. */
check('a long label turns the whole card stacked',
  /if \(String\(fld\.label \|\| ""\)\.length > LONG_LABEL\) stacked = true;/.test(atlas), true);
check('the whole card, not the one row that caused it',
  /The whole card, not the offending\n       row/.test(atlas), true);
check('and the stacked card gives the answer the full width',
  /\.pop-facts-stacked \{ grid-template-columns:1fr;/.test(page), true);
check('the question sits above it, on its own line',
  /\.pop-facts-stacked \.pop-lbl \{ display:block;/.test(page), true);

console.log('\n  a whole number is not printed as a decimal');
check('"30.0" is tidied where it is shown, not where it is stored',
  /if \(\/\^-\?\\d\+\\\.0\+\$\/\.test\(shown\)\) shown = shown\.replace/.test(atlas), true);
check('and only a value that is entirely a number is touched',
  /"1\.5" stays, "v1\.0" stays, "30\.0 km" stays/.test(atlas), true);

/* ------------------------------------------------------------------ *
 * The owner's row
 * ------------------------------------------------------------------ */
console.log('\n  the owner can read the name of their own layer');
/* Measured before this: "Edit card" and "Remove…" took 105 pixels of a
   284-pixel row and the little "i" 25 more, leaving the name 88 — so the owner
   saw "Where the re…" while every reader saw it whole. */
check('the two actions live behind one control', /more\.className = "own-more";/.test(owner), true);
check('which says what it opens', /more\.setAttribute\("aria-haspopup", "true"\);/.test(owner), true);
check('both actions moved into it',
  /menu\.appendChild\(btn\);\s*\n\s*menu\.appendChild\(del\);/.test(owner), true);
check('it shuts on Escape', /if \(e\.key === "Escape"\) \{ shut\(\); more\.focus\(\); \}/.test(owner), true);
check('and on a click elsewhere', /function away\(e\) \{ if \(!menu\.contains\(e\.target\)/.test(owner), true);
check('opening either action shuts the menu behind it',
  /b\.onclick = function \(e\) \{ shut\(\); was\.call\(this, e\); \};/.test(owner), true);
check('the name wraps now instead of ending in an ellipsis',
  /white-space:normal; overflow-wrap:anywhere;/.test(ownerCss), true);
check('and the old one-line cut is gone',
  /\.own-nameable \{[^}]*text-overflow:ellipsis/.test(ownerCss), false);

/* ------------------------------------------------------------------ *
 * The phone
 * ------------------------------------------------------------------ */
console.log('\n  on a phone, nothing important hides behind the bottom sheet');
/* Measured before this: the zoom buttons sat at 768-834 down the page while
   the shut sheet spanned 725-844, so "+" hit the sheet, "-" hit its credit
   line and the scale bar sat behind the Satellite button. */
check('the sheet’s height is measured, not guessed',
  /function watchSheetHeight\(stage\)/.test(atlas) &&
  /stage\.style\.setProperty\("--sheet-h"/.test(atlas), true);
check('it is re-measured when the sheet changes size',
  /new ResizeObserver\(sync\)\.observe\(panel\)/.test(atlas), true);
check('and when the layout flips to the phone one',
  /matchMedia\("\(max-width: 720px\)"\)\.addEventListener\("change", sync\)/.test(atlas), true);
check('it is zero on a desktop, where there is no sheet',
  /\(onPhone \? panel\.offsetHeight : 0\)/.test(atlas), true);
check('the zoom buttons and the scale bar clear it',
  /bottom:calc\(var\(--sheet-h, 0px\) \+ 12px\);/.test(page), true);
check('and the framing leaves room for it, so pins do not load under it',
  /if \(sheet > 0\) pad\.bottom = Math\.min\(sheet \+ 16/.test(atlas), true);
check('but never so much room that the map has nowhere to draw',
  /map\.getContainer\(\)\.clientHeight \* 0\.45/.test(atlas), true);

console.log('\n  on a phone, a place’s card sits along the bottom');
/* Measured before this: on Bengaluru a card 320 pixels wide on a 375-pixel map
   opened 61 past the right edge with 145 hidden under the sheet; on Cubbon
   Park, 82 past and 305 hidden. */
check('it spans the map rather than hanging off a pin',
  /\.atlas-stage \.atlas-popup\.maplibregl-popup \{\s*\n\s*position:absolute; inset:auto 8px calc\(var\(--sheet-h, 0px\) \+ 8px\) 8px;/.test(page), true);
check('loudly enough to beat the width the map library writes on it',
  /width:auto; max-width:none !important; transform:none !important;/.test(page), true);
check('above the sheet, not behind it', /inset:auto 8px calc\(var\(--sheet-h, 0px\) \+ 8px\) 8px/.test(page), true);
check('and it drops the tip, which points at nothing once it has moved',
  /\.atlas-stage \.atlas-popup \.maplibregl-popup-tip \{ display:none; \}/.test(page), true);
check('it leaves some map visible behind it',
  /\.atlas-stage \.atlas-popup \.pop \{ max-height:min\(38vh, 320px\); \}/.test(page), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
