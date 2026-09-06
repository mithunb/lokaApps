/* Readings the atlas owes.

   A reading that could not be finished is no longer quietly filled in with
   guesses, which means somebody has to come back to it. This is the list of
   what is outstanding: which layer, on whose behalf, since when, and when it is
   worth trying again.

   It is a file rather than a variable because the whole point is to survive.
   An outage long enough to matter outlasts a deploy, and a promise to come back
   that a restart forgets is worse than no promise.

   Two kinds wait differently, because the two kinds of trouble are different.
   Something OVERLOADED clears on its own, so it is tried soon and then less
   often — a minute, five, fifteen, hourly, then every six hours — and given up
   on after a week. Something GONE, a withdrawn model or a refused key, will
   never clear by waiting: it gets one more try in case the first was a fluke
   and then parks. A parked reading is not forgotten, it is only not retried
   until something changes — the model chosen for the job changes, or an
   operator says try now. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', '..', 'data', 'atlas', 'owed.json');

const MIN = 60 * 1000;
const WAITS = [1 * MIN, 5 * MIN, 15 * MIN, 60 * MIN, 60 * MIN, 6 * 60 * MIN];
const GIVE_UP_AFTER = 7 * 24 * 60 * MIN;

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}

function save(db) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.warn('[owed] could not write the list — ' + (e && e.message));
  }
}

const keyOf = (dataset, layerId) => dataset + '|' + layerId;

// when to try again, given how it failed and how many times we have tried.
// attempts counts the failure that just happened, so the first one is index 0.
function nextAfter(kind, attempts, now) {
  if (kind === 'gone') return attempts >= 2 ? null : now + MIN;
  const i = Math.min(Math.max(0, attempts - 1), WAITS.length - 1);
  return now + WAITS[i];
}

/* Record that a reading is owed, or note another failed attempt at one. */
export function owe({ dataset, layerId, email, kind, trouble }) {
  const db = load();
  const key = keyOf(dataset, layerId);
  const now = Date.now();
  const had = db[key];
  const attempts = (had ? had.attempts : 0) + 1;
  db[key] = {
    dataset, layerId,
    email: email || (had && had.email) || '',
    kind: kind === 'gone' ? 'gone' : 'busy',
    trouble: trouble || (had && had.trouble) || '',
    firstAt: (had && had.firstAt) || now,
    lastAt: now,
    attempts,
    nextAt: nextAfter(kind, attempts, now),
  };
  save(db);
  return db[key];
}

/* The reading landed, or the layer no longer needs one. */
export function settle(dataset, layerId) {
  const db = load();
  const key = keyOf(dataset, layerId);
  if (!db[key]) return null;
  const gone = db[key];
  delete db[key];
  save(db);
  return gone;
}

/* Which readings are due to be tried now, oldest debt first. Parked ones are
   not due, and neither is one that has waited past giving-up — that is handed
   back separately so somebody can be told before it is dropped. */
export function due(now = Date.now()) {
  const db = load();
  return Object.values(db)
    .filter((o) => o.nextAt && o.nextAt <= now && (now - o.firstAt) < GIVE_UP_AFTER)
    .sort((a, b) => a.firstAt - b.firstAt);
}

export function expired(now = Date.now()) {
  const db = load();
  return Object.values(db).filter((o) => (now - o.firstAt) >= GIVE_UP_AFTER);
}

/* Something changed that a parked reading was waiting on — the job is running
   on a different model now, or an operator asked. Parked readings become due
   again; ones already waiting are left alone. */
export function wake(why) {
  const db = load();
  let woken = 0;
  const now = Date.now();
  for (const o of Object.values(db)) {
    if (o.nextAt) continue;
    o.nextAt = now;
    o.attempts = 0;         // a new model deserves a fresh set of tries
    woken += 1;
  }
  if (woken) {
    save(db);
    console.log('[owed] ' + woken + ' waiting reading' + (woken === 1 ? '' : 's') +
      ' woken — ' + (why || 'something changed'));
  }
  return woken;
}

export function all() { return Object.values(load()); }

export function get(dataset, layerId) { return load()[keyOf(dataset, layerId)] || null; }

// tests only
export function _reset() { save({}); }
export const GIVE_UP_MS = GIVE_UP_AFTER;
