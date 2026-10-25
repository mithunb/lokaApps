#!/usr/bin/env node
/* Measure the Insight summary ("What the places say") on one atlas: write it
 * a few times over the same answers and show what each step did. Reads only;
 * saves nothing.
 *
 *   node deploy/measure-summary.mjs --dataset=<slug> [--runs=3] [--layer=id] [--max-calls=N]
 *   node deploy/measure-summary.mjs --file=places.json [--stub] [--runs=3]
 *   --dataset=SLUG  the atlas to measure (its own folder under atlas/datasets or the private ones)
 *   --layer=ID      the layer whose questions are summed up (default: the one the atlas's
 *                   Insight mode names, else the first that can be shown in Insight)
 *   --runs=N        how many summaries to write over the same answers (default 3, at most 10)
 *   --max-calls=N   a hard ceiling on model calls for the whole run (default four a run:
 *                   the write, one retry when no sentence passes the cell check, the
 *                   proofread, one re-write when the proofread leaves under two)
 *   --file=PATH     read places from a file instead of an atlas: { layer: {keyLabels, …}, features }
 *   --stub          no model at all: the server's stand-in writes the sentences, and the
 *                   stand-in proofread questions the last one, so there is a drop to show
 *
 * Each run writes the summary as "Write it again" does (api/lib/atlas/
 * insight-summary.js writeSummary, forced, with no summary before it) and
 * prints, in order: the sentences the cell check dropped and why, the ones
 * it kept, the ones the proofread dropped and why (or why the proofread was
 * skipped), the re-write when there was one, and the sentences a visitor
 * would see. Running it more than once shows what moves
 * with nothing changed.
 *
 * The model is called the way the server calls the summary (api/apps/atlas.js
 * insightCaller, a file call): the reading model, thinking kept low, at
 * temperature 0. The calls are counted by this run alone, against
 * --max-calls; they are not charged to anybody's hourly allowance on the
 * running server, which lives in that process. The key comes from the
 * environment, or from api/.env as the server reads it.
 *
 * The deoria-bioregion atlas is never measured, in any spelling. Nothing is
 * written anywhere: not into atlas/ or api/data, not the atlas's saved
 * summary, no report file. Everything goes to the screen.
 *
 * The sentences are written from the answer counts only (no place's own
 * words, no names), so they are safe to print.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as SUM from '../api/lib/atlas/insight-summary.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IM = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'insight-mode.js'));
const ROOTS = [path.join(REPO, 'atlas', 'datasets'), path.join(REPO, 'api', 'data', 'atlas', 'private-datasets')];
const NEVER = 'deoria-bioregion';
// the schema's types, as @google/genai names them (the REST API takes the same words)
const Type = { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', NUMBER: 'NUMBER' };

function s_helpEnd() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  return lines.findIndex((l, k) => k > 4 && l.trim() === '*');
}
const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  .slice(1, s_helpEnd()).map((l) => l.replace(/^ \* ?/, '').replace(/^\/\* ?/, '')).join('\n');

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function die(msg) { console.error(msg); process.exit(1); }

export function parseArgs(argv) {
  const o = { dataset: '', layer: '', runs: 3, maxCalls: 0, file: '', stub: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--stub') o.stub = true;
    else if (a.startsWith('--dataset=')) o.dataset = a.slice(10);
    else if (a.startsWith('--layer=')) o.layer = a.slice(8);
    else if (a.startsWith('--runs=')) o.runs = Math.min(10, Math.max(1, Math.floor(Number(a.slice(7)) || 0)));
    else if (a.startsWith('--max-calls=')) o.maxCalls = Math.max(1, Math.floor(Number(a.slice(12)) || 0));
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else die('unknown option ' + a + ' — see --help');
  }
  if (o.dataset && o.file) die('either --dataset or --file, not both');
  if (!o.maxCalls) o.maxCalls = o.runs * 4;
  return o;
}

// any spelling: a case-insensitive disk would otherwise let "Deoria-Bioregion" through
export function refused(named) {
  return String(named || '').toLowerCase().includes(NEVER);
}

/* The layer and its places as the server finds them for Insight
   (api/apps/atlas.js insightSource): the atlas's own layers with questions,
   the one asked for (or the one its Insight mode names) first, the first
   whose places can be shown in Insight. */
function loadAtlas(slug, layerId) {
  const dir = ROOTS.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json')));
  if (!dir) die('no atlas called ' + slug + ' in ' + ROOTS.join(' or '));
  const local = readJSON(path.join(dir, 'manifest.local.json')) || {};
  const want = layerId || (local.mode && local.mode.layer) || '';
  const layers = (local.layers || []).filter((L) => L && (L.group || 'userdata') === 'userdata' && L.source &&
    !String(L.source).includes('..') && L.keyLabels && typeof L.keyLabels === 'object');
  if (layerId && !layers.some((L) => L.id === layerId)) die('no layer ' + layerId + ' with questions in ' + slug + '; layers with questions: ' + layers.map((L) => L.id).join(', '));
  layers.sort((a, b) => (b.id === want) - (a.id === want));
  for (const L of layers) {
    const gj = readJSON(path.join(dir, L.source));
    const features = (gj && gj.features) || [];
    if (features.length && IM.canInsight(L, features)) return { layer: L, features };
    if (layerId) die('layer ' + layerId + ' cannot be shown in Insight (no questions its places answer)');
  }
  die('no layer in ' + slug + ' can be shown in Insight');
}

