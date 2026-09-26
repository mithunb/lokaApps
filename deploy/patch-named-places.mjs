#!/usr/bin/env node
/* One-off: give an existing atlas's "Named places" layer the name, look and
 * labels a fresh build now gives it (api/atlas-builders/recipes.py,
 * places_named). The layer's shapes and credits are untouched; only its name,
 * paint, labels, key, info line and card change.
 *
 *   node deploy/patch-named-places.mjs            # dry run: says what would change
 *   node deploy/patch-named-places.mjs --apply    # writes, keeping <file>.pre-places.bak
 *   node deploy/patch-named-places.mjs <root>...  # other dataset roots
 *
 * Default roots are the two the server uses: atlas/datasets and
 * api/data/atlas/private-datasets, under this checkout. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const roots = args.filter((a) => !a.startsWith('--'));
if (!roots.length) roots.push(path.join(ROOT, 'atlas/datasets'), path.join(ROOT, 'api/data/atlas/private-datasets'));

// Same groups and wording as places_label() in recipes.py — keep the two in step.
const GROUPS = [
  [['sanctuary', 'national park', 'community reserve', 'conservation reserve', 'tiger reserve'], 'protected areas', 'protected area'],
  [['mountain range'], 'mountain ranges', 'mountain range'],
  [['wetland'], 'wetlands', 'wetland'],
  [['ward'], 'wards', 'ward'],
];
const cap = (t) => t[0].toUpperCase() + t.slice(1);
const list = (xs, last) => (xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + last + xs[xs.length - 1]);
export function placesLabel(kinds, one = false) {
  const k = new Set(kinds);
  const hit = GROUPS.filter(([ks]) => ks.some((x) => k.has(x)));
  if (!hit.length) return one ? 'Named place' : 'Named places';
  return cap(one ? list(hit.map((g) => g[2]), ' or ') : list(hit.map((g) => g[1]), ' & '));
}

export function patchLayer(L, kinds) {
  const label = placesLabel(kinds);
  const credits = L.attribution || '';
  L.label = label;
  L.paint = { fillColor: '#A39E94', fillOpacity: 0.08, outlineColor: '#5A5751', outlineWidth: 1.2, outlineDash: [3, 2] };
  L.label_text = { property: 'name', size: 11.5, color: '#5A5751', haloColor: '#F5F1E6', haloWidth: 2, transform: 'none', letterSpacing: 0.01 };
  L.legend = [{ color: '#5A5751', label: placesLabel(kinds, true), shape: 'dashed' }];
  L.popup = { title: 'name', fields: [{ label: 'What it is', property: 'kind' }, { label: 'State', property: 'state' }] };
  L.info = 'Background only: ' + label.toLowerCase() + ' in this region, each with its name. Tap one to see what it is.' + (credits ? ' ' + credits : '');
  return L;
}

let files = 0, layers = 0;
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(APPLY ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write');
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root)) {
      if (slug.startsWith('.')) continue;
      const dir = path.join(root, slug);
      for (const name of ['manifest.json', 'manifest.local.json']) {
        const file = path.join(dir, name);
        if (!fs.existsSync(file)) continue;
        const m = JSON.parse(fs.readFileSync(file, 'utf8'));
        let changed = false;
        for (const L of m.layers || []) {
          if (L.id !== 'places' || !/places\.geojson$/.test(String(L.source || ''))) continue;
          const gj = path.join(dir, String(L.source).split('/').pop());
          if (!fs.existsSync(gj)) continue;
          const kinds = [...new Set(JSON.parse(fs.readFileSync(gj, 'utf8')).features.map((f) => f.properties && f.properties.kind).filter(Boolean))];
          const before = JSON.stringify(L);
          patchLayer(L, kinds);
          if (JSON.stringify(L) === before) continue;
          changed = true; layers++;
          console.log(`  ${slug} / ${name}: "${JSON.parse(before).label}" → "${L.label}"`);
        }
        if (!changed) continue;
        files++;
        if (APPLY) {
          const bak = file + '.pre-places.bak';
          if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
          const tmp = file + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(m, null, 2) + '\n');
          fs.renameSync(tmp, file);
        }
      }
    }
  }
  console.log(`\n  ${files} file(s), ${layers} layer(s) ${APPLY ? 'changed' : 'would change'}`);
}
