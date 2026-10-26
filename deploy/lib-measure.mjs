/* What the read-only measuring tools share (deploy/measure-questions.mjs and
 * deploy/scorecard.mjs): finding an atlas's places, calling the model the
 * way the server does, the stand-in model for checks with no network, one
 * counter with a hard ceiling on calls, and one fresh reading of a layer's
 * questions as "Ask again" makes it.
 *
 * Nothing here writes a file, and nothing here imports the server
 * (api/apps/atlas.js): a reading is asked of api/lib/atlas/enrich.js
 * enrichRows directly, which keeps nothing. The deoria-bioregion atlas is
 * never read, in any spelling (refused below).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as E from '../api/lib/atlas/enrich.js';

export const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RULES = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'reading-rules.js'));
export const ROOTS = [path.join(REPO, 'atlas', 'datasets'), path.join(REPO, 'api', 'data', 'atlas', 'private-datasets')];
const REGISTRY = path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
export const NEVER = 'deoria-bioregion';
// the server's own numbers (api/apps/atlas.js AI_CALLS_PER_READING, ANSWER_CHECK_CALLS)
export const CALLS_PER_ATTEMPT = 24;
export const CHECK_CALLS = 4;

/* A tool's help is its own opening comment, from the line after the first to
   the first line that is a bare "*". */
export function helpOf(fileUrl) {
  const lines = fs.readFileSync(fileURLToPath(fileUrl), 'utf8').split('\n');
  const end = lines.findIndex((l, k) => k > 4 && l.trim() === '*');
  return lines.slice(1, end).map((l) => l.replace(/^ \* ?/, '').replace(/^\/\* ?/, '')).join('\n');
}

export function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
export function die(msg) { console.error(msg); process.exit(1); }

// any spelling: a case-insensitive disk would otherwise let "Deoria-Bioregion" through
export function refused(named) {
  return String(named || '').toLowerCase().includes(NEVER);
}

/* The layer and its places as runReading finds them: the atlas's layers and
   its own overlay's, the one asked for, and the other half of its file when it
   shares one (sameFileAs), read as one set of places. */
export function loadAtlas(slug, layerId) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) die('not an atlas name: ' + slug);
  const dir = ROOTS.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json')));
  if (!dir) die('no atlas called ' + slug + ' in ' + ROOTS.join(' or '));
  const base = readJSON(path.join(dir, 'manifest.json')) || {};
  const local = readJSON(path.join(dir, 'manifest.local.json')) || {};
  const layers = [...(base.layers || []), ...(local.layers || [])];
  const withPlaces = layers.filter((L) => L && L.source && /\.geojson$/.test(String(L.source)) && !String(L.source).includes('..'));
  let layer = layerId ? layers.find((L) => L.id === layerId) : null;
  if (layerId && !layer) die('no layer ' + layerId + ' in ' + slug + '; layers with places: ' + withPlaces.map((L) => L.id).join(', '));
  if (!layer) {
    const own = withPlaces.filter((L) => (L.group || 'userdata') === 'userdata');
    if (own.length !== 1) die('name the layer with --layer=: ' + (own.length ? own : withPlaces).map((L) => L.id).join(', '));
    layer = own[0];
  }
  if (!layer.source || String(layer.source).includes('..')) die('layer ' + layer.id + ' has no places of its own');
  const rowsOf = (L) => {
    const gj = readJSON(path.join(dir, L.source));
    return gj ? ((gj.features || []).map((f) => (f && f.properties) || {})) : null;
  };
  const twin = layer.sameFileAs ? layers.find((L) => L.id === layer.sameFileAs && L.source && !String(L.source).includes('..')) : null;
  const halves = [layer].concat(twin ? [twin] : []).map((L) => rowsOf(L));
  if (!halves[0]) die('the places of layer ' + layer.id + ' are missing');
  const rows = halves.filter(Boolean).flat();
  // the title the reading is told: the registry's, as the server's instance carries it
  const inst = ((readJSON(REGISTRY) || {}).instances || {})[slug] || {};
  // an owner-kept set of categories turns a reading into filing (runReading passes keptCatSet)
  const cats = readJSON(path.join(dir, 'categories.local.json'));
  const kept = (cats && cats.kept && Array.isArray(cats.categories)) ? cats.categories : [];
  return { layer, rows, title: inst.title || slug, keptSet: kept };
}

export function loadFile(file) {
  const j = readJSON(file);
  if (!j || !Array.isArray(j.features)) die('cannot read places from ' + file + ' (want { layer, features })');
  return { layer: j.layer || {}, rows: j.features.map((f) => (f && f.properties) || {}), title: (j.layer && j.layer.label) || '', keptSet: [] };
}

