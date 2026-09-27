#!/usr/bin/env node
/* Trim the coordinates of layers people have already added to six decimals.
 *
 *   node deploy/trim-uploaded-coordinates.mjs                  dry run: lists every file, bytes before → after
 *   node deploy/trim-uploaded-coordinates.mjs --apply          writes the changes
 *   node deploy/trim-uploaded-coordinates.mjs [--apply] root…  other folders instead of the two below
 *
 * New uploads are trimmed as they are committed (api/lib/atlas/coords.js). This
 * does the same, once, for the user-*.geojson files committed before that: in
 * every <root>/<slug>/ of the two folders the server reads atlases from
 * (atlas/datasets and api/data/atlas/private-datasets, under this checkout).
 *
 * Only coordinates change: rounded to six decimals (about 10 cm), with exact
 * repeated points that the rounding creates dropped from lines and outlines.
 * Names, columns, the number of places and their order are untouched.
 *
 * The deoria-bioregion atlas is never touched, nor its previews — a standing
 * rule. It is listed as skipped so its absence is visible, not silent.
 *
 * --apply saves <file>.pre-trim.bak beside each file it changes (never over an
 * existing one) and writes through a temporary file. A file that is already
 * trimmed is left alone, so running it twice changes nothing the second time.
 *
 * Rewriting a file changes its size and time, which is what the search index
 * checks to see if a layer changed: the next search on that atlas rebuilds the
 * layer's word list at once, and its meaning search re-embeds in the background.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trimFeatureCollection } from '../api/lib/atlas/coords.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];
export const NEVER = 'deoria-bioregion';
const USER_FILE = /^user-[a-z0-9-]+\.geojson$/;

export function isProtected(slug) {
  return slug === NEVER || slug.startsWith(NEVER + '--');
}

export function trimFile(file, { apply = false } = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const out = JSON.stringify(trimFeatureCollection(JSON.parse(text)));
  const before = Buffer.byteLength(text), after = Buffer.byteLength(out);
  // compare documents, not text: a file already trimmed but laid out
  // differently is not worth rewriting
  const changed = out !== text && out !== JSON.stringify(JSON.parse(text));
  if (changed && apply) {
    const bak = file + '.pre-trim.bak';
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    const tmp = file + '.trim-tmp';
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, file);
  }
  return { file, before, after: changed ? after : before, changed };
}

export function trimRoots(roots, opts = {}) {
  const results = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) { results.push({ root, missing: true }); continue; }
    for (const slug of fs.readdirSync(root).sort()) {
      if (slug.startsWith('.')) continue;                 // .building-*, .history
      const dir = path.join(root, slug);
      let st;
      try { st = fs.statSync(dir); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (isProtected(slug)) { results.push({ root, slug, skipped: true }); continue; }
      for (const name of fs.readdirSync(dir).sort()) {
        if (!USER_FILE.test(name)) continue;
        const file = path.join(dir, name);
        try { results.push({ root, slug, ...trimFile(file, opts) }); }
        catch (e) { results.push({ root, slug, file, error: e.message }); }
      }
    }
  }
  return results;
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function main(argv) {
  const apply = argv.includes('--apply');
  const named = argv.filter((a) => !a.startsWith('--'));
  const roots = (named.length ? named : DEFAULT_ROOTS).map((r) => path.resolve(r));
  console.log((apply ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write') + '\n');
  let files = 0, changed = 0, before = 0, after = 0, errors = 0;
  for (const r of trimRoots(roots, { apply })) {
    if (r.missing) { console.log('  (no such folder: ' + r.root + ')'); continue; }
    if (r.skipped) { console.log('  ' + r.slug + ': skipped, never touched'); continue; }
    if (r.error) { errors++; console.log('  ERROR ' + r.file + ': ' + r.error); continue; }
    files++; before += r.before; after += r.after;
    if (r.changed) changed++;
    console.log('  ' + r.slug + ' / ' + path.basename(r.file) + ': ' + kb(r.before) + ' → ' + kb(r.after) +
      (r.changed ? (apply ? '  trimmed' : '  would trim') : '  already trimmed'));
  }
  console.log('\n  ' + files + ' file(s), ' + changed + ' ' + (apply ? 'trimmed' : 'would be trimmed') +
    ', ' + kb(before) + ' → ' + kb(after) + (errors ? ', ' + errors + ' error(s)' : ''));
  return errors ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
