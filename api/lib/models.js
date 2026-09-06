/* Which model each job runs on.

   This file used to guess. It asked Google for a list, took the highest-numbered
   flash it saw, and built the cheaper model's name by gluing "-lite" onto the
   end of it. On 3 September 2026 that produced gemini-2.5-flash-lite, a model
   Google had retired, and every call to answer questions about a place came back
   404 for days without a word anywhere.

   Two things were wrong and both are fixed here.

   A name is no longer derived. Gluing a suffix onto a string and hoping is what
   invented the dead model; each job now has its own ordered list of real names.

   And a listing is no longer taken as proof. Measured the day this was written:
   gemini-2.5-flash-lite is still in the account's list of 54 models and returns
   404 the moment you call it. So each candidate is actually CALLED, in the same
   shape the job will use it in, and the first one that answers is the one that
   gets the work. */

const apiKey = process.env.GEMINI_API_KEY;
const REST = 'https://generativelanguage.googleapis.com/v1beta/models';
const REFRESH_MS = 24 * 60 * 60 * 1000;

/* Ordered by what was measured on 5 September 2026 against this account, on the
   real work rather than on a hello.

   Reading — the one call that has to look at a whole set of places and decide
   what it can honestly be asked. gemini-2.5-flash is first because it is the
   only one that actually spends its thinking allowance on that call: given a
   budget of 2,048 it used 1,557, while every 3-series model took the same
   budget and spent nothing. The newer ones also proposed worse questions — one
   offered "which locality is it in", which is the address column read back.

   Answering — copying a kind and quoting the words that justify it, for every
   place. Not reasoning, and thinking there only crowds out the answer. At a
   full batch of 40 places and 6 questions, gemini-3.5-flash-lite kept 100 of
   100 quoted words while gemini-3.1-flash-lite kept 130 of 171. */
const READING = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash'];
const FILING = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];

function ordered(envName, list) {
  const pinned = process.env[envName];
  // A pinned name goes first but is still called before it is trusted — the
  // name that broke this was pinned by derivation and nobody checked it.
  return pinned ? [pinned, ...list.filter((m) => m !== pinned)] : list.slice();
}

let flashModel = ordered('GEMINI_MODEL', READING)[0];
let liteModel = ordered('GEMINI_LITE_MODEL', FILING)[0];
let lastRefreshedAt = 0;
let notes = [];

async function listNames() {
  // the pinned SDK (0.3.1) has no models.list — measured, it throws
  const r = await fetch(REST + '?pageSize=200', { headers: { 'x-goog-api-key': apiKey } });
  if (!r.ok) throw new Error('listing refused (' + r.status + ')');
  return ((await r.json()).models || []).map((m) => String(m.name || '').replace(/^models\//, ''));
}

/* One real call, in the shape the job uses. The two jobs speak different
   dialects and a model that takes one may refuse the other: gemini-2.5-flash
   rejects thinkingLevel, and gemini-3.5-flash-lite rejects a thinking budget of
   zero while accepting 2,048. Asking in the wrong dialect would rule out a
   perfectly good model, so when only the thinking request is refused it is
   dropped and the call made again — the same thing the filing call itself
   does. */
async function answers(model, thinking) {
  async function once(withThinking) {
    const gen = { maxOutputTokens: 3000 };
    if (withThinking) gen.thinkingConfig = withThinking;
    const r = await fetch(REST + '/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word ok.' }] }], generationConfig: gen }),
      signal: AbortSignal.timeout(20000),
    });
    if (r.ok) return true;
    let why = '';
    try { why = ((await r.json()).error || {}).message || ''; } catch { /* not json */ }
    const e = new Error(r.status + ' ' + why.replace(/\s+/g, ' ').slice(0, 90));
    e.status = r.status;
    e.body = why;
    throw e;
  }
  try { return await once(thinking); }
  catch (e) {
    if (thinking && e.status === 400 && /thinking|invalid argument/i.test(e.body || e.message || '')) {
      try { return await once(null); } catch (e2) { throw e2; }
    }
    throw e;
  }
}

async function pick(job, choices, thinking, listed) {
  for (const m of choices) {
    if (listed && !listed.includes(m)) { notes.push(job + ': ' + m + ' is not in the account\'s list'); continue; }
    try {
      await answers(m, thinking);
      if (m !== choices[0]) {
        console.warn('[models] ' + job + ' fell back to ' + m + ' — ' + choices[0] + ' would not answer');
      }
      return m;
    } catch (e) {
      notes.push(job + ': ' + m + ' — ' + e.message);
      console.warn('[models] ' + job + ': ' + m + ' would not answer — ' + e.message);
    }
  }
  console.error('[models] ' + job + ': NOTHING answered. Keeping ' + choices[0] + ', which will fail.');
  return choices[0];
}

async function refresh() {
  if (!apiKey) return;
  notes = [];
  let listed = null;
  try { listed = await listNames(); }
  catch (e) {
    // a listing we cannot get is not a reason to stop: the calls below are the
    // real test anyway, and skipping the filter only costs a wasted call
    console.warn('[models] could not list the account\'s models — ' + e.message + '; calling the candidates anyway');
  }
  try {
    const wasFlash = flashModel, wasLite = liteModel;
    flashModel = await pick('reading', ordered('GEMINI_MODEL', READING), { thinkingBudget: 2048 }, listed);
    liteModel = await pick('answering', ordered('GEMINI_LITE_MODEL', FILING), { thinkingBudget: 0 }, listed);
    if (flashModel !== wasFlash || liteModel !== wasLite || !lastRefreshedAt) {
      console.log('[models] reading on ' + flashModel + ', answering on ' + liteModel);
    }
  } catch (e) {
    console.warn('[models] choosing a model failed — ' + (e && e.message));
  } finally {
    lastRefreshedAt = Date.now();
  }
}

export function startModelResolver() {
  refresh();
  setInterval(refresh, REFRESH_MS).unref();
}

// used by tests and by the admin status page to force a fresh look
export function recheckModels() { return refresh(); }

export function getFlashModel() { return flashModel; }

// No longer derived. The suffix trick is what invented a retired model.
export function getFlashLiteModel() { return liteModel; }

// Text-embedding model for the viewer's semantic search. Defaults to Google's
// multilingual embedding model (100+ languages) so search works across languages
// as atlases grow beyond English. Env-overridable; nothing here probes it,
// because a failed search is visible where a failed reading was not.
export function getEmbedModel() {
  return process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
}

export function getResolverStatus() {
  const readingChoices = ordered('GEMINI_MODEL', READING);
  const filingChoices = ordered('GEMINI_LITE_MODEL', FILING);
  return {
    reading: flashModel,
    answering: liteModel,
    readingIsFirstChoice: flashModel === readingChoices[0],
    answeringIsFirstChoice: liteModel === filingChoices[0],
    checkedAt: lastRefreshedAt,
    pinned: {
      reading: Boolean(process.env.GEMINI_MODEL),
      answering: Boolean(process.env.GEMINI_LITE_MODEL),
    },
    trouble: notes,
    // the old names, for anything still reading them
    flashModel,
    overridden: Boolean(process.env.GEMINI_MODEL),
  };
}