/* The models a reading uses on the server, or the stand-in's names. The key
   comes from the environment, or from api/.env as the server reads it. */
export async function loadModels(stub) {
  if (stub) return { flash: 'stub', flashLite: 'stub-lite' };
  if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
  if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env (or use --stub)');
  const M = await import('../api/lib/models.js');
  await M.recheckModels();
  return { flash: M.getFlashModel(), flashLite: M.getFlashLiteModel() };
}

/* ---------- calling the model, as the server does ---------- */
const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
async function post(model, prompt, schema, cfg, timeout) {
  const r = await fetch(API + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: Object.assign({ responseMimeType: 'application/json', responseSchema: schema }, cfg) }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) {
    let why = '';
    try { why = (((await r.json()) || {}).error || {}).message || ''; } catch { /* not json */ }
    const e = new Error('the model refused (' + r.status + ')' + (why ? ': ' + why.slice(0, 160) : ''));
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) throw new Error('no answer from the model');
  if (cand.finishReason && cand.finishReason !== 'STOP') throw new Error('the answer stopped early (' + cand.finishReason + ')');
  const text = ((cand.content && cand.content.parts) || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
  return JSON.parse(text);
}
const QUIET = [{ thinkingBudget: 0 }, { thinkingLevel: 'low' }, null];   // atlas.js QUIET_DIALECTS
const quietOf = new Map();
// geminiJSONDeep for { think }, geminiJSONFile for { file } — every call a reading makes is one of the two
export async function realCall(model, prompt, schema, o) {
  if (o && o.think) {
    return post(model, prompt, schema, { maxOutputTokens: 16384, temperature: 0.2, thinkingConfig: { thinkingBudget: 2048 } }, 90000);
  }
  const tries = quietOf.has(model) ? [quietOf.get(model)] : QUIET;
  let last = null;
  for (const quiet of tries) {
    try {
      const out = await post(model, prompt, schema, Object.assign({ maxOutputTokens: 24000, temperature: 0 },
        quiet ? { thinkingConfig: quiet } : {}), 120000);
      quietOf.set(model, quiet);
      return out;
    } catch (e) {
      last = e;
      if (e.status !== 400) throw e;      // only a refused setting is worth asking again without it
    }
  }
  throw last;
}

/* The stand-in. Finding: the words (four letters or more) on three or more of
   the lines but not on all of them, commonest first, make two questions of
   three kinds each. Answering: a place takes the first kind its own column
   says, quoting the word. The check says yes to everything. Enough to run the
   whole of a reading with nothing on the network. Each question names a
   checklist item (about) of its own, counting on from the last call's, so
   the one-question-per-item rule (enrich.js G1) does not fold the stand-in's
   questions together before the six-question cap would. resetStand starts
   the count again, so two readings of the same places name the same items. */
let stubAbout = 0;
export function resetStand() { stubAbout = 0; }
const FENCE = /----- BEGIN PLACES[^\n]*\n([\s\S]*?)\n----- END PLACES -----/;
function stubFind(prompt) {
  const lines = ((prompt.match(FENCE) || [])[1] || '').split('\n').filter((l) => /^\d+\. /.test(l));
  const on = new Map();
  for (const l of lines) {
    for (const w of new Set(l.replace(/^\d+\. /, '').toLowerCase().match(/[a-z]{4,}/g) || [])) on.set(w, (on.get(w) || 0) + 1);
  }
  const words = [...on.entries()].filter(([, n]) => n >= 3 && n < lines.length)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).map(([w]) => w);
  const qs = [words.slice(0, 3), words.slice(3, 6)].filter((k) => k.length >= 2).map((k) => ({
    about: (stubAbout++ % 8) + 1,
    question: 'Does it say ' + k.slice(0, -1).join(', ') + ' or ' + k[k.length - 1] + '?', noun: '',
    kinds: k.map((w) => ({ name: w, definition: 'Places that say ' + w, examples: [1, 2, 3] })),
  }));
  return qs.length ? { reading: 'stand-in', facts: ['words'], verdict: 'questions', questions: qs }
    : { reading: 'stand-in', facts: [], verdict: 'no_clear_questions', note: 'no word on three places' };
}
function stubAnswer(prompt) {
  // a question asked of several columns at once (the columns read together, enrich.js G2) is answered from the whole place
  const qs = [...prompt.matchAll(/^q(\d+) — (.*?)(?:   \(asked of the ("[^\n]*?") columns? only\))?\n((?:   .*\n?)+)/gm)]
    .map((x) => ({ n: Number(x[1]), col: x[3] && !/" and "/.test(x[3]) ? x[3].slice(1, -1) : '', several: Boolean(x[3] && /" and "/.test(x[3])),
      kinds: x[4].split('\n').map((l) => l.trim().split(' — ')[0]).filter(Boolean) }));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
  return { rows: blocks.map((b) => {
    const r = { i: Number(b.match(/^(\d+)\./)[1]) };
    for (const q of qs) {
      const part = q.several ? b.toLowerCase() : ((b.match(new RegExp('(?:^\\d+\\. |\\n    )' + esc(q.col || 'whole record') + ': ([^\\n]*)')) || [])[1] ||
        (!/\n    /.test(b) ? b.replace(/^\d+\. /, '') : '')).toLowerCase();
      const hit = q.kinds.find((k) => new RegExp('\\b' + esc(k.toLowerCase()) + '\\b').test(part));
      r['q' + q.n] = hit || 'other';
      r['w' + q.n] = hit ? [hit.toLowerCase()] : [];
    }
    return r;
  }) };
}
export async function stubCall(model, prompt, schema, o) {
  if (schema && schema.properties && schema.properties.checks) return { checks: [] };
  if (schema && schema.properties && schema.properties.questions) return stubFind(prompt);
  if (o && o.file) return stubAnswer(prompt);
  throw new Error('the stand-in has no answer for this call');
}

