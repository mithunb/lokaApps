// Data-import sessions for the layer workbench: session persistence, draft
// preview datasets, and the manifest.local.json overlay commit.
//
// Draft preview trick (zero engine changes): a draft dataset folder
// atlas/datasets/<id>--draft-<importId>/ holds a manifest whose existing layer
// sources are rewritten to "../<id>/<file>" (the browser resolves them against
// the real folder) plus the proposed layer + its geojson. The preview iframe
// is just the real viewer with ?dataset=<id>--draft-<importId>.
//
// Commit is git-safe: user layers go to manifest.local.json + user-*.geojson
// (both gitignored), merged by the viewer at load time — a `git pull` on the
// server never conflicts with org-added layers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './registry.js';
import { DATASETS_ROOT, PRIVATE_ROOT } from './jobs.js';

const IMPORTS_DIR = path.join(DATA_DIR, 'imports');
const TTL_MS = 24 * 3600 * 1000;

// A built atlas lives under ONE of two roots: public ones the web server can
// serve as static files, private ones outside the web root that only the keyed
// API route serves. A slug can never exist in both — creating an atlas checks
// both — so looking in both is unambiguous. Without it, every upload route
// answered "unknown dataset" for a private atlas, so a private atlas could take
// no data at all.
//
// Callers must NOT read "I got a directory" as "this is public". Anything that
// hands data to a reader makes its own access check — see the gate added to
// /layers/search, which is otherwise open by design.
const DATASET_ROOTS = [DATASETS_ROOT, PRIVATE_ROOT];
export function datasetDir(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) return null;
  for (const root of DATASET_ROOTS) {
    const dir = path.join(root, id);
    if (!dir.startsWith(root)) continue;
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  }
  return null;
}

// Which root a slug (or a draft of it) belongs under. A draft sits beside its
// parent so a private atlas's draft never appears in the public web root.
export function rootForDataset(id) {
  const base = String(id).split('--draft-')[0];
  for (const root of DATASET_ROOTS) {
    if (fs.existsSync(path.join(root, base, 'manifest.json'))) return root;
  }
  return DATASETS_ROOT;
}

export function readManifest(id) {
  const dir = datasetDir(id);
  if (!dir) return null;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const localFile = path.join(dir, 'manifest.local.json');
  let local = null;
  if (fs.existsSync(localFile)) local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
  return { manifest, local, dir };
}

export function mergedLayers(m) {
  return [...m.manifest.layers, ...((m.local && m.local.layers) || [])];
}

/* ---------------- sessions ---------------- */

export function newImport(data) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const id = 'imp_' + crypto.randomBytes(8).toString('hex');
  const session = { id, createdAt: Date.now(), ...data };
  saveImport(session);
  return session;
}
export function saveImport(session) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const p = path.join(IMPORTS_DIR, session.id + '.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(session));
  fs.renameSync(tmp, p);
}
export function getImport(id) {
  if (!/^imp_[a-f0-9]{16}$/.test(String(id))) return null;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(IMPORTS_DIR, id + '.json'), 'utf8'));
    if (Date.now() - s.createdAt > TTL_MS) { discardImport(id); return null; }
    return s;
  } catch { return null; }
}
export function discardImport(id) {
  try { fs.rmSync(path.join(IMPORTS_DIR, id + '.json'), { force: true }); } catch {}
  try { fs.rmSync(path.join(IMPORTS_DIR, id + '.geom.json'), { force: true }); } catch {}
  try { fs.rmSync(path.join(IMPORTS_DIR, id + '.targets.json'), { force: true }); } catch {}
  // remove any draft folder for this import
  try {
    for (const root of DATASET_ROOTS) {
      for (const d of fs.readdirSync(root)) {
        if (d.includes('--draft-' + id.replace('imp_', ''))) {
          fs.rmSync(path.join(root, d), { recursive: true, force: true });
        }
      }
    }
  } catch {}
}

/* The induced category set is persisted per-atlas so a second upload (or a
   partner org's contribution) classifies into the SAME emergent set — coherent
   colours across contributions. Stored next to the dataset, gitignored. */
