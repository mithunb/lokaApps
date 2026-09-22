/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* A country's name is not a place inside that country. No network: the real
 * function is read out of the server and run against the real country list. */
import fs from 'node:fs';
import { norm } from '../api/lib/matching.js';

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const list = JSON.parse(fs.readFileSync(ROOT + '/atlas/setup/countries.json', 'utf8'));
const COUNTRY_NAMES = Object.fromEntries(list.map((c) => [c.iso3, c.name]));

const cut = (src, head, close) => {
  const a = src.indexOf(head);
  if (a < 0) throw new Error('not found: ' + head);
  return src.slice(a, src.indexOf(close, a + head.length) + close.length);
};
const { countryNamed } = new Function('norm', 'COUNTRY_NAMES',
  cut(server, '\nconst COUNTRY_BY_NAME = (() => {', '\n})();') +
  cut(server, "\nconst COUNTRY_ALSO_CALLED =", '\n') +
  cut(server, '\nconst WHOLE_COUNTRY = new Set([', '\n]);') +
  cut(server, '\nfunction countryNamed(', '\n}\n') +
  '\n return { countryNamed };')(norm, COUNTRY_NAMES);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the atlas’s own country, however it is written');
check('the name itself', countryNamed('India', 'IND'), 'IND');
check('what people also call it', countryNamed('Bharat', 'IND'), 'IND');
check('"Pan India" — which is what sent us here', countryNamed('Pan India', 'IND'), 'IND');
check('all over India', countryNamed('all over India', 'IND'), 'IND');
check('across India', countryNamed('across India', 'IND'), 'IND');
check('the whole country without naming it', countryNamed('nationwide', 'IND'), 'IND');
check('and again', countryNamed('countrywide', 'IND'), 'IND');
check('case and spacing do not matter', countryNamed('  PAN-INDIA ', 'IND'), 'IND');

console.log('\n  somebody else’s country');
check('Bhutan is not a village in Uttar Pradesh', countryNamed('Bhutan', 'IND'), 'BTN');
check('Nepal is a country', countryNamed('Nepal', 'IND'), 'NPL');
check('and it says which, so the page can name it', countryNamed('Sri Lanka', 'IND'), 'LKA');

console.log('\n  and the places that must keep matching');
/* The prefix is stripped ONLY to see whether what is left is a country, so a
   real place beginning with one of those words keeps it. */
['Panipat', 'Panna', 'Allahabad', 'Bharatpur', 'Panchkula', 'Thane', 'Wholesale Market',
 'Across', 'Pan', 'Indore', 'Indi'].forEach(function (n) {
  check(n + ' is not a country', countryNamed(n, 'IND'), '');
});
check('an empty cell names nothing', countryNamed('', 'IND'), '');

console.log('\n  the guesser never sees any of them');
/* dice("india","indi") is 0.86 against a floor of 0.85, so before this the
   fuzzy fallback placed a row reading India in a taluk in Vijayapura. */
check('the country test runs where the guess used to be made',
  /const c = countryNamed\(nm, iso3\);\s*\n\s*if \(c === iso3\) \{ countryRows \+= n; continue; \}/.test(server), true);
check('another country is set aside too',
  /if \(c\) \{ outsideRows \+= n; outsideNames\.add\(String\(nm\)\.trim\(\)\); continue; \}/.test(server), true);
/* ORDER IS THE SAFEGUARD: a village genuinely called Nepal matches exactly,
   long before anything here is asked. */
check('but only after an exact match has failed',
  server.indexOf('for (const sp of aliasSpellings(nm)) { cands = byName.get(sp); if (cands) break; }') <
  server.indexOf('const c = countryNamed(nm, iso3);'), true);
check('and after the sentence has been read for names',
  server.indexOf('const inside = /\\s/.test(String(nm).trim())') <
  server.indexOf('const c = countryNamed(nm, iso3);'), true);

console.log('\n  they are counted, and the count is reported');
check('the level carries both counts', /countryRows, outsideRows, outsideNames: \[\.\.\.outsideNames\]\.slice\(0, 6\)/.test(server), true);
check('the answer carries them when places were found', /countryRows: r\.countryRows \|\| 0,/.test(server), true);
check('and when none were', /countryRows: \(r && r\.countryRows\) \|\| 0,/.test(server), true);

console.log('\n  and the page says it in words');
check('a whole-country row is explained, not hidden', /so there is no one place to put/.test(setup), true);
check('an outside row is named', /somewhere outside this country/.test(setup), true);
check('it is said when places were found', /said \+= wholeCountryNote\(d\);/.test(setup), true);
check('and when none were', /couldn’t match any of it to a place we know\." \+\n        wholeCountryNote\(d\) \+/.test(setup), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
