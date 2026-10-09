/* Finding the questions in a layer, on the server.

   The reading used to start in the owner's browser the first time they opened
   their atlas signed in. It took half a minute or more, an owner who left early
   saved nothing, and a visitor never started it at all. It now starts the
   moment a layer is put on an atlas, here, and nobody has to keep a page open.

   This file is the waiting list and nothing else: which layer, which version of
   its places, where it has got to. What a reading actually does stays in
   api/apps/atlas.js (runReading), the same code the operator's re-read and the
   retry of an unreachable model already use, so there is one way to read a
   layer and not two.

   The rules it keeps:
     - once per version of a layer's places. The version is a fingerprint of the
       places with every previous answer taken out, so writing the answers on
       does not count as a change, but a re-upload with different rows does.
     - one reading at a time, on the whole server. That is one at a time per
       atlas and then some, and it is kind to the model and to the budget.
     - written to a file, so a restart picks up where it was: anything that was
       running when the server stopped goes back to waiting and starts again.
     - a reading that fails says why in a few words and stops. It is not tried
       again in a loop. (An unreachable model is the one exception, and that
       already has its own list, owed.js, with its own patient timetable.) */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* The same folder registry.js keeps its files in. Worked out here rather than
   imported, because importing the registry loads (and may tidy and re-save)
   it, and the one-off script that also uses this file must not do that. */
const DATA_DIR = process.env.LOKA_DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'atlas');

/* Never read, whatever happens: the operator's own hand-made atlas. */
export const NEVER_READ = new Set(['deoria-bioregion']);

const BUSY = new Set(['queued', 'running']);
const keyOf = (dataset, layerId) => dataset + '|' + layerId;

/* The fingerprint of a layer's places, with every trace of a reading taken out.
   Values are compared as words and empty ones are skipped, because saving a
   layer turns every column but the coordinates into words and writes a blank
   for a column a place does not have — neither of which is a change anybody
   made to their data. */
export function signatureOf(rows, isAnswerColumn) {
  const answer = isAnswerColumn || ((k) => /^pattern_/.test(k));
  const h = crypto.createHash('sha1');
  for (const r of rows || []) {
    const keys = Object.keys(r || {}).filter((k) => k !== '_category' && !answer(k)).sort();
    const parts = [];
    for (const k of keys) {
      const v = r[k];
      if (v === null || v === undefined) continue;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (s === '') continue;
      parts.push(k + '\u0001' + s);
    }
    h.update(parts.join('\u0002') + '\u0003');
  }
  return h.digest('hex').slice(0, 20);
}