export function readCatSet(datasetId) {
  const dir = datasetDir(datasetId);
  if (!dir) return [];
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'categories.local.json'), 'utf8'));
    return Array.isArray(s.categories) ? s.categories : [];
  } catch { return []; }
}
export function writeCatSet(datasetId, categories) {
  const dir = datasetDir(datasetId);
  if (!dir) return;
  const p = path.join(dir, 'categories.local.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ categories }, null, 1));
  fs.renameSync(tmp, p);
}

/* Semantic-search vocabulary: embedded tag/category terms per contributed layer,
   for the viewer's search box. Stored next to the dataset, gitignored, keyed by
   layer id so re-committing a layer refreshes just its terms. */
export function readSearchIndex(datasetId) {
  const dir = datasetDir(datasetId);
  if (!dir) return null;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'search.local.json'), 'utf8')); }
  catch { return null; }
}
export function writeSearchIndex(datasetId, layerId, entry) {
  const dir = datasetDir(datasetId);
  if (!dir) return;
  const p = path.join(dir, 'search.local.json');
  const idx = readSearchIndex(datasetId) || {};
  idx[layerId] = entry;
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(idx));
  fs.renameSync(tmp, p);
}

/* Geometry rides in a side file so the session JSON stays small — the
   spatial track can carry ~150k vertices per import. */
export function writeGeoms(importId, geoms) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const p = path.join(IMPORTS_DIR, importId + '.geom.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(geoms));
  fs.renameSync(tmp, p);
}
export function readGeoms(importId) {
  if (!/^imp_[a-f0-9]{16}$/.test(String(importId))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(IMPORTS_DIR, importId + '.geom.json'), 'utf8')); }
  catch { return null; }
}

/* geoBoundaries join targets (name→admin matching against the atlas region's
   admin units, materialised once at ingest) live in their own side file too —
   they can be a few MB for a district's worth of villages. Keyed by option id
   (e.g. "geo:ADM4") so the placement step can switch levels without a refetch. */
export function writeGeoTargets(importId, byOption) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const p = path.join(IMPORTS_DIR, importId + '.targets.json');
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(byOption));
  fs.renameSync(tmp, p);
}
export function readGeoTargets(importId) {
  if (!/^imp_[a-f0-9]{16}$/.test(String(importId))) return null;
  try { return JSON.parse(fs.readFileSync(path.join(IMPORTS_DIR, importId + '.targets.json'), 'utf8')); }
  catch { return null; }
}
export function listImports(dataset) {
  try {
    return fs.readdirSync(IMPORTS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(IMPORTS_DIR, f), 'utf8')); } catch { return null; } })
      .filter((s) => s && s.dataset === dataset && Date.now() - s.createdAt <= TTL_MS)
      .map((s) => ({ id: s.id, filename: s.filename || '', createdAt: s.createdAt, label: (s.spec && s.spec.label) || '' }));
  } catch { return []; }
}
export function sweepImports() {
  try {
    for (const f of fs.readdirSync(IMPORTS_DIR)) {
      const p = path.join(IMPORTS_DIR, f);
      if (f.endsWith('.geom.json')) {
        // orphaned geometry side files (session gone) are swept here
        if (!fs.existsSync(path.join(IMPORTS_DIR, f.replace('.geom.json', '.json')))) {
          fs.rmSync(p, { force: true });
        }
        continue;
      }
      try {
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (Date.now() - s.createdAt > TTL_MS) discardImport(s.id);
      } catch { fs.rmSync(p, { force: true }); }
    }
  } catch {}
}

/* ---------------- draft preview dataset ---------------- */

