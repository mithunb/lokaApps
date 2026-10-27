/* Run me with: node test/atlas-menu-test.mjs — or through node test/run.mjs.
 * An atlas's menu promotes what made it (Mithun, 27 Oct 2026): the LOKA app that
 * tagged the places and the Atlas that maps them. No all atlases / all apps /
 * sign in on an atlas; the store badges sit in the phone's menu and in About;
 * an atlas made for someone says "Made for" and their name. Paths come from
 * where this file sits. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
const body = html.split('<body')[1] || '';
const menu = body.slice(body.indexOf('<div class="nav-menu" id="nav-menu">'), body.indexOf('<div class="nav-menu-scrim"'));

check('the menu has no "Powered by LOKA" badge', /loka-badge/.test(menu), false);
check('the menu links the LOKA app and the Atlas builder', /class="nav-app" href="https:\/\/discoverloka\.org"/.test(menu) && /class="nav-build" href="https:\/\/loka\.place\/apps\/atlas\/setup\/"/.test(menu), true);
check('all atlases, all apps and sign in are not drawn on an atlas',
  /\.atlas-full \.nav \.links a\[href="\.\/"\], \.atlas-full \.nav \.links a\[href="\.\.\/"\], \.atlas-full #nav-signin \{ display:none !important; \}/.test(html), true);
check('the home gallery keeps its links and has no app row', /html:not\(\.atlas-full\) \.nav \.links \.nav-app,/.test(html), true);
const stores = (s) => /https:\/\/apps\.apple\.com\/in\/app\/loka-discover-local\/id6758565297/.test(s) && /https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.find_ar\.app/.test(s);
check('the store badges are in the phone menu', stores(menu) && /class="store-badges nav-stores"/.test(menu), true);
check('and only there on a phone: a wide screen shows them in About, not the header',
  /\.nav-menu \.nav-stores \{ display:none; \}/.test(html) && /\.atlas-full \.nav-menu \.nav-stores \{ display:flex;/.test(html), true);
const about = body.slice(body.indexOf('<section class="atlas-credits">'), body.indexOf('</section>', body.indexOf('<section class="atlas-credits">')));
check('About says where the places were tagged, with both badges and the trademark lines', stores(about) && /tagged in the LOKA app/.test(about) && /trademarks of Google LLC/.test(about) && /service mark of Apple Inc/.test(about), true);
check('the badges are Apple\'s and Google\'s own art, kept on our server', (html.match(/src="\.\/badge-app-store\.svg"/g) || []).length === 2 && (html.match(/src="\.\/badge-google-play\.png"/g) || []).length === 2 &&
  /Download_on_the_App_Store_Badge/.test(fs.readFileSync(ROOT + '/atlas/badge-app-store.svg', 'utf8')) && fs.readFileSync(ROOT + '/atlas/badge-google-play.png').slice(1, 4).toString() === 'PNG', true);
check('on a phone "Powered by LOKA" sits at the map\'s bottom right above the sheet, and the zoom buttons stand on it',
  /\.atlas-full \.loka-badge-float \{ display:inline-flex; bottom:calc\(var\(--sheet-h, 0px\) \+ 8px\); \}/.test(html) && /\.atlas-full \.atlas-stage \.maplibregl-ctrl-bottom-right \{ bottom:calc\(var\(--sheet-h, 0px\) \+ 40px\); \}/.test(html) && /\.atlas-embed \.loka-badge-float \{ display:none !important; \}/.test(html), true);
check('the credit heading can be rewritten', /<span id="made-head">Made by<\/span>/.test(about), true);
check('a manifest\'s madeFor turns it into "Made for" and the name, escaped and capped',
  /var madeFor = typeof manifest\.madeFor === "string" \? manifest\.madeFor\.trim\(\)\.slice\(0, 120\) : "";/.test(js) && /head\.textContent = "Made for";/.test(js) && /el\("div", "org-credit-name", esc\(madeFor\)\)/.test(js), true);
check('without madeFor the heading stays "Made by"', /if \(madeFor && head && cred\)/.test(js), true);

const ev = fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8');
check('in Event mode the badge rises above the category buttons with the credit and the zoom buttons',
  /\.atlas-stage\.ev-on \.maplibregl-ctrl-bottom-right,\.atlas-stage\.ev-on \.loka-badge-float\{transform:translateY\(-60px\)\}/.test(ev) &&
  /\.atlas-stage\.ev-on\.ev-sub-on \.maplibregl-ctrl-bottom-right,\.atlas-stage\.ev-on\.ev-sub-on \.loka-badge-float\{transform:translateY\(-100px\)\}/.test(ev), true);

check('the credit in words shows once per browser; after that the map wears only its ⓘ',
  /if \(creditSeen\(\)\) \{ pill\.classList\.add\("folded"\); return; \}/.test(js) && /localStorage\.setItem\("atlas-credit-seen", "1"\)/.test(js) && /creditFoldT = setTimeout\(fold, 5000\);/.test(js), true);
check('and for a returning visitor it is folded from the first frame, before the map has loaded', /\(function \(\) \{ var p = document\.getElementById\("map-attrib"\); if \(p && creditSeen\(\)\) p\.classList\.add\("folded", "no-anim"\); \}\)\(\);/.test(js), true);
check('the ⓘ opens About, whose head carries the credit', /<button id="sources-btn" class="map-attrib-i"[^>]*aria-controls="atlas-sources"/.test(html) && /<p class="sources-map" id="sources-map"><\/p>/.test(html), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
