#!/usr/bin/env node
/* Mock up "What the places say" version 2 on one atlas: the summary and the
 * findings the proposed pipeline would write, what it dropped and why, and a
 * page that looks like the Insight tab it would fill.
 * Reads the places; writes only into the folder you name with --out.
 *
 *   node deploy/measure-findings.mjs --dataset=<slug> --out=DIR
 *   node deploy/measure-findings.mjs --dir=<folder with manifest.local.json> --out=DIR
 *   node deploy/measure-findings.mjs --file=places.json --out=DIR [--stub]
 *   --list          print every atlas on this computer whose places can be read in Insight, and stop
 *   --dataset=SLUG  an atlas under atlas/datasets or api/data/atlas/private-datasets
 *   --dir=PATH      an atlas folder anywhere (a read-only copy, say)
 *   --layer=ID      the layer to read (default: the one the atlas's Insight mode names)
 *   --out=DIR       where the three files go: <name>-findings.json, <name>-dropped.txt,
 *                   <name>-mock.html
 *   --name=WORD     what to call this mock in the file names (default: the slug)
 *   --all-questions read every question, not only the ones the owner leaves on
 *   --stub          no model: the stand-in writes a plain answer, so the plumbing
 *                   can be checked without a key
 *   --ask-dir=DIR   no key here: each call is written out as a prompt file and the
 *                   run stops until the answer file beside it exists. The model that
 *                   answers is named in the mock, so nobody mistakes it for the
 *                   server's own.
 *   --asked-by=NAME what wrote those answers (with --ask-dir), for the mock's footer
 *
 * The model is called exactly as the server calls the summary (the same key
 * and the same reading model: GEMINI_API_KEY from the environment or from
 * api/.env as the server reads it, the model from api/lib/models.js
 * getFlashModel, thinking kept low, temperature 0, the JSON schema sent with
 * the prompt — api/apps/atlas.js insightCaller, as deploy/measure-summary.mjs
 * already copies it). Two calls an atlas: the write and the proofread. The
 * calls are this run's own; they are not charged to anybody's hourly
 * allowance on the running server, which lives in that process.
 *
 * ON THE SERVER (where the key is), from the repo root:
 *   node deploy/measure-findings.mjs --list
 *   node deploy/measure-findings.mjs --dataset=bengaluru-on-loka \
 *        --out=$HOME/places-say-mock --name=bengaluru
 *   node deploy/measure-findings.mjs --dataset=<the second atlas from --list> \
 *        --out=$HOME/places-say-mock --name=<that atlas>
 * Then look at $HOME/places-say-mock/<name>-mock.html. The atlas folders are
 * only read; everything written goes under --out and nowhere else.
 *
 * The deoria-bioregion atlas is never read, in any spelling.
 *
 * The findings carry places' own words, so the files this writes are NOT safe
 * to paste anywhere public without reading them first. Nothing is written
 * into atlas/ or api/data.
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
const Type = { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', NUMBER: 'NUMBER' };

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function die(msg) { console.error(msg); process.exit(1); }
export function refused(named) { return String(named || '').toLowerCase().includes(NEVER); }

export function parseArgs(argv) {
  const o = { dataset: '', dir: '', file: '', layer: '', out: '', name: '', stub: false, askDir: '', askedBy: '', allQuestions: false, list: false, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--list') o.list = true;
    else if (a === '--stub') o.stub = true;
    else if (a === '--all-questions') o.allQuestions = true;
    else if (a.startsWith('--dataset=')) o.dataset = a.slice(10);
    else if (a.startsWith('--dir=')) o.dir = a.slice(6);
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else if (a.startsWith('--layer=')) o.layer = a.slice(8);
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a.startsWith('--name=')) o.name = a.slice(7);
    else if (a.startsWith('--ask-dir=')) o.askDir = a.slice(10);
    else if (a.startsWith('--asked-by=')) o.askedBy = a.slice(11);
    else die('unknown option ' + a + ' — see --help');
  }
  const named = [o.dataset, o.dir, o.file].filter(Boolean);
  if (named.length > 1) die('name one atlas: --dataset, --dir or --file');
  if (!o.name) o.name = path.basename(o.dataset || o.dir || o.file || 'mock').replace(/\.[a-z]+$/i, '');
  return o;
}

/* The layer and its places as the server finds them for Insight, and which
   questions the owner leaves on. */
