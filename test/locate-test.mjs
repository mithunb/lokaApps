// "Where am I" (atlas/locate.js): when the map moves to you, and what it says when you are far
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
};
globalThis.window = globalThis;
await import(path.join(ROOT, 'atlas', 'locate.js'));
const LL = globalThis.LokaLocate;
const box = (w, s, e, n) => ({ getSouthWest: () => ({ lng: w, lat: s }), getNorthEast: () => ({ lng: e, lat: n }) });
const panaji = LL.nearTest(box(73.80, 15.47, 73.85, 15.51));
check('a walk across Panaji is near the festival map', panaji([73.83, 15.50]).near, true);
check('Margao, 30 km off, is not', panaji([73.96, 15.27]).near, false);
check('…and Bengaluru is about 490 km away, in words', LL.farWords(panaji([77.59, 12.97]).m), 'about 490 km');
check('a small atlas still counts 20 km round it as near', panaji([73.83 + 0.15, 15.49]).near, true);
const india = LL.nearTest(box(68, 8, 97, 37));
check('on a map of India, anywhere in India is near', india([77.59, 12.97]).near, true);
check('no first view yet: everything is near, the map follows you', LL.nearTest(null)([0, 0]).near, true);

const atlas = fs.readFileSync(path.join(ROOT, 'atlas', 'atlas.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'atlas', 'index.html'), 'utf8');
check('event guides get the button, above the zoom buttons; other atlases do not', /NavigationControl[^\n]*\n[^\n]*\n[^\n]*\n\s*if \(EV && window\.LokaLocate\) map\.addControl\(new LokaLocate\.Control\(\{ padding: viewPadding \}\), "bottom-right"\)/.test(atlas), true);
check('index.html loads locate.js before atlas.js', html.indexOf('locate.js') > 0 && html.indexOf('locate.js') < html.indexOf('src="./atlas.js'), true);
const src = fs.readFileSync(path.join(ROOT, 'atlas', 'locate.js'), 'utf8');
check('the position is never sent anywhere', /fetch\(|XMLHttpRequest|sendBeacon/.test(src), false);
check('the iPhone compass is asked for inside the tap', /tap = function[\s\S]*?this\.askFacing\(\);[\s\S]*?this\.start\(\)/.test(src), true);

const ev = fs.readFileSync(path.join(ROOT, 'atlas', 'event-mode.js'), 'utf8');
check('event guide: one chip at a time — no chip is ever switched on beside another', /on\[c\.id\] = true/.test(ev), false);
check('…choosing a chip puts the others away', /function choose\(id\) \{\s*CATS\.forEach\(function \(c\) \{ on\[c\.id\] = c\.id === id; \}\);/.test(ev), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
