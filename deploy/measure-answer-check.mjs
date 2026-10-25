#!/usr/bin/env node
/* Measure the evidence rule and the careful answer check on one atlas layer,
 * before they are trusted with a reading. Reads only; writes nothing anywhere
 * near the atlas.
 *
 *   node deploy/measure-answer-check.mjs <slug> [--layer=id] [--out=dir] [--max-calls=60]
 *   node deploy/measure-answer-check.mjs --file=places.json [--stub]
 *   --layer=ID      the layer to measure (needed when more than one has questions)
 *   --out=DIR       where the .json and .md reports go (default: the system's temp folder)
 *   --max-calls=N   a hard ceiling on model calls for the whole run (default 60; 80 with --stability)
 *   --no-noise      skip the second run of the old step (by default it runs, to show what moves with nothing changed)
 *   --file=PATH     read places from a file instead of an atlas: { layer: {keyLabels, keyKinds, …}, features }
 *   --stub          no model at all: a stand-in answers by matching kind names, and the check says yes
 *   --stability     instead: how steady the answers are — quick model twice, careful model twice,
 *                   and "answer twice, keep what agrees" (default --max-calls 80 in this mode)
 *   --sample=N      with --stability: write <out>/sample-<slug>.json, N place-and-question pairs where
 *                   the quick and careful models answered differently (never questions about people)
 *
 * Three runs over the same places and the layer's settled questions (keyLabels /
 * keyKinds / keyColumns, as a reading would answer them):
 *   old — the answering step as it was: no evidence rule, no check;
 *   old again — the same, a second time: what moves with nothing changed (noise);
 *   new — the stricter rule and the misreading check, both on judging questions only.
 * For every question it prints the noise (old against old) beside the changes
 * (old against new), the changes split into those the check made and those
 * the answering step made, each with the place's name and the words quoted,
 * and the calls each run used; and writes the same as JSON and as a .md.
 *
 * The model is called the way the server calls it (api/apps/atlas.js aiCaller):
 * answering on the answering model with thinking off at temperature 0, the
 * check on the reading model with thinking on at 0.2. The calls are counted by
 * this run alone, against --max-calls; they are not charged to anybody's
 * hourly allowance on the running server, which lives in that process. The
 * key comes from the environment, or from api/.env as the server reads it.
 *
 * The deoria-bioregion atlas is never measured. Nothing is written into
 * atlas/datasets or any atlas folder; the saved answers are not touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as E from '../api/lib/atlas/enrich.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'reading-rules.js'));
const ROOTS = [path.join(REPO, 'atlas', 'datasets'), path.join(REPO, 'api', 'data', 'atlas', 'private-datasets')];
const NEVER = 'deoria-bioregion';

function s_helpEnd() {
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  return lines.findIndex((l, k) => k > 4 && l.trim() === '*');
}
const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  .slice(1, s_helpEnd()).map((l) => l.replace(/^ \* ?/, '').replace(/^\/\* ?/, '')).join('\n');

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function die(msg) { console.error(msg); process.exit(1); }

export function parseArgs(argv) {
  const o = { slug: '', layer: '', out: os.tmpdir(), maxCalls: 0, noise: true, file: '', stub: false, stability: false, sample: 0, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--no-noise') o.noise = false;
    else if (a === '--noise') o.noise = true;
    else if (a === '--stub') o.stub = true;
    else if (a === '--stability') o.stability = true;
    else if (a.startsWith('--sample=')) o.sample = Math.max(0, Math.floor(Number(a.slice(9)) || 0));
    else if (a.startsWith('--layer=')) o.layer = a.slice(8);
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a.startsWith('--max-calls=')) o.maxCalls = Math.max(1, Number(a.slice(12)) || 0);
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else if (!a.startsWith('--')) o.slug = a;
    else die('unknown option ' + a + ' — see --help');
  }
  if (o.sample && !o.stability) die('--sample goes with --stability');
  if (!o.maxCalls) o.maxCalls = o.stability ? 80 : 60;
  return o;
}

/* The layer and its places, as a reading would see them: the file's two
   halves read as one when a layer shares its file with another. */
