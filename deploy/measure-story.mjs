#!/usr/bin/env node
/* Mock up "What the places say" version 2 on one atlas: the short STORY the
 * proposed pipeline would write — one paragraph about what the map is and what
 * people noticed, then two quotes in the places' own words — what it dropped
 * and why, and a page that looks like the Insight tab it would fill.
 * Reads the places; writes only into the folder you name with --out.
 *
 *   node deploy/measure-story.mjs --dataset=<slug> --out=DIR
 *   node deploy/measure-story.mjs --dir=<folder with manifest.local.json> --out=DIR
 *   node deploy/measure-story.mjs --file=places.json --out=DIR [--stub]
 *   --list          print every atlas on this computer whose places can be read in Insight, and stop
 *   --dataset=SLUG  an atlas under atlas/datasets or api/data/atlas/private-datasets
 *   --dir=PATH      an atlas folder anywhere (a read-only copy, say)
 *   --layer=ID      the layer to read (default: the one the atlas's Insight mode names)
 *   --out=DIR       where the three files go: <name>-story.json, <name>-dropped.txt,
 *                   <name>-mock.html
 *   --name=WORD     what to call this mock in the file names (default: the slug)
 *   --model=NAME    the model for both calls (default: the one the server's summary uses)
 *   --proofread-model=NAME  a different model for the proofread only
 *   --places=N      how many places to offer the model (default 80)
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
 * getFlashModel unless --model says otherwise, thinking kept low, temperature
 * 0, the JSON schema sent with the prompt — api/apps/atlas.js insightCaller,
 * as deploy/measure-summary.mjs already copies it). Two calls an atlas: the
 * write and the proofread, and the model and the seconds of each are written
 * into the json. The calls are this run's own; they are not charged to
 * anybody's hourly allowance on the running server, which lives in that
 * process.
 *
 * ON THE SERVER (where the key is), from the repo root:
 *   node deploy/measure-story.mjs --list
 *   node deploy/measure-story.mjs --dataset=bengaluru-on-loka \
 *        --out=$HOME/places-say-mock --name=bengaluru --model=gemini-flash-latest
 *   node deploy/measure-story.mjs --dataset=<the second atlas from --list> \
 *        --out=$HOME/places-say-mock --name=<that atlas> --model=gemini-flash-latest
 * Then look at $HOME/places-say-mock/<name>-mock.html. The atlas folders are
 * only read; everything written goes under --out and nowhere else.
 *
 * The deoria-bioregion atlas is never read, in any spelling.
 *
 * The story carries places' own words, so the files this writes are NOT safe
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

// a file name of our own making: letters, digits, - and _, nothing that walks a path
export function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function parseArgs(argv) {
  const o = { dataset: '', dir: '', file: '', layer: '', out: '', name: '', model: '', proofreadModel: '', places: 0,
    stub: false, askDir: '', askedBy: '', allQuestions: false, list: false, help: false };
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
    else if (a.startsWith('--proofread-model=')) o.proofreadModel = a.slice(18);
    else if (a.startsWith('--model=')) o.model = a.slice(8);
    else if (a.startsWith('--places=')) o.places = Number(a.slice(9)) || 0;
    else if (a.startsWith('--ask-dir=')) o.askDir = a.slice(10);
    else if (a.startsWith('--asked-by=')) o.askedBy = a.slice(11);
    else die('unknown option ' + a + ' — see --help');
  }
  const named = [o.dataset, o.dir, o.file].filter(Boolean);
  if (named.length > 1) die('name one atlas: --dataset, --dir or --file');
  if (!o.name) o.name = path.basename(o.dataset || o.dir || o.file || 'mock').replace(/\.[a-z]+$/i, '');
  /* The name goes into file names under --out, and the slug is joined to the
     dataset folders: letters, digits, - and _ only, so nothing can be written
     or read outside them (Opus review, 5 Nov 2026). */
  o.name = safeName(o.name);
  if (!o.name) die('--name must have a letter or a digit in it');
  if (o.dataset) {
    const slug = safeName(o.dataset);
    if (slug !== o.dataset) die('--dataset is the folder name of an atlas: letters, digits, - and _ only');
  }
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
  const c = (digest.candidates || []).slice(0, 4);
  const cite = (i) => (c[i] ? [c[i].id] : []);
  return {
    sentences: [
      { text: 'Somebody here is taken with what they walked past, and says so plainly.', quotes: cite(0) },
      { text: 'Another is curious about something here and asks it out loud.', quotes: cite(1) },
      { text: 'Elsewhere the writing turns, as though the place itself were speaking.', quotes: cite(2) },
    ].filter((s) => s.quotes.length),
  };
}
function stubCall(digest, prompt, o) {
  if (o && o.proofread) {
    const parts = String(prompt).split('\n');
    const read = (label) => { try { return JSON.parse(parts[parts.indexOf(label) + 1]); } catch { return []; } };
    return { sentences: read('Sentences and the quotes they cite:').map((s) => ({ index: s.index, shows: true, why: '' })),
      quotes: read('Quotes, in order:').map((q) => ({ index: q.index, namesPerson: false, why: '' })) };
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
  // proposed, not yet in the product: the story and the two quotes under it
  '.in-sum .in-story{margin:.35rem 0 0;font-size:.95rem;line-height:1.55;color:var(--color-text-primary,#24211D)}',
  '.in-quotes{margin:.9rem 0 .2rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.10))}',
  '.in-fq{margin:.75rem 0 0;padding:0 0 0 .7rem;border-left:2px solid var(--color-leaf,#2A6B41);opacity:.95}',
  '.in-fq q{font-family:var(--font-display,Georgia,serif);font-style:italic;font-size:.92rem;line-height:1.45;color:var(--color-text-secondary,#5A5751);quotes:"\\201C" "\\201D"}',
  '.in-fq .in-who{display:block;margin-top:.15rem}',
  '.in-fq .in-who button{background:none;border:none;padding:.15rem 0;margin:0;font:inherit;font-size:var(--t-meta,.8rem);font-weight:700;color:var(--color-leaf-deep,#1F5232);text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left}',
  '.in-warn{margin:.6rem 0 0;font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);background:var(--color-marigold-tint,rgba(233,162,55,.16));border-radius:var(--radius-md,.25rem);padding:.45rem .6rem}',
  '@media (max-width:720px){.in-sum .in-story{font-size:.92rem}.in-fq q{font-size:.88rem}}',
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

function mockHTML({ title, result, byWho }) {
  const r = result;
  const tabs = '<div class="in-tabs" role="tablist">' +
    '<button type="button" class="in-tab" role="tab"><span class="in-tl">Explore Insights</span><span class="in-ts">Insights</span></button>' +
    '<button type="button" class="in-tab on" role="tab" aria-selected="true"><span class="in-tl">What the places say</span><span class="in-ts">Summary</span></button></div>';
  const warn = r.quality && r.quality.warning ? '<p class="in-warn">' + esc(r.quality.warning) + '.</p>' : '';
  const story = r.story || { sentences: [], quotes: [] };
  const quotes = story.quotes.map((q) => '<blockquote class="in-fq"><q>' + esc(q.text) + '</q>' +
    '<span class="in-who"><button type="button">' + (q.name ? 'See “' + esc(q.name) + '” on the map' : 'Show this place on the map') + '</button></span></blockquote>').join('');
  const body = story.sentences.length
    ? '<section class="in-sum" aria-label="What the places say">' +
      '<p class="in-story">' + story.sentences.map((s) => esc(s.text)).join(' ') + '</p>' +
      warn + '<div class="in-quotes">' + quotes + '</div>' +
      '<div class="in-by">Written by AI from what people wrote about these places, when the atlas was last updated. The quotes under it are the evidence; the counts are in the questions.</div></section>' +
      '<button type="button" class="in-tolink">See the questions these places answer</button>'
    : '<p class="in-hint">Nothing would be shown: ' + esc(r.by) + '.</p>';
  return ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>' + esc(title) + ' — what the places say (mock-up)</title>',
    '<style>' + PAGE_CSS + '\n' + IM.CSS + '\n' + MOCK_CSS + '</style></head><body>',
    '<div class="mock-note"><b>Mock-up, ' + esc(new Date().toISOString().slice(0, 10)) + '.</b> ' + esc(title) +
      '. Not live anywhere: this is what the proposed “What the places say” would show. The story and the choice of quotes are by <b>' + esc(byWho) +
      '</b>; every rule and every quote checked by the product’s own code.</div>',
    '<div class="mock-wrap"><div class="atlas-panel"><div class="panel-head in-tabbed">' + tabs + '</div>',
    '<div class="in-panel">' + body + '</div></div></div></body></html>'].join('\n');
}

function droppedText(name, r) {
  const d = r.digest;
  const lines = ['What the mock-up dropped — ' + name, ''];
  lines.push('Result: ' + r.by);
  lines.push('Calls: ' + (r.calls || []).map((c) => c.what + ' on ' + c.model + ', ' + c.seconds + 's' + (c.failed ? ' (' + c.failed + ')' : '')).join('; '));
  lines.push('Places: ' + d.places + '; questions read: ' + d.questions.map((q) => q.id).join(', '));
  lines.push('Places with words of their own: ' + d.quality.withWords + ' of ' + d.quality.places +
    '; places repeating another’s words: ' + d.quality.repeated + (d.quality.thin ? ' — thin, so the warning shows' : ''));
  lines.push('Places offered to the model: ' + d.offered.length + '; quotes worth citing: ' + (d.candidates || []).length);
  lines.push('');
  if (!(r.dropped || []).length) lines.push('Nothing was dropped.');
  (r.dropped || []).forEach((x) => {
    lines.push('- [' + x.what + '] ' + String(x.text || '').slice(0, 220));
    lines.push('    why: ' + x.why);
  });
  lines.push('');
  lines.push('Places whose words could not be used at all (a sample):');
  (d.unquotable || []).slice(0, 12).forEach((u) => lines.push('- ' + u.id + ': ' + u.why));
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

  let model = o.model || 'stub', byWho = 'the stand-in (no model)';
  let call = null;
  const digestOnly = IM.storyDigest(layer, features, { shownCols: shownCols || null, cap: o.places || 0 });
  if (o.stub) {
    call = async (m, prompt, schema, x) => stubCall(digestOnly, prompt, x);
  } else if (o.askDir) {
    call = askDirCall(o.askDir, o.name);
    model = o.model || o.askedBy || 'a model outside this script';
    byWho = o.askedBy || model;
  } else {
    if (!process.env.GEMINI_API_KEY) { try { process.loadEnvFile(path.join(REPO, 'api', '.env')); } catch { /* none */ } }
    if (!process.env.GEMINI_API_KEY) die('no GEMINI_API_KEY in the environment or in api/.env — use --ask-dir=DIR (another model answers) or --stub');
    if (!o.model) {
      const M = await import('../api/lib/models.js');
      await M.recheckModels();
      model = M.getFlashModel();
    }
    byWho = model + (o.proofreadModel ? ' (proofread on ' + o.proofreadModel + ')' : '');
    call = realCall;
  }

  /* --model sets both calls; --proofread-model moves the second one alone.
     Both are printed and written into the json, so a run is never in doubt. */
  const proofWith = o.proofreadModel || model;
  console.log('Mocking ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + features.length + ' places, ' +
    digestOnly.questions.length + ' questions, ' + digestOnly.offered.length + ' places with words of their own, ' +
    digestOnly.candidates.length + ' quotes worth citing.');
  console.log('  Models: write on ' + model + '; proofread on ' + proofWith + (o.proofreadModel ? '' : ' (the same, no --proofread-model)') + '.');

  let r;
  try {
    r = await SUM.writeStory({ layer, features, call, model, proofreadModel: o.proofreadModel || '', Type, shownCols, cap: o.places || 0 });
  } catch (e) {
    if (e instanceof Waiting) { console.log('\nStopped: ' + e.message + '\nWrite the answer there, then run this again.'); process.exit(2); }
    throw e;
  }
  if (waiting.at) {
    console.log('\nStopped: the answer to this call is not there yet.\n  prompt: ' + waiting.at.replace('-answer.json', '-prompt.txt') +
      '\n  write the answer to: ' + waiting.at + '\nThen run this again.');
    process.exit(2);
  }

  fs.mkdirSync(o.out, { recursive: true });
  const base = path.join(o.out, o.name);
  fs.writeFileSync(base + '-story.json', JSON.stringify({ atlas: o.name, layer: layer.id || '', model, at: new Date().toISOString(),
    proofreadModel: proofWith, by: r.by, sig: r.sig, calls: r.calls, story: r.story, quality: r.quality, dropped: r.dropped, digest: r.digest }, null, 1));
  fs.writeFileSync(base + '-dropped.txt', droppedText(o.name, r));
  fs.writeFileSync(base + '-mock.html', mockHTML({ title: o.name, result: r, byWho }));

  const secs = (r.calls || []).reduce((s, c) => s + c.seconds, 0).toFixed(1);
  console.log('  ' + r.by + ' in ' + secs + 's; sentences ' + ((r.story && r.story.sentences.length) || 0) +
    ', quotes ' + ((r.story && r.story.quotes.length) || 0) + ', dropped ' + (r.dropped || []).length +
    ', places with no quotable words ' + (r.digest.unquotable || []).length);
  ((r.story && r.story.sentences) || []).forEach((s) => console.log('   ~ ' + s.text));
  ((r.story && r.story.quotes) || []).forEach((q) => console.log('       “' + q.text + '”  (' + (q.name || q.id) + ')'));
  console.log('  Written: ' + base + '-story.json, ' + base + '-dropped.txt, ' + base + '-mock.html');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
