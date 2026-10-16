/* Every wait shows the same mark and says what is happening.
 *
 * Mithun's rule (16 Oct 2026): if someone is waiting on something to load, a
 * graphic should be shown to reduce anxiety, or an explanation given. An
 * audit of the live site found the waits each answered differently — a
 * stripe, a spinner, a disabled button with no words, or nothing at all —
 * and one that answered with a frozen page: pressing a gallery card left the
 * gallery still on screen until the atlas's first paint, which waited on two
 * outside stylesheets.
 *
 * These checks hold the treatment in place: one piece (atlas/wait.js) with
 * one mark and one timing rule; the first paint no longer held by Google
 * Fonts or the map library's stylesheet; the gallery row that says
 * "Opening" at once; the stage that says what it is waiting for; and every
 * button or line that used to go quiet now going through the same piece.
 *
 *   node test/waits-test.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// the files write an ellipsis either way (databench.js and setup.js escape
// theirs, the rest spell it); the checks read one spelling
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\\u2026/g, '…').replace(/\\u201c/g, '“').replace(/\\u201d/g, '”');
const wait = read('atlas/wait.js');
const html = read('atlas/index.html');
const js = read('atlas/atlas.js');
const share = read('atlas/share.js');
const owner = read('atlas/owner.js');
const setup = read('atlas/setup/setup.js');
const setupHtml = read('atlas/setup/index.html');
const bench = read('atlas/databench.js');
const addData = read('atlas/add-data/index.html');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
}
const squeeze = (s) => s.replace(/\s+/g, ' ').trim();

console.log('\n  one piece, one mark, one timing rule');
check('wait.js hands the page start(), html() and the delay', /window\.LokaWait = \{ start: start, html: html, mark: MARK, css: CSS, DELAY: DELAY \}/.test(wait), true);
check('a wait is shown only once it has lasted 300 ms', /var DELAY = 300;/.test(wait), true);
check('the mark is three dots that breathe, in Leaf', /\.wait-mark i \{[^}]*background:var\(--color-leaf,#2A6B41\)/.test(wait) && /@keyframes wait-breathe/.test(wait), true);
check('inside a button the dots take the button\'s own colour', /button \.wait-mark i,[^{]*\{ background:currentColor; \}/.test(wait), true);
check('and stand still for anyone who finds motion difficult', /prefers-reduced-motion: reduce\) \{ \.wait-mark i \{ animation:none;/.test(wait), true);
check('the mark is hidden from screen readers; the words are not', /<span class="wait-mark" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span>/.test(wait), true);
const cssFromJs = wait.slice(wait.indexOf('var CSS ='), wait.indexOf('function injectStyle')).split('\n')
  .map((l) => l.trim()).filter((l) => l.startsWith("'"))
  .map((l) => l.replace(/^'/, '').replace(/\\n'( \+|;)$/, '')).join('\n');
const inlineStart = html.indexOf('.wait-mark { display:inline-flex');
const inlineEnd = html.indexOf('\n', html.indexOf('prefers-reduced-motion: reduce) { .wait-mark i', inlineStart));
check('index.html repeats the same rules inline, for the atlas\'s first frame — and they are the same rules',
  squeeze(html.slice(inlineStart, inlineEnd)), squeeze(cssFromJs));

console.log('\n  wait.js, run: nothing flashes, nothing is wiped');
{
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, at: now + ms }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
  let now = 0;
  const tick = (ms) => { now += ms; timers.filter((t) => t.fn && t.at <= now).forEach((t) => { const f = t.fn; t.fn = null; f(); }); };
  const elem = (tag) => {
    const a = {}, cls = new Set();
    return { tagName: tag, innerHTML: '', disabled: false, type: '',
      setAttribute: (k, v) => { a[k] = String(v); }, getAttribute: (k) => (k in a ? a[k] : null), removeAttribute: (k) => { delete a[k]; },
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) }, appendChild() {} };
  };
  globalThis.document = { getElementById: () => null, createElement: elem, head: elem('HEAD'), documentElement: elem('HTML') };
  globalThis.window = {};
  new Function(wait)();
  const W = globalThis.window.LokaWait;
  const btn = elem('BUTTON'); btn.innerHTML = 'Save changes';
  const stop = W.start(btn, 'Saving…');
  check('a button is disabled at once, so a second press cannot send twice', [btn.disabled, btn.innerHTML], [true, 'Save changes']);
  tick(299);
  check('its words are untouched before the delay', btn.innerHTML, 'Save changes');
  tick(1);
  check('and become the mark and the words at it', btn.innerHTML, W.html('Saving…'));
  stop();
  check('ending the wait puts the label back and enables the button', [btn.disabled, btn.innerHTML, btn.getAttribute('aria-busy')], [false, 'Save changes', null]);
  const quick = elem('BUTTON'); quick.innerHTML = 'Send';
  const stopQuick = W.start(quick, 'Sending…'); tick(100); stopQuick(); tick(1000);
  check('a wait that ends inside the delay never shows at all', quick.innerHTML, 'Send');
  const line = elem('P');
  const stopLine = W.start(line, 'Opening…'); tick(300);
  check('a line gets the mark and the words', [line.innerHTML, line.classList.contains('wait-line')], [W.html('Opening…'), true]);
  line.innerHTML = 'Could not open it.';
  stopLine();
  check('ending it leaves a message written in the meantime alone', line.innerHTML, 'Could not open it.');
  const kept = elem('BUTTON'); kept.innerHTML = 'Look it up';
  const stopKept = W.start(kept, 'Looking…', { delay: 0, keepDisabled: true });
  check('delay 0 shows at once, for an action that is never instant', kept.innerHTML, W.html('Looking…'));
  stopKept();
  check('keepDisabled leaves the button off for its caller to finish with', kept.disabled, true);
  check('the words are escaped', W.html('<b>') , W.mark + '<span>&lt;b&gt;</span>');
}

console.log('\n  the first paint no longer waits on the outside stylesheets');
const head = html.slice(0, html.indexOf('</head>'));
check('the fonts\' link is written by the head script, which already knows whether this is an atlas', /document\.write\(document\.documentElement\.classList\.contains\("atlas-full"\)/.test(head), true);
check('on an atlas it is a preload that becomes a stylesheet when it lands', /\? '<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com\/[^"]+" onload="this\.onload=null;this\.rel=\\'stylesheet\\'" \/>'/.test(head), true);
check('on the gallery it is an ordinary stylesheet, so the headings never flash from the fallback face', /: '<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/[^"]+" \/>'\);/.test(head), true);
check('the map library\'s stylesheet is a preload with an id the viewer can wait on', /<link id="maplibre-css" rel="preload" as="style" href="https:\/\/unpkg\.com\/maplibre-gl@[^"]+\/maplibre-gl\.css" onload="this\.onload=null;this\.rel='stylesheet'" \/>/.test(head), true);
check('with a plain link for a browser without scripts', /<noscript><link rel="stylesheet" href="https:\/\/unpkg\.com\/maplibre-gl@[^"]+\/maplibre-gl\.css" \/><\/noscript>/.test(head), true);
check('no other stylesheet is linked in the markup', (head.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/<link rel="stylesheet"/g) || []).length, 0);
check('the viewer waits for that stylesheet before it builds the map, so the map is never drawn unstyled',
  /Promise\.all\(\[baseStyle\(m\), mapCssReady\(\)\]\)\.then\(function \(r\) \{ start\(m, r\[0\]\); return true; \}\);/.test(js), true);
check('— resolved at once if it is already in', /if \(!link \|\| link\.rel === "stylesheet"\) return Promise\.resolve\(\);/.test(js), true);
check('— and after a short cap regardless, so a CDN that never answers costs a plain map, not no map', /var t = setTimeout\(resolve, 4000\);/.test(js), true);

console.log('\n  the gallery answers a press at once');
check('a pressed row says Opening, with the mark', /row\.classList\.add\("opening"\);\n\s*var go = row\.querySelector\("\.go"\);\n\s*if \(go && window\.LokaWait\) go\.innerHTML = LokaWait\.html\("Opening…"\);/.test(js), true);
check('a modifier press (new tab) is left alone', /if \(!row \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.altKey \|\| e\.button\) return;/.test(js), true);
check('coming back with the back button puts the arrow back', /window\.addEventListener\("pageshow", function \(\) \{\n\s*grid\.querySelectorAll\("a\.home-row\.opening"\)/.test(js), true);
check('the row\'s arrow slot is restyled for the words', /a\.home-row\.opening \.go, a\.home-row\.opening:hover \.go \{/.test(html), true);
check('wait.js is loaded before atlas.js', html.indexOf('<script src="./wait.js?v=dev"></script>') > 0 && html.indexOf('<script src="./wait.js?v=dev"></script>') < html.indexOf('<script src="./atlas.js?v=dev"></script>'), true);

console.log('\n  the stage says what it is waiting for');
check('"Loading the map" carries the mark in the markup, so it is in the first frame', /<div class="atlas-loading" id="atlas-loading" aria-live="polite"><div class="atlas-loading-words"><span class="wait-mark" aria-hidden="true"><i><\/i><i><\/i><i><\/i><\/span><span>Loading the map<\/span><small id="atlas-loading-more"><\/small><\/div><\/div>/.test(html), true);
check('after six seconds it adds that this can take a minute', /LONG_WAIT = 6000/.test(js) && /more\.textContent = "Still on its way — this can take a minute on a slow connection\.";/.test(js), true);
check('the layer files, which come after the map, get a small label once they have taken longer than a blink',
  /var layersWait = setTimeout\(function \(\) \{ showLoading\("Drawing the layers"\); \}, WAIT_DELAY\);/.test(js) && /WAIT_DELAY = 300/.test(js), true);
check('taken away when they land, and when they fail', (js.match(/clearTimeout\(layersWait\);\s*showLoading\(false\);/g) || []).length, 2);
check('a new basemap gets the same label until the map is idle', /showLoading\("Loading the " \+ label \+ " map"\);\n\s*map\.once\("idle", function \(\) \{ if \(tilesWaitFor === id\) showLoading\(false\); \}\);/.test(js), true);
check('asked for in switchBasemap', /function switchBasemap\(id\) \{\n\s*activeBasemap = id;\n\s*tilesWait\(id\);/.test(js), true);
check('the label sits at the stage\'s foot, over the map, not across it', /\.atlas-loading\.aside \{ inset:auto auto \.75rem 50%; transform:translateX\(-50%\);/.test(html), true);
check('and on a phone it steps up above the sheet', /\.atlas-loading\.aside \{ bottom:calc\(var\(--sheet-h, 0px\) \+ 52px\); \}/.test(html), true);
check('search by meaning says it is looking further, under the count', /line\.innerHTML = LokaWait\.html\("Looking for similar words…"\);/.test(js) && /var stopWait = meaningWait\(seq\);/.test(js), true);
check('and stops saying so whether the answer comes or not', /\.catch\(function \(\) \{ return null; \}\)\n\s*\.then\(function \(r\) \{\n\s*stopWait\(\);/.test(js), true);

console.log('\n  the owner\'s buttons say what they are doing');
check('Make a new link', /LokaWait\.start\(b, "Making a new link…"\)/.test(share), true);
check('Settings save', /var stop = LokaWait\.start\(btn, "Saving…"\);/.test(owner) && /\}\)\.then\(stop\);\n  \}\n\n  function paintInvites/.test(owner), true);
check('who can open it', /LokaWait\.start\(btn, "Changing who can open it…"\)/.test(owner), true);
check('open data and region rebuilds', (owner.match(/LokaWait\.start\(btn, "Starting the rebuild…"\)/g) || []).length, 2);
check('delete, at once', /LokaWait\.start\(yes, "Deleting…", \{ delay: 0 \}\)/.test(owner), true);
check('invite, which used to allow a second press', /LokaWait\.start\(go, "Inviting…"\)/.test(owner), true);
check('the open-data list', /LokaWait\.html\("Loading the list…"\)/.test(owner), true);
check('a question\'s three steps carry the mark', (owner.match(/saying\(/g) || []).length, 4);
check('and a failed step takes its waiting line away', /function fail\(e\) \{ say\.textContent = ""; err\.textContent = errMsg\(e\);/.test(owner), true);

console.log('\n  the wizard');
check('loads wait.js first', setupHtml.indexOf('<script src="../wait.js?v=dev"></script>') > 0 && setupHtml.indexOf('<script src="../wait.js?v=dev"></script>') < setupHtml.indexOf('setup.js?v=dev'), true);
check('says Opening while it asks who is here, where it drew nothing', /<p class="intro wait-line" id="boot-wait" hidden><\/p>/.test(setupHtml) && /stopBoot = LokaWait\.start\(bootWait, "Opening…"\)/.test(setup), true);
check('sending and checking the code', /LokaWait\.start\(btn, "Sending the code…"\)/.test(setup) && /LokaWait\.start\(btn, "Checking the code…"\)/.test(setup), true);
check('a status line about something still running carries the mark', /if \(cls === "wait"\) \{ box\.innerHTML = text \? '<div class="msg ok wait-line">' \+ LokaWait\.html\(text\)/.test(setup), true);
check('reading the file, and finding its places', /msg\(2, "Reading " \+ file\.name \+ "…", "wait"\);/.test(setup) && /rows to find the places… this can take a minute for a big file\.", "wait"\);/.test(setup), true);
check('the open-data list and the fixes list', /LokaWait\.html\("Loading what is available here…"\)/.test(setup) && /\$\("#fixes-intro"\)\.innerHTML = LokaWait\.html\("Loading…"\);/.test(setup), true);
check('looking a place up, and finding one by name', /LokaWait\.start\(b, "Looking it up…", \{ delay: 0, keepDisabled: true \}\)/.test(setup) && /LokaWait\.start\(find\.querySelector\("button"\), "Finding…"\)/.test(setup), true);

console.log('\n  Add data');
check('loads wait.js first', addData.indexOf('<script src="../wait.js?v=dev"></script>') > 0 && addData.indexOf('<script src="../wait.js?v=dev"></script>') < addData.indexOf('databench.js?v=dev'), true);
check('the gate says Opening the atlas while the page asks about it', /LokaWait\.start\(\$\("#gate-p"\), "Opening the atlas…"\)/.test(addData) && /\}, LokaWait\.DELAY\);/.test(addData), true);
check('a status line about something still running carries the mark', /if \(cls === "wait"\) \{ \$\(sel\)\.innerHTML = text \? '<div class="msg ok wait-line">' \+ LokaWait\.html\(text\)/.test(bench), true);
check('sending the rows, and every progress line after it', /if \(cls === "ok"\) \{ msg\("#msg-check", text \|\| "", "wait"\); return; \}/.test(bench), true);
check('placing rows that need no decision, which was silent', /msg\("#msg-check", "Placing them on the map…", "wait"\);/.test(bench), true);
check('the code buttons, which allowed a second press', /LokaWait\.start\(this, "Sending the code…"\)/.test(bench) && /LokaWait\.start\(this, "Checking the code…"\)/.test(bench), true);
check('finding themes, with how long it can take', /var done = LokaWait\.start\(btn, "Reading…", \{ delay: 0 \}\);/.test(bench) && /places… this can take a minute\.", "wait"\);/.test(bench), true);
check('the old spinner is gone', /class="spin"/.test(bench), false);
check('building and updating the preview', /msg\("#msg-place", "Building the preview…", "wait"\);/.test(bench) && /\$\("#style-state"\)\.innerHTML = LokaWait\.html\(renaming \? "Renaming the places on the map…" : "Updating the preview…"\);/.test(bench), true);
check('looking up addresses, with the pace', /LokaWait\.html\(ADDR\.results\.length\n\s*\? "looked up " \+ ADDR\.results\.length \+ "…" : "looking them up… about one a second"\)/.test(bench), true);
check('Add to the atlas, which was silent and allowed a second press', /var stop = LokaWait\.start\(this, "Adding it to the atlas…"\);/.test(bench), true);
check('and taking the upload off', /LokaWait\.start\(this, "Taking it off…"\)/.test(bench), true);

console.log('\n  the waiting timings exist before the atlas starts drawing');
{
  const src = readFileSync(path.join(ROOT, 'atlas', 'atlas.js'), 'utf8');
  const decl = src.indexOf('var LONG_WAIT = 6000');
  const firstDraw = src.indexOf('draw().then(');
  check('LONG_WAIT is set before the first draw() call', decl > -1 && firstDraw > -1 && decl < firstDraw, true);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