function loadAtlas(slug, layerId) {
  const dir = ROOTS.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json')));
  if (!dir) die('no atlas called ' + slug + ' in ' + ROOTS.join(' or '));
  const base = readJSON(path.join(dir, 'manifest.json')) || {};
  const local = readJSON(path.join(dir, 'manifest.local.json')) || {};
  const layers = [...(base.layers || []), ...(local.layers || [])];
  const rowsOfLayer = (L) => {
    const gj = L && L.source ? readJSON(path.join(dir, L.source)) : null;
    return ((gj && gj.features) || []).map((f) => f.properties || {});
  };
  const withQuestions = layers.filter((L) => L.source && Object.keys(L.keyLabels || {}).length);
  let layer = layerId ? layers.find((L) => L.id === layerId) : null;
  if (layerId && !layer) die('no layer ' + layerId + ' in ' + slug + '; layers with questions: ' + withQuestions.map((L) => L.id).join(', '));
  if (!layer) {
    if (withQuestions.length !== 1) {
      die((withQuestions.length ? 'more than one layer has questions — name one with --layer=: ' + withQuestions.map((L) => L.id).join(', ')
        : 'no layer in ' + slug + ' has settled questions to measure'));
    }
    layer = withQuestions[0];
  }
  const twin = layer.sameFileAs ? layers.find((L) => L.id === layer.sameFileAs && L.source) : null;
  const halves = [layer].concat(twin ? [twin] : []).map((L) => ({ layer: L, rows: rowsOfLayer(L) }));
  const rows = halves.flatMap((h) => h.rows);
  const settled = halves.map((h) => RULES.settledQuestions(h.layer, rows)).find((s) => s.length) || [];
  return { layer, rows, settled };
}