function loadDir(dir, layerId, all) {
  if (!fs.existsSync(path.join(dir, 'manifest.local.json'))) die('no manifest.local.json in ' + dir);
  const local = readJSON(path.join(dir, 'manifest.local.json')) || {};
  const want = layerId || (local.mode && local.mode.layer) || '';
  const layers = (local.layers || []).filter((L) => L && (L.group || 'userdata') === 'userdata' && L.source &&
    !String(L.source).includes('..') && L.keyLabels && typeof L.keyLabels === 'object');
  layers.sort((a, b) => (b.id === want) - (a.id === want));
  for (const L of layers) {
    if (layerId && L.id !== layerId) continue;
    const gj = readJSON(path.join(dir, L.source));
    const features = (gj && gj.features) || [];
    if (!features.length || !IM.canInsight(L, features)) continue;
    const settings = IM.settingsOf(L, local.mode);
    const shownCols = all ? null : settings.order.filter((c) => settings.shown[c]);
    return { layer: L, features, shownCols, mode: local.mode || null };
  }
  die('no layer in ' + dir + ' can be shown in Insight');
}
function loadSlug(slug, layerId, all) {
  const dir = ROOTS.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json')));
  if (!dir) die('no atlas called ' + slug + ' in ' + ROOTS.join(' or '));
  return loadDir(dir, layerId, all);
}
function loadFile(file) {
  const j = readJSON(file);
  if (!j || !Array.isArray(j.features)) die('cannot read places from ' + file + ' (want { layer, features })');
  return { layer: j.layer || {}, features: j.features, shownCols: null, mode: null };
}

/* ---------- calling the model ---------- */
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
  return JSON.parse(((cand.content && cand.content.parts) || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''));
}
const QUIET = [{ thinkingBudget: 0 }, { thinkingLevel: 'low' }, null];
const quietOf = new Map();
async function realCall(model, prompt, schema) {
  const tries = quietOf.has(model) ? [quietOf.get(model)] : QUIET;
  let last = null;
  for (const quiet of tries) {
    try {
      const out = await post(model, prompt, schema, Object.assign({ maxOutputTokens: 24000, temperature: 0 }, quiet ? { thinkingConfig: quiet } : {}), 120000);
      quietOf.set(model, quiet);
      return out;
    } catch (e) { last = e; if (e.status !== 400) throw e; }
  }
  throw last;
}
/* The stand-in: a plain answer built from the digest, so every check can be
   walked through with no model at all. Not a mock-up anybody should read. */
function stubAnswer(digest) {
  const cells = (digest.quotes || []).filter((q) => q.shape === 'single').slice(0, 4);
  return {
    summary: [{ text: 'The ' + digest.places + ' places on this map answer a few questions about themselves.' },
      { text: 'Most of them say something about where they are and what they are for.' }],
    findings: cells.map((c) => ({ text: 'Of the ' + c.of + ' places that answer this, ' + c.count + ' say ' + c.answers[0] + '.',
      questions: c.questions, answers: c.answers, count: c.count, of: c.of, quotes: c.quotes.slice(0, 1).map((q) => ({ id: q.id, text: q.text })) })),
  };
}
function stubCall(digest, prompt, o) {
  if (o && o.proofread) {
    let list = [];
    try { list = JSON.parse(String(prompt).split('\n').pop()); } catch { list = []; }
    return { checks: list.map((f) => ({ index: f.index, ok: true, namesPerson: false, why: '' })) };
  }
  return stubAnswer(digest);
}

/* A model somewhere else answers: each call is written out as a prompt, and
   the run stops until the answer file is there. */
class Waiting extends Error {}
const waiting = { at: '' };
function askDirCall(dir, name) {
  let n = 0;
  return async (model, prompt, schema, o) => {
    n += 1;
    const tag = name + '-call' + n + (o && o.proofread ? '-proofread' : '-write');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, tag + '-prompt.txt'), prompt);
    fs.writeFileSync(path.join(dir, tag + '-schema.json'), JSON.stringify(schema, null, 1));
    const answerAt = path.join(dir, tag + '-answer.json');
    const got = readJSON(answerAt);
    if (!got) { waiting.at = answerAt; throw new Waiting('waiting for ' + answerAt); }
    return got;
  };
}

