/* Run me with: node test/navigate-test.mjs — or through node test/run.mjs.
 * Every place with a point has "Navigate" (Mithun, 27 Oct 2026): the phone's own
 * map app with the way there — Apple Maps on an iPhone or iPad, the default map
 * app (a geo: link) on Android, Google Maps' directions elsewhere. Paths come
 * from where this file sits. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');
let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function grab(name) {
  const i = js.indexOf('  function ' + name + '(');
  const j = js.indexOf('\n  }\n', i);
  return js.slice(i, j + 4);
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function build(ua, touch) {
  const line = (re) => (js.match(re) || [''])[0] + '\n';
  const helpers = line(/  var NAV_ICON = .*/) + line(/  function isAppleTouch\(.*/);
  return new Function('esc', 'navigator', helpers + grab('navURL') + grab('navLinkHTML') + 'return { navURL: navURL, navLinkHTML: navLinkHTML };')(esc, { userAgent: ua, maxTouchPoints: touch });
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';
const DESK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const pt = { type: 'Feature', geometry: { type: 'Point', coordinates: [73.811621, 15.486167] } };
const props = { loka_name: 'Doolally Taproom' };

check('an iPhone gets Apple Maps\' directions, named', build(IPHONE, 5).navURL(73.811621, 15.486167, 'Doolally Taproom', IPHONE, 5),
  'https://maps.apple.com/?daddr=15.486167,73.811621&q=Doolally%20Taproom');
check('an iPad that says it is a Mac is still an iPad', /^https:\/\/maps\.apple\.com\//.test(build(IPAD, 5).navURL(1, 2, '', IPAD, 5)), true);
check('a real Mac (no touch) gets Google Maps', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=2\.000000,1\.000000$/.test(build(IPAD, 0).navURL(1, 2, '', IPAD, 0)), true);
check('Android gets a geo: link its default map app answers, with the name', build(ANDROID, 5).navURL(73.811621, 15.486167, "Sadhana Dell 'Arte", ANDROID, 5),
  "geo:0,0?q=15.486167,73.811621(Sadhana%20Dell%20'Arte)");
const a = build(ANDROID, 5).navLinkHTML(props, pt);
check('the phone link opens in place (an app, not a tab)', /^<a class="pop-nav" href="geo:[^"]+">/.test(a) && !/target=/.test(a), true);
const d = build(DESK, 0).navLinkHTML(props, pt);
check('a computer opens Google Maps in a new tab', /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=15\.486167,73\.811621" target="_blank" rel="noopener"/.test(d), true);
check('the button says Navigate', />Navigate<\/a>$/.test(d), true);
check('an area or a line has no button', [build(DESK, 0).navLinkHTML(props, { geometry: { type: 'Polygon', coordinates: [] } }), build(DESK, 0).navLinkHTML(props, null)], ['', '']);
check('brackets in a name are written out, so the geo: name stays one name', build(ANDROID, 5).navURL(1, 2, 'IPSCDL (Old Secretariat)', ANDROID, 5), 'geo:0,0?q=2.000000,1.000000(IPSCDL%20%28Old%20Secretariat%29)');
check('a broken point has no button', build(DESK, 0).navLinkHTML(props, { geometry: { type: 'Point', coordinates: ['x', 95] } }), '');
const ios = build(IPHONE, 5).navLinkHTML(props, pt);
check('an iPhone offers a choice: Navigate opens Apple Maps and Google Maps', /^<details class="pop-navs"><summary class="pop-nav">[\s\S]*Navigate<\/summary>/.test(ios) &&
  /<a class="pop-nav-opt" href="https:\/\/maps\.apple\.com\/\?daddr=15\.486167,73\.811621&amp;q=Doolally%20Taproom">Apple Maps<\/a>/.test(ios) &&
  /<a class="pop-nav-opt" href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;destination=15\.486167,73\.811621" target="_blank" rel="noopener">Google Maps<\/a>/.test(ios), true);
check('an iPad gets the same choice', /Apple Maps[\s\S]*Google Maps/.test(build(IPAD, 5).navLinkHTML(props, pt)), true);
check('Android and computers keep the one button', [/<details/.test(a), /<details/.test(d)], [false, false]);
check('the choice is styled: no triangle, 44px options', /\.pop-navs > summary::-webkit-details-marker \{ display:none; \}/.test(html) && /\.pop-nav-opt \{[^}]*min-height:44px;/.test(html), true);
check('a name with quotes or markup cannot break out of the link', /<script|"\s*onclick/.test(build(IPHONE, 5).navLinkHTML({ name: '"><script>x</script>' }, pt)), false);

console.log('\n  on every card');
check('the plain card', /h \+= navLinkHTML\(props, f\) \+ lokaLinkHTML\(L, props\);/.test(js), true);
const ev = fs.readFileSync(ROOT + '/atlas/event-mode.js', 'utf8');
check('Event mode: venues, the team\'s places and the map\'s places', (ev.match(/if \(api\.navLinkHTML\) h \+= api\.navLinkHTML\(props, f\);/g) || []).length, 2);
check('Explore and Insight', ['explore-mode', 'insight-mode'].map((m) => /if \(api\.navLinkHTML\) h \+= api\.navLinkHTML\(props, f\);/.test(fs.readFileSync(ROOT + '/atlas/' + m + '.js', 'utf8'))), [true, true]);
check('a 44px button, in the leaf colour', /\.pop-nav \{[^}]*min-height:44px;[^}]*border:1px solid var\(--color-leaf\);/.test(html), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
