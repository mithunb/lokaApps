#!/usr/bin/env node
/* Put the layers read under the old one-pile rule back on the server's list,
 * so the columns their questions never drew on get their own look.
 *
 *   node deploy/queue-question-rereads.mjs                    dry run: lists them, changes nothing
 *   node deploy/queue-question-rereads.mjs --apply            puts them on the list
 *   node deploy/queue-question-rereads.mjs [--apply] root…    other folders instead of the two below
 *   --registry FILE   the registry to read owners from (default: api/data/atlas/registry.json)
 *   --queue FILE      the list to write to (default: api/data/atlas/question-readings.json)
 *
 * Until October 2026 a reading handed the model one line per place with every
 * column on it, and the model found its questions in whichever column was
 * easiest — the rest went unused. On a festival's 24 venues both questions came
 * from the description, and a column of 214-character schedules contributed
 * not one word of evidence. Every column with words of its own is now read on
 * its own (api/lib/atlas/enrich.js, planColumns), but a layer read before that
 * keeps the questions it has, and nothing re-reads it on its own.
 *
 * This finds those layers: in every <root>/<slug>/manifest.local.json of the
 * two folders the server reads atlases from, a contributed layer whose places
 * wear a marker, with questions already on it, and with at least one column
 * that would get its own look today (the same test the reading uses) which
 * none of the kept questions draws on. "Draws on" is measured, not guessed:
 * each kept question's evidence words (pattern_N_why) are looked for in each
 * column's text on that place, and a column counts as drawn on when the
 * words quoted under an answer are found in it on at least three places —
 * three being this product's own floor for a kind. A word found in two
 * columns at once counts for both: a description and a comment that share
 * words have both been drawn on, and calling them both unused (as an
 * earlier version of this did) would pay for a re-read of a column the
 * questions already speak from.
 *
 * --apply puts each such layer on the list with the unused columns named
 * (addColumns). The server reads it within a minute, keeps every question
 * already on the map, asks the named columns for more, and charges the
 * reading to the atlas owner's hourly allowance (the owner's account, else the
 * email the atlas was set up with). Running it twice adds nothing the second
 * time: a layer already waiting or being read is not added again, and nor is
 * one whose record already shows a re-read of these columns (or more) at this
 * same version of its places — a column that yielded nothing then would yield
 * nothing again, at the owner's cost.
 *
 * A layer with no questions is not this script's business (that is
 * queue-question-readings.mjs). The deoria-bioregion atlas is never touched —
 * a standing rule; it is listed as skipped so its absence is visible, not
 * silent. Nothing in any atlas folder is written by this script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createQueue, fileSignatureOf, NEVER_READ, payerOf } from '../api/lib/atlas/questions-queue.js';
import { textColumns, columnLabel } from '../api/lib/atlas/enrich.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'reading-rules.js'));
// mirrors api/lib/atlas/jobs.js (DATASETS_ROOT, PRIVATE_ROOT); not imported,
// because that module starts the job queue the moment it loads
export const DEFAULT_ROOTS = [
  path.join(REPO, 'atlas', 'datasets'),
  path.join(REPO, 'api', 'data', 'atlas', 'private-datasets'),
];
const DRAWN_ON = 3;      // places on which a column's words stand under an answer

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const textOf = (v) => v == null ? '' : Array.isArray(v) ? v.map((x) => x == null ? '' : String(x)).join('; ') : String(v);

/* Which of a layer's text columns its kept questions draw on, and which not. */
export function unusedColumns(layer, rows) {
  const fields = RULES.wordColumns(rows);
  const nameCol = (layer && layer.popup && layer.popup.title) || 'name';
  const { ask } = textColumns(rows, fields, { nameCol });
  const asked = Object.keys(rows[0] || {}).filter((k) => RULES.isQuestionColumn(k));
  const used = new Map();     // column -> places where words quoted under an answer are found in it
  for (const c of ask) used.set(c.column, 0);
  for (const r of rows) {
    const texts = ask.map((c) => textOf(r[c.column]).toLowerCase());
    const hit = new Set();      // the columns its quoted words are found in, on this place
    for (const q of asked) {
      if (!r[q] || r[q] === 'other') continue;
      const words = String(r[q + '_why'] || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
      for (const w of words) {
        ask.forEach((c, i) => { if (texts[i].includes(w)) hit.add(c.column); });
      }
    }
    for (const c of hit) used.set(c, used.get(c) + 1);
  }
  return {
    questions: asked.length,
    drawnOn: ask.filter((c) => used.get(c.column) >= DRAWN_ON).map((c) => c.column),
    unused: ask.filter((c) => used.get(c.column) < DRAWN_ON)
      .map((c) => ({ column: c.column, kind: c.kind, filled: c.filled, avgLen: c.avgLen, places: used.get(c.column) })),
  };
}

/* Every layer that wants reading again, and every atlas skipped with why. */
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
        if (!RULES.wearsMarks(L)) continue;                 // no marker, nowhere to show a key
        if (RULES.readByItsTwin(L, local.layers)) continue; // its file is listed through its pins
        const gj = L.source ? readJSON(path.join(dir, L.source)) : null;
        const rows = ((gj && gj.features) || []).map((f) => f.properties || {});
        if (!rows.length) continue;
        if (!Object.keys(rows[0] || {}).some((k) => RULES.isQuestionColumn(k))) continue;   // never read: not this script's
        const twin = L.sameFileAs && (local.layers || []).find((o) => o.id === L.sameFileAs && o.source);
        const twinGJ = twin ? readJSON(path.join(dir, twin.source)) : null;
        const twinRows = ((twinGJ && twinGJ.features) || []).map((f) => f.properties || {});
        const halves = [{ layer: L, rows }].concat(twin && twinRows.length ? [{ layer: twin, rows: twinRows }] : []);
        const all = halves.flatMap((h) => h.rows);
        const got = unusedColumns(L, all);
        if (!got.unused.length) continue;
        want.push({ dataset: slug, layerId: L.id, label: L.label || L.id, places: all.length,
          questions: got.questions, drawnOn: got.drawnOn, unused: got.unused,
          sig: fileSignatureOf(halves, RULES.isAnswerColumn) });
      }
    }
  }
  return { want, skipped };
}