/* ---------- the mock page ---------- */
const MOCK_CSS = [
  // proposed, not yet in the product: the findings under the summary
  '.in-sum .in-s{margin:.3rem 0 0}',
  '.in-finds{margin:.85rem 0 .2rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.10))}',
  '.in-find{padding:.7rem 0 .55rem;border-bottom:1px solid var(--color-divider,rgba(36,33,29,.10))}',
  '.in-find:last-child{border-bottom:none;padding-bottom:.2rem}',
  '.in-find .in-fs{margin:0;font-size:.95rem;line-height:1.45;color:var(--color-text-primary,#24211D)}',
  '.in-fq{margin:.5rem 0 0;padding:0 0 0 .7rem;border-left:2px solid var(--color-leaf,#2A6B41);opacity:.95}',
  '.in-fq q{font-family:var(--font-display,Georgia,serif);font-style:italic;font-size:.92rem;line-height:1.45;color:var(--color-text-secondary,#5A5751);quotes:"\\201C" "\\201D"}',
  '.in-fq .in-who{display:block;margin-top:.15rem}',
  '.in-fq .in-who button{background:none;border:none;padding:.15rem 0;margin:0;font:inherit;font-size:var(--t-meta,.8rem);font-weight:700;color:var(--color-leaf-deep,#1F5232);text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left}',
  '.in-warn{margin:.6rem 0 0;font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);background:var(--color-marigold-tint,rgba(233,162,55,.16));border-radius:var(--radius-md,.25rem);padding:.45rem .6rem}',
  '@media (max-width:720px){.in-find .in-fs{font-size:.92rem}.in-fq q{font-size:.88rem}}',
  // the page has no script, so the short tab label the viewer swaps in on a phone is done here in CSS
  '@media (max-width:480px){.in-tabs .in-tab .in-tl{display:none}.in-tabs .in-tab .in-ts{display:inline}}',
].join('\n');

const PAGE_CSS = [
  '*,*::before,*::after{box-sizing:border-box}',
  'html{overflow-x:hidden}',
  'body{margin:0;background:#EFEBE2;font-family:var(--font-body,system-ui,-apple-system,"Segoe UI",sans-serif);color:#24211D}',
  '.mock-note{max-width:900px;margin:0 auto;padding:1rem 1rem .2rem;font-size:.8rem;line-height:1.5;color:#5A5751}',
  '.mock-note b{color:#24211D}',
  '.mock-wrap{display:flex;gap:1.2rem;justify-content:center;align-items:flex-start;padding:1rem;flex-wrap:wrap}',
  '.atlas-panel{flex:0 1 420px;max-width:420px;width:100%;min-width:0;background:#FDFCF8;border:1px solid rgba(36,33,29,.18);border-radius:.375rem;box-shadow:0 2px 14px rgba(36,33,29,.10);overflow:hidden}',
  '.panel-head{display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem .35rem;border-bottom:1px solid rgba(36,33,29,.10)}',
  '.atlas-panel>.in-panel{padding:.8rem .9rem 1rem}',
  '@media (max-width:720px){.mock-wrap{padding:0}.atlas-panel{max-width:none;border-radius:0;border-left:none;border-right:none}}',
].join('\n');

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function mockHTML({ title, result, byWho, nameOf }) {
  const r = result;
  const tabs = '<div class="in-tabs" role="tablist">' +
    '<button type="button" class="in-tab" role="tab"><span class="in-tl">Explore Insights</span><span class="in-ts">Insights</span></button>' +
    '<button type="button" class="in-tab on" role="tab" aria-selected="true"><span class="in-tl">What the places say</span><span class="in-ts">Summary</span></button></div>';
  const warn = r.quality && r.quality.warning ? '<p class="in-warn">' + esc(r.quality.warning) + '.</p>' : '';
  const findings = (r.findings || []).map((f) => {
    const quotes = (f.quotes || []).map((q) => '<blockquote class="in-fq"><q>' + esc(q.text) + '</q>' +
      '<span class="in-who"><button type="button">' + (q.place ? 'See “' + esc(q.place) + '” on the map' : 'Show this place on the map') + '</button></span></blockquote>').join('');
    // no count line: the sentence already says K of N (Mithun, 5 Nov 2026)
    return '<div class="in-find"><p class="in-fs">' + IM.sentenceHTML(f.text) + '</p>' + quotes + '</div>';
  }).join('');
  const body = r.findings && r.findings.length
    ? '<section class="in-sum" aria-label="What the places say">' +
      (r.summary || []).map((s) => '<p class="in-s">' + IM.sentenceHTML(s.text) + '</p>').join('') +
      warn + '<div class="in-finds">' + findings + '</div>' +
      '<div class="in-by">Written by AI from the answers to the questions and the places’ own words, when the atlas was last updated. Numbers count places, not people.</div></section>' +
      '<button type="button" class="in-tolink">See the questions these numbers come from</button>'
    : '<p class="in-hint">Nothing would be shown: ' + esc(r.by) + '.</p>';
  return ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + esc(title) + ' — what the places say (mock-up)</title>',
    '<style>' + PAGE_CSS + '\n' + IM.CSS + '\n' + MOCK_CSS + '</style></head><body>',
    '<div class="mock-note"><b>Mock-up, ' + esc(new Date().toISOString().slice(0, 10)) + '.</b> ' + esc(title) +
      '. Not live anywhere: this is what the proposed “What the places say” would show. Sentences and quote choices by <b>' + esc(byWho) +
      '</b>; every number and every quote checked by the product’s own code.</div>',
    '<div class="mock-wrap"><div class="atlas-panel"><div class="panel-head in-tabbed">' + tabs + '</div>',
    '<div class="in-panel">' + body + '</div></div></div></body></html>'].join('\n');
}

