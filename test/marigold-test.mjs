/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Shaded layers switch to marigold: the ramp at any number of steps, the old
   ramp names still meaning something, and the one-off repaint of built atlases.
   The repaint check writes only into a temporary folder it removes. */
const frag = await import(ROOT + '/api/lib/fragment.js');
const mig = await import(ROOT + '/deploy/migrate-ramps-marigold.mjs');
const { marigoldRamp, rampFor, PALETTES, PALETTE_ALIASES, RETIRED_RAMPS, buildFragment } = frag;

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function lightness(hex) {
  const lin = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const Y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.0721750 * lin[2];
  return Y > 216 / 24389 ? 116 * Math.cbrt(Y) - 16 : (24389 / 27) * Y;
}
const falling = (ramp) => ramp.every((c, i) => i === 0 || lightness(c) < lightness(ramp[i - 1]));
const MARIGOLD = ['#FBF1D9', '#F4CF82', '#E9A237', '#D2692A', '#A8321A'];

console.log('\n  marigold at any number of steps');
check('five steps are the five anchors, exactly', marigoldRamp(5), MARIGOLD);
for (const n of [3, 4, 6, 7]) {
  const r = marigoldRamp(n);
  check(n + ' steps: that many colours', r.length, n);
  check(n + ' steps: palest and darkest are the anchors’ ends', [r[0], r[n - 1]], [MARIGOLD[0], MARIGOLD[4]]);
  check(n + ' steps: every step darker than the one before', falling(r), true);
  check(n + ' steps: all plain hex colours', r.every((c) => /^#[0-9A-F]{6}$/.test(c)), true);
}
check('three steps land on the middle anchor', marigoldRamp(3)[1], MARIGOLD[2]);
check('asking again does not change the anchors', (marigoldRamp(5)[0] = 'x', PALETTES.marigold[0]), MARIGOLD[0]);

console.log('\n  the retired ramp names still mean something');
for (const name of ['greens', 'ylorbr', 'rust', 'purples']) {
  check(name + ' now paints marigold', rampFor(name), MARIGOLD);
  check(name + ' is no longer offered', name in PALETTES, false);
  check(name + ' is kept only to be recognised', Array.isArray(RETIRED_RAMPS[name]), true);
}
check('blue stays blue', rampFor('blues')[0], '#e6ebec');
check('the diverging pair stays', [rampFor('brteal')[0], rampFor('tealbr')[0]], ['#8a5a25', '#2c625d']);
check('the older retired names still go where they went', [PALETTE_ALIASES.rdylgn, PALETTE_ALIASES.gnrd], ['brteal', 'tealbr']);
check('the ramps offered, marigold first', Object.keys(PALETTES), ['marigold', 'blues', 'brteal', 'tealbr']);

console.log('\n  a shaded layer keeps every class it asked for');
const feats = Array.from({ length: 60 }, (_, i) => ({ type: 'Feature', properties: { name: 'p' + i, v: i }, geometry: { type: 'Point', coordinates: [0, 0] } }));
for (const [palette, n] of [['greens', 6], ['marigold', 7], [undefined, 5], ['marigold', 3]]) {
  const { stanza } = buildFragment({ kind: 'choropleth', label: 'Shade', valueColumn: 'v', palette, classCount: n }, feats, []);
  const paint = stanza.paint.fillColor.filter((x) => typeof x === 'string' && x.startsWith('#'));
  const key = stanza.legend.filter((l) => l.color !== 'transparent').map((l) => l.color);
  check((palette || 'no ramp named') + ', ' + n + ' classes: ' + n + ' colours on the map', paint.length, n);
  check((palette || 'no ramp named') + ', ' + n + ' classes: the key matches the map', key, paint);
  check((palette || 'no ramp named') + ', ' + n + ' classes: marigold', paint, marigoldRamp(n));
}
const blue = buildFragment({ kind: 'choropleth', label: 'Rain', valueColumn: 'v', palette: 'blues', classCount: 6 }, feats, []).stanza;
check('a blue layer still paints blue', blue.legend[0].color, '#e6ebec');

console.log('\n  repainting built atlases');
const G = RETIRED_RAMPS.greens, Y = RETIRED_RAMPS.ylorbr;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marigold-'));
try {
  const dir = path.join(tmp, 'demo');
  fs.mkdirSync(dir);
  const manifest = {
    title: 'Demo',
    layers: [
      { id: 'div', type: 'categories', diversity: { ramp: G, max: 5 } },
      { id: 'share', type: 'fill', paint: { fillColor: ['step', ['get', 'x'], Y[0], 1, Y[1].toUpperCase(), 2, Y[2]] },
        legend: [{ color: Y[0], label: 'a' }, { color: Y[1], label: 'b' }, { color: Y[2], label: 'c' }] },
      { id: 'one', type: 'fill', paint: { fillColor: G[3] }, legend: [{ color: G[3], label: 'just one colour' }] },
      { id: 'rain', type: 'fill', paint: { fillColor: ['step', ['get', 'r'], ...PALETTES.blues.slice(0, 3)] } },
      { id: 'pic', type: 'image', source: 'pic.json', legend: [{ color: G[0] }, { color: G[1] }] },
    ],
  };
  const file = path.join(dir, 'manifest.json');
  const before = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(file, before);
  const local = path.join(dir, 'manifest.local.json');
  fs.writeFileSync(local, JSON.stringify({ layers: [{ id: 'mine', paint: { fillColor: ['step', ['get', 'v'], G[0], 1, G[1]] }, spec: { palette: 'greens' } }] }, null, 1));

  const dry = mig.migrateRoots([tmp]);
  check('a dry run writes nothing', fs.readFileSync(file, 'utf8'), before);
  check('a dry run leaves no backup', fs.existsSync(file + '.pre-marigold.bak'), false);
  const found = dry.flatMap((r) => r.report.map((l) => [path.basename(r.file), l.layer, l.ramp, l.count]));
  check('it says which layers, which ramp and how many colours', found,
    [['manifest.json', 'div', 'greens', 6], ['manifest.json', 'share', 'ylorbr', 6], ['manifest.local.json', 'mine', 'greens', 2]]);

  mig.migrateRoots([tmp], { apply: true });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const L = Object.fromEntries(after.layers.map((l) => [l.id, l]));
  check('the six-step diversity ramp becomes marigold in six', L.div.diversity.ramp, marigoldRamp(6));
  check('a three-class layer becomes marigold in three, whatever the case of its colours', L.share.paint.fillColor, ['step', ['get', 'x'], ...[0, 1, 2].flatMap((i) => (i ? [i, marigoldRamp(3)[i]] : [marigoldRamp(3)[0]]))]);
  check('its key moves with it', L.share.legend.map((l) => l.color), marigoldRamp(3));
  check('the labels are untouched', L.share.legend.map((l) => l.label), ['a', 'b', 'c']);
  check('a layer painted one colour keeps it', [L.one.paint.fillColor, L.one.legend[0].color], [G[3], G[3]]);
  check('a blue layer keeps its blues', L.rain.paint.fillColor, manifest.layers[3].paint.fillColor);
  check('a picture layer is left alone', L.pic.legend, manifest.layers[4].legend);
  check('the rest of the file is untouched', after.title, 'Demo');
  const loc = JSON.parse(fs.readFileSync(local, 'utf8')).layers[0];
  check('an added layer is repainted too', loc.paint.fillColor, ['step', ['get', 'v'], ...marigoldRamp(2).flatMap((c, i) => (i ? [1, c] : [c]))]);
  check('its saved ramp name is left for the server to resolve', loc.spec.palette, 'greens');
  check('the added layer file keeps its own layout', fs.readFileSync(local, 'utf8').startsWith('{\n "layers"'), true);
  check('the old file is backed up beside it', fs.readFileSync(file + '.pre-marigold.bak', 'utf8'), before);

  const once = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file + '.pre-marigold.bak', 'first backup');
  const again = mig.migrateRoots([tmp], { apply: true });
  check('a second run changes nothing', [fs.readFileSync(file, 'utf8') === once, again.some((r) => r.changed)], [true, false]);
  check('and never overwrites a backup', fs.readFileSync(file + '.pre-marigold.bak', 'utf8'), 'first backup');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n  the committed Deoria atlas');
const deoria = fs.readFileSync(ROOT + '/atlas/datasets/deoria-bioregion/manifest.json', 'utf8').toLowerCase();
check('holds no retired ramp colour', Object.values(mig.OLD_RAMPS).flat().filter((c) => deoria.includes('"' + c + '"')), []);

console.log('\n  the builders');
const recipes = fs.readFileSync(ROOT + '/api/atlas-builders/recipes.py', 'utf8');
check('the builders’ marigold is the atlas’s', recipes.includes('MARIGOLD = ' + JSON.stringify(MARIGOLD).replace(/,/g, ', ')), true);
check('their four-step marigold is the resampled one', recipes.includes('MARIGOLD_4 = ' + JSON.stringify(marigoldRamp(4)).replace(/,/g, ', ')), true);
check('rainfall stays blue', recipes.includes('"#dce9e0", "#a9ccc9", "#6fb0bd", "#3d86ad", "#264f96"'), true);
check('surface water stays blue', recipes.includes('"#bcd6e8", "#6aa8d8", "#2166ac"'), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
