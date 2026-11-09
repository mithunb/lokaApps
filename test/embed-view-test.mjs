/* An atlas inside another website's frame (?embed=1).
 *
 * discoverloka.org shows Khazan Survey on Divar Island in a frame. Before this,
 * a frame got the WHOLE loka.place page — its header (title row, Share, "Get
 * the LOKA app", sign in), its footer, its wizard links — and a map that took
 * the host page's scroll. The embed view is the same atlas with none of that:
 * the map and its panel, the atlas's name as one line at the head of the
 * panel, one quiet "Open full map ↗" in the map's corner, and a map that waits
 * to be asked before it zooms.
 *
 * Two kinds of frame are told apart by one test — is the frame's parent page
 * loka.place itself? The atlas's own previews (the data bench's, the look
 * sheet's) are, and they keep the header and the branding they exist to show.
 * Anything else is a guest: .atlas-embed-site, no header at all.
 *
 *   node test/embed-view-test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const html = read('atlas/index.html');
const js = read('atlas/atlas.js');
const share = read('atlas/share.js');
const apache = read('deploy/lokaApps.conf');
const server = read('api/server.js');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
}

console.log('\n  the flag is read from the address, and kept on the way in');
check('the head reads ?embed=1 (and ?embed=map) before anything is drawn',
  /if \(\/\[\?&\]embed=\(1\|map\)\(&\|\$\)\/\.test\(location\.search\)\) \{ document\.documentElement\.classList\.add\("atlas-embed"\);/.test(html), true);
check('the head\'s first statement — the atlas\'s page shape — is untouched',
  html.indexOf('<script>if (/[?&]dataset=[^&]/.test(location.search))') > 0, true);
check('atlas.js reads the same flag', /var EMBED = QS\.get\("embed"\) === "1" \|\| QS\.get\("embed"\) === "map";/.test(js), true);
check('Apache keeps the flag through /a/<slug>\'s 302',
  /RewriteCond %\{QUERY_STRING\} \(\^\|&\)embed=\(1\|map\)\(&\|\$\)\nRewriteRule \^\/apps\/atlas\/a\/\(\[a-z0-9-\]\+\)\/\?\$ \/apps\/atlas\/\?dataset=\$1&embed=%2 \[R=302,L\]/.test(apache), true);
check('and carries nothing else over — no [QSA], so no view key rides along',
  /RewriteRule \^\/apps\/atlas\/a\/[^\n]*embed=%2 \[R=302,L\]/.test(apache) &&
  !/RewriteRule \^\/apps\/atlas\/a\/[^\n]*QSA/.test(apache), true);
check('the plain pretty address still redirects exactly as it did',
  /RedirectMatch 302 \^\/apps\/atlas\/a\/\(\[a-z0-9-\]\+\)\/\?\$ \/apps\/atlas\/\?dataset=\$1/.test(apache), true);
check('the dev server does the same for the flag',
  /const ae = req\.url\.match\(\/\^\\\/apps\\\/atlas\\\/a\\\/\(\[a-z0-9-\]\+\)\\\/\?\\\?\(\?:\.\*&\)\?embed=\(1\|map\)\(\?:&\|\$\)\/\);/.test(server) &&
  /res\.redirect\(302, `\/apps\/atlas\/\?dataset=\$\{ae\[1\]\}&embed=\$\{ae\[2\]\}`\)/.test(server), true);

console.log('\n  a guest frame is told from the atlas\'s own previews');
// One test in both places: can this frame read its parent's origin, and is it
// ours? A cross-origin parent throws, and the throw is the answer.
const PARENT_TEST = /window\.top !== window && window\.top\.location\.origin === location\.origin/;
check('the head asks whether the top page is loka.place itself', PARENT_TEST.test(html), true);
check('and gives a guest frame .atlas-embed-site, from the first frame',
  /if \(!sameSite\) document\.documentElement\.classList\.add\("atlas-embed-site"\);/.test(html), true);
check('atlas.js reaches the same answer the same way', PARENT_TEST.test(js) && /var EMBED_SITE = EMBED && !/.test(js), true);
check('no frame at all counts as a guest too (?embed=1 pasted into a tab)',
  /window\.top !== window &&/.test(js), true);
check('the atlas\'s own look preview still frames itself with ?embed=1',
  /&embed=1/.test(read('atlas/owner-look.js')), true);

console.log('\n  nothing of loka.place around the map');
check('no site header in a guest frame',
  /\.atlas-embed-site header\.site,\n\s*\.atlas-embed-site \.atlas-hero,\n\s*\.atlas-embed-site \.sources-foot \{ display:none !important; \}/.test(html), true);
check('…which takes the title row, Share, "Get the LOKA app" and sign in with it',
  /<header class="site">/.test(html) && /nav-signin/.test(html) && /Get the LOKA app/.test(html), true);
check('no wizard link at the foot of About & sources (.sources-foot, hidden above)',
  /\.sources-foot \{ display:none !important; \}/.test(html), true);
check('the owner\'s row is taken out of the document in any embed, not merely hidden',
  /ownerActions\.parentNode\.removeChild\(ownerActions\)/.test(js), true);
check('the owner tools are never even asked for', /if \(EMBED \|\| !DATASET\) return;/.test(js), true);
check('nor is "who is signed in"', /\/\/ reason to ask the API who's signed in from inside somebody's iframe\.\n\s*if \(EMBED\) return;/.test(js), true);
check('no Share inside a frame', /if \(EMBED\) return;\s+\/\/ no Share inside a frame/.test(js), true);
check('Share still refuses to hand out an embed snippet for a private atlas',
  /embed snippet \(public only/.test(share), true);
check('the cta band and the footer stay gone in every embed',
  /\.atlas-embed \.atlas-cta,\n\s*\.atlas-embed footer\.site \{ display:none; \}/.test(html), true);

console.log('\n  the map says what it is, and where it lives');
check('the atlas\'s name is one line at the head of the panel',
  /<div class="embed-title" id="embed-title"><\/div>/.test(html) &&
  /\.atlas-embed-site \.embed-title \{ display:block;/.test(html), true);
check('…filled from the manifest, in a guest frame only', /setText\("#embed-title", manifest\.title\);/.test(js), true);
check('…and not drawn while it is empty, or while a card has the sheet',
  /\.atlas-embed-site \.embed-title:empty \{ display:none; \}/.test(html) &&
  /\.atlas-panel\.card-mode \.embed-title,\n\s*\.atlas-panel\.collapsed \.embed-title \{ display:none; \}/.test(html), true);
check('the name costs the phone\'s sheet one line at peek, and nothing else',
  /\.atlas-embed-site \.atlas-panel\[data-h="peek"\] \{ height:calc\(114px \+ env\(safe-area-inset-bottom\)\); \}/.test(html) &&
  /\.atlas-panel\[data-h="half"\] \{ height:52%; \}/.test(html), true);
check('"Open full map ↗" opens in a tab of its own, safely',
  /<a class="embed-open" id="embed-open" hidden target="_blank" rel="noopener"/.test(html), true);
check('…in the map\'s top corner, clear of the map\'s own round button',
  /\.atlas-embed-site \.embed-open \{ position:absolute; top:8px; right:8px;/.test(html) &&
  /\.atlas-embed-site \.map-style-btn \{ top:52px; \}/.test(html), true);
check('…and clear of a docked place card', /\.atlas-embed-site \.atlas-stage\.card-docked \.embed-open \{ right:356px; \}/.test(html), true);
check('its address is this atlas\'s plain link — no embed flag, no key, no ?via=',
  /return location\.origin \+ location\.pathname\.replace\(\/index\\\.html\$\/, ""\) \+\n\s*"\?dataset=" \+ encodeURIComponent\(DATASET\);/.test(js), true);
check('…set only once the manifest has named the atlas',
  /openFull\.href = fullMapUrl\(\); openFull\.hidden = false;/.test(js), true);

console.log('\n  the map does not take the page\'s scroll');
check('cooperative gestures only in a guest frame (not our own previews)', /cooperativeGestures: EMBED_SITE,/.test(js), true);
check('same-site test reads the top window, so a loka.place page framed by another site is still a guest', /window\.top !== window && window\.top\.location\.origin === location\.origin/.test(js) && /window\.top !== window && window\.top\.location\.origin/.test(html), true);
check('two fingers move it on a touch screen', /"CooperativeGesturesHandler\.MobileHelpText": "Use two fingers to move the map"/.test(js), true);
check('Ctrl and the wheel zoom it, in plain words', /"CooperativeGesturesHandler\.WindowsHelpText": "Hold Ctrl and scroll to zoom the map"/.test(js), true);
check('⌘ and the wheel on a Mac', /"CooperativeGesturesHandler\.MacHelpText": "Hold ⌘ and scroll to zoom the map"/.test(js), true);

console.log('\n  a private atlas is never drawn in somebody else\'s frame');
check('a guest frame reads the static files and never asks the API', /if \(EMBED_SITE\) VIA_API = false;/.test(js), true);
check('…not even after a 404, where every other visitor asks', /if \(EMBED_SITE \|\| VIA_API \|\| !notHere\(r\)\) return r;/.test(js), true);
check('private and "no atlas there" give the same card, so the card tells nothing',
  /if \(EMBED_SITE && err && \(err\.privateAtlas \|\| err\.noAtlas\)\) \{/.test(js), true);
check('"no atlas at that address" is marked as such', /e\.noAtlas = !yes;/.test(js), true);
check('the card says it plainly', /<h2>This map is private<\/h2>/.test(js), true);
check('…with the one link, in a tab of its own, escaped',
  /'<p><a href="' \+ esc\(fullMapUrl\(\)\) \+ '" target="_blank" rel="noopener">Open it on LOKA Atlas ↗<\/a><\/p>'/.test(js), true);
check('…and nothing else: no title, no region, no photo, nothing to sign in to',
  /function embedPrivateCard\(\) \{[\s\S]*?\n  \}/.exec(js)[0].indexOf('signin') < 0 &&
  !/manifest|region|photo/.test(/function embedPrivateCard\(\) \{[\s\S]*?\n  \}/.exec(js)[0]), true);
check('the full page keeps its own private page, sign-in and all',
  /class="atlas-error-signin" href="\.\/setup\/\?back='/.test(js), true);

console.log('\n  nothing else changed');
check('framing stays allowed — no X-Frame-Options anywhere', /X-Frame-Options/i.test(apache + html + js), false);
check('…and no frame-ancestors', /frame-ancestors/i.test(apache + html + js), false);
check('no analytics went in with the embed', /googletagmanager|gtag\(|analytics|plausible|matomo/i.test(js + html), false);
check('the full page is untouched without the flag — every embed rule is behind the class',
  html.split('\n').filter((l) => /embed-open|embed-title|embed-card/.test(l) && /\{/.test(l) &&
    !/\.atlas-embed-site|\.atlas-panel\.(card-mode|collapsed)|^\s*\.embed-(open|title) \{ display:none; \}/.test(l)).length, 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
