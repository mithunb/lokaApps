#!/usr/bin/env node
/* Put the layers whose questions have no noun for "Explore by …" on the
 * server's list, so each gets its nouns once.
 *
 *   node deploy/queue-key-nouns.mjs                    dry run: lists them, changes nothing
 *   node deploy/queue-key-nouns.mjs --apply            puts them on the list
 *   node deploy/queue-key-nouns.mjs [--apply] root…    other folders instead of the two below
 *   --registry FILE   the registry to read owners from (default: api/data/atlas/registry.json)
 *   --queue FILE      the list to write to (default: api/data/atlas/key-nouns.json)
 *
 * Since October 2026 ("version D") a question's row on the map is headed
 * "Explore <place> by <noun>", and the reading picks the noun from the
 * question's own words when it finds the question. Questions found before
 * that have none, and their rows show the question as written, which works.
 * This is how they get one: one small call per layer, for all of its
 * questions at once (api/lib/atlas/key-nouns.js), each noun checked so that
 * every word of it is a word of the question. It finds every contributed
 * layer in <root>/<slug>/manifest.local.json with a question (keyLabels
 * pattern_N) that has no noun and is not a yes-or-no question.
 *
 * The deoria-bioregion atlas is never touched — a standing rule. It is listed
 * as skipped so its absence is visible, not silent.
 *
 * --apply only adds lines to the list. The server picks them up within a
 * minute, one at a time, and charges each call to the atlas owner's hourly
 * allowance. Running it twice adds nothing the second time: a layer whose
 * questions are already on the list, as they are now, is not added again.
 * Nothing in any atlas folder is written by this script; the server writes
 * the nouns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEVER_READ, payerOf } from '../api/lib/atlas/questions-queue.js';
import { createKeyNounsQueue, questionsWanting, questionsSig } from '../api/lib/atlas/key-nouns.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

/* Every layer whose questions want nouns, and every atlas skipped with why. */
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
        const wanting = questionsWanting(L);
        if (!wanting.length) continue;
        want.push({ dataset: slug, layerId: L.id, label: L.label || L.id, wanting, sig: questionsSig(wanting) });
      }
    }
  }
  return { want, skipped };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const registryFile = opt('--registry') || path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
  const queueFile = opt('--queue') || path.join(REPO, 'api', 'data', 'atlas', 'key-nouns.json');
  const taken = new Set([opt('--registry'), opt('--queue')].filter(Boolean));
  const roots = argv.filter((a) => !a.startsWith('--') && !taken.has(a));
  const { want, skipped } = survey(roots.length ? roots : DEFAULT_ROOTS);
  const reg = readJSON(registryFile) || {};
  const instances = reg.instances || {};
  const queue = createKeyNounsQueue({ file: queueFile });

  console.log((apply ? 'Putting on the list' : 'Dry run — nothing is changed') +
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' with questions that have no noun yet.');
  let added = 0;
  for (const w of want) {
    // the account that owns the atlas, else the email it was set up with (questions-queue payerOf)
    const owner = payerOf(instances[w.dataset]);
    const had = queue.get(w.dataset, w.layerId);
    const note = had && had.sig === w.sig ? ' (already on the list: ' + had.state + ')' : '';
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.wanting.length +
      ' question' + (w.wanting.length === 1 ? '' : 's') + ', one call' +
      (owner ? '' : ' — no owner on record, charged to the server') + note);
    for (const q of w.wanting) console.log('      ' + q.col + ': ' + JSON.stringify(q.question));
    if (apply && queue.offer({ dataset: w.dataset, layerId: w.layerId, sig: w.sig, payer: owner })) added += 1;
  }
  for (const s of skipped) console.log('  skipped ' + s.dataset + ' — ' + s.why);
  if (apply) console.log(added + ' added. The server asks for them one layer at a time, starting within a minute.');
  else if (want.length) console.log('Run again with --apply to put them on the list.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