function droppedText(name, r) {
  const lines = ['What the mock-up dropped — ' + name, ''];
  lines.push('Result: ' + r.by + (r.proofread ? '; proofread: ' + (r.proofread === 'not run' ? 'not run' : r.proofread || 'ran') : ''));
  lines.push('Places: ' + r.digest.places + '; questions read: ' + r.digest.questions.map((q) => q.id).join(', '));
  lines.push('Places with words of their own: ' + r.digest.quality.withWords + ' of ' + r.digest.quality.places +
    '; places repeating another’s words: ' + r.digest.quality.repeated + (r.digest.quality.thin ? ' — thin, so the warning shows' : ''));
  lines.push('Cells the code offered quotes for: ' + r.digest.quotes.length + '; quotes offered: ' +
    r.digest.quotes.reduce((s, q) => s + q.quotes.length, 0));
  lines.push('');
  if (!(r.dropped || []).length) lines.push('Nothing was dropped.');
  (r.dropped || []).forEach((d) => {
    lines.push('- [' + d.what + '] ' + String(d.text || '').slice(0, 220) + (d.finding ? '  (from: ' + String(d.finding).slice(0, 90) + ')' : ''));
    lines.push('    why: ' + d.why);
  });
  lines.push('');
  lines.push('Places whose words could not be quoted at all (a sample):');
  (r.unquotable || []).slice(0, 12).forEach((u) => lines.push('- ' + u.id + ': ' + u.why));
  return lines.join('\n') + '\n';
}

/* Every atlas on this computer whose places can be read in Insight, so the
   command to mock one up can be written without guessing a slug. */
