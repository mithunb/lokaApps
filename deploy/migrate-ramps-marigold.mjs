#!/usr/bin/env node
/* Repaint built atlases' shaded layers in marigold, without rebuilding them.
 *
 *   node deploy/migrate-ramps-marigold.mjs --print-roots
 *   node deploy/migrate-ramps-marigold.mjs [root ...]            dry run: says what would change
 *   node deploy/migrate-ramps-marigold.mjs --apply [root ...]    writes the changes
 *
 * With no roots named it uses the two the server reads atlases from (the same
 * paths api/lib/atlas/jobs.js builds: atlas/datasets and
 * api/data/atlas/private-datasets, both under this checkout).
 *
 * In every <root>/<slug>/manifest.json and manifest.local.json, each layer that
 * holds two or more colours of ONE retired ramp (greens, rust, ylorbr, purples,
 * and the builders' old district-indicator green and rust) has those colours
 * swapped for marigold, wherever they sit in that layer — paint steps, a
 * diversity ramp, the legend. The colours the layer used are ranked light →
 * dark and given marigold at that many steps, so a five-class layer gets the
 * five anchors and a six-class one six steps across the same range. That is
 * exactly what a fresh build now paints, so the key and the map agree.
 *
 * Only colours change. Labels, breaks, data and layer names are untouched, and
 * nothing is rebuilt or re-committed. Picture layers (a coloured image with a
 * key beside it) are skipped: their pixels cannot be repainted from here, and a
 * new key over old pixels would lie. A layer's saved ramp NAME (spec.palette)
 * is left as it is: the server resolves the retired names to marigold.
 *
 * --apply saves <file>.pre-marigold.bak beside each file it changes (never
 * over an existing one). Running it twice changes nothing the second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETIRED_RAMPS, marigoldRamp } from '../api/lib/fragment.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT) and
// api/lib/atlas/registry.js (DATA_DIR); not imported, because those modules
// load the job queue and registry the moment they are imported
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];

// every ramp a built atlas may carry that marigold replaces, light → dark
export const OLD_RAMPS = {
  ...RETIRED_RAMPS,
  // api/atlas-builders/recipes.py _GREEN / _RUST (district indicators) before September 2026
  'indicator-green': ['#eef2e3', '#c9d6a8', '#9fb673', '#6f8f4a', '#4a5a33'],
  'indicator-rust': ['#f2e3d6', '#e0b48f', '#cf8a5a', '#b25e30', '#7c3616'],
};
const FILES = ['manifest.json', 'manifest.local.json'];
const HEX = /"(#[0-9a-fA-F]{6})"/g;

function isPicture(layer) {
  return layer && (layer.type === 'image' || layer.type === 'raster' ||
    /\.(json|png|jpe?g|webp)$/i.test(String(layer.source || '')));
}

// What would change in one layer: { ramp, map: {oldLower: newHex}, count } or null.
export function planLayer(layer) {
  if (!layer || typeof layer !== 'object' || isPicture(layer)) return null;
  const text = JSON.stringify(layer);
  const found = new Set([...text.matchAll(HEX)].map((m) => m[1].toLowerCase()));
  const hits = [];
  for (const [name, ramp] of Object.entries(OLD_RAMPS)) {
    const idx = ramp.map((c, i) => (found.has(c.toLowerCase()) ? i : -1)).filter((i) => i >= 0);
    if (idx.length >= 2) hits.push({ name, ramp, idx });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.idx.length - a.idx.length);
  if (hits.length > 1 && hits[0].idx.length === hits[1].idx.length) {
    return { ramp: hits.map((h) => h.name).join(' / '), ambiguous: true, map: {}, count: 0 };
  }
  const { name, ramp, idx } = hits[0];
  const fresh = marigoldRamp(idx.length);
  const map = {};
  idx.forEach((i, rank) => { map[ramp[i].toLowerCase()] = fresh[rank]; });
  let count = 0;
  for (const m of text.matchAll(HEX)) if (map[m[1].toLowerCase()]) count++;
  return { ramp: name, steps: idx.length, map, count };
}

function recolour(value, map) {
  if (typeof value === 'string') return map[value.toLowerCase()] || value;
  if (Array.isArray(value)) return value.map((v) => recolour(v, map));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = recolour(v, map);
    return out;
  }
  return value;
}

// Character offsets [start, end) of each element of the top-level "layers"
// array, so the text of one layer can be edited without reflowing the file.
function layerSpans(text) {
  const spans = [];
  const stack = [];           // { t: '{'|'[', key }
  let key = null, lastString = null, inLayers = -1, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      lastString = text.slice(i + 1, j);
      i = j;
      continue;
    }
    if (ch === ':') { key = lastString; continue; }
    if (ch === '{' || ch === '[') {
      if (inLayers >= 0 && stack.length === inLayers + 1 && ch === '{') start = i;
      stack.push({ t: ch, key: stack.length === 1 ? key : null });
      if (ch === '[' && stack.length === 2 && stack[1].key === 'layers') inLayers = 1;
      key = null;
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      if (inLayers >= 0 && stack.length === inLayers + 1 && ch === '}' && start >= 0) {
        spans.push([start, i + 1]); start = -1;
      }
      if (inLayers >= 0 && stack.length === inLayers) inLayers = -1;
    }
  }
  return spans;
}

// Plan and (optionally) rewrite one manifest file. Returns a report.
export function migrateFile(file, { apply = false } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const doc = JSON.parse(text);
  const layers = Array.isArray(doc.layers) ? doc.layers : [];
  const plans = layers.map(planLayer);
  const report = plans.map((p, i) => p && { layer: layers[i].id || '#' + i, ...p }).filter(Boolean);
  const changing = plans.some((p) => p && p.count);
  if (!changing) return { file, report, changed: false };

  const wanted = { ...doc, layers: layers.map((L, i) => (plans[i] && plans[i].count ? recolour(L, plans[i].map) : L)) };
  // Edit the text in place, one layer's span at a time, so hand-laid-out
  // manifests keep their shape; fall back to a clean 2-space rewrite only if
  // the in-place edit did not land on exactly the intended document.
  let out = text;
  const spans = layerSpans(text);
  if (spans.length === layers.length) {
    for (let i = spans.length - 1; i >= 0; i--) {
      if (!plans[i] || !plans[i].count) continue;
      const [a, b] = spans[i];
      const seg = out.slice(a, b).replace(HEX, (m, h) => (plans[i].map[h.toLowerCase()] ? '"' + plans[i].map[h.toLowerCase()] + '"' : m));
      out = out.slice(0, a) + seg + out.slice(b);
    }
  }
  let same = false;
  try { same = JSON.stringify(JSON.parse(out)) === JSON.stringify(wanted); } catch {}
  if (!same) out = JSON.stringify(wanted, null, 2) + '\n';

  if (apply) {
    const bak = file + '.pre-marigold.bak';
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    const tmp = file + '.marigold-tmp';
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, file);
  }
  return { file, report, changed: true, reflowed: !same };
}

export function migrateRoots(roots, opts = {}) {
  const results = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) { results.push({ root, missing: true }); continue; }
    for (const slug of fs.readdirSync(root).sort()) {
      if (slug.startsWith('.')) continue;           // .building-*, .history
      const dir = path.join(root, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of FILES) {
        const file = path.join(dir, f);
        if (!fs.existsSync(file)) continue;
        try { results.push({ root, slug, ...migrateFile(file, opts) }); }
        catch (e) { results.push({ root, slug, file, error: e.message }); }
      }
    }
  }
  return results;
}

function main(argv) {
  const apply = argv.includes('--apply');
  if (argv.includes('--print-roots')) {
    for (const r of DEFAULT_ROOTS) console.log(r + (fs.existsSync(r) ? '' : '   (not here)'));
    return 0;
  }
  const named = argv.filter((a) => !a.startsWith('--'));
  const roots = (named.length ? named : DEFAULT_ROOTS).map((r) => path.resolve(r));
  console.log((apply ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write') + '\n');
  let files = 0, colours = 0, errors = 0;
  for (const r of migrateRoots(roots, { apply })) {
    if (r.missing) { console.log('  (no such folder: ' + r.root + ')'); continue; }
    if (r.error) { errors++; console.log('  ERROR ' + r.file + ': ' + r.error); continue; }
    for (const L of r.report) {
      if (L.ambiguous) { console.log('  ' + r.slug + ' / ' + path.basename(r.file) + ' / ' + L.layer + ': skipped, holds colours of ' + L.ramp + ' equally'); continue; }
      console.log('  ' + r.slug + ' / ' + path.basename(r.file) + ' / ' + L.layer + ': ' + L.ramp + ' (' + L.steps + ' steps) → marigold, ' + L.count + ' colour' + (L.count === 1 ? '' : 's') + (apply ? ' changed' : ' would change'));
      colours += L.count;
    }
    if (r.changed) { files++; if (r.reflowed) console.log('    (' + path.basename(r.file) + ' rewritten with 2-space indent)'); }
  }
  console.log('\n  ' + files + ' file(s), ' + colours + ' colour(s) ' + (apply ? 'changed' : 'would change') + (errors ? ', ' + errors + ' error(s)' : ''));
  return errors ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