function loadFile(file) {
  const j = readJSON(file);
  if (!j || !Array.isArray(j.features)) die('cannot read places from ' + file + ' (want { layer, features })');
  return { layer: j.layer || {}, features: j.features };
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
// the server's file call (geminiJSONFile): thinking kept low, temperature 0, the dialect that works remembered
async function realCall(model, prompt, schema) {
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

/* The stand-in: the server's own (insightCaller with ATLAS_FAKE_READING) for
   the write; the proofread questions the last sentence, so the report has a
   drop to show. */
async function stubCall(model, prompt, schema, o) {
  if (o && o.proofread) {
    const all = SUM.standInProofread(prompt).checks;
    if (all.length) all[all.length - 1] = { index: all.length - 1, ok: false, why: 'stand-in: the last sentence is always questioned' };
    return { checks: all };
  }
  let t = null;
  try { t = JSON.parse(String(prompt).split('\n').pop()); } catch { t = null; }
  return SUM.standInAnswer(t);
}

/* Every call of the run goes through one counter with a hard ceiling; each
   run gets its own view of it, so its calls can be told apart. */
function budget(maxCalls, stub) {
  let spent = 0;
  const view = () => {
    let mine = 0;
    const call = async (model, prompt, schema, o) => {
      if (spent >= maxCalls) throw new Error('this measurement has used its ' + maxCalls + ' calls');
      spent += 1; mine += 1;
      return (stub ? stubCall : realCall)(model, prompt, schema, o);
    };
    call.used = () => mine;
    return call;
  };
  return { view, left: () => maxCalls - spent };
}

const bullet = (list) => list.length ? list.map((t) => '    - ' + t).join('\n') : '    (none)';

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.dataset && !o.file)) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  const named = o.dataset || o.file;
  if (refused(named)) die('refused: ' + NEVER + ' is never measured or read (standing rule)');

  const { layer, features } = o.file ? loadFile(o.file) : loadAtlas(o.dataset, o.layer);
  if (!features.length) die('the layer has no places');
  const tables = IM.summaryTables(layer, features);
  if (!tables.questions.length) die('the layer has no questions its places answer');

  let model = 'stub';
  if (!o.stub) {
    if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
    if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env (or use --stub)');
    const M = await import('../api/lib/models.js');
    await M.recheckModels();
    model = M.getFlashModel();      // the summary's model on the server (runInsightSummary)
  }
  console.log('Measuring ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + tables.places + ' places, ' +
    tables.questions.length + ' questions, ' + tables.pairs.length + ' pairs; ' + o.runs + ' run' + (o.runs === 1 ? '' : 's') +
    ' on ' + model + '; at most ' + o.maxCalls + ' calls.');

  const pot = budget(o.maxCalls, o.stub);
  const finals = [];
  for (let k = 1; k <= o.runs; k++) {
    const call = pot.view();
    // forced and with no summary before it, as "Write it again"; the answer is printed, never saved
    const r = await SUM.writeSummary({ layer, features, prev: null, call, model, Type, force: true });
    const proof = r.proofread || { dropped: [], skipped: r.checked ? '' : 'not run' };
    console.log('\nRun ' + k + ' — ' + r.by + ', ' + call.used() + ' call' + (call.used() === 1 ? '' : 's') +
      (r.dropped ? '; the cell check dropped ' + r.dropped : ''));
    if ((r.cellDropped || []).length) {
      console.log('  Dropped by the cell check (' + r.cellDropped.length + '):');
      console.log(bullet(r.cellDropped.map((d) => d.text + ' — ' + d.why)));
    }
    console.log('  Kept by the cell check (' + (r.checked || []).length + '):');
    console.log(bullet((r.checked || []).map((s) => s.text)));
    if (proof.skipped) console.log('  Proofread skipped: ' + proof.skipped);
    else {
      console.log('  Dropped by the proofread (' + proof.dropped.length + '):');
      console.log(bullet(proof.dropped.map((d) => d.text + ' — ' + d.why)));
    }
    if (r.rewrite) {
      if (r.rewrite.skipped) console.log('  Re-write skipped: ' + r.rewrite.skipped);
      else console.log('  Written again (the proofread left under two): kept ' + r.rewrite.kept.length + ', dropped ' + r.rewrite.dropped.length);
    }
    const final = r.summary ? r.summary.sentences.map((s) => s.text) : [];
    console.log('  Final (' + (r.summary ? final.length : 'none: no summary would show') + '):');
    console.log(bullet(final));
    finals.push(JSON.stringify(final));
    if (pot.left() <= 0 && k < o.runs) { console.log('\nStopped: the ' + o.maxCalls + ' calls are used.'); break; }
  }
  if (finals.length > 1) {
    const same = finals.filter((f) => f === finals[0]).length;
    console.log('\n' + same + ' of ' + finals.length + ' runs gave the same final sentences as the first.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
