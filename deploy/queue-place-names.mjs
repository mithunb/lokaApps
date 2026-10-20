#!/usr/bin/env node
/* Put the layers whose places are named by a sentence on the server's list,
 * so each place gets a short name written by LOKA.
 *
 *   node deploy/queue-place-names.mjs                    dry run: lists them, changes nothing
 *   node deploy/queue-place-names.mjs --apply            puts them on the list
 *   node deploy/queue-place-names.mjs [--apply] root…    other folders instead of the two below
 *   --registry FILE   the registry to read owners from (default: api/data/atlas/registry.json)
 *   --queue FILE      the list to write to (default: api/data/atlas/place-names.json)
 *
 * Since October 2026 a layer whose naming column is longer than 32 characters
 * for more than half its places — a layer out of the LOKA tagging app, whose
 * only name is the tagger's sentence — gets a short name for every long place
 * the moment it is put on an atlas (api/lib/atlas/place-names.js): the first
 * words stand in at once, and the model writes a name of the tagger's own
 * words, checked, within the hour. Layers added before that have none. This
 * finds every contributed layer in <root>/<slug>/manifest.local.json, points
 * or areas, with places, whose naming column is long for most of them and
 * whose long places do not all have a kept name yet — and it is the list,
 * not this script, that writes anything: the server picks each layer up
 * within a minute, writes the first words beside every pin straight away,
 * switches the layer to "Short names written by LOKA", and asks the model.
 * An owner who later picks another column in Settings is remembered, and
 * such a layer is listed here as skipped.
 *
 * Both roots — the public atlases and the private ones — are looked at: a
 * private atlas gets every feature a public one does. The deoria-bioregion
 * atlas is never touched — a standing rule. It is listed as skipped so its
 * absence is visible, not silent.
 *
 * --apply only adds lines to the list. Running it twice adds nothing the
 * second time: a version of a layer's places already on the list is not
 * added again. Nothing in any atlas folder is written by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEVER_READ, payerOf } from '../api/lib/atlas/questions-queue.js';
import { createPlaceNamesQueue, sourceColumnOf, wantsNames, countLong, namesFor, sigFor, firstWords, NAME_FIELD }
  from '../api/lib/atlas/place-names.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

/* Every layer that wants short names, and every one skipped with why. */
export function survey(roots, queue) {
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
        const had = queue ? queue.get(slug, L.id) : null;
        const from = sourceColumnOf(L) || (had && had.from) || '';
        if (!from || !wantsNames(rows, from)) continue;
        if (had && had.off) { skipped.push({ dataset: slug + '/' + L.id, why: 'the owner chose another column' }); continue; }
        const got = namesFor(rows, from, (had && had.names) || {});
        const on = L.popup && L.popup.title === NAME_FIELD && !!L.lokaNames;
        if (!got.waiting && on) continue;
        want.push({ dataset: slug, layerId: L.id, label: L.label || L.id, places: rows.length, from,
          long: countLong(rows, from).long, waiting: got.waiting, on, rows, sig: sigFor(rows, from) });
      }
    }
  }
  return { want, skipped };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const registryFile = opt('--registry') || path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
  const queueFile = opt('--queue') || path.join(REPO, 'api', 'data', 'atlas', 'place-names.json');
  const taken = new Set([opt('--registry'), opt('--queue')].filter(Boolean));
  const roots = argv.filter((a) => !a.startsWith('--') && !taken.has(a));
  const queue = createPlaceNamesQueue({ file: queueFile });
  const { want, skipped } = survey(roots.length ? roots : DEFAULT_ROOTS, queue);
  const reg = readJSON(registryFile) || {};
  const instances = reg.instances || {};

  console.log((apply ? 'Putting on the list' : 'Dry run — nothing is changed') +
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' whose places are named by a sentence.');
  let added = 0;
  for (const w of want) {
    // the account that owns the atlas, else the email it was set up with (questions-queue payerOf)
    const owner = payerOf(instances[w.dataset]);
    const had = queue.get(w.dataset, w.layerId);
    const note = had && had.sig === w.sig ? ' (already on the list: ' + had.state + ')' : '';
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.places + ' places, ' +
      w.long + ' long in ' + w.from + ', ' + w.waiting + ' waiting for a name' + (w.on ? '' : ', not switched on yet') +
      (owner ? '' : ' — no owner on record, charged to the server') + note);
    const calls = Math.ceil(w.waiting / 40);
    console.log('      ' + calls + ' call' + (calls === 1 ? '' : 's') + ' to the model, out of the owner\'s hourly allowance');
    for (const r of w.rows.filter((x) => String(x[w.from] || '').trim().length > 32).slice(0, 3)) {
      const d = String(r[w.from]).replace(/\s+/g, ' ').trim();
      console.log('      ' + JSON.stringify(d.length > 70 ? d.slice(0, 69) + '…' : d) + '  → until named: "' + firstWords(d) + '"');
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
