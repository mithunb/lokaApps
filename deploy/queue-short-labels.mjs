#!/usr/bin/env node
/* Put the layers whose long column headings have no stored short name on the
 * server's list, so each gets named once.
 *
 *   node deploy/queue-short-labels.mjs                    dry run: lists them, changes nothing
 *   node deploy/queue-short-labels.mjs --apply            puts them on the list
 *   node deploy/queue-short-labels.mjs [--apply] root…    other folders instead of the two below
 *   --registry FILE   the registry to read owners from (default: api/data/atlas/registry.json)
 *   --queue FILE      the list to write to (default: api/data/atlas/short-labels.json)
 *
 * Since October 2026 a layer's long headings ("What languages do you primarily
 * work in? Feel free to mention all…") are given a short name the moment the
 * layer is put on an atlas (api/lib/atlas/short-labels.js): one call to the
 * model per layer, stored on the layer as shortLabels. Layers added before
 * that have none — the viewer shows them by its own plain cut ("Languages"),
 * which works, and this is how they get the better name. It finds every
 * contributed layer in <root>/<slug>/manifest.local.json, points or areas,
 * with places, that has a long heading the owner has not named by hand and
 * no stored short name for it.
 *
 * The deoria-bioregion atlas is never touched — a standing rule. It is listed
 * as skipped so its absence is visible, not silent.
 *
 * --apply only adds lines to the list. The server picks them up within a
 * minute, one at a time, and charges each call to the atlas owner's hourly
 * allowance. Running it twice adds nothing the second time: a version of a
 * layer's headings already on the list is not added again. Nothing in any
 * atlas folder is written by this script; the server writes the names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEVER_READ } from '../api/lib/atlas/questions-queue.js';
import { createShortLabelsQueue, headingsWanting, headingSig, hasNamesFor, LABELS } from '../api/lib/atlas/short-labels.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

/* Every layer that wants short names, and every one skipped with why. */
export function survey(roots) {
  const want = [], skipped = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const slug of fs.readdirSync(root).sort()) {
      const dir = path.join(root, slug);
      if (slug.startsWith('.') || slug.includes('--draft-')) continue;
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
      if (NEVER_READ.has(slug)) { skipped.push({ dataset: slug, why: 'never touched (standing rule)' }); continue; }
      const local = readJSON(path.join(dir, 'manifest.local.json'));
      for (const L of (local && local.layers) || []) {
        if (!L.source) continue;
        const gj = readJSON(path.join(dir, L.source));
        const rows = ((gj && gj.features) || []).map((f) => f.properties || {});
        if (!rows.length) continue;
        const headings = headingsWanting(L, rows);
        if (!headings.length) continue;
        if (hasNamesFor(L, headings)) continue;
        want.push({ dataset: slug, layerId: L.id, label: L.label || L.id, places: rows.length,
          headings, sig: headingSig(headings) });
      }
    }
  }
  return { want, skipped };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const registryFile = opt('--registry') || path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
  const queueFile = opt('--queue') || path.join(REPO, 'api', 'data', 'atlas', 'short-labels.json');
  const taken = new Set([opt('--registry'), opt('--queue')].filter(Boolean));
  const roots = argv.filter((a) => !a.startsWith('--') && !taken.has(a));
  const { want, skipped } = survey(roots.length ? roots : DEFAULT_ROOTS);
  const reg = readJSON(registryFile) || {};
  const instances = reg.instances || {};
  const queue = createShortLabelsQueue({ file: queueFile });

  console.log((apply ? 'Putting on the list' : 'Dry run — nothing is changed') +
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' with long headings and no stored short names.');
  let added = 0;
  for (const w of want) {
    const owner = (instances[w.dataset] && instances[w.dataset].email) || '';
    const had = queue.get(w.dataset, w.layerId);
    const note = had && had.sig === w.sig ? ' (already on the list: ' + had.state + ')' : '';
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.places + ' places, ' +
      w.headings.length + ' long heading' + (w.headings.length === 1 ? '' : 's') +
      (owner ? '' : ' — no owner on record, charged to the server') + note);
    for (const h of w.headings) {
      console.log('      ' + JSON.stringify(h.length > 70 ? h.slice(0, 69) + '…' : h) + '  → until named: "' + LABELS.shortHeading(h) + '"');
    }
    if (apply && queue.offer({ dataset: w.dataset, layerId: w.layerId, sig: w.sig, payer: owner })) added += 1;
  }
  for (const s of skipped) console.log('  skipped ' + s.dataset + ' — ' + s.why);
  if (apply) console.log(added + ' added. The server names them one at a time, starting within a minute.');
  else if (want.length) console.log('Run again with --apply to put them on the list.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