function listAtlases() {
  const rows = [];
  ROOTS.forEach((root) => {
    let names = [];
    try { names = fs.readdirSync(root); } catch { return; }
    names.sort().forEach((slug) => {
      if (refused(slug)) return;
      const dir = path.join(root, slug);
      if (!fs.existsSync(path.join(dir, 'manifest.local.json'))) return;
      const local = readJSON(path.join(dir, 'manifest.local.json')) || {};
      (local.layers || []).forEach((L) => {
        if (!L || !L.source || String(L.source).includes('..') || !L.keyLabels || typeof L.keyLabels !== 'object') return;
        const gj = readJSON(path.join(dir, L.source));
        const features = (gj && gj.features) || [];
        if (!features.length || !IM.canInsight(L, features)) return;
        const settings = IM.settingsOf(L, local.mode);
        rows.push({ slug, layer: L.id, places: features.length,
          questions: settings.order.filter((c) => settings.shown[c]).length,
          mode: (local.mode && local.mode.name) || 'standard', where: root });
      });
    });
  });
  if (!rows.length) { console.log('No atlas here has questions its places answer.'); return; }
  console.log('Atlases that can be mocked up (' + rows.length + '):');
  rows.forEach((r) => console.log('  --dataset=' + r.slug + ' --layer=' + r.layer + '   ' + r.places + ' places, ' +
    r.questions + ' question(s) on show, mode ' + r.mode));
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.list) { listAtlases(); return; }
  if (o.help || (!o.dataset && !o.dir && !o.file)) {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(src.slice(1, src.findIndex((l, k) => k > 4 && l.trim() === '*/')).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(o.help ? 0 : 1);
  }
  const named = o.dataset || o.dir || o.file;
  if (refused(named) || refused(o.name)) die('refused: ' + NEVER + ' is never read (standing rule)');
  if (!o.out) die('say where the files go with --out=DIR');

  const src = o.file ? loadFile(o.file) : o.dir ? loadDir(o.dir, o.layer, o.allQuestions) : loadSlug(o.dataset, o.layer, o.allQuestions);
  const { layer, features, shownCols } = src;

  let model = 'stub', byWho = 'the stand-in (no model)';
  let call = null;
  const digestOnly = IM.summaryDigest(layer, features, shownCols ? { shownCols } : null);
  if (o.stub) {
    call = async (m, prompt, schema, x) => stubCall(digestOnly, prompt, x);
  } else if (o.askDir) {
    call = askDirCall(o.askDir, o.name);
    model = o.askedBy || 'a model outside this script';
    byWho = model;
  } else {
    if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
    if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env — use --ask-dir=DIR (another model answers) or --stub');
    const M = await import('../api/lib/models.js');
    await M.recheckModels();
    model = M.getFlashModel();
    byWho = model;
    call = realCall;
  }

  console.log('Mocking ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + features.length + ' places, ' +
    digestOnly.questions.length + ' questions, ' + digestOnly.quotes.length + ' cells with quotes, on ' + model + '.');

  const started = Date.now();
  let r;
  try {
    r = await SUM.writeFindings({ layer, features, call, model, Type, shownCols });
  } catch (e) {
    if (e instanceof Waiting) { console.log('\nStopped: ' + e.message + '\nWrite the answer there, then run this again.'); process.exit(2); }
    throw e;
  }
  if (waiting.at) {
    console.log('\nStopped: the answer to this call is not there yet.\n  prompt: ' + waiting.at.replace('-answer.json', '-prompt.txt') +
      '\n  write the answer to: ' + waiting.at + '\nThen run this again.');
    process.exit(2);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  // the place behind each quote, for the "open this place" link the plan asks about
  const byId = new Map();
  features.forEach((f, i) => byId.set(IM.placeIdOf(f, i), f));
  /* The name the link would carry. Some atlases title their places by a
     field that is not a name (blr-finds-test titles them by their
     categories), so a title with a list separator in it, or one that only
     repeats the place's categories, is left out and the link says "this
     place". A name is never shown when the place's people columns say it. */
  (r.findings || []).forEach((f) => (f.quotes || []).forEach((q) => {
    const f0 = byId.get(q.id), p = (f0 && f0.properties) || {};
    let nm = IM.placeNameOf(layer, f0) || '';
    if (nm && (/[;|]/.test(nm) || IM.foldName(nm) === IM.foldName(p.categories || '') || IM.foldName(nm) === IM.foldName(p._category || ''))) nm = '';
    if (nm && IM.peopleValuesOf(layer, p).some((v) => IM.hasWhole(IM.foldName(nm), IM.foldName(v)))) nm = '';
    q.place = nm;
  }));
  // the places whose words could not be used at all, as a reason list
  const unquotable = [];
  features.forEach((f, i) => {
    const q = IM.quoteOf(layer, f, (digestOnly.questions[0] || {}).id || '');
    if (!q.text) unquotable.push({ id: IM.placeIdOf(f, i), why: q.why });
  });
  r.unquotable = unquotable;

  fs.mkdirSync(o.out, { recursive: true });
  const base = path.join(o.out, o.name);
  fs.writeFileSync(base + '-findings.json', JSON.stringify({ atlas: o.name, layer: layer.id || '', model, at: new Date().toISOString(),
    seconds: Number(seconds), by: r.by, sig: r.sig, summary: r.summary, findings: r.findings, quality: r.digest.quality,
    dropped: r.dropped, digest: r.digest }, null, 1));
  fs.writeFileSync(base + '-dropped.txt', droppedText(o.name, r));
  fs.writeFileSync(base + '-mock.html', mockHTML({ title: o.name, result: r, byWho }));

  console.log('  ' + r.by + ' in ' + seconds + 's; summary ' + (r.summary || []).length + ' sentence(s), findings ' +
    (r.findings || []).length + ', dropped ' + (r.dropped || []).length + ', places with no quotable words ' + unquotable.length);
  (r.summary || []).forEach((s) => console.log('   ~ ' + s.text));
  (r.findings || []).forEach((f) => {
    console.log('   - ' + f.text);
    (f.quotes || []).forEach((q) => console.log('       “' + q.text + '”  (' + (q.place || q.id) + ')'));
  });
  console.log('  Written: ' + base + '-findings.json, ' + base + '-dropped.txt, ' + base + '-mock.html');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
