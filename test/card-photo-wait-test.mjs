/* Run me with: node test/run.mjs — or on my own with node.
 *
 * A card never shows an empty box where a photograph should be.
 *
 * Seen on the Cubbon Park atlas: a card opened with a tall blank band above
 * its words. The photographs there are most of a megabyte each; the browser
 * learns a photo's size from its first few hundred bytes, makes room for it,
 * and fills that room a second or two later. Until then the room was empty.
 * Now the room says a photo is coming, and if the photo never comes the room
 * is taken away. These checks run the card's own code from atlas.js against a
 * small stand-in for the page. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const html = fs.readFileSync(ROOT + '/atlas/index.html', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function grab(re, what) {
  const m = src.match(re);
  if (!m) { console.log('  FAIL  ' + what + ' could not be found in atlas.js'); process.exit(1); }
  return m[0];
}

const shotsSrc = grab(/\n  var SHOTS_MAX = 12;[\s\S]*?\n  function shotsHTML\(urls\) \{[\s\S]*?\n  \}\n/, 'shotsHTML');
const settledSrc = grab(/\n  function shotSettled\(img, ok\) \{[\s\S]*?\n  \}\n/, 'shotSettled');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shotsHTML = new Function('esc', shotsSrc + '; return shotsHTML;')(esc);
const shotSettled = new Function(settledSrc + '; return shotSettled;')();

const A = 'https://loka.place/api/images/a.jpg';
const B = 'https://loka.place/api/images/b.jpg';
const C = 'https://loka.place/api/images/c.jpg';

console.log('\n  while a photograph is on its way');
const one = shotsHTML([A]);
check('its room starts out waiting', /class="pop-shots is-waiting"/.test(one), true);
check('and says so in plain words', /Loading photo…/.test(one), true);
check('with a picture of a photo, not a spinner', /<svg[^>]*>[\s\S]*<rect[\s\S]*<\/svg>Loading/.test(one), true);
check('which a screen reader is spared', /class="pop-shot-wait" aria-hidden="true"/.test(one), true);
check('the room is held at photo height while it waits', /\.pop-shots\.is-waiting \{ min-height:180px; \}/.test(html), true);
check('the panel shows only while waiting',
  /\.pop-shot-wait \{[^}]*display:none/.test(html) && /\.pop-shots\.is-waiting \.pop-shot-wait \{ display:flex; \}/.test(html), true);
check('the photograph paints over the panel as it arrives', /\.pop-shots \.pop-img \{ margin:0; position:relative; \}/.test(html), true);
check('the first photograph is fetched at once', /loading="eager"/.test(one), true);
const three = shotsHTML([A, B, C]);
check('the rest of a carousel wait for a swipe', (three.match(/loading="lazy"/g) || []).length, 2);
check('every photograph reports when it arrives', (three.match(/onload="atlasShotSettled\(this,true\)"/g) || []).length, 3);
check('and when it fails', (three.match(/onerror="atlasShotSettled\(this,false\)"/g) || []).length, 3);
check('the old hide-only-the-picture rule is gone', /onerror="this\.style\.display/.test(src), false);
check('the page can reach the handler', /window\.atlasShotSettled = shotSettled;/.test(src), true);
check('no photographs, no room at all', shotsHTML([]), '');

/* A small stand-in for the page: just what shotSettled touches. */
class El {
  constructor(cls, attrs = {}) {
    this.classes = new Set(cls.split(/\s+/).filter(Boolean));
    this.attrs = { ...attrs }; this.children = []; this.parentNode = null;
    this.textContent = ''; this.complete = false; this.naturalWidth = 0;
    this.style = {}; this.scrollLeft = 0; this.clientWidth = 300;
    const self = this;
    this.classList = {
      contains: (c) => self.classes.has(c),
      remove: (c) => self.classes.delete(c),
      add: (c) => self.classes.add(c),
    };
  }
  get className() { return [...this.classes].join(' '); }
  add(...kids) { kids.forEach((k) => { k.parentNode = this; this.children.push(k); }); return this; }
  removeChild(k) { this.children = this.children.filter((c) => c !== k); k.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  matches(sel) { return sel.split(',').some((s) => this.classes.has(s.trim().replace(/^\./, ''))); }
  closest(sel) { let e = this; while (e) { if (e.matches && e.matches(sel)) return e; e = e.parentNode; } return null; }
  querySelectorAll(sel) {
    const out = [];
    (function walk(e) { e.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); })(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function card(n) {
  const page = new El('pop');
  const imgs = Array.from({ length: n }, () => new El('pop-img'));
  const box = new El(n > 1 ? 'pop-shots many is-waiting' : 'pop-shots is-waiting', n > 1 ? { 'data-n': String(n) } : {});
  box.add(new El('pop-shot-wait'));
  if (n > 1) {
    const strip = new El('pop-strip').add(...imgs);
    const at = new El('pop-shot-at'); at.textContent = '1 / ' + n;
    box.add(strip, new El('pop-shot-go back'), new El('pop-shot-go on'), at);
  } else box.add(...imgs);
  page.add(box, new El('pop-caption'));
  return { page, box, imgs };
}
const arrive = (img) => { img.complete = true; img.naturalWidth = 720; shotSettled(img, true); };
const lose = (img) => { img.complete = true; img.naturalWidth = 0; shotSettled(img, false); };

console.log('\n  when it arrives');
{
  const { box, imgs } = card(1);
  arrive(imgs[0]);
  check('the waiting panel steps aside', box.classList.contains('is-waiting'), false);
  check('and the photograph stays', box.querySelectorAll('.pop-img').length, 1);
}

console.log('\n  when it never comes');
{
  const { page, box, imgs } = card(1);
  lose(imgs[0]);
  check('a lone photograph that fails takes its room with it', page.querySelector('.pop-shots'), null);
  check('so the card opens on its words', page.children[0].className, 'pop-caption');
  void box;
}
{
  const { page, imgs } = card(3);
  lose(imgs[0]); lose(imgs[1]);
  const box = page.querySelector('.pop-shots');
  check('a carousel keeps the photographs that work', box.querySelectorAll('.pop-img').length, 1);
  check('and loses its arrows when one is left', box.querySelectorAll('.pop-shot-go').length, 0);
  check('and its counter', box.querySelector('.pop-shot-at'), null);
  check('and stops calling itself several', box.classList.contains('many'), false);
  check('it still waits for the one that is left', box.classList.contains('is-waiting'), true);
  arrive(imgs[2]);
  check('until that one arrives', box.classList.contains('is-waiting'), false);
}
{
  const { page, imgs } = card(3);
  arrive(imgs[0]); lose(imgs[2]);
  const box = page.querySelector('.pop-shots');
  check('one lost of three counts what is left', box.querySelector('.pop-shot-at').textContent, '1 / 2');
  check('and tells the swipe how many there are', box.getAttribute('data-n'), '2');
  check('keeping its arrows', box.querySelectorAll('.pop-shot-go').length, 2);
}
{
  const { page, imgs } = card(2);
  lose(imgs[0]); lose(imgs[1]);
  check('a carousel where every photograph fails leaves no room behind', page.querySelector('.pop-shots'), null);
}
{
  const { page, imgs } = card(2);
  arrive(imgs[1]); lose(imgs[0]);
  check('a failure after another photograph arrived does not bring the panel back',
    page.querySelector('.pop-shots').classList.contains('is-waiting'), false);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
