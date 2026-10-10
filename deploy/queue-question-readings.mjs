#!/usr/bin/env node
/* Put the layers that never had their questions found on the server's list.
 *
 *   node deploy/queue-question-readings.mjs                    dry run: lists them, changes nothing
 *   node deploy/queue-question-readings.mjs --apply            puts them on the list
 *   node deploy/queue-question-readings.mjs [--apply] root…    other folders instead of the two below
 *   --registry FILE   the registry to read owners from (default: api/data/atlas/registry.json)
 *   --queue FILE      the list to write to (default: api/data/atlas/question-readings.json)
 *
 * Questions are found on the server now, as each layer is added
 * (api/lib/atlas/questions-queue.js). Before that they were found in the
 * owner's browser, the first time the owner opened the atlas signed in, so a
 * layer whose owner never came back has no questions. And until October 2026
 * only a layer of pins was read at all, so every layer of areas has none.
 * This finds both: in every <root>/<slug>/manifest.local.json of the two
 * folders the server reads atlases from, a contributed layer whose places
 * wear a marker (pins, and areas with a mark at their middle), with places,
 * with words of its own worth reading (the rules the reading uses,
 * atlas/reading-rules.js: wearsMarks and worthReading — a layer of outlines
 * that carries nothing but the names it was joined by is not read), with no
 * questions and not already found to have none.
 *
 * A layer that already has questions is never listed and never touched.
 * The deoria-bioregion atlas is never touched — a standing rule. It is listed
 * as skipped so its absence is visible, not silent.
 *
 * --apply only adds lines to the list. The server picks them up within a
 * minute, one at a time, and charges each reading to the atlas owner's hourly
 * allowance as if they had added the layer just now. Running it twice adds
 * nothing the second time: a version of a layer's places already on the list
 * is not added again. Nothing in any atlas folder is written by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createQueue, signatureOf, NEVER_READ } from '../api/lib/atlas/questions-queue.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'reading-rules.js'));
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

/* Every layer that wants its questions found, and every one skipped with why. */
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
        const where = { dataset: slug, layerId: L.id, label: L.label || L.id };
        if (!RULES.wearsMarks(L)) continue;                 // no marker, nowhere to show a key
        if (L.patternsNone) continue;                       // already looked, nothing there
        const gj = L.source ? readJSON(path.join(dir, L.source)) : null;
        const rows = ((gj && gj.features) || []).map((f) => f.properties || {});
        if (!rows.length) continue;
        if (RULES.settledQuestions(L, rows).length ||
            Object.keys(rows[0] || {}).some((k) => RULES.isQuestionColumn(k))) continue;   // has questions
        if (!RULES.worthReading(L, rows)) continue;         // nothing beyond the places' names
        const cols = RULES.wordColumns(rows);
        want.push(Object.assign(where, { places: rows.length, columns: cols,
          shapes: L.type !== 'marker', sig: signatureOf(rows, RULES.isAnswerColumn) }));
      }
    }
  }
  return { want, skipped };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const registryFile = opt('--registry') || path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
  const queueFile = opt('--queue') || path.join(REPO, 'api', 'data', 'atlas', 'question-readings.json');
  const taken = new Set([opt('--registry'), opt('--queue')].filter(Boolean));
  const roots = argv.filter((a) => !a.startsWith('--') && !taken.has(a));
  const { want, skipped } = survey(roots.length ? roots : DEFAULT_ROOTS);
  const reg = readJSON(registryFile) || {};
  const instances = reg.instances || {};
  const queue = createQueue({ file: queueFile });

  console.log((apply ? 'Putting on the list' : 'Dry run — nothing is changed') +
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' with words to read and no questions yet.');
  let added = 0;
  for (const w of want) {
    const owner = (instances[w.dataset] && instances[w.dataset].email) || '';
    const had = queue.get(w.dataset, w.layerId);
    const note = had && had.sig === w.sig ? ' (already on the list: ' + had.state + ')' : '';
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.places + (w.shapes ? ' areas' : ' places') +
      ', reading ' + w.columns.slice(0, 3).join(', ') + (owner ? '' : ' — no owner on record, charged to the server') + note);
    if (apply && queue.offer({ dataset: w.dataset, layerId: w.layerId, sig: w.sig, payer: owner })) added += 1;
  }
  for (const s of skipped) console.log('  skipped ' + s.dataset + ' — ' + s.why);
  if (apply) console.log(added + ' added. The server reads them one at a time, starting within a minute.');
  else if (want.length) console.log('Run again with --apply to put them on the list.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
