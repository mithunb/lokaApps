#!/usr/bin/env node
/* Rebuild every atlas's search words so nobody's name is in them.
 *
 *   node deploy/rebuild-search-index.mjs                   dry run: says what it would do, writes nothing
 *   node deploy/rebuild-search-index.mjs --apply           rewrites the search words, removes stale meaning files
 *   node deploy/rebuild-search-index.mjs [--apply] root…   other folders instead of the two below
 *
 * Until 25 Oct 2026 the visitor's search read every answer, including the
 * answers to questions about who made a record, so typing a contributor's name
 * lit up their places. The server now leaves those out (api/lib/atlas/
 * search-text.js), but an atlas built before that still has the names in its
 * saved words (search.local.json) and in its meaning files (search-<layer>.vec).
 *
 * For each contributed layer this script:
 *   - writes the layer's words again with the same code the server uses
 *     (search.local.json), and
 *   - removes the layer's meaning file when it was built before the fix, so
 *     deploy/queue-meaning-index.mjs lists it and the server builds it again.
 * It writes nothing else: no atlas data, no manifest. The deoria-bioregion
 * atlas is never touched (standing rule); it is listed as skipped.
 *
 * Run it on the server with pm2 stopped (the server rule for anything that
 * writes into an atlas folder), then start pm2 and run queue-meaning-index.mjs
 * --apply. Running it twice changes nothing the second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEVER_READ } from '../api/lib/atlas/questions-queue.js';
import { layerVocabTerms } from '../api/lib/atlas/search-text.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];
const INDEX_V = 4;        // api/apps/atlas.js SEARCH_INDEX_V
const ROW_VEC_V = 3;      // api/apps/atlas.js ROW_VEC_V
const MAX_TERMS = 300;    // api/apps/atlas.js SEARCH_MAX_TERMS

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function searchable(L) {
  return L && L.id && L.source && (L.userLayer || /^user-[a-z0-9-]+\.geojson$/.test(String(L.source)));
}
function sigOf(dir, L) {
  try { const st = fs.statSync(path.join(dir, String(L.source))); return st.size + ':' + Math.round(st.mtimeMs); }
  catch { return ''; }
}
function vecVersion(file) {
  let buf = null;
  try { buf = fs.readFileSync(file); } catch { return null; }
  const nl = buf.indexOf(10);
  try { const h = nl > 0 ? JSON.parse(buf.subarray(0, nl).toString('utf8')) : null; return h ? h.v : 0; } catch { return 0; }
}

/* What would change, and (with apply) the change. Answers a list of lines. */
export function rebuild(roots, apply) {
  const report = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root).sort()) {
      const dir = path.join(root, slug);
      if (slug.startsWith('.') || slug.includes('--draft-')) continue;
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      // a linked folder is left alone unless it really lives inside this repo's own dataset folders
      if (fs.lstatSync(dir).isSymbolicLink() && !DEFAULT_ROOTS.some((r) => { try { return fs.realpathSync(dir).startsWith(fs.realpathSync(r) + path.sep); } catch { return false; } })) continue;
      // deoria is refused by name in any case, and by where the folder really is (a link cannot hide it)
      let real = '';
      try { real = fs.realpathSync(dir); } catch { continue; }
      if (NEVER_READ.has(slug.toLowerCase()) || /deoria-bioregion/i.test(slug) || /deoria-bioregion/i.test(real)) { report.push({ dataset: slug, skipped: 'never touched (standing rule)' }); continue; }
      const local = readJSON(path.join(dir, 'manifest.local.json'));
      const manifest = readJSON(path.join(dir, 'manifest.json'));
      const layers = [...((manifest && manifest.layers) || []), ...((local && local.layers) || [])];
      const indexFile = path.join(dir, 'search.local.json');
      const idx = readJSON(indexFile) || {};
      let wrote = false;
      for (const L of layers) {
        if (!searchable(L)) continue;
        const sig = sigOf(dir, L);
        if (!sig) continue;
        const gj = readJSON(path.join(dir, String(L.source)));
        const features = (gj && gj.features) || [];
        if (!features.length) continue;
        const terms = layerVocabTerms(L, features, MAX_TERMS);
        const next = { v: INDEX_V, sig, terms: terms.map((t) => ({ t })) };
        const same = idx[L.id] && JSON.stringify(idx[L.id]) === JSON.stringify(next);
        const vecFile = /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(L.id)) ? path.join(dir, 'search-' + L.id + '.vec') : null;
        const vv = vecFile ? vecVersion(vecFile) : null;
        const staleVec = vv !== null && vv !== ROW_VEC_V;
        if (!same || staleVec) report.push({ dataset: slug, layerId: L.id, words: !same, vecRemoved: staleVec });
        if (!apply) continue;
        if (!same && terms.length) { idx[L.id] = next; wrote = true; }
        if (staleVec) fs.rmSync(vecFile, { force: true });
      }
      if (apply && wrote) {
        const tmp = indexFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(idx));
        fs.renameSync(tmp, indexFile);
      }
    }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const roots = args.filter((a) => !a.startsWith('--'));
  const report = rebuild(roots.length ? roots.map((r) => path.resolve(r)) : DEFAULT_ROOTS, apply);
  for (const r of report) {
    if (r.skipped) console.log('skipped  ' + r.dataset + ' — ' + r.skipped);
    else console.log((apply ? 'rebuilt  ' : 'would rebuild  ') + r.dataset + ' / ' + r.layerId +
      (r.words ? ' · search words' : '') + (r.vecRemoved ? ' · old meaning file removed' : ''));
  }
  console.log(report.filter((r) => !r.skipped).length + ' layer(s) ' + (apply ? 'rebuilt.' : 'need it (dry run, nothing written).'));
  if (apply) console.log('Next: start pm2, then node deploy/queue-meaning-index.mjs --apply');
}