function loadFile(file) {
  const j = readJSON(file);
  if (!j || !Array.isArray(j.features)) die('cannot read places from ' + file + ' (want { layer, features })');
  const layer = j.layer || {};
  const rows = j.features.map((f) => (f && f.properties) || {});
  return { layer, rows, settled: RULES.settledQuestions(layer, rows) };
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
async function realCall(model, prompt, schema, o) {
  if (o && o.think) {
    return post(model, prompt, schema, { maxOutputTokens: 8192, temperature: 0.2, thinkingConfig: { thinkingBudget: 2048 } }, 90000);
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

/* A stand-in, for trying the script without a model: a place gets the first
   kind whose name has a word (four letters or more) on its line, quoting it;
   the check says yes to everything. */
/* The stand-in "careful" model (named "stub") takes the LAST kind that
   matches, and passes over every fifth place, so the stability figures and
   the sample have differences to show. */
async function stubCall(model, prompt, schema) {
  if (schema.properties && schema.properties.checks) return { checks: [] };
  const careful = model === 'stub';
  const qs = [...prompt.matchAll(/^q(\d+) — .*\n((?:   .*\n?)+)/gm)].map((m) => ({
    n: Number(m[1]), kinds: m[2].split('\n').map((l) => l.trim().split(' — ')[0]).filter(Boolean) }));
  const lines = [...prompt.matchAll(/^(\d+)\. ([^\n]*(?:\n    [^\n]*)*)/gm)];
  return { rows: lines.map((m) => {
    const r = { i: Number(m[1]) };
    const text = m[2].toLowerCase();
    for (const q of qs) {
      r['q' + q.n] = 'other'; r['w' + q.n] = [];
      if (careful && r.i % 5 === 0) continue;
      for (const k of (careful ? q.kinds.slice().reverse() : q.kinds)) {
        const w = k.toLowerCase().split(/[^a-z]+/).find((x) => x.length >= 4 && text.includes(x));
        if (w) { r['q' + q.n] = k; r['w' + q.n] = [w]; break; }
      }
    }
    return r;
  }) };
}

/* Every call of the run goes through one counter with a hard ceiling. Each
   step gets its own view of it, so the calls can be told apart. */
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

/* ---------- comparing the runs ---------- */
/* Old against new, per question, with the noise beside it: the old step run
   twice moves some answers with nothing changed, and a change of that size
   between old and new is not evidence of anything. Each change says whether
   the check took the answer away or the answering step gave a different one,
   and whether that place also moved between the two old runs. */
export function compare(questions, names, oldRun, old2Run, newRun) {
  const answered = (a) => Boolean(a && a !== 'other');
  const judged = new Set((newRun.check && newRun.check.judged) || []);
  return questions.map((q, n) => {
    const t = { kept: 0, changed: 0, blanked: 0, moved: 0, added: 0, byCheck: 0, byAnswering: 0, noise: 0, noiseOf: 0 };
    const removed = new Map(((newRun.check && newRun.check.blankedList) || []).filter((b) => b.n === n).map((b) => [b.i, b]));
    const byCheck = [], byAnswering = [];
    for (let i = 0; i < oldRun.answers[n].length; i++) {
      const a = oldRun.answers[n][i], b = newRun.answers[n][i];
      const a2 = old2Run ? old2Run.answers[n][i] : a;
      if (answered(a) || answered(a2)) { t.noiseOf += 1; if (a !== a2) t.noise += 1; }
      if (answered(a) && a === b) { t.kept += 1; continue; }
      if (!answered(a) && !answered(b)) continue;
      const what = answered(a) && !answered(b) ? 'blanked' : !answered(a) ? 'added' : 'moved';
      t[what] += 1; t.changed += 1;
      const c = { place: names[i] || ('place ' + i), what, old: a || '', new: b || '',
        oldWords: oldRun.why[n][i] || [], newWords: newRun.why[n][i] || [], noisy: Boolean(old2Run) && a !== a2 };
      if (removed.has(i)) {
        const r = removed.get(i);
        byCheck.push(Object.assign(c, { firstNew: r.kind, firstNewWords: r.words }));
        t.byCheck += 1;
      } else {
        if (what === 'blanked') c.why = b === 'other' ? 'answered "other"' : 'no words stood';
        byAnswering.push(c);
        t.byAnswering += 1;
      }
    }
    return { question: q.question, judged: judged.has(n), totals: t, byCheck, byAnswering };
  });
}

const wordsOf = (ws) => (ws && ws.length ? ' ("' + ws.join('", "') + '")' : '');
function changeLine(c) {
  return c.place + ' — ' + c.what + ': ' + (c.old || 'no answer') + wordsOf(c.oldWords) + ' → ' +
    (c.new || 'no answer') + wordsOf(c.newWords) +
    (c.firstNew ? ' — the new step answered ' + c.firstNew + wordsOf(c.firstNewWords) + ', the check said misread' : '') +
    (c.why ? ' — ' + c.why : '') + (c.noisy ? ' — also moved between the two old runs' : '');
}

function asMarkdown(rep) {
  const L = [];
  L.push('# Answer check — ' + rep.atlas + (rep.layer ? ' / ' + rep.layer : ''));
  L.push('');
  L.push('Measured ' + rep.when + ' on ' + rep.places + ' places' + (rep.stub ? ' (stand-in model, not a real measurement)' : '') +
    '. Answering on ' + rep.models.answering + ', checking on ' + rep.models.checking + '.');
  L.push('');
  L.push('Calls: old step ' + rep.calls.old + (rep.calls.noise != null ? ', old step again ' + rep.calls.noise : '') +
    ', new step ' + rep.calls.new + ' (answering ' + rep.calls.newAnswering + ' + check ' + rep.calls.check + ').');
  if (rep.check) {
    L.push('Check: ' + rep.check.asked + ' answers put to it, ' + rep.check.blanked + ' taken away, ' +
      rep.check.failed + ' calls failed, ' + rep.check.unchecked + ' left unchecked.');
  }
  if (rep.unread.old || rep.unread.new || rep.unread.noise) {
    L.push('**Unread batches** — old ' + rep.unread.old + ', old again ' + (rep.unread.noise || 0) + ', new ' + rep.unread.new + ': the comparison is incomplete.');
  }
  L.push('');
  L.push('Noise is old against old (the same step run twice); changed is old against new.');
  L.push('');
  L.push('| Question | judged? | noise | changed | by the check | by answering | kept |');
  L.push('|---|---|---|---|---|---|---|');
  for (const q of rep.questions) {
    const t = q.totals;
    L.push('| ' + q.question + ' | ' + (q.judged ? 'yes' : 'no') + ' | ' + (rep.noiseRun ? t.noise + ' of ' + t.noiseOf : '—') +
      ' | ' + t.changed + ' | ' + t.byCheck + ' | ' + t.byAnswering + ' | ' + t.kept + ' |');
  }
  for (const q of rep.questions) {
    L.push('');
    L.push('## ' + q.question + (q.judged ? ' (judged — checked)' : ' (describes — not checked)'));
    L.push('');
    L.push('By the check (' + q.byCheck.length + '):');
    for (const c of q.byCheck) L.push('- ' + changeLine(c));
    L.push('');
    L.push('By answering (' + q.byAnswering.length + '):');
    for (const c of q.byAnswering) L.push('- ' + changeLine(c));
  }
  return L.join('\n') + '\n';
}

/* ---------- stability: how steady are the answers? ---------- */
/* Per question, between two runs: how many places either run answered, and
   on how many of those the two runs gave different answers. */
export function between(a, b, n) {
  const answered = (x) => Boolean(x && x !== 'other');
  let of = 0, differ = 0;
  for (let i = 0; i < a.answers[n].length; i++) {
    const x = a.answers[n][i], y = b.answers[n][i];
    if (answered(x) || answered(y)) { of += 1; if (x !== y) differ += 1; }
  }
  return { of, differ };
}
/* "Answer twice, keep what agrees": an answer the two runs disagree on is
   blanked. How many answers survive, against how many the first run gave. */
export function agreements(a, b, n) {
  const answered = (x) => Boolean(x && x !== 'other');
  let first = 0, kept = 0;
  for (let i = 0; i < a.answers[n].length; i++) {
    if (answered(a.answers[n][i])) first += 1;
    if (answered(a.answers[n][i]) && a.answers[n][i] === b.answers[n][i]) kept += 1;
  }
  return { first, kept };
}

/* ---------- a sample of disagreements, for a person to read ---------- */
/* Columns that name the people who added places. A question drawn from one
   of these, or asked "Who …", is about people, and is never sampled; and the
   names in them are scrubbed from everything else the sample carries. */
const PEOPLE_COLUMN = (c) => /^created_by$/i.test(c) || /_user_id$/i.test(c);
export function peopleQuestions(layer, settled) {
  const out = new Set();
  const labels = (layer && layer.keyLabels) || {}, from = (layer && layer.keyColumns) || {};
  for (const col of Object.keys(labels)) {
    if ((from[col] || []).some(PEOPLE_COLUMN)) out.add(String(labels[col]).trim());
  }
  for (const q of settled || []) if ((q.columns || []).some(PEOPLE_COLUMN)) out.add(String(q.question).trim());
  return out;
}
export const isAboutPeople = (question, people) => people.has(String(question).trim()) || /^\s*who\b/i.test(String(question));

// a small seeded generator, so the same run picks the same sample
function seeded(seed) {
  let t = seed >>> 0;
  return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

/* N place-and-question pairs where the quick run and the careful run gave
   different answers (one giving no answer counts), spread evenly over the
   questions — round the questions in turn, each question's pairs in a seeded
   order — and never a question about people. Each pair carries the place's
   name, its own words and labels, and both answers with their quoted words and
   definitions. Every name found in a people column is scrubbed from all of it. */
export function pickSample({ questions, quick, careful, rows, names, n, people, seed = 1 }) {
  const answered = (x) => Boolean(x && x !== 'other');
  const tagged = new Set();
  for (const r of rows) for (const k of Object.keys(r || {})) {
    if (!PEOPLE_COLUMN(k)) continue;
    for (const v of [].concat(r[k])) { const t = String(v == null ? '' : v).trim(); if (t.length >= 3) tagged.add(t); }
  }
  const byLength = [...tagged].sort((a, b) => b.length - a.length);
  const scrub = (t) => {
    let out = String(t == null ? '' : t);
    for (const name of byLength) out = out.split(name).join('[someone]');
    return out;
  };
  const scrubWords = (ws) => (ws || []).map(scrub).filter((w) => w !== '[someone]');
  const textOf = (v) => v == null ? '' : Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).join('; ') : String(v);
  const pools = [];
  questions.forEach((q, qi) => {
    if (isAboutPeople(q.question, people)) return;
    const pool = [];
    for (let i = 0; i < quick.answers[qi].length; i++) {
      const a = quick.answers[qi][i], b = careful.answers[qi][i];
      if (!answered(a) && !answered(b)) continue;
      if (a === b) continue;
      pool.push(i);
    }
    const rand = seeded(seed + qi * 7919);
    for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
    if (pool.length) pools.push({ qi, pool });
  });
  const items = [];
  const defOf = (q, kind) => ((q.kinds.find((k) => k.name === kind) || {}).definition || '');
  const side = (q, run, qi, i) => {
    const a = run.answers[qi][i];
    return answered(a) ? { answer: a, words: scrubWords(run.why[qi][i]), definition: defOf(q, a) }
      : { answer: a === 'other' ? 'other' : 'no answer', words: [], definition: '' };
  };
  for (let round = 0; items.length < n && pools.some((p) => round < p.pool.length); round++) {
    for (const { qi, pool } of pools) {
      if (items.length >= n) break;
      if (round >= pool.length) continue;
      const i = pool[round], q = questions[qi], r = rows[i] || {};
      const desc = ['description', 'desc', 'notes', 'text', 'comment'].map((k) => textOf(r[k])).find((t) => t.trim()) || '';
      const labels = ['labels', 'categories', 'tags'].filter((k) => textOf(r[k]).trim()).map((k) => ({ column: k, value: scrub(textOf(r[k])) }));
      items.push({
        place: scrub(names[i] || ''), text: scrub(desc).slice(0, 400), labels,
        question: q.question,
        quick: side(q, quick, qi, i), careful: side(q, careful, qi, i),
      });
    }
  }
  return items;
}

/* Four answering runs, each as a reading answers today (the stricter rule on
   judging questions, no check): the quick model twice, the careful (reading)
   model twice. The agreement figure reuses the quick model's two runs. */
async function stability({ o, digest, questions, title, models, names, layer, rows, settled, outDir }) {
  const pot = budget(o.maxCalls, o.stub);
  const runs = {};
  const calls = {};
  for (const [key, model] of [['quick1', models.answering], ['quick2', models.answering], ['careful1', models.checking], ['careful2', models.checking]]) {
    const call = pot.view();
    runs[key] = await E.answerQuestions({ digest, questions, title, callJSON: call, model, strict: true, checkModel: null });
    calls[key] = call.used();
  }
  const rep = {
    atlas: o.slug || o.file, layer: layer.id || '', when: new Date().toISOString(), places: rows.length, stub: o.stub,
    mode: 'stability', models: { quick: models.answering, careful: models.checking }, calls,
    unread: Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.unread])),
    questions: questions.map((q, n) => ({
      question: q.question, judged: E.isJudgementQuestion(q),
      quickNoise: between(runs.quick1, runs.quick2, n),
      carefulNoise: between(runs.careful1, runs.careful2, n),
      carefulVsQuick: between(runs.quick1, runs.careful1, n),
      agreeTwice: agreements(runs.quick1, runs.quick2, n),
    })),
  };
  const L = [];
  L.push('# Answer stability — ' + rep.atlas + (rep.layer ? ' / ' + rep.layer : ''));
  L.push('');
  L.push('Measured ' + rep.when + ' on ' + rep.places + ' places' + (rep.stub ? ' (stand-in model, not a real measurement)' : '') +
    '. Quick model ' + models.answering + ', careful model ' + models.checking + ' (both answering with thinking off, as answering runs).');
  L.push('');
  L.push('Calls: quick ' + calls.quick1 + ' + ' + calls.quick2 + ', careful ' + calls.careful1 + ' + ' + calls.careful2 +
    '; "answer twice, keep what agrees" reuses the two quick runs (it would cost a reading ' + (calls.quick1 + calls.quick2) + ').');
  if (Object.values(rep.unread).some(Boolean)) L.push('**Unread batches** ' + JSON.stringify(rep.unread) + ': the figures are incomplete.');
  L.push('');
  L.push('"x of y" = answers that differ, of places either run answered. Kept = answers left when the two quick runs must agree, of the first run\'s answers.');
  L.push('');
  L.push('| Question | judged? | quick vs quick | careful vs careful | careful vs quick | answer twice, kept |');
  L.push('|---|---|---|---|---|---|');
  const f = (x) => x.differ + ' of ' + x.of;
  for (const q of rep.questions) {
    L.push('| ' + q.question + ' | ' + (q.judged ? 'yes' : 'no') + ' | ' + f(q.quickNoise) + ' | ' + f(q.carefulNoise) +
      ' | ' + f(q.carefulVsQuick) + ' | ' + q.agreeTwice.kept + ' of ' + q.agreeTwice.first + ' |');
  }
  const md = L.join('\n') + '\n';
  console.log(md);
  fs.mkdirSync(outDir, { recursive: true });
  const stem = 'measure-answer-stability-' + String(o.slug || path.basename(o.file, '.json')).replace(/[^\w-]+/g, '_') +
    (layer.id ? '-' + String(layer.id).replace(/[^\w-]+/g, '_') : '') + '-' + rep.when.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, stem + '.json'), JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(outDir, stem + '.md'), md);
  console.log('Reports: ' + path.join(outDir, stem + '.json') + ' and .md');
  if (o.sample > 0) {
    const items = pickSample({ questions, quick: runs.quick1, careful: runs.careful1, rows, names, n: o.sample,
      people: peopleQuestions(layer, settled) });
    const file = path.join(outDir, 'sample-' + String(o.slug || path.basename(o.file, '.json')).replace(/[^\w-]+/g, '_') + '.json');
    fs.writeFileSync(file, JSON.stringify({ atlas: o.slug || path.basename(o.file), layer: layer.id || '', when: rep.when,
      models: rep.models, asked: o.sample, items }, null, 2));
    console.log('Sample: ' + items.length + ' pairs where the two models differ — ' + file);
  }
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.slug && !o.file)) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  const named = o.slug || o.file;
  // any spelling: a case-insensitive disk would otherwise let "Deoria-Bioregion" through
  if (String(named).toLowerCase().includes(NEVER)) die('refused: ' + NEVER + ' is never measured or read (standing rule)');
  const outDir = path.resolve(o.out);
  for (const r of ROOTS) {
    if (outDir === r || outDir.startsWith(r + path.sep)) die('refused: reports are never written into ' + r);
  }

  const { layer, rows, settled } = o.file ? loadFile(o.file) : loadAtlas(o.slug, o.layer);
  if (!rows.length) die('the layer has no places');
  if (!settled.length) die('the layer has no settled questions to measure');
  const fields = RULES.wordColumns(rows);
  if (!fields.length) die('none of the columns hold words to read');
  const digest = E.buildDigest(rows, fields);
  // as enrichRows answers them: a question found in one column is answered from that column
  const questions = E.settledForAnswering(settled, fields);
  for (const q of questions) if (q.columns.length) q.digest = Object.assign(E.buildDigest(rows, q.columns), { lists: digest.lists });
  const nameCol = (layer.popup && layer.popup.title) || [RULES.NAME_FIELD, 'name', 'title'].find((k) => k in (rows[0] || {})) || '';
  const names = rows.map((r) => String((nameCol && r[nameCol]) || ''));
  const title = String(layer.label || o.slug || path.basename(o.file));

  let models = { answering: 'stub-lite', checking: 'stub' };
  if (!o.stub) {
    if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
    if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env (or use --stub)');
    const M = await import('../api/lib/models.js');
    await M.recheckModels();
    models = { answering: M.getFlashLiteModel(), checking: M.getFlashModel() };
  }
  const batches = Math.ceil(digest.withText / 40);
  console.log('Measuring ' + (o.slug || o.file) + (layer.id ? ' / ' + layer.id : '') + ': ' + rows.length + ' places, ' +
    questions.length + ' questions, ' + batches + ' batch' + (batches === 1 ? '' : 'es') + ' a run; at most ' + o.maxCalls + ' calls.');

  if (o.stability) return stability({ o, digest, questions, title, models, names, layer, rows, settled, outDir });

  const pot = budget(o.maxCalls, o.stub);
  const oldCall = pot.view();
  const oldRun = await E.answerQuestions({ digest, questions, title, callJSON: oldCall, model: models.answering,
    strict: false, checkModel: null });
  let old2Run = null, noiseCalls = null;
  if (o.noise) {
    const again = pot.view();
    old2Run = await E.answerQuestions({ digest, questions, title, callJSON: again, model: models.answering,
      strict: false, checkModel: null });
    noiseCalls = again.used();
  }
  const newCall = pot.view();
  let beforeCheck = 0;
  const newRun = await E.answerQuestions({ digest, questions, title, callJSON: newCall, model: models.answering,
    strict: true, checkModel: models.checking,
    checkRoom: () => { beforeCheck = newCall.used(); return pot.left(); } });
  if (!newRun.check) beforeCheck = newCall.used();

  const rep = {
    atlas: o.slug || o.file, layer: layer.id || '', when: new Date().toISOString(), places: rows.length, stub: o.stub, models,
    noiseRun: Boolean(old2Run),
    calls: { old: oldCall.used(), new: newCall.used(), newAnswering: beforeCheck, check: newCall.used() - beforeCheck,
             ...(noiseCalls != null ? { noise: noiseCalls } : {}) },
    unread: { old: oldRun.unread, new: newRun.unread, ...(old2Run ? { noise: old2Run.unread } : {}) },
    check: newRun.check ? { asked: newRun.check.asked, blanked: newRun.check.blanked, failed: newRun.check.failed,
      unchecked: newRun.check.unchecked, calls: newRun.check.calls, judged: newRun.check.judged } : null,
    questions: compare(questions, names, oldRun, old2Run, newRun),
  };

  for (const q of rep.questions) {
    const t = q.totals;
    console.log('\n' + q.question + (q.judged ? ' [judged]' : '') + ' — noise ' + (old2Run ? t.noise + ' of ' + t.noiseOf : '—') +
      '; changed ' + t.changed + ' (by the check ' + t.byCheck + ', by answering ' + t.byAnswering + '); kept ' + t.kept);
    for (const c of q.byCheck) console.log('  check:     ' + changeLine(c));
    for (const c of q.byAnswering) console.log('  answering: ' + changeLine(c));
  }
  const all = rep.questions.reduce((acc, q) => { for (const k of Object.keys(acc)) acc[k] += q.totals[k]; return acc; },
    { kept: 0, changed: 0, blanked: 0, moved: 0, added: 0, byCheck: 0, byAnswering: 0, noise: 0, noiseOf: 0 });
  rep.totals = all;
  console.log('\nIn all: noise ' + (old2Run ? all.noise + ' of ' + all.noiseOf : '—') + '; changed ' + all.changed +
    ' (by the check ' + all.byCheck + ', by answering ' + all.byAnswering + '); kept ' + all.kept + '.');
  console.log('Calls: old ' + rep.calls.old + (noiseCalls != null ? ', old again ' + noiseCalls : '') +
    ', new ' + rep.calls.new + ' (answering ' + rep.calls.newAnswering + ' + check ' + rep.calls.check + ').');
  if (oldRun.unread || newRun.unread || (old2Run && old2Run.unread)) console.log('Unread batches: the comparison is incomplete.');

  fs.mkdirSync(outDir, { recursive: true });
  const stem = 'measure-answer-check-' + String(o.slug || path.basename(o.file, '.json')).replace(/[^\w-]+/g, '_') +
    (layer.id ? '-' + String(layer.id).replace(/[^\w-]+/g, '_') : '') + '-' + rep.when.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(outDir, stem + '.json'), JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(outDir, stem + '.md'), asMarkdown(rep));
  console.log('Reports: ' + path.join(outDir, stem + '.json') + ' and .md');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
