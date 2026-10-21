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

/* An atlas's own look (atlas/theme.js), first used for the Emergence
   festival's atlas (October 2026, deploy/themes/emergence-festival.json).
   What these hold: a theme changes the page's colours and type; no theme
   changes nothing; words stay readable whatever a theme says; "Powered by
   LOKA Atlas" looks the same on every atlas; fonts come only from Google
   Fonts. No network. */

const T = require(ROOT + '/atlas/theme.js');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const emergence = JSON.parse(fs.readFileSync(ROOT + '/deploy/themes/emergence-festival.json', 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// a page just big enough for apply() to write on
function fakeDoc() {
  const props = {}, classes = new Set(), head = [];
  return {
    props, classes, appended: head,
    documentElement: { style: { setProperty: (k, v) => { props[k] = v; } }, classList: { add: (c) => classes.add(c) } },
    head: { appendChild: (n) => head.push(n) },
    querySelector: (s) => (/data-atlas-theme-fonts/.test(s) ? head.find((n) => n.attrs && 'data-atlas-theme-fonts' in n.attrs) || null : null),
    createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
}

console.log('\n  a theme is applied');
const r = T.resolve(emergence.theme);
check('the festival purple becomes the accent', r.vars['--color-leaf'], '#6B1164');
check('its white page', r.vars['--color-page'], '#FFFDFD');
check('its near-black words', r.vars['--color-text-primary'], '#060606');
check('its red for the selected-place ring', r.vars['--color-sindoor'], '#FC3103');
check('its headings face, Poppins, with LOKA’s behind it', r.vars['--font-display'], '"Poppins","Lora",var(--font-companions-serif),serif');
check('its lighter heading weight', r.vars['--weight-display'], '500');
check('square corners', [r.vars['--radius-md'], r.vars['--radius-lg']], ['0', '0']);
check('the fonts come from Google Fonts', r.fontCss, emergence.theme.fonts.cssUrl);
const d = fakeDoc();
T.apply(emergence.theme, d);
check('apply() sets the variables on the page', d.props['--color-leaf'], '#6B1164');
check('and loads the fonts once', d.appended.length, 1);
T.apply(emergence.theme, d);
check('a second apply() does not load them again', d.appended.length, 1);
check('the viewer applies a theme the manifest gives', /if \(manifest\.theme && window\.LokaTheme\)/.test(viewer), true);
check('a theme in manifest.local.json reaches the viewer (a rebuild keeps that file)',
  /if \(local\.theme && typeof local\.theme === "object"\) manifest\.theme = local\.theme;/.test(viewer), true);
check('theme.js loads before atlas.js', page.indexOf('src="./theme.js?v=dev"') > 0 && page.indexOf('src="./theme.js?v=dev"') < page.indexOf('src="./atlas.js?v=dev"'), true);

console.log('\n  no theme, no change');
check('nothing resolved from no theme', T.resolve(undefined), { vars: {}, fontCss: null, notes: [] });
check('nothing from an empty theme', T.resolve({}).vars, {});
const blank = fakeDoc();
T.apply(undefined, blank);
check('apply() with no theme touches nothing', [Object.keys(blank.props).length, blank.appended.length, blank.classes.size], [0, 0, 0]);
const root = page.slice(page.indexOf(':root {'), page.indexOf('}', page.indexOf(':root {')));
check('LOKA’s own page colours are as they were', ['--color-page:#FAF8F3', '--color-leaf:#2A6B41', '--color-text-primary:#24211D', '--color-sindoor:#C9402B'].every((s) => root.includes(s)), true);
check('headings keep their weight when no theme lightens it', root.includes('--weight-display:700;'), true);
check('the LOKA values theme.js measures against are the page’s own',
  Object.entries(T.LOKA).every(([k, v]) => root.includes(T.VARS[k] + ':' + v)), true);
check('a logo keeps its usual width with no theme', /\.org-brand-logo \{[^}]*max-width:var\(--logo-max-width,120px\)/.test(page), true);
check('the map’s own colours are never a theme’s to set', Object.values(T.VARS).some((v) => /--map-|--ramp-|--point-/.test(v)), false);

console.log('\n  words stay readable');
const faint = T.resolve({ colors: { text: '#BBBBBB', textSecondary: '#CCCCCC', textMuted: '#DDDDDD', accent: '#03FCAD', accentDeep: '#1DC254', highlightDeep: '#FC3103', highlight: '#FFE0D0' } });
const bgs = [T.LOKA.page, T.LOKA.surface, T.LOKA.surfaceAlt];
const words = ['--color-text-primary', '--color-text-secondary', '--color-text-muted', '--color-leaf', '--color-leaf-deep', '--color-sindoor-deep'];
check('every faint colour is darkened until it reads at 4.5 to 1 on every background',
  words.every((k) => bgs.every((b) => T.contrast(faint.vars[k], b) >= 4.5)), true);
check('white words on the accent read at 4.5 to 1', T.contrast('#FFFFFF', faint.vars['--color-leaf']) >= 4.5, true);
check('a ring reads at 3 to 1', bgs.every((b) => T.contrast(faint.vars['--color-sindoor'], b) >= 3), true);
check('and each change is said, in words', faint.notes.length, 7);
check('the festival file stores its red already darkened for words, so it needs no change at run time', r.notes.length, 0);
check('and the guard would still darken the raw site red if given it', /^highlightDeep: #FC3103 .* darkened to #[0-9A-F]{6}$/.test((T.resolve({ colors: { highlightDeep: '#FC3103' } }).notes[0] || '')), true);
check('a colour that already reads is left exactly as given', T.resolve({ colors: { accent: '#6B1164' } }).vars['--color-leaf'], '#6B1164');
const dark = T.resolve({ colors: { page: '#060606', surface: '#111111', text: '#FFFDFD' } });
check('a dark page is refused (no dark mode)', [dark.vars['--color-page'], dark.vars['--color-surface']], [undefined, undefined]);
check('so light words meant for it are darkened to read on LOKA’s light page', T.contrast(dark.vars['--color-text-primary'], T.LOKA.page) >= 4.5, true);
check('a colour that is not a colour is ignored', T.resolve({ colors: { accent: 'red; background:url(x)' } }).vars['--color-leaf'], undefined);

console.log('\n  "Powered by LOKA Atlas" is the same on every atlas');
const badgeRule = (page.match(/\.loka-badge \{ --color-text-primary:[^}]*\}/) || [''])[0];
check('the badge sets LOKA’s colours back for itself', ['--color-text-primary:#24211D', '--color-text-secondary:#5A5751', '--color-border:rgba(36,33,29,.18)', '--color-leaf:#2A6B41', '--color-leaf-deep:#1F5232'].every((s) => badgeRule.includes(s)), true);
check('and LOKA’s faces and corner', ['--font-display:"Lora"', '--font-body:"Karla"', '--radius-md:.25rem', 'font-family:var(--font-body)'].every((s) => badgeRule.includes(s)), true);
check('those match the page’s own values', ['--color-text-primary:#24211D', '--color-text-secondary:#5A5751', '--color-border:rgba(36,33,29,.18)', '--radius-md:.25rem'].every((s) => root.includes(s)), true);
check('the badge’s words are unchanged, in all three places', (page.match(/Powered by<\/span> <img src="\.\/loka-logo\.png" alt="LOKA"> <em>Atlas<\/em>/g) || []).length + (page.match(/>Powered by <img src="\.\/loka-logo\.png" alt="LOKA"> <em>Atlas<\/em>/g) || []).length, 3);
check('the badge keeps its own weight, not the theme’s', /\.loka-badge em \{[^}]*font-weight:700;/.test(page), true);

console.log('\n  fonts only from Google Fonts');
const fontsFrom = (u) => T.resolve({ fonts: { display: 'Poppins', cssUrl: u } }).fontCss;
check('Google Fonts is loaded', fontsFrom('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500&display=swap'), 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500&display=swap');
for (const bad of [
  'https://emergencefestival.in/wp-content/themes/emergence-theme/assets/fonts/poppins.css',
  'http://fonts.googleapis.com/css2?family=Poppins',
  'https://fonts.googleapis.com.example.com/css2?family=Poppins',
  'https://fonts.googleapis.com/css2?family=Poppins"><script>',
  'javascript:alert(1)',
]) check('refused: ' + bad.slice(0, 60), fontsFrom(bad), null);
check('and a refused host drops the face too, so nothing half-applies', T.resolve({ fonts: { display: 'Poppins', cssUrl: 'https://example.com/f.css' } }).vars['--font-display'], undefined);
check('a font name cannot carry CSS', T.resolve({ fonts: { display: 'Poppins";}body{x:y' } }).vars['--font-display'], undefined);

console.log('\n  the one-off script');
const run = spawnSync(process.execPath, [ROOT + '/deploy/apply-theme.mjs', 'deoria-bioregion', ROOT + '/deploy/themes/emergence-festival.json'], { encoding: 'utf8' });
check('never touches deoria-bioregion', [run.status, /never touched/.test(run.stderr)], [1, true]);
const script = fs.readFileSync(ROOT + '/deploy/apply-theme.mjs', 'utf8');
check('writes nothing without --apply', /if \(!APPLY\) process\.exit\(0\);/.test(script), true);
check('backs up before it writes', script.indexOf('backups') < script.indexOf('local.theme = theme'), true);
check('the logo obeys the server’s rule (PNG, under 200 KB)', /PNG_MAGIC/.test(script) && /200 \* 1024/.test(script), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
