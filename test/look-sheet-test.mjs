/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* The owner's side of "Use my website's look" (atlas/owner-look.js, drawn into
   Settings by owner.js) and the one visitor-facing trace, the credit line in
   About this atlas (atlas.js, index.html). docs/design-style-from-website.md
   §1 and §13. What these hold: Mithun's words for the row (D1); owner and
   editors alike see the row (D2); the credit switch is there and on by default
   (D3); the logo candidates are shown with which looks like the organisation's
   own and which a partner's (D4); a JavaScript-only site is said plainly (D5);
   no fonts or tab icon in phase 1 (D6, D7); Undo is one step (D9); nothing is
   pill-shaped; every wait shows the mark and words; the creator never reads
   "theme", "palette", "hex", "WCAG", "scrape", "fetch" or "render". Regex
   checks on source, like navigate-test.mjs. */

const look = fs.readFileSync(ROOT + '/atlas/owner-look.js', 'utf8');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
const css = fs.readFileSync(ROOT + '/atlas/owner.css', 'utf8');
const viewer = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
// the words a creator reads: every string literal in owner-look.js
const strings = (look.match(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g) || []).map((s) => s.slice(1, -1));

console.log('\n  the row in Settings');
check('owner.js leaves a slot after the website field, and owner-look.js draws into it', /\/label>' \+\n(?:\s*\/\*[\s\S]*?\*\/\n)?\s*'<div id="own-look"><\/div>' \+/.test(owner) && /var host = scrim\.querySelector\("#own-look"\);/.test(look), true);
check('the row reads as Mithun wrote it (D1)', /Provide a website for visual style and design reference\./.test(look), true);
check('owner.js loads owner-look.js beside owner-modes.js, at the same version stamp, and hands over what it owns', /look\.src = "\.\/owner-look\.js" \+ \(v \? "\?" \+ v\[0\]\.slice\(1\) : ""\);/.test(owner) && /LOOK_KIT = window\.LokaOwnerLook\.mount\(\{ api: api, errMsg: errMsg, esc: esc, toast: toast, openDialog: openDialog, closeDialog: closeDialog, inst: INST, slug: SLUG, preview: preview/.test(owner), true);
check('and asks it to draw the row every time Settings opens', /wireLogo\(scrim\); if \(LOOK_KIT\) LOOK_KIT\.settings\(scrim\);/.test(owner), true);
check('the row is not behind an owner-only gate: editors see it too (D2)', /owner \? [^;]*own-look/.test(owner), false);
check('it says where the look is from today, or that it is LOKA’s own', /"Look from " \+ src\.host/.test(look) && /"LOKA’s own look"/.test(look), true);
check('Back to LOKA’s look calls DELETE /look; Undo calls POST /look/undo — one step (D9)', /"DELETE", "look"/.test(look) && /"POST", "look\/undo"/.test(look), true);
check('the credit switch, on by default, posts to /look/credit (D3)', /id="own-look-credit"/.test(look) && /\/look\/credit", \{ method: "POST", body: \{ on: box\.checked \} \}/.test(look) && /checked = !!\(t && t\.credit !== false\)/.test(look), true);
check('after any change the page is repainted from its own files: the old variables cleared first', /function repaint\(scrim\) \{\n\s*if \(window\.LokaTheme\) window\.LokaTheme\.clear\(document\);\n\s*if \(window\.LokaAtlas && window\.LokaAtlas\.dataChanged\) window\.LokaAtlas\.dataChanged\(\);\n\s*preview\(SLUG\);/.test(look), true);
check('and the Logo block in the open Settings sheet shows the logo as it now is', /function syncLogoBlock\(scrim\)/.test(look) && /now\.hidden = !STATE\.hasLogo;/.test(look), true);

console.log('\n  the sheet');
check('one address box, Read the site, and the promise that nothing changes until Use this look', /id="look-url"/.test(look) && /id="look-read">Read the site</.test(look) && /Nothing is changed until you press <b>Use this look<\/b>\./.test(look), true);
check('it is filled in from the website field in Identity', /value="' \+ esc\(STATE\.site \|\| \(INST\.branding && INST\.branding\.orgUrl\) \|\| ""\)/.test(look), true);
check('the read shows the wait mark at once, with how long it takes', /LokaWait\.start\(go, "Reading the site…", \{ delay: 0 \}\)/.test(look) && /"This takes a few seconds\."/.test(look), true);
check('the proposal names the slots in plain words', /page: "page", text: "words", accent: "links and buttons", highlight: "chosen place", surfaceAlt: "shading"/.test(look), true);
check('each tile says the site’s own colour and use: “the site’s purple: links and buttons”', /"the site’s " \+ f\.name \+ \(f\.usedFor \? ": " \+ f\.usedFor : ""\)/.test(look), true);
check('a colour can be swapped for another the site uses, and the rule is run again here (look-map.js, the same file the server runs)', /window\.LokaLookMap\.map\(\{ colours: f\.colours, page: f\.page, text: f\.text, corners: f\.corners/.test(look) && /P\.chosen\[slot\] = c\.hex; remap\(scrim\);/.test(look), true);
check('look-map.js is fetched by the sheet when first needed, at the same version stamp — visitors never load it', /s\.src = "\.\/look-map\.js" \+ VERSION;/.test(look) && !/look-map\.js/.test(page), true);
check('what the guard changed is said under the tiles', /id="look-lines"/.test(look) && /\(P\.lines \|\| \[\]\)\.forEach/.test(look), true);
check('the logo candidates are listed with the words for each — own, partner’s, the icon (D4)', /esc\(l\.words\)/.test(look) && /l\.verdict === "partner" \? " own-look-logo-no"/.test(look), true);
check('and “No logo from the site” is always a choice', /No logo from the site/.test(look), true);
check('the rights line, off by default; Use this look waits for it when a logo is picked', /This is my organisation’s own site and logo, and I may use them here\./.test(look) && /use\.disabled = P\.logoPick >= 0 && !P\.rights;/.test(look), true);
check('the credit switch in the sheet too, on by default', /<input type="checkbox" id="look-credit" checked \/>/.test(look), true);
check('what was left out is folded', /<details class="own-look-left" id="look-left"><summary>What we left out<\/summary>/.test(look), true);
check('a JavaScript-only site is said plainly (D5)', /That site draws itself in the browser, so we could only read part of it\. Here is what we found\./.test(look), true);
check('the preview is this very atlas in a frame (?embed=1, with the key of a private atlas), with Now / With the site’s look', /f\.src = "\.\/\?dataset=" \+ encodeURIComponent\(SLUG\) \+ "&embed=1" \+ \(key\(\) \? "&key=" \+ encodeURIComponent\(key\(\)\) : ""\);/.test(look) && /id="look-sw-now" aria-pressed="false">Now</.test(look) && /id="look-sw-with" aria-pressed="true">With the site’s look</.test(look), true);
check('the frame is told by message, to this origin only', /f\.contentWindow\.postMessage\(msg, location\.origin\)/.test(look) && /type: "loka-look-preview"/.test(look), true);
check('the frame shows the wait mark until it has loaded', /LokaWait\.html\("Opening the preview…"\)/.test(look), true);
check('Use this look saves the block, the logo as the browser made it (logo-tools), and the credit choice', /body: \{ theme: theme, useLogo: useLogo, logoData: useLogo \? P\.logoPng : undefined \}/.test(look) && /Object\.assign\(\{\}, P\.theme, \{ credit: P\.credit \}\)/.test(look), true);
check('…with the wait mark on the button', /LokaWait\.start\(btn, "Saving the look…"\)/.test(look), true);
check('and afterwards the sheet closes, Settings says so, and the page repaints', /closeDialog\(scrim\);\n\s*paint\(settingsScrim\);\n\s*repaint\(settingsScrim\);/.test(look), true);
check('Not now closes the sheet with nothing changed', /id="look-not" data-close>Not now</.test(look), true);
check('no fonts and no tab icon in phase 1 (D6, D7)', /fonts|favicon|rel="icon"/.test(look), false);

console.log('\n  words and shapes');
const banned = /\b(theme|palette|token|hex|contrast ratio|WCAG|scrape|scraped|fetch|fetched|render|rendered)\b/i;
check('the creator never reads theme, palette, hex, WCAG, scrape, fetch or render', strings.filter((s) => /\s/.test(s) && banned.test(s)), []);
check('the tiles and the switch are square-cornered; nothing pill-shaped', /\.own-look-swatch \{[^}]*border-radius:0;/.test(css) && /\.own-look-sw \{[^}]*border-radius:0;/.test(css) && !/own-look[^{]*\{[^}]*border-radius:\s*(9+px|50%|[2-9]\d+px)/.test(css), true);
check('a light logo sits on a dark tile', /\.own-look-logo-pic\.own-look-logo-dark \{ background:#24211D; \}/.test(css), true);
check('the switch is two plain buttons, one pressed', /\.own-look-sw\[aria-pressed="true"\] \{ background:var\(--color-leaf\); color:#fff; \}/.test(css), true);
check('logo-tools is loaded at the same version stamp when needed', /s\.src = "\.\/logo-tools\.js" \+ VERSION;/.test(look), true);

console.log('\n  the visitor’s one trace: the credit line');
check('index.html has the line, hidden until a look says where it is from', /<p class="cr-look" id="look-credit" hidden><\/p>/.test(page), true);
check('atlas.js fills it from theme.source unless credit is off, in plain words', /look\.hidden = !sayLook;/.test(viewer) && /manifest\.theme\.credit !== false/.test(viewer) && /"Colours" \+ \(manifest\.branding && manifest\.branding\.logo \? " and logo" : ""\) \+ " from " \+ src\.host/.test(viewer), true);
check('nothing else new for visitors: no control, no switch, and the badge rule is as it was', /loka-look/.test(page.split('<body')[1] || ''), false);
check('the badge still sets LOKA’s colours back for itself', /\.loka-badge \{ --color-text-primary:#24211D/.test(page), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
