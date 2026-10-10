#!/usr/bin/env node
/* Put the layers whose search-by-meaning index is missing or stale on the
 * server's list, so each gets built once — public and private atlases alike.
 *
 *   node deploy/queue-meaning-index.mjs                   dry run: lists them, changes nothing
 *   node deploy/queue-meaning-index.mjs --apply           puts them on the list
 *   node deploy/queue-meaning-index.mjs [--apply] root…   other folders instead of the two below
 *   --queue FILE      the list to write to (default: api/data/atlas/meaning-index.json)
 *   --model NAME      the embedding model the server is using (default: GEMINI_EMBED_MODEL
 *                     from api/.env, or gemini-embedding-001, the server's own default)
 *
 * Search by meaning keeps one vector per place in search-<layerId>.vec beside
 * the layer's file (api/apps/atlas.js, "row vectors"). The server builds that
 * file the first time somebody searches the layer, whichever folder the atlas
 * lives in. This script is for building it BEFORE anyone searches: for the
 * atlases that were already live when the private folder got the same search
 * as the public one (October 2026), and for the day the embedding model
 * changes and every side-file goes stale at once. It finds every contributed
 * layer in <root>/<slug>/manifest.local.json whose side-file is missing, or
 * was written for a different version of the file or a different model.
 *
 * The deoria-bioregion atlas is never touched — a standing rule. It is listed
 * as skipped so its absence is visible, not silent.
 *
 * --apply only adds lines to the list. The server picks them up within a
 * minute, one layer at a time, with the same code a search uses. Running it
 * twice adds nothing the second time: a version of a layer already on the list
 * is not added again, and a version already built is not listed at all.
 * Nothing in any atlas folder is written by this script; the server writes
 * the side-files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQueue, NEVER_READ } from '../api/lib/atlas/questions-queue.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];
const DEFAULT_MODEL = 'gemini-embedding-001';   // api/lib/models.js getEmbedModel()
const EMBED_DIM = 768;                          // api/apps/atlas.js EMBED_DIM

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

// the server's GEMINI_EMBED_MODEL, read the way the server reads it, so the
// dry run judges a side-file against the model that will be asked to rebuild it
function modelFromEnv() {
  if (process.env.GEMINI_EMBED_MODEL) return process.env.GEMINI_EMBED_MODEL;
  try {
    const env = fs.readFileSync(path.join(REPO, 'api', '.env'), 'utf8');
    const m = /^\s*GEMINI_EMBED_MODEL\s*=\s*"?([^"\n#]+)"?/m.exec(env);
    if (m) return m[1].trim();
  } catch { /* no .env here */ }
  return DEFAULT_MODEL;
}

// mirrors api/apps/atlas.js searchLayers(): only contributed layers are searched
function searchable(L) {
  return L && L.id && L.source && (L.userLayer || /^user-[a-z0-9-]+\.geojson$/.test(String(L.source)));
}
// mirrors api/apps/atlas.js layerSig(): size and mtime of the layer's file
function sigOf(dir, L) {
  try { const st = fs.statSync(path.join(dir, String(L.source))); return st.size + ':' + Math.round(st.mtimeMs); }
  catch { return ''; }
}
// the side-file's header, as readRowVectors() checks it: version, file
// fingerprint, model and width all have to agree or the file is as good as absent
function vecState(dir, L, sig, model) {
  const file = path.join(dir, 'search-' + L.id + '.vec');
  let buf = null;
  try { buf = fs.readFileSync(file); } catch { return 'missing'; }
  const nl = buf.indexOf(10);
  let h = null;
  try { h = nl > 0 ? JSON.parse(buf.subarray(0, nl).toString('utf8')) : null; } catch { return 'unreadable'; }
  if (!h || h.v !== 1) return 'unreadable';
  if (h.sig !== sig) return 'stale (the places changed)';
  if (h.model !== model) return 'stale (written by ' + h.model + ')';
  if (h.dim !== EMBED_DIM) return 'stale (a different width)';
  return 'built';
}

/* Every layer wanting a side-file, and every one skipped with why. */
export function survey(roots, model) {
  const want = [], skipped = [];
  let built = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root).sort()) {
      const dir = path.join(root, slug);
      if (slug.startsWith('.') || slug.includes('--draft-')) continue;
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      if (NEVER_READ.has(slug)) { skipped.push({ dataset: slug, why: 'never touched (standing rule)' }); continue; }
      const where = path.basename(root) === 'private-datasets' ? 'private' : 'public';
      const local = readJSON(path.join(dir, 'manifest.local.json'));
      const manifest = readJSON(path.join(dir, 'manifest.json'));
      const layers = [...((manifest && manifest.layers) || []), ...((local && local.layers) || [])];
      for (const L of layers) {
        if (!searchable(L)) continue;
        const sig = sigOf(dir, L);
        if (!sig) continue;                         // the file is not there to index
        const gj = readJSON(path.join(dir, L.source));
        const places = ((gj && gj.features) || []).length;
        if (!places) continue;
        const state = vecState(dir, L, sig, model);
        if (state === 'built') { built += 1; continue; }
        want.push({ dataset: slug, layerId: L.id, label: L.label || L.id, places, sig, state, where });
      }
    }
  }
  return { want, skipped, built };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const queueFile = opt('--queue') || path.join(REPO, 'api', 'data', 'atlas', 'meaning-index.json');
  const model = opt('--model') || modelFromEnv();
  const taken = new Set([opt('--queue'), opt('--model')].filter(Boolean));
  const roots = argv.filter((a) => !a.startsWith('--') && !taken.has(a));
  const { want, skipped, built } = survey(roots.length ? roots : DEFAULT_ROOTS, model);
  const queue = createQueue({ file: queueFile });

  console.log((apply ? 'Putting on the list' : 'Dry run — nothing is changed') +
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' without a search-by-meaning index for ' + model +
    ' (' + built + ' already built).');
  let added = 0;
  for (const w of want) {
    const had = queue.get(w.dataset, w.layerId);
    const note = had && had.sig === w.sig ? ' (already on the list: ' + had.state + (had.reason ? ', ' + had.reason : '') + ')' : '';
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.places + ' places, ' + w.where + ' — ' + w.state + note);
    if (apply && queue.offer({ dataset: w.dataset, layerId: w.layerId, sig: w.sig, payer: 'server' })) added += 1;
  }
  for (const s of skipped) console.log('  skipped ' + s.dataset + ' — ' + s.why);
  if (apply) console.log(added + ' added. The server builds them one at a time, starting within a minute; needs GEMINI_API_KEY on the server.');
  else if (want.length) console.log('Run again with --apply to put them on the list.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
