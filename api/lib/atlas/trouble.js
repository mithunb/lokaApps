/* When the model will not answer, somebody has to be told — but not once per
   call.

   A reading is three calls, and a busy hour is many readings. Mailing on every
   failure would mean dozens of identical messages arriving while the one thing
   the operator needs to know stays the same: this model is not answering, and
   here is what it said. So the unit is not the call, it is the TROUBLE: one
   cause, on one model, however many calls run into it.

   Two kinds, told apart by what Google itself answers, because they want
   different things done about them:

     GONE   the model was withdrawn, or the key is refused. It will not fix
            itself and waiting is pointless. Mail at once.
     BUSY   overloaded, rate-limited, timed out. Usually clears on its own, and
            a single failed call is not worth anyone's attention. Mail only if
            it is still failing an hour later.

   While a trouble is open the mail goes at most once a day. When the model
   answers again the trouble closes and one more mail says so. Worst hour: one
   message. */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// how long a busy patch must persist before it is worth an email
const BUSY_PATIENCE = HOUR;

const open = new Map();   // key -> trouble
let notify = null;        // set by whoever can send mail

export function setTroubleNotifier(fn) { notify = fn; }

/* Google's own answer decides the kind. A refused request shape is filed with
   the withdrawals rather than the busy signals: a call that is malformed for
   this model will be just as malformed in an hour. */
export function classify(err) {
  const status = err && err.status;
  const msg = String((err && err.message) || err || '');
  if (status === 404 || status === 400 || status === 401 || status === 403) return 'gone';
  if (/\b(404|400|401|403)\b/.test(msg) && !/\b(429|500|502|503|504)\b/.test(msg)) return 'gone';
  return 'busy';
}

function keyFor(model, kind) {
  /* One trouble per model per kind, and the wording is deliberately NOT part of
     it. It was, briefly, so that a withdrawn model could be told apart from a
     refused key — and the first refusal carried Google's full sentence while
     the ones behind it carried a shorter one, so the same outage opened two
     troubles and sent two identical emails. The latest wording is kept for the
     message; it does not get a vote on what counts as a separate problem. */
  return String(model || 'no model') + '|' + kind;
}

function firstLine(s) { return String(s || '').split('\n')[0].slice(0, 120); }

async function mail(t, closing, now) {
  if (!notify) return;
  /* Claimed BEFORE the send, not after. Sending is asynchronous and failures
     arrive in bursts — thirty refused calls in a row all reached this line
     before the first message had left, so all thirty sent one. Marking it up
     front means the second caller sees the first has it. If the send then
     fails, the cost is silence until tomorrow rather than a mailbox full of
     the same sentence; the warning below is the trace. */
  t.mailedAt = now || Date.now();
  const started = new Date(t.firstSeen).toISOString().replace('T', ' ').slice(0, 19);
  const lines = closing
    ? [
      `${t.model} is answering again.`,
      '',
      `It stopped at ${started} UTC and ${t.calls} call${t.calls === 1 ? '' : 's'} ran into it.`,
      `What it had been saying: ${firstLine(t.why)}`,
      '',
      'Nothing needs doing. Readings that were refused during this were not saved,',
      'and no places were guessed at.',
    ]
    : t.kind === 'gone'
      ? [
        `${t.model} will not answer, and waiting will not help.`,
        '',
        `What Google says: ${firstLine(t.why)}`,
        '',
        `First seen: ${started} UTC`,
        `Calls refused so far: ${t.calls}`,
        '',
        'This is the withdrawn-model or refused-key shape. Someone has to change',
        'the model name or the key; it will not come back on its own.',
        'The reading falls back to the next name on its list, and if none answers,',
        'no places are given answers at all — nothing is guessed.',
      ]
      : [
        `${t.model} has been failing for an hour.`,
        '',
        `What it says: ${firstLine(t.why)}`,
        '',
        `First seen: ${started} UTC`,
        `Calls affected so far: ${t.calls}`,
        '',
        'This is the busy or rate-limited shape, which usually clears on its own.',
        'You will get one more message when it does. No places are being guessed at',
        'meanwhile — a reading that cannot finish is not saved.',
      ];
  try {
    await notify({
      subject: closing
        ? `[LOKA Atlas] ${t.model} is answering again`
        : `[LOKA Atlas] ${t.model} ${t.kind === 'gone' ? 'will not answer' : 'is failing'}`,
      text: lines.join('\n') + '\n',
    });
  } catch (e) {
    console.warn('[trouble] could not send word of ' + t.model + ' — ' + (e && e.message));
  }
}

/* A call failed. Opens a trouble or adds to one, and mails when the rules above
   say it is worth an email. Never throws: telling somebody about a problem must
   not become a second problem. */
export function noteTrouble(model, err, whenMs) {
  try {
    const kind = classify(err);
    const why = String((err && err.message) || err || 'no reason given');
    const key = keyFor(model, kind);
    const now = whenMs || Date.now();
    let t = open.get(key);
    if (!t) {
      t = { key, model: String(model || 'no model'), kind, why, firstSeen: now, calls: 0, mailedAt: 0 };
      open.set(key, t);
    }
    t.calls += 1;
    t.lastSeen = now;
    t.why = why;

    const ripe = kind === 'gone' || (now - t.firstSeen) >= BUSY_PATIENCE;
    const quiet = now - t.mailedAt >= DAY;
    if (ripe && quiet) mail(t, false, now);
  } catch (e) {
    console.warn('[trouble] ' + (e && e.message));
  }
}

/* The model answered. Anything open against it is over — including a trouble of
   the other kind, because answering settles both. */
export function noteOk(model) {
  try {
    const m = String(model || 'no model');
    for (const [key, t] of [...open.entries()]) {
      if (t.model !== m) continue;
      open.delete(key);
      // only worth saying it came back if somebody was told it had gone
      if (t.mailedAt) mail(t, true);
      else console.log('[trouble] ' + m + ' is answering again (nobody had been told it stopped)');
    }
  } catch (e) {
    console.warn('[trouble] ' + (e && e.message));
  }
}

// for the admin status page and for tests
export function openTroubles() {
  return [...open.values()].map((t) => ({
    model: t.model, kind: t.kind, why: firstLine(t.why),
    firstSeen: t.firstSeen, lastSeen: t.lastSeen, calls: t.calls, mailed: Boolean(t.mailedAt),
  }));
}

// tests only
export function _reset() { open.clear(); }
