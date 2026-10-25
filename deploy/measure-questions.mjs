#!/usr/bin/env node
/* Measure the question finding on one atlas layer: ask its places for questions
 * afresh, as "Ask again" would, and show what each column gave, what was dropped
 * and why, and the questions a visitor would get. Reads only; saves nothing.
 *
 *   node deploy/measure-questions.mjs --dataset=<slug> --layer=<id> [--runs=1] [--max-calls=N]
 *   node deploy/measure-questions.mjs --file=places.json [--stub] [--runs=1]
 *   --dataset=SLUG  the atlas to measure (its own folder under atlas/datasets or the private ones)
 *   --layer=ID      the layer whose places are read (needed when the atlas has more than one)
 *   --runs=N        how many fresh readings of the same places (default 1, at most 5)
 *   --max-calls=N   a hard ceiling on model calls for the whole run (default 56 a run:
 *                   a reading's two attempts, each with the server's own 24 calls
 *                   plus 4 for the answer check)
 *   --file=PATH     read places from a file instead of an atlas: { layer: {id, popup}, features }
 *   --stub          no model at all: a stand-in finds questions from the commonest words
 *                   and answers each place by the first of them its own words say
 *
 * Each run is what a fresh reading does (api/apps/atlas.js runReading with
 * afresh): every column with words of its own asked on its own
 * (api/lib/atlas/enrich.js enrichRows, questions mode, with no settled
 * questions), the answers counted and trimmed, and one more attempt when the
 * first left a group of places with no answer, kept only if it is better. It
 * prints, for every column, the line the owner's page would show — what it
 * gave, what was dropped and why — then the questions kept, how many places
 * each reaches, and how many places took each answer. Running it more than
 * once shows what moves with nothing changed.
 *
 * The model is called the way the server calls it (api/apps/atlas.js
 * aiCaller): finding questions and the answer check on the reading model with
 * thinking on at 0.2, answering with thinking off at temperature 0. The calls
 * are counted by this run alone, against --max-calls; they are not charged to
 * anybody's hourly allowance on the running server, which lives in that
 * process. The key comes from the environment, or from api/.env as the
 * server reads it.
 *
 * The deoria-bioregion atlas is never measured, in any spelling. Nothing is
 * written anywhere: not into atlas/ or api/data, not the layer's questions or
 * answers, not the manifest, not the reading's history, no report file.
 * Everything goes to the screen. Questions, answers and column names are
 * printed; no place's name or own words are.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as E from '../api/lib/atlas/enrich.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'reading-rules.js'));
const ROOTS = [path.join(REPO, 'atlas', 'datasets'), path.join(REPO, 'api', 'data', 'atlas', 'private-datasets')];
const REGISTRY = path.join(REPO, 'api', 'data', 'atlas', 'registry.json');
const NEVER = 'deoria-bioregion';
// the server's own numbers (api/apps/atlas.js AI_CALLS_PER_READING, ANSWER_CHECK_CALLS)
const CALLS_PER_ATTEMPT = 24;
const CHECK_CALLS = 4;

function s_helpEnd() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  return lines.findIndex((l, k) => k > 4 && l.trim() === '*');
}
const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  .slice(1, s_helpEnd()).map((l) => l.replace(/^ \* ?/, '').replace(/^\/\* ?/, '')).join('\n');

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function die(msg) { console.error(msg); process.exit(1); }

export function parseArgs(argv) {
  const o = { dataset: '', layer: '', runs: 1, maxCalls: 0, file: '', stub: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--stub') o.stub = true;
    else if (a.startsWith('--dataset=')) o.dataset = a.slice(10);
    else if (a.startsWith('--layer=')) o.layer = a.slice(8);
    else if (a.startsWith('--runs=')) o.runs = Math.min(5, Math.max(1, Math.floor(Number(a.slice(7)) || 0)));
    else if (a.startsWith('--max-calls=')) o.maxCalls = Math.max(1, Math.floor(Number(a.slice(12)) || 0));
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else die('unknown option ' + a + ' — see --help');
  }
  if (o.dataset && o.file) die('either --dataset or --file, not both');
  if (!o.maxCalls) o.maxCalls = o.runs * 2 * (CALLS_PER_ATTEMPT + CHECK_CALLS);
  return o;
}

// any spelling: a case-insensitive disk would otherwise let "Deoria-Bioregion" through
export function refused(named) {
  return String(named || '').toLowerCase().includes(NEVER);
}

/* The layer and its places as runReading finds them: the atlas's layers and
   its own overlay's, the one asked for, and the other half of its file when it
   shares one (sameFileAs), read as one set of places. */