/* Every call of the run goes through one counter with a hard ceiling. Each
   attempt gets its own caller, as the server gives it (aiCaller): its own cap
   (24 + 4 for a reading, which the answer check reads to know its room) and
   its own count. A caller may be given its own stand-in (stand) for calls the
   reading's stand-in cannot answer, such as the summary's. */
export function budget(maxCalls, stub) {
  let spent = 0;
  const caller = (cap = CALLS_PER_ATTEMPT + CHECK_CALLS, stand = stubCall) => {
    let mine = 0;
    const call = async (model, prompt, schema, o) => {
      if (spent >= maxCalls) throw new Error('this measurement has used its ' + maxCalls + ' calls');
      if (mine >= call.cap) throw new Error('this reading has used its share of the model');
      spent += 1; mine += 1;
      return (stub ? stand : realCall)(model, prompt, schema, o);
    };
    call.cap = cap;
    call.spent = () => mine;
    return call;
  };
  return { caller, spent: () => spent, left: () => maxCalls - spent };
}

/* runReading's retry, the same tests: holes named by the first attempt, and a
   second set kept only if more questions speak for most of the map or, on a
   tie, fewer places are left with no answer. */
export const holesIn = (r) => [
  ...((r.gaps || []).flatMap((g) => g.missing.map((m) => ({ word: m.word, places: m.places, under: g.question })))),
  ...((r.nobodyAsked || []).map((m) => ({ word: m.word, places: m.places, under: '' }))),
];
export const strongIn = (r) => (r.questions || []).filter((q) => q.coverage >= 0.6).length;
export const unspokenIn = (r, n) => Array.from({ length: n }, (_, i) => i).filter((i) =>
  !(r.questions || []).some((q) => q.categories[i] && q.categories[i] !== 'other')).length;

/* One fresh reading, as runReading does it with afresh: no settled questions,
   nothing carried from an earlier reading's record, and one more attempt
   when the first left a group of places with no answer, kept only if it is
   better. Answers { out, retry } — retry is null, or { missed, better }. */
export async function freshReading({ rows, fields, title, nameCol, pot, models }) {
  const ask = (missed, reuseFound) => E.enrichRows({
    rows, fields, title, mode: 'questions', keepQuestions: [], seedSet: [],
    callJSON: pot.caller(), models, missed, nameCol, callBudget: CALLS_PER_ATTEMPT,
    addColumns: null, reuseFound, previousColumns: [],
  });
  let out = await ask([], null);
  let retry = null;
  if (out.verdict === 'questions' && holesIn(out).length) {
    const missed = holesIn(out).slice(0, 4);
    const second = await ask(missed, out.found || null);
    const better = Boolean(second.verdict === 'questions' && (second.questions || []).length &&
      (strongIn(second) !== strongIn(out) ? strongIn(second) > strongIn(out) : unspokenIn(second, rows.length) < unspokenIn(out, rows.length)));
    retry = { missed, better };
    if (better) out = second;
  }
  return { out, retry };
}
