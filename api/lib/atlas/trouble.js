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

/* "Gone" covers two problems that want different hands on them: a model Google
   withdrew, and a key it will not accept. The subject line and the fix differ,
   so the message has to know which — and it can, because Google says so. */
export function faultOf(err) {
  const t = String((err && err.body) || (err && err.message) || err || '').toLowerCase();
  if (/api key|permission|unauthenti|unauthor|credential/.test(t)) return 'key';
  if (/not found|no longer available|is not supported|deprecat/.test(t)) return 'model';
  return 'other';
}

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

function firstLine(s, cap) { return String(s || '').split('\n')[0].slice(0, cap || 120); }

/* What to print under "Google says". The error carries two strings: our own
   wrapper ("the model refused (404): ...") and, separately, the sentence Google
   actually sent. Quoting the wrapper under that heading makes the message a
   liar, so the raw sentence is preferred — and given room, because the useful
   half of a withdrawal notice is the end of it, where the replacement model is
   named. */
function theirWords(t) { return firstLine(t.said || t.why, 220) || 'nothing useful'; }

async function mail(t, closing, now) {
  if (!notify) return;
  /* Claimed BEFORE the send, not after. Sending is asynchronous and failures
     arrive in bursts — thirty refused calls in a row all reached this line
     before the first message had left, so all thirty sent one. Marking it up
     front means the second caller sees the first has it. If the send then
     fails, the cost is silence until tomorrow rather than a mailbox full of
     the same sentence; the warning below is the trace. */
  t.mailedAt = now || Date.now();
  const started = new Date(t.firstSeen).toISOString().replace('T', ' ').slice(0, 16);
  const calls = t.calls + ' call' + (t.calls === 1 ? '' : 's');

  /* Written to the operator, not about them. The earlier version said "someone
     has to change the model name or the key" — which someone, and which of the
     two? It also headed Google's message "What Google says" and then printed
     our own summary of it, "gemini 400", because the reasoning call was
     dropping the body. Both are fixed: the fault is named, the words are
     Google's, and the thing to do is addressed to the person reading it. */
  const said = theirWords(t);
  const lines = closing
    ? [
      t.model + ' is answering again.',
      '',
      'It stopped at ' + started + ' UTC and ' + calls + ' ran into it.',
      'It had been saying: ' + said,
      '',
      'Nothing needs doing. Readings refused during this were not saved, and no',
      'places were guessed at — any that are waiting will be finished on their own.',
    ]
    : t.kind === 'busy'
      ? [
        t.model + ' has been failing for an hour.',
        '',
        'It says: ' + said,
        'Since ' + started + ' UTC · ' + calls + ' affected.',
        '',
        'This is the overloaded or rate-limited shape and it usually clears by',
        'itself, so there is nothing to do yet. You will get one more message when',
        'it clears. No places are being guessed at meanwhile.',
      ]
      : t.fault === 'key'
        ? [
          'The key is being refused, so no atlas can be read at all.',
          '',
          'Google says: ' + said,
          'Tried on ' + t.model + ' · since ' + started + ' UTC · ' + calls + ' refused.',
          '',
          'To fix: check GEMINI_API_KEY in api/.env on the server, then restart.',
          'Nothing else will help — every model is refused with the same key.',
        ]
        : t.fault === 'model'
          ? [
            t.model + ' has been withdrawn.',
            '',
            'Google says: ' + said,
            'Since ' + started + ' UTC · ' + calls + ' refused.',
            '',
            'The job moves to the next name on its list on its own, so this is not',
            'urgent. To stop it happening again, set the name Google suggests in',
            'api/.env — GEMINI_MODEL for reading, GEMINI_LITE_MODEL for answering.',
          ]
          : [
            t.model + ' is refusing calls, and waiting will not help.',
            '',
            'It says: ' + said,
            'Since ' + started + ' UTC · ' + calls + ' refused.',
            '',
            'This is neither a withdrawn model nor a refused key, so it is worth a',
            'look: /apps/atlas/api/admin/models shows what each job is running on.',
          ];
  try {
    await notify({
      subject: closing
        ? `[LOKA Atlas] ${t.model} is answering again`
        : t.kind === 'busy'
          ? `[LOKA Atlas] ${t.model} is failing`
          : t.fault === 'key'
            ? '[LOKA Atlas] the key is being refused — no atlas can be read'
            : t.fault === 'model'
              ? `[LOKA Atlas] ${t.model} has been withdrawn`
              : `[LOKA Atlas] ${t.model} is refusing calls`,
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
      t = { key, model: String(model || 'no model'), kind, why, said: (err && err.body) || '',
        fault: faultOf(err), firstSeen: now, calls: 0, mailedAt: 0 };
      open.set(key, t);
    }
    t.calls += 1;
    t.lastSeen = now;
    t.why = why;
    if (err && err.body) t.said = err.body;
    t.fault = faultOf(err);

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