/* Has this layer's record already had a re-read of these columns, at this same
   version of its places? Then a second run must not pay for another. Every
   column wanted now must be among those asked then: a column that yielded
   nothing at the time is still listed as never drawn on, and asking it again
   of the same places would only buy the same nothing. */
export function alreadyReread(had, w) {
  if (!had || had.sig !== w.sig || !Array.isArray(had.addColumns)) return false;
  const asked = new Set(had.addColumns.map(String));
  return w.unused.every((u) => asked.has(u.column));
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
    ': ' + want.length + ' layer' + (want.length === 1 ? '' : 's') + ' with a column its questions never drew on.');
  let added = 0;
  for (const w of want) {
    // the account that owns the atlas, else the email it was set up with (questions-queue payerOf)
    const owner = payerOf(instances[w.dataset]);
    const had = queue.get(w.dataset, w.layerId);
    const busy = had && (had.state === 'queued' || had.state === 'running');
    const done = !busy && alreadyReread(had, w);
    console.log('  ' + w.dataset + '/' + w.layerId + ' — ' + w.label + ' — ' + w.places + ' places, ' +
      w.questions + ' question' + (w.questions === 1 ? '' : 's') + ' drawing on ' + (w.drawnOn.join(', ') || 'no column') +
      '; never drawn on: ' + w.unused.map((u) => columnLabel(u.column) + ' (' + u.kind + ', ' + u.avgLen + ' characters on ' + u.filled + ' places)').join(', ') +
      (owner ? '' : ' — no owner on record, charged to the server') + (busy ? ' (already on the list: ' + had.state + ')' : '') +
      (done ? ' (already re-read for these columns at this version: ' + had.state + ' — not added again)' : ''));
    if (!apply || busy || done) continue;
    if (queue.offer({ dataset: w.dataset, layerId: w.layerId, sig: w.sig, payer: owner,
                      addColumns: w.unused.map((u) => u.column) })) added += 1;
  }
  for (const s of skipped) console.log('  skipped ' + s.dataset + ' — ' + s.why);
  if (apply) console.log(added + ' put on the list; the server reads them one at a time, within a minute of starting.');
  else console.log('Run again with --apply to put them on the list.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