export function createQueue({ file } = {}) {
  const FILE = file || path.join(DATA_DIR, 'question-readings.json');
  let runner = null;
  let recheck = null;
  let running = false;

  function load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
  }
  function save(db) {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.warn('[questions] could not write the list — ' + (e && e.message));
    }
  }

  function get(dataset, layerId) { return load()[keyOf(dataset, layerId)] || null; }

  // what an owner's page needs to know, per layer of one atlas
  function forDataset(dataset) {
    const out = {};
    for (const r of Object.values(load())) {
      if (r.dataset === dataset) out[r.layerId] = { state: r.state, reason: r.reason || '', unreachable: !!r.unreachable };
    }
    return out;
  }

  function isBusy(dataset, layerId) {
    const r = get(dataset, layerId);
    return !!(r && BUSY.has(r.state));
  }

  // set what is known about a layer without queueing anything
  function remember(dataset, layerId, patch) {
    const db = load();
    const k = keyOf(dataset, layerId);
    db[k] = Object.assign({ dataset, layerId }, db[k] || {}, patch, { at: Date.now() });
    save(db);
    return db[k];
  }

  /* Put a layer on the list for this version of its places. Answers whether it
     went on: a version already read, waiting or being read is not added twice. */
  function offer({ dataset, layerId, sig, payer, restore }) {
    if (NEVER_READ.has(dataset)) return false;
    const db = load();
    const k = keyOf(dataset, layerId);
    const had = db[k];
    // a restore is the one thing asked for the same version twice: putting
    // back answers a re-commit dropped, which costs no reading at all
    if (had && had.sig === sig && !restore) return false;
    if (had && restore && BUSY.has(had.state)) return false;
    // being read right now: the newer version is read once this one has landed
    if (had && had.state === 'running') {
      had.again = true;
      save(db);
      return false;
    }
    db[k] = { dataset, layerId, sig, payer: payer || (had && had.payer) || '', state: 'queued',
              reason: '', queuedAt: Date.now(), at: Date.now(), restore: !!restore };
    save(db);
    setImmediate(pump);
    return true;
  }

  function forget(dataset, layerId) {
    try { fs.unlinkSync(answersFile(dataset, layerId)); } catch { /* none kept */ }
    const db = load();
    const k = keyOf(dataset, layerId);
    if (!db[k]) return;
    delete db[k];
    save(db);
  }

  /* The answers last written onto a layer, kept beside the list.

     Putting a layer back — fixing a row's place, re-committing the same file —
     rebuilds it from the rows that were sent, which never carried the answers.
     Without a copy, the same places would either lose their questions or be
     paid for twice. With one, the same version gets its answers back for
     nothing, and a changed version is asked the questions it already had. */
  const ANSWERS_DIR = path.join(path.dirname(FILE), 'question-answers');
  function answersFile(dataset, layerId) {
    return path.join(ANSWERS_DIR, String(dataset).replace(/[^a-z0-9-]/gi, '_') + '--' +
      String(layerId).replace(/[^a-z0-9_-]/gi, '_') + '.json');
  }
  function saveAnswers(dataset, layerId, data) {
    try {
      fs.mkdirSync(ANSWERS_DIR, { recursive: true });
      const f = answersFile(dataset, layerId);
      fs.writeFileSync(f + '.tmp', JSON.stringify(data));
      fs.renameSync(f + '.tmp', f);
    } catch (e) {
      console.warn('[questions] could not keep the answers — ' + (e && e.message));
    }
  }
  function loadAnswers(dataset, layerId) {
    try { return JSON.parse(fs.readFileSync(answersFile(dataset, layerId), 'utf8')); } catch { return null; }
  }

  async function pump() {
    if (running || !runner) return;
    const db = load();
    const next = Object.values(db).filter((r) => r.state === 'queued')
      .sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0))[0];
    if (!next) return;
    running = true;
    const k = keyOf(next.dataset, next.layerId);
    db[k] = Object.assign({}, next, { state: 'running', startedAt: Date.now(), again: false });
    save(db);
    let patch;
    try {
      patch = await runner(Object.assign({}, db[k]));
    } catch (e) {
      patch = { state: 'failed', reason: String((e && e.message) || 'something went wrong').slice(0, 160) };
    }
    const after = load();
    const was = after[k];
    if (was) {
      const again = was.again;
      after[k] = Object.assign({}, was, patch || { state: 'failed', reason: 'nothing was said' },
        { endedAt: Date.now(), at: Date.now(), again: false });
      save(after);
      running = false;
      // the places changed while they were being read: look again at what is
      // on disk now, and read that if it is a version nobody has read
      if (again && recheck) {
        try { recheck(next.dataset, next.layerId); } catch { /* a later commit will offer it */ }
      }
    } else {
      running = false;
    }
    setImmediate(pump);
  }

  /* Called once at start: anything that was being read when the server stopped
     is waiting again, and the list starts moving. */
  function start(fn, opts) {
    runner = fn;
    recheck = (opts && opts.recheck) || null;
    const db = load();
    let back = 0;
    for (const r of Object.values(db)) {
      if (r.state === 'running') { r.state = 'queued'; back += 1; }
    }
    if (back) save(db);
    const waiting = Object.values(db).filter((r) => r.state === 'queued').length;
    if (waiting) console.log('[questions] ' + waiting + ' reading' + (waiting === 1 ? '' : 's') + ' waiting');
    setImmediate(pump);
  }

  function all() { return Object.values(load()); }
  function idle() { return !running && !all().some((r) => r.state === 'queued'); }

  return { get, forDataset, isBusy, remember, offer, forget, start, pump, all, idle,
           saveAnswers, loadAnswers, FILE };
}

export const queue = createQueue();