function loadAtlas(slug, layerId) {
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

function loadFile(file) {
  const j = readJSON(file);
  if (!j || !Array.isArray(j.features)) die('cannot read places from ' + file + ' (want { layer, features })');
  return { layer: j.layer || {}, rows: j.features.map((f) => (f && f.properties) || {}), title: (j.layer && j.layer.label) || '', keptSet: [] };
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
async function realCall(model, prompt, schema, o) {
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
   questions together before the six-question cap would. */
let stubAbout = 0;
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
async function stubCall(model, prompt, schema, o) {
  if (schema && schema.properties && schema.properties.checks) return { checks: [] };
  if (schema && schema.properties && schema.properties.questions) return stubFind(prompt);
  if (o && o.file) return stubAnswer(prompt);
  throw new Error('the stand-in has no answer for this call');
}

/* Every call of the run goes through one counter with a hard ceiling. Each
   attempt gets its own caller, as the server gives it (aiCaller): its own cap
   of 24 + 4, which the answer check reads to know its room, and its own count. */
function budget(maxCalls, stub) {
  let spent = 0;
  const caller = () => {
    let mine = 0;
    const call = async (model, prompt, schema, o) => {
      if (spent >= maxCalls) throw new Error('this measurement has used its ' + maxCalls + ' calls');
      if (mine >= call.cap) throw new Error('this reading has used its share of the model');
      spent += 1; mine += 1;
      return (stub ? stubCall : realCall)(model, prompt, schema, o);
    };
    call.cap = CALLS_PER_ATTEMPT + CHECK_CALLS;
    call.spent = () => mine;
    return call;
  };
  return { caller, spent: () => spent, left: () => maxCalls - spent };
}

/* runReading's retry, the same tests: holes named by the first attempt, and a
   second set kept only if more questions speak for most of the map or, on a
   tie, fewer places are left with no answer. */
const holesIn = (r) => [
  ...((r.gaps || []).flatMap((g) => g.missing.map((m) => ({ word: m.word, places: m.places, under: g.question })))),
  ...((r.nobodyAsked || []).map((m) => ({ word: m.word, places: m.places, under: '' }))),
];
const strongIn = (r) => (r.questions || []).filter((q) => q.coverage >= 0.6).length;
const unspokenIn = (r, n) => Array.from({ length: n }, (_, i) => i).filter((i) =>
  !(r.questions || []).some((q) => q.categories[i] && q.categories[i] !== 'other')).length;

const bullet = (list) => list.length ? list.map((t) => '    - ' + t).join('\n') : '    (none)';

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.dataset && !o.file)) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  const named = o.dataset || o.file;
  if (refused(named) || refused(o.layer)) die('refused: ' + NEVER + ' is never measured or read (standing rule)');

  const { layer, rows, title, keptSet } = o.file ? loadFile(o.file) : loadAtlas(o.dataset, o.layer);
  if (!rows.length) die('the layer has no places');
  if (keptSet.length) die('this atlas has a set of categories its owner kept; a reading files places into that set and finds no questions, so there is nothing to measure');
  const fields = RULES.wordColumns(rows);
  if (!fields.length) die('none of the columns hold words to read');
  const nameCol = (layer.popup && layer.popup.title) || 'name';

  let models = { flash: 'stub', flashLite: 'stub-lite' };
  if (!o.stub) {
    if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
    if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env (or use --stub)');
    const M = await import('../api/lib/models.js');
    await M.recheckModels();
    models = { flash: M.getFlashModel(), flashLite: M.getFlashLiteModel() };
  }
  console.log('Measuring ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + rows.length + ' places, ' +
    fields.length + ' columns with words; ' + o.runs + ' fresh reading' + (o.runs === 1 ? '' : 's') +
    ' on ' + models.flash + '; at most ' + o.maxCalls + ' calls.');

  const pot = budget(o.maxCalls, o.stub);
  const sets = [];
  for (let k = 1; k <= o.runs; k++) {
    const before = pot.spent();
    // afresh: no settled questions, nothing carried from an earlier reading's record
    const ask = (missed, reuseFound) => E.enrichRows({
      rows, fields, title, mode: 'questions', keepQuestions: [], seedSet: [],
      callJSON: pot.caller(), models, missed, nameCol, callBudget: CALLS_PER_ATTEMPT,
      addColumns: null, reuseFound, previousColumns: [],
    });
    let out = await ask([], null);
    let retry = '';
    if (out.verdict === 'questions' && holesIn(out).length) {
      const missed = holesIn(out).slice(0, 4);
      const second = await ask(missed, out.found || null);
      const better = second.verdict === 'questions' && (second.questions || []).length &&
        (strongIn(second) !== strongIn(out) ? strongIn(second) > strongIn(out) : unspokenIn(second, rows.length) < unspokenIn(out, rows.length));
      retry = 'asked again for ' + missed.map((m) => m.word + ' on ' + m.places + ' places' +
        (m.under ? ' left blank by “' + m.under + '”' : ' asked about by nothing')).join('; ') +
        ' — ' + (better ? 'the second set was better, and is the one shown' : 'the second set was no better; the first is shown');
      if (better) out = second;
    }
    const used = pot.spent() - before;
    console.log('\nRun ' + k + ' — ' + out.verdict + ', ' + used + ' call' + (used === 1 ? '' : 's'));
    if (retry) console.log('  ' + retry);
    if (out.verdict !== 'questions') {
      const why = out.note || out.reason || out.trouble || '';
      if (why) console.log('  Why: ' + why);
    }
    console.log('  Every column (what it gave, what was dropped and why):');
    console.log(bullet((out.columns || []).map((c) => c.line)));
    const qs = out.verdict === 'questions' ? (out.questions || []) : [];
    console.log('  Questions kept (' + qs.length + '):');
    for (const q of qs) {
      const blank = rows.length - q.answered - q.other;
      console.log('    - “' + q.question + '”' + (q.column ? ' (from ' + q.column + ')' : '') +
        ' — reaches ' + q.answered + ' of ' + rows.length + ' places' + (q.flat ? '; one answer takes most of them' : ''));
      console.log('        ' + q.counts.map((c) => c.name + ' ' + c.count).join(', ') +
        (q.other ? '; none of these: ' + q.other : '') + (blank > 0 ? '; no answer: ' + blank : ''));
    }
    sets.push(JSON.stringify(qs.map((q) => q.question)));
    if (pot.left() <= 0 && k < o.runs) { console.log('\nStopped: the ' + o.maxCalls + ' calls are used.'); break; }
  }
  if (sets.length > 1) {
    const same = sets.filter((s) => s === sets[0]).length;
    console.log('\n' + same + ' of ' + sets.length + ' runs kept the same questions, in the same words, as the first.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