export function writeDraft(datasetId, importId, stanza, sourceFile, geojson, replacingId) {
  const m = readManifest(datasetId);
  if (!m) throw new Error('dataset not found');
  const suffix = importId.replace('imp_', '');
  const draftId = datasetId + '--draft-' + suffix;
  // beside its parent, whichever root that is: a private atlas's draft must not
  // land in the public web root, and the '../<id>/' sources written below only
  // resolve when draft and parent share a root
  const draftDir = path.join(rootForDataset(datasetId), draftId);
  fs.rmSync(draftDir, { recursive: true, force: true });
  fs.mkdirSync(draftDir, { recursive: true });

  const draft = JSON.parse(JSON.stringify(m.manifest));
  // point existing sources back at the real folder
  for (const L of draft.layers) {
    if (L.source && !/^(https?:)?\//.test(L.source)) L.source = '../' + datasetId + '/' + L.source;
  }
  if (draft.branding && draft.branding.logo) draft.branding.logo = '../' + datasetId + '/' + draft.branding.logo;
  // committed user layers too — except the one being edited, which the proposal
  // stands in for, at its own place in the order so the preview draws honestly
  let stood = false;
  if (m.local && m.local.layers) {
    for (const L of m.local.layers) {
      if (replacingId && L.id === replacingId) { draft.layers.push(stanza); stood = true; continue; }
      const c = JSON.parse(JSON.stringify(L));
      if (c.source && !/^(https?:)?\//.test(c.source)) c.source = '../' + datasetId + '/' + c.source;
      draft.layers.push(c);
    }
  }
  if (!stood) draft.layers.push(stanza);   // the proposal, its source local to the draft dir
  draft.id = draftId;
  draft.focusLayer = stanza.id;        // preview zooms to the proposed layer

  fs.writeFileSync(path.join(draftDir, sourceFile), JSON.stringify(geojson));
  fs.writeFileSync(path.join(draftDir, 'manifest.json'), JSON.stringify(draft));
  return draftId;
}

/* ---------------- commit (overlay) ---------------- */

export function commitLayer(datasetId, stanza, sourceFile, geojson) {
  const m = readManifest(datasetId);
  if (!m) throw new Error('dataset not found');
  const localFile = path.join(m.dir, 'manifest.local.json');
  const local = m.local || { layers: [] };

  // history snapshot
  try {
    const hist = path.join(m.dir, '.history');
    fs.mkdirSync(hist, { recursive: true });
    if (fs.existsSync(localFile)) {
      fs.copyFileSync(localFile, path.join(hist, 'manifest.local.' + Date.now() + '.json'));
    }
  } catch {}

  fs.writeFileSync(path.join(m.dir, sourceFile), JSON.stringify(geojson));
  // Replace in place. Filtering then pushing sent an edited layer to the end,
  // which is not just a list reordering: contributed layers draw in this order,
  // so changing a layer's colour also moved it above everything it used to sit
  // under. A layer that is being replaced keeps its index; a new one appends.
  local.layers = local.layers || [];
  const at = local.layers.findIndex((l) => l.id === stanza.id);
  if (at >= 0) local.layers[at] = stanza;
  else local.layers.push(stanza);
  const tmp = localFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(local, null, 1));
  fs.renameSync(tmp, localFile);
  return { layerId: stanza.id };
}

// Everything a layer owns goes when the layer does: its geometry, its search
// vocabulary and its embedding binary. Leaving the last two behind was
// survivable while they were a few KB of JSON; a .vec file is megabytes, and a
// stale index answers searches for places that are no longer on the map.
export function dropSearchIndex(datasetId, layerId) {
  const dir = datasetDir(datasetId);
  if (!dir) return;
  const idx = readSearchIndex(datasetId);
  if (idx && Object.prototype.hasOwnProperty.call(idx, layerId)) {
    delete idx[layerId];
    const p = path.join(dir, 'search.local.json');
    const tmp = p + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(idx));
      fs.renameSync(tmp, p);
    } catch {}
  }
  // same name the search section builds; guarded so a layer id can never
  // reach outside the dataset directory
  if (/^[a-z0-9][a-z0-9-]{0,80}$/.test(String(layerId))) {
    try { fs.rmSync(path.join(dir, 'search-' + layerId + '.vec'), { force: true }); } catch {}
  }
}

export function removeLayer(datasetId, layerId) {
  const m = readManifest(datasetId);
  if (!m || !m.local) return false;
  const keep = (m.local.layers || []).filter((l) => l.id !== layerId);
  if (keep.length === (m.local.layers || []).length) return false;
  const gone = (m.local.layers || []).find((l) => l.id === layerId);
  if (gone && gone.source && /^user-[a-z0-9-]+\.geojson$/.test(gone.source)) {
    try { fs.rmSync(path.join(m.dir, gone.source), { force: true }); } catch {}
  }
  dropSearchIndex(datasetId, layerId);
  m.local.layers = keep;
  const localFile = path.join(m.dir, 'manifest.local.json');
  fs.writeFileSync(localFile, JSON.stringify(m.local, null, 1));
  return true;
}
