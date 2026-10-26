#!/usr/bin/env node
/* A scorecard for the question finding on one atlas layer: read it afresh, file it and sum it up,
 * several times each, and say how each of Mithun's seven goals (25 Oct 2026) came out against
 * its pass mark. Reads the atlas only; writes its report into a folder of its own.
 *
 *   node deploy/scorecard.mjs --dataset=<slug> --layer=<id> [--out=DIR] [--max-calls=N]
 *   node deploy/scorecard.mjs --file=places.json --stub [--out=DIR]
 *   --dataset=SLUG     the atlas to measure (its own folder under atlas/datasets or the private ones)
 *   --layer=ID         the layer whose places are read (needed when the atlas has more than one)
 *   --finder-runs=N    fresh readings of the same places, nothing settled (default 10, 2 to 20)
 *   --filing-runs=N    times the places are filed into the questions of the most typical
 *                      reading (default 5, 0 to 10; 0 skips goal 6)
 *   --summary-runs=N   summaries written over that reading's answers (default 5, 0 to 10)
 *   --max-calls=N      a hard ceiling on model calls for the whole scorecard (default: room
 *                      for every run at the server's own caps; see "calls" below)
 *   --out=DIR          where the report goes (default: a new folder under the system's
 *                      temporary folder). Never inside this repository, so never in atlas/
 *                      or api/data.
 *   --file=PATH        read places from a file instead of an atlas: { layer: {id, popup}, features }
 *   --stub             no model at all: the stand-ins of deploy/measure-questions.mjs and of
 *                      the summary, so the whole scorecard runs with nothing on the network
 *
 * The seven goals, and their pass marks (an atlas of under 60 places is
 * small, and takes the looser mark where one is given):
 *   1 About the place: no question kept, in any run, asks about the record or the
 *     people who made it (its column says who made it, or its words do).
 *   2 Steady: across the readings, the number of questions moves by at most 1 and,
 *     on 100 places or more, is never under 3; and at least 80% of the things the
 *     most typical reading asks about come back in 7 of every 10 readings.
 *   3 Distinct: in every reading, no two questions split the places that answer
 *     both the same way (a shared-information score under 0.5; over 0.7 is flagged).
 *   4 Covering: each question answers at least 70% of the places (60% when small).
 *   5 Balanced: no answer takes more than 65% of a question's answers, and "none
 *     of these" is at most 15% of the places it was read for.
 *   6 Reliable filing: filed again and again, at least 85% of the places get the
 *     same answer every time, and the agreement between any two filings (Cohen's
 *     kappa) averages 0.8 or more.
 *   7 Useful summary: every summary written has no unfinished sentence, every
 *     number in it passed the exact check, and the proofread ran. Whether it tells
 *     anything new is Mithun's to judge: the summaries are in the report to rate.
 *
 * Calls. A reading may spend the server's own 24 calls plus 4 for the answer
 * check, twice (its one retry); a filing one call per 40 places plus 4 for
 * the check; a summary 4. The default ceiling is all of that; a real run
 * spends far less, and prints what it used.
 *
 * What it writes, into --out only: scorecard.json (every number), scorecard.md
 * (a table a reader with no technical words can follow, each run's questions,
 * and the summaries to rate), person-check-places.json (30 places chosen at
 * random with a fixed seed, with only the columns the questions read and never who made them, and
 * the two questions most places answer, for a later labelling page) and
 * person-check-ai-answers.json (the model's answers for those places, kept
 * apart so a person labelling never sees them). Nothing is written into the
 * atlas, its questions, answers, manifest or summary, or anywhere in this
 * repository. The deoria-bioregion atlas is never measured, in any spelling.
 *
 * Built on api/lib/atlas/enrich.js enrichRows and answerQuestions and
 * api/lib/atlas/insight-summary.js writeSummary, called as
 * deploy/measure-questions.mjs and deploy/measure-summary.mjs call them; no
 * server code (api/apps/) is loaded.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as E from '../api/lib/atlas/enrich.js';
import * as SUM from '../api/lib/atlas/insight-summary.js';
import { REPO, RULES, ROOTS, NEVER, CALLS_PER_ATTEMPT, CHECK_CALLS, helpOf, die, refused, loadAtlas, loadFile,
  loadModels, budget, freshReading, resetStand } from './lib-measure.mjs';

const LABELS = createRequire(import.meta.url)(path.join(REPO, 'atlas', 'label-rules.js'));
const HELP = helpOf(import.meta.url);
// the schema's types, as @google/genai names them (the REST API takes the same words)
const Type = { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', BOOLEAN: 'BOOLEAN', INTEGER: 'INTEGER', NUMBER: 'NUMBER' };
const BATCH = 40;                 // places per answering call (enrich.js CLASSIFY_BATCH)

/* The pass marks, as agreed. */
export const MARKS = {
  small: 60,                      // under this many places, an atlas is small
  bigEnough: 100,                 // from this many, a reading must keep at least 3 questions
  minQuestions: 3,
  countRange: 1,
  recurIn: 0.7,                   // an item "comes back" when it is in 7 of 10 readings
  recurShare: 0.8,
  nmiPass: 0.5,
  nmiFlag: 0.7,
  nmiPlaces: 5,                   // fewer places answering both say nothing (Insight's own compare floor)
  cover: 0.7,
  coverSmall: 0.6,
  biggest: 0.65,
  none: 0.15,
  same: 0.85,
  kappa: 0.8,
};
const PERSON_PLACES = 30;
const PERSON_SEED = 20261025;
const ITEMS = ['', 'what sort of thing it is', 'what it is used for', 'who or what uses it',
  'what it is made of or looks like', 'what state it is in', 'when', 'how big or how many', 'something else'];

export function parseArgs(argv) {
  const o = { dataset: '', layer: '', file: '', stub: false, help: false, out: '', maxCalls: 0,
    finderRuns: 10, filingRuns: 5, summaryRuns: 5 };
  const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(Number(v) || 0)));
  for (const a of argv) {
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--stub') o.stub = true;
    else if (a.startsWith('--dataset=')) o.dataset = a.slice(10);
    else if (a.startsWith('--layer=')) o.layer = a.slice(8);
    else if (a.startsWith('--file=')) o.file = a.slice(7);
    else if (a.startsWith('--out=')) o.out = a.slice(6);
    else if (a.startsWith('--finder-runs=')) o.finderRuns = int(a.slice(14), 2, 20);
    else if (a.startsWith('--filing-runs=')) o.filingRuns = int(a.slice(14), 0, 10);
    else if (a.startsWith('--summary-runs=')) o.summaryRuns = int(a.slice(15), 0, 10);
    else if (a.startsWith('--max-calls=')) o.maxCalls = Math.max(1, Math.floor(Number(a.slice(12)) || 0));
    else die('unknown option ' + a + ' — see --help');
  }
  if (o.dataset && o.file) die('either --dataset or --file, not both');
  return o;
}

// room for every run at the server's own caps (see "Calls" above)
export function callCeiling({ places, finderRuns, filingRuns, summaryRuns }) {
  return finderRuns * 2 * (CALLS_PER_ATTEMPT + CHECK_CALLS) +
    filingRuns * (Math.ceil(places / BATCH) + CHECK_CALLS) + summaryRuns * 4;
}

/* ---------- where the report may go ---------- */
// the real place a path names, even when its last folders do not exist yet
function realOf(p) {
  let at = path.resolve(p), rest = [];
  while (!fs.existsSync(at)) { rest.unshift(path.basename(at)); const up = path.dirname(at); if (up === at) break; at = up; }
  // .native asks the system, which gives the folder's own spelling: "LOKAAPPS" on a Mac is the repo
  try { at = fs.realpathSync.native(at); } catch { /* as it is */ }
  return path.join(at, ...rest);
}
// a Mac's and Windows' disks do not tell capitals apart, so neither does this test there
const FOLD = process.platform === 'darwin' || process.platform === 'win32';
const inside = (child, parent) => {
  const r = FOLD ? path.relative(parent.toLowerCase(), child.toLowerCase()) : path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
/* The report's folder: never this repository, and never an atlas's folder or
   the server's data, wherever they really live (a link is followed). Answers
   the folder, or '' with the reason in why. */
export function outFolder(asked, named) {
  const dir = asked ? realOf(asked)
    : path.join(realOf(os.tmpdir()), 'loka-scorecard', String(named || 'atlas').replace(/[^a-z0-9-]+/gi, '-').slice(-40) + '-' + Date.now());
  const guarded = [REPO, ...ROOTS, path.join(REPO, 'api', 'data')].map(realOf);
  if (guarded.some((g) => inside(dir, g))) return { dir: '', why: 'the report never goes inside this repository (' + REPO + '), where the atlases and the server\'s data live' };
  return { dir, why: '' };
}

/* ---------- the measures, each on its own so a check can hold it to a hand-made case ---------- */
const answered = (a) => Boolean(a) && a !== 'other';

/* How much two questions say the same of the places that answer both: the
   information they share over the most either could hold (normalised mutual
   information, the square-root form). 0 is nothing in common, 1 the same
   sorting under other names. Places with no answer, or "none of these", to
   either question are left out. */
export function nmi(a, b) {
  const pairs = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (answered(a[i]) && answered(b[i])) pairs.push([a[i], b[i]]);
  const n = pairs.length;
  if (!n) return { nmi: 0, places: 0 };
  const count = (list) => { const m = new Map(); list.forEach((k) => m.set(k, (m.get(k) || 0) + 1)); return m; };
  const px = count(pairs.map((p) => p[0])), py = count(pairs.map((p) => p[1])), pxy = count(pairs.map((p) => p[0] + '\u0000' + p[1]));
  const H = (m) => [...m.values()].reduce((h, c) => h - (c / n) * Math.log(c / n), 0);
  const hx = H(px), hy = H(py);
  if (hx <= 0 || hy <= 0) return { nmi: 0, places: n };
  let mi = 0;
  for (const [k, c] of pxy) {
    const [x, y] = k.split('\u0000');
    mi += (c / n) * Math.log((c / n) / ((px.get(x) / n) * (py.get(y) / n)));
  }
  return { nmi: Math.max(0, Math.min(1, mi / Math.sqrt(hx * hy))), places: n };
}

/* Agreement between two filings of the same places, beyond what chance alone
   would give (Cohen's kappa): 1 is the same answer everywhere, 0 no better
   than chance. Every answer counts as itself, "no answer" included. */
export function kappa(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let same = 0;
  const ca = new Map(), cb = new Map();
  for (let i = 0; i < n; i++) {
    const x = a[i] || '', y = b[i] || '';
    if (x === y) same += 1;
    ca.set(x, (ca.get(x) || 0) + 1); cb.set(y, (cb.get(y) || 0) + 1);
  }
  const po = same / n;
  let pe = 0;
  for (const [k, c] of ca) pe += (c / n) * ((cb.get(k) || 0) / n);
  if (pe >= 1) return po >= 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

/* One question over several filings: the share of places given the same
   answer every time, and the mean kappa over every two filings. filings is a
   list of answer lists (one per filing), over the same places. */
export function filingAgreement(filings) {
  const n = filings.length ? filings[0].length : 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (filings.every((f) => (f[i] || '') === (filings[0][i] || ''))) same += 1;
  const ks = [];
  for (let x = 0; x < filings.length; x++) for (let y = x + 1; y < filings.length; y++) ks.push(kappa(filings[x], filings[y]));
  return { places: n, same, sameShare: n ? same / n : 1, kappa: ks.length ? ks.reduce((s, k) => s + k, 0) / ks.length : 1, pairs: ks.length };
}

/* What a question is about, for telling readings apart: the checklist item
   it names (1 to 7), or for "something else" and for none, its own words. */
export function itemOf(q) {
  const a = Number(q && q.about) || 0;
  return a >= 1 && a <= 7 ? 'item ' + a : 'asks: ' + String((q && q.question) || '').trim().toLowerCase();
}
export function itemName(key) {
  const m = /^item (\d)$/.exec(key);
  return m ? ITEMS[Number(m[1])] : '“' + key.slice(6) + '”';
}

/* The most typical reading: the one whose set of things asked about comes up
   most often; on a tie, the one whose things come back most, then the first.
   runs: a list of item lists, null for a run that could not be measured. */
export function pickModal(runs) {
  const keyOf = (items) => JSON.stringify([...new Set(items)].sort());
  const seenIn = new Map();
  runs.forEach((items) => { if (items) for (const k of new Set(items)) seenIn.set(k, (seenIn.get(k) || 0) + 1); });
  const sets = new Map();
  runs.forEach((items) => { if (items) sets.set(keyOf(items), (sets.get(keyOf(items)) || 0) + 1); });
  let best = -1, bestScore = null;
  runs.forEach((items, k) => {
    if (!items || !items.length) return;
    const uniq = [...new Set(items)];
    const score = [sets.get(keyOf(items)), uniq.reduce((s, x) => s + seenIn.get(x), 0) / uniq.length];
    if (!bestScore || score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) { best = k; bestScore = score; }
  });
  return best;
}

/* Of the things the most typical reading asks about, the share that come
   back in at least 70% of the readings measured. */
export function recurrence(runs, modal) {
  const measured = runs.filter(Boolean);
  const need = Math.ceil(MARKS.recurIn * measured.length - 1e-9);
  const mine = modal >= 0 && runs[modal] ? [...new Set(runs[modal])] : [];
  const items = mine.map((k) => ({ item: k, runs: measured.filter((r) => r.includes(k)).length }));
  const back = items.filter((x) => x.runs >= need).length;
  return { need, of: measured.length, items, share: mine.length ? back / mine.length : 0 };
}

/* How far a question reaches, and how its answers spread: the share of all
   places it answers, the share of its answers the commonest takes, and the
   share of the places it was read for that got "none of these". */
export function spreadOf(q, places) {
  const answeredN = q.answered || 0, other = q.other || 0;
  const biggest = (q.counts || []).reduce((m, c) => Math.max(m, c.count), 0);
  return { cover: places ? answeredN / places : 0, biggest: answeredN ? biggest / answeredN : 0,
    none: (answeredN + other) ? other / (answeredN + other) : 0 };
}

/* A question about the record or the people who made it, not the place:
   read from a column that says who made the record (the viewer's own rule,
   label-rules.js isPeopleQuestion), or worded about who wrote, added or
   created it, or about the record itself (enrich.js tells the finder never
   to ask either). */
const RECORD_WORDS = /\bwho (?:wrote|added|created|posted|submitted|tagged|uploaded|contributed|recorded|entered)\b|\b(?:written|added|posted|submitted|tagged|uploaded|contributed|entered) by\b|\bin whose (?:voice|words)\b|\b(?:this|the) (?:record|entry|submission|post)\b|\b(?:contributor|submitter|uploader)s?\b/i;
export function aboutTheRecord(q) {
  const layer = { keyColumns: { q: (q && q.columns) || [] } };
  return Boolean(LABELS.isPeopleQuestion(layer, 'q') || RECORD_WORDS.test(String((q && q.question) || '')));
}

// the viewer's own rule alone: its answers are the names of people
export function answersArePeople(q) {
  return Boolean(LABELS.isPeopleQuestion({ keyColumns: { q: (q && q.columns) || [] } }, 'q'));
}

// a sentence that stops part way: no full stop at its end, or a last word that needs another after it
const DANGLING = /\b(?:and|or|but|of|the|a|an|to|with|while|than|which|that|by|for|in|on|at|from|as|whose|their|its)$/i;
// (a sentence may end on an answer's own name, "… say from.", and that is finished)
export function unfinished(text, names = []) {
  const t = String(text || '').trim().replace(/["'”’)\]]+$/, '');
  if (!/[.!?…]$/.test(t)) return true;
  const body = t.replace(/[.!?…]+$/, '').trim().replace(/["'”’]+$/, '').toLowerCase();
  if (names.some((n) => n && body.endsWith(String(n).toLowerCase()))) return false;
  return DANGLING.test(body);
}

// the same "random" every time: a small seeded generator (mulberry32)
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function sample(list, k, seed) {
  const pick = list.slice(), rnd = seeded(seed);
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  return pick.slice(0, Math.min(k, pick.length));
}

/* Columns that say who made a record, or hold their name or address. The
   person check copies only the columns its questions read (and LOKA's own
   short name), and drops any of these even then. Wider than the viewer's
   rule on purpose: when unsure, leave it out. */
const PEOPLE_COLUMN = /(^|[_\s-])by$|_by_user_id$|_user_id$|(^|[_\s-])(created|updated|modified|edited|added|submitted|uploaded|posted|reported|recorded|collected)[_\s-]?by($|[_\s-])|(^|[_\s-])(user|users|username|user_name|author|authors|contributor|contributors|creator|collector|collectors|owner|email|e-mail|reporter|uploader|submitter|photographer|credit|credits|phone|mobile)($|[_\s-])/i;
export function isPeopleColumn(col) { return PEOPLE_COLUMN.test(String(col || '')); }
// the person check's columns: those the questions read, and loka_name, never a people column
export function personColumns(questions, rows) {
  const read = [...new Set((questions || []).flatMap((q) => (q && q.columns) || []))];
  const name = (rows || []).some((r) => r && r[RULES.NAME_FIELD]) ? [RULES.NAME_FIELD] : [];
  return [...name, ...read.filter((c) => c !== RULES.NAME_FIELD)].filter((c) => !isPeopleColumn(c));
}
// what a cell says, a list joined as the browser joins one
const cellText = (v) => (v == null ? '' : Array.isArray(v) ? v.filter((x) => x != null && String(x).trim()).join('; ') : String(v));
/* A credit line is dropped wherever it sits: one that says "credit", or
   starts "Photo", "Pic", "Image", "Courtesy" or "©". A name inside running
   text cannot be told from any other word, so it stays (the file says so). */
const CREDIT_LINE = /credit|^\s*(?:photo|pic|image|courtesy|©)/i;
export function withoutCredit(text) {
  return String(text).split(/\r?\n/).filter((l) => !CREDIT_LINE.test(l)).join(' ').replace(/\s+/g, ' ').trim();
}

/* ---------- the summary's stand-in (as deploy/measure-summary.mjs, without its forced drop) ---------- */
async function summaryStand(model, prompt, schema, o) {
  if (o && o.proofread) return SUM.standInProofread(prompt);
  let t = null;
  try { t = JSON.parse(String(prompt).split('\n').pop()); } catch { t = null; }
  return SUM.standInAnswer(t);
}

const pct = (x) => Math.round(x * 100) + '%';
const two = (x) => (Math.round(x * 100) / 100).toFixed(2);

/* ---------- the goals, judged ---------- */
// each: { n, goal, measured, mark, result: PASS | FAIL | NOT MEASURED, sentence }
function judge({ places, small, runs, modal, recur, nmiRuns, filing, summaries }) {
  const done = runs.filter((r) => r.measured);
  const out = [];
  const row = (n, goal, measured, mark, result, sentence) => out.push({ n, goal, measured, mark, result, sentence });

  // 1
  if (!done.length) row(1, 'About the place, not the record', '—', 'none', 'NOT MEASURED', 'No reading could be finished, so there were no questions to look at.');
  else {
    const bad = done.flatMap((r) => r.questions.filter((q) => q.aboutRecord).map((q) => q.question));
    const total = done.reduce((s, r) => s + r.questions.length, 0);
    if (!total) row(1, 'About the place, not the record', '0 questions', 'none', 'NOT MEASURED', 'No reading kept a question, so there was nothing to look at.');
    else row(1, 'About the place, not the record', bad.length + ' of ' + total + ' questions', 'none', bad.length ? 'FAIL' : 'PASS',
      bad.length ? bad.length + ' question' + (bad.length === 1 ? ' asks' : 's ask') + ' about the record or who made it, not the place: ' + [...new Set(bad)].map((q) => '“' + q + '”').join(', ') + '.'
        : 'Every question kept, in all ' + done.length + ' readings, asks about the places themselves.');
  }
  // 2
  if (done.length < 2) row(2, 'Steady from one reading to the next', '—', 'moves by at most 1; 80% come back', 'NOT MEASURED', 'Fewer than two readings could be finished, so there is nothing to compare.');
  else {
    const counts = done.map((r) => r.questions.length);
    const lo = Math.min(...counts), hi = Math.max(...counts);
    const countOk = hi - lo <= MARKS.countRange && (places < MARKS.bigEnough || lo >= MARKS.minQuestions);
    const recurOk = recur.share >= MARKS.recurShare;
    row(2, 'Steady from one reading to the next',
      lo + ' to ' + hi + ' questions; ' + pct(recur.share) + ' come back',
      'moves by at most 1' + (places >= MARKS.bigEnough ? ', never under 3' : '') + '; at least 80% come back in ' + recur.need + ' of ' + recur.of,
      countOk && recurOk ? 'PASS' : 'FAIL',
      'Asked ' + done.length + ' times afresh, the places gave between ' + lo + ' and ' + hi + ' questions, and ' +
        recur.items.filter((x) => x.runs >= recur.need).length + ' of the ' + recur.items.length + ' things the most typical reading asks about came back in at least ' + recur.need + ' readings.');
  }
  // 3
  if (!done.length) row(3, 'Each question tells something different', '—', 'under 0.50', 'NOT MEASURED', 'No reading could be finished.');
  else {
    const all = nmiRuns.flat().filter((p) => p.places >= MARKS.nmiPlaces);
    const worst = all.reduce((m, p) => (!m || p.nmi > m.nmi ? p : m), null) || { nmi: 0, a: '', b: '', places: 0 };
    const flagged = all.filter((p) => p.nmi > MARKS.nmiFlag).length;
    if (!all.length) row(3, 'Each question tells something different', 'no two to compare', 'under 0.50', 'NOT MEASURED',
      'No reading kept two questions that ' + MARKS.nmiPlaces + ' places or more both answer, so none could repeat another.');
    else row(3, 'Each question tells something different', 'highest overlap ' + two(worst.nmi) + (flagged ? ' (' + flagged + ' pair' + (flagged === 1 ? '' : 's') + ' over 0.70)' : ''),
      'under 0.50', worst.nmi < MARKS.nmiPass ? 'PASS' : 'FAIL',
      'The two questions that overlap most, “' + worst.a + '” and “' + worst.b + '”, split the ' + worst.places + ' places answering both with an overlap of ' + two(worst.nmi) + ' (0 is none, 1 is the same question in other words).');
  }
  // 4 and 5, on the most typical reading
  const typical = modal >= 0 ? runs[modal] : null;
  const coverMark = small ? MARKS.coverSmall : MARKS.cover;
  if (!typical) {
    row(4, 'Answers most of the places', '—', 'at least ' + pct(coverMark), 'NOT MEASURED', 'No reading could be finished.');
    row(5, 'Answers spread out', '—', 'top answer at most 65%; "none of these" at most 15%', 'NOT MEASURED', 'No reading could be finished.');
  } else {
    const low = typical.questions.filter((q) => q.spread.cover < coverMark);
    const lowest = typical.questions.reduce((m, q) => Math.min(m, q.spread.cover), 1);
    row(4, 'Answers most of the places', 'lowest ' + pct(lowest) + '; ' + low.length + ' of ' + typical.questions.length + ' under the mark',
      'at least ' + pct(coverMark) + ' each' + (small ? ' (small atlas)' : ''), low.length ? 'FAIL' : 'PASS',
      low.length ? low.map((q) => '“' + q.question + '” answers ' + pct(q.spread.cover) + ' of the places').join('; ') + '.'
        : 'Every question in the most typical reading answers at least ' + pct(coverMark) + ' of the ' + places + ' places.');
    const lop = typical.questions.filter((q) => q.spread.biggest > MARKS.biggest);
    const vague = typical.questions.filter((q) => q.spread.none > MARKS.none);
    const topMax = typical.questions.reduce((m, q) => Math.max(m, q.spread.biggest), 0);
    const noneMax = typical.questions.reduce((m, q) => Math.max(m, q.spread.none), 0);
    row(5, 'Answers spread out', 'top answer up to ' + pct(topMax) + '; "none of these" up to ' + pct(noneMax),
      'top answer at most 65%; "none of these" at most 15%', lop.length || vague.length ? 'FAIL' : 'PASS',
      lop.length || vague.length
        ? lop.map((q) => '“' + q.question + '”: one answer takes ' + pct(q.spread.biggest) + ' of its answers').concat(
          vague.map((q) => '“' + q.question + '”: ' + pct(q.spread.none) + ' of the places it was read for got "none of these"')).join('; ') + '.'
        : 'In every question, no answer takes more than 65% of the answers, and "none of these" stays at 15% or under.');
  }
  // 6
  if (!filing || filing.runs < 2) {
    row(6, 'Same answers when asked again', '—', 'at least 85% the same; agreement 0.80', 'NOT MEASURED',
      (filing && filing.why) || 'The places could not be filed twice or more.');
  } else {
    const weak = filing.questions.filter((q) => q.sameShare < MARKS.same || q.kappa < MARKS.kappa);
    const lowSame = filing.questions.reduce((m, q) => Math.min(m, q.sameShare), 1);
    const lowK = filing.questions.reduce((m, q) => Math.min(m, q.kappa), 1);
    row(6, 'Same answers when asked again', 'lowest ' + pct(lowSame) + ' the same; lowest agreement ' + two(lowK),
      'at least 85% the same; agreement 0.80', weak.length ? 'FAIL' : 'PASS',
      'Filed ' + filing.runs + ' times, ' + (weak.length
        ? weak.map((q) => '“' + q.question + '” gave ' + pct(q.sameShare) + ' of the places the same answer every time (agreement ' + two(q.kappa) + ')').join('; ') + '.'
        : 'every question gave at least ' + pct(lowSame) + ' of the places the same answer every time.'));
  }
  // 7
  const wrote = (summaries || []).filter((s) => s.measured);
  if (!wrote.length) row(7, 'A useful summary', '—', 'no unfinished sentence; every number checked; proofread ran', 'NOT MEASURED',
    (summaries || []).some((s) => /^not started/.test(s.by || '') || s.ceilingHit) ? 'The calls ran out before a summary could be written and proofread.'
      : (summaries && summaries.why) || 'No summary could be written.');
  else {
    const missing = wrote.filter((s) => !s.sentences.length).length;
    const names = typical ? typical.questions.flatMap((q) => q.counts.map((c) => c.name)) : [];
    const loose = wrote.reduce((n, s) => n + s.sentences.filter((t) => unfinished(t, names)).length, 0);
    const unread = wrote.filter((s) => s.proofreadSkipped).length;
    const ok = !missing && !loose && !unread;
    row(7, 'A useful summary', wrote.length + ' written; ' + loose + ' unfinished; ' + missing + ' with nothing to show; proofread missed ' + unread,
      'no unfinished sentence; every number checked; proofread ran', ok ? 'PASS' : 'FAIL',
      'Of ' + wrote.length + ' summaries, ' + (wrote.length - missing) + ' had sentences to show; every number in them passed the exact check (a sentence that fails it is never shown)' +
        (loose ? ', but ' + loose + ' sentence' + (loose === 1 ? '' : 's') + ' stop part way' : '') +
        (unread ? ', and the proofread could not be had ' + unread + ' time' + (unread === 1 ? '' : 's') : '') +
        '. Whether they tell you something new is yours to rate, below.');
  }
  return out;
}

/* ---------- the Markdown, for a reader with no technical words ---------- */
function markdown(card) {
  const L = [];
  L.push('# Question-finding scorecard: ' + card.atlas + (card.layer ? ' / ' + card.layer : ''));
  L.push('');
  L.push(card.places + ' places' + (card.small ? ' (a small atlas: under 60 places, so the looser mark for covering applies)' : '') +
    '. Measured on ' + card.when + ' with ' + card.model + '; ' + card.calls.used + ' model calls of at most ' + card.calls.ceiling + '.');
  L.push('');
  L.push('| # | Goal | Measured | Pass mark | Result |');
  L.push('|---|---|---|---|---|');
  for (const g of card.goals) L.push('| ' + g.n + ' | ' + g.goal + ' | ' + g.measured + ' | ' + g.mark + ' | **' + g.result + '** |');
  L.push('');
  for (const g of card.goals) L.push(g.n + '. **' + g.goal + '.** ' + g.sentence);
  L.push('');
  L.push('## Each reading\'s questions');
  L.push('');
  card.runs.forEach((r) => {
    L.push('**Reading ' + r.run + '**' + (r.run === card.typicalReading ? ' (the most typical; goals 4 to 7 use it)' : '') + ': ' +
      (r.measured ? r.questions.length + ' question' + (r.questions.length === 1 ? '' : 's') : 'could not be finished (' + r.verdict + ')') + ', ' + r.calls + ' calls');
    for (const q of (r.questions || [])) {
      L.push('- “' + q.question + '” (' + itemName(q.item) + ') — answers ' + pct(q.spread.cover) + ' of places; ' +
        (q.peopleAnswers ? '(answers are people — not shown)' : q.counts.map((c) => c.name + ' ' + c.count).join(', ') + (q.other ? '; none of these ' + q.other : '')));
    }
    L.push('');
  });
  if (card.summaries.length) {
    L.push('## The summaries, for you to rate');
    L.push('');
    L.push('For each: does it tell you something new about these places? Write yes, a little, or no.');
    L.push('');
    card.summaries.forEach((s, k) => {
      L.push('**Summary ' + (k + 1) + '**' + (s.measured ? '' : ' (could not be written)'));
      for (const t of s.sentences) L.push('- ' + t);
      if (s.measured && !s.sentences.length) L.push('- (nothing to show: too few sentences passed the checks)');
      L.push('');
      L.push('Your rating: ____');
      L.push('');
    });
  }
  L.push('## For the person check');
  L.push('');
  L.push(card.personCheck.places + ' places, chosen at random (always the same ones for this atlas), are in person-check-places.json with the two questions most places answer. The model\'s answers for them are kept apart, in person-check-ai-answers.json, so nobody labelling sees them first.');
  L.push('');
  return L.join('\n');
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.help || (!o.dataset && !o.file)) { console.log(HELP); process.exit(o.help ? 0 : 1); }
  const named = o.dataset || o.file;
  if (refused(named) || refused(o.layer) || refused(o.out)) die('refused: ' + NEVER + ' is never measured or read (standing rule)');
  const where = outFolder(o.out, o.dataset || path.basename(o.file, path.extname(o.file)));
  if (!where.dir) die('refused: ' + where.why);

  const { layer, rows, title, keptSet } = o.file ? loadFile(o.file) : loadAtlas(o.dataset, o.layer);
  if (!rows.length) die('the layer has no places');
  if (keptSet.length) die('this atlas has a set of categories its owner kept; a reading files places into that set and finds no questions, so there is nothing to measure');
  const fields = RULES.wordColumns(rows);
  if (!fields.length) die('none of the columns hold words to read');
  const nameCol = (layer.popup && layer.popup.title) || 'name';
  const places = rows.length, small = places < MARKS.small;
  const ceiling = o.maxCalls || callCeiling({ places, finderRuns: o.finderRuns, filingRuns: o.filingRuns, summaryRuns: o.summaryRuns });

  const models = await loadModels(o.stub);
  console.log('Scorecard for ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + places + ' places, ' + fields.length +
    ' columns with words; ' + o.finderRuns + ' readings, ' + o.filingRuns + ' filings, ' + o.summaryRuns + ' summaries on ' +
    models.flash + '; at most ' + ceiling + ' calls. Report: ' + where.dir);
  const pot = budget(ceiling, o.stub);

  /* Goals 1 to 5: fresh readings, nothing settled. The answers stay in this
     process; only questions and counts are reported. */
  const runs = [];
  for (let k = 1; k <= o.finderRuns; k++) {
    if (pot.left() <= 0) { runs.push({ run: k, measured: false, verdict: 'not started: the calls were used', calls: 0, questions: [] }); continue; }
    const before = pot.spent();
    resetStand();
    const { out } = await freshReading({ rows, fields, title, nameCol, pot, models });
    const measured = !['unavailable', 'unread'].includes(out.verdict);
    const asked = out.asked || [];
    const qs = out.verdict === 'questions' ? (out.questions || []) : [];
    runs.push({ run: k, measured, verdict: out.verdict, calls: pot.spent() - before,
      questions: qs.map((q) => ({
        question: q.question, about: q.about || 0, item: itemOf(q), column: q.column || '', columns: q.columns || [],
        // a question read from who made the record: its answers are people, never printed
        peopleAnswers: answersArePeople(q),
        counts: answersArePeople(q) ? [] : q.counts.map((c) => ({ name: c.name, count: c.count })), answered: q.answered, other: q.other,
        spread: spreadOf(q, places), aboutRecord: aboutTheRecord(q),
      })),
      // kept for the measures below; never written out
      _raw: qs, _asked: asked });
    console.log('  reading ' + k + ': ' + out.verdict + ', ' + qs.length + ' questions, ' + (pot.spent() - before) + ' calls');
  }
  const itemRuns = runs.map((r) => (r.measured ? r.questions.map((q) => q.item) : null));
  const modal = pickModal(itemRuns);
  const recur = recurrence(itemRuns, modal);
  // goal 3: every two questions of every reading
  const nmiRuns = runs.map((r) => {
    if (!r.measured) return [];
    const list = [];
    for (let x = 0; x < r._raw.length; x++) for (let y = x + 1; y < r._raw.length; y++) {
      const m = nmi(r._raw[x].categories, r._raw[y].categories);
      list.push({ a: r._raw[x].question, b: r._raw[y].question, nmi: m.nmi, places: m.places });
    }
    return list;
  });

  /* Goal 6: the most typical reading's questions, filed again and again by
     the answering step alone (answerQuestions with the careful model and its
     check), as a later reading answers settled questions. Only the places
     with words are counted: a place with none is never asked. */
  const typical = modal >= 0 ? runs[modal] : null;
  const digest = E.buildDigest(rows, fields);
  const withWords = digest.entries.map((e, i) => (e.text ? i : -1)).filter((i) => i >= 0);
  let filing = { runs: 0, why: 'There was no reading to take questions from.', questions: [] };
  let filed = [];
  if (typical && o.filingRuns) {
    const fileQs = typical._raw.map((q) => {
      const kinds = ((typical._asked.find((a) => a.question === q.question) || {}).kinds || q.counts)
        .map((k) => ({ name: k.name, definition: k.definition || '' }));
      const one = { question: q.question, noun: q.noun || '', kinds, column: q.column || '', columns: q.columns || [] };
      // a question asked of its own column is answered from that column, as the reading did
      if (one.columns.length) one.digest = Object.assign(E.buildDigest(rows, one.columns), { lists: digest.lists });
      return one;
    });
    let tried = 0;
    for (let f = 1; f <= o.filingRuns && pot.left() > 0; f++) {
      tried += 1;
      const call = pot.caller(Math.ceil(places / BATCH) + CHECK_CALLS);
      const got = await E.answerQuestions({ digest, questions: fileQs, title, callJSON: call, model: models.flash,
        checkModel: models.flash, checkRoom: () => call.cap - call.spent() });
      console.log('  filing ' + f + ': ' + (got.unread ? got.unread + ' of ' + got.batches + ' batches unread, not counted' : 'every place read') + ', ' + call.spent() + ' calls');
      if (!got.unread) filed.push(got.answers);
    }
    filing = { runs: filed.length, tried, why: filed.length < 2 ? 'The places were filed ' + filed.length + ' time' + (filed.length === 1 ? '' : 's') + ' in full; two or more are needed.' : '',
      questions: fileQs.map((q, n) => Object.assign({ question: q.question },
        filingAgreement(filed.map((a) => withWords.map((i) => a[n][i] || ''))))) };
  }

  /* Goal 7: the summary over the most typical reading's answers, forced and
     with none before it, as "Write it again"; held in memory, never saved. */
  const summaries = [];
  if (typical && o.summaryRuns) {
    const shaped = RULES.shapeReading(rows, typical._raw);
    const sLayer = { id: layer.id || 'places', keyLabels: shaped.keyLabels, keyKinds: shaped.keyKinds, keyColumns: shaped.keyColumns, keyNouns: shaped.keyNouns };
    const features = shaped.rows.map((p) => ({ type: 'Feature', geometry: null, properties: p }));
    for (let s = 1; s <= o.summaryRuns; s++) {
      if (pot.left() <= 0) { summaries.push({ measured: false, sentences: [], by: 'not started: the calls were used' }); continue; }
      const call = pot.caller(4, summaryStand);
      const r = await SUM.writeSummary({ layer: sLayer, features, prev: null, call, model: models.flash, Type, force: true });
      // a proofread or re-write the ceiling stopped is not a fault of the summary: not measured
      const ceilingHit = /has used its/.test(String(((r.proofread || {}).skipped) || '') + ' ' + String(((r.rewrite || {}).skipped) || ''));
      const measured = (r.by === 'model' || r.by === 'nothing usable') && !ceilingHit;
      summaries.push({ measured, by: r.by, calls: call.spent(),
        sentences: r.summary ? r.summary.sentences.map((x) => x.text) : [],
        cellDropped: (r.cellDropped || []).map((d) => ({ text: d.text, why: d.why })),
        proofreadDropped: ((r.proofread || {}).dropped || []).map((d) => ({ text: d.text, why: d.why })),
        proofreadSkipped: (r.proofread || {}).skipped || '', ceilingHit,
        rewrite: r.rewrite || null });
      console.log('  summary ' + s + ': ' + r.by + ', ' + call.spent() + ' calls');
    }
  }
  if (typical && !summaries.length) summaries.why = 'No summary was asked for.';

  /* The person check: 30 places at random (the same 30 every time), their own
     words but never who made them, and the two questions most places answer
     (never a people question). The model's answers go in a file of their own. */
  const pickable = typical ? typical._raw.filter((q) => !aboutTheRecord(q)).slice().sort((a, b) => b.answered - a.answered).slice(0, 2) : [];
  const textCols = personColumns(pickable, rows);
  const chosen = sample(withWords, PERSON_PLACES, PERSON_SEED);
  const pid = (k) => 'p' + String(k + 1).padStart(2, '0');
  const personPlaces = {
    note: 'For the atlas owner only; descriptions are as published (a name written inside a description is not removed).',
    atlas: named, layer: layer.id || '', seed: PERSON_SEED,
    questions: pickable.map((q, n) => ({ id: 'q' + (n + 1), question: q.question,
      kinds: q.counts.map((c) => ({ name: c.name, definition: c.definition || '' })), alsoAllowed: ['none of these'] })),
    places: chosen.map((i, k) => {
      const words = {};
      for (const c of textCols) { const t = withoutCredit(cellText(rows[i][c])); if (t) words[c] = t.slice(0, 800); }
      return { id: pid(k), words };
    }),
  };
  const qIndex = pickable.map((q) => typical._raw.indexOf(q));
  const word = (a) => (a === 'other' ? 'none of these' : a || 'no answer');
  const modalOf = (list) => { const m = new Map(); list.forEach((a) => m.set(a, (m.get(a) || 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1])[0][0]; };
  const personAI = {
    atlas: named, layer: layer.id || '', seed: PERSON_SEED,
    how: 'reading: the answer the most typical reading gave; filed: the commonest answer over the ' + filed.length + ' filings (empty when there were none)',
    answers: chosen.map((i, k) => ({ id: pid(k), answers: Object.fromEntries(pickable.map((q, n) => ['q' + (n + 1), {
      reading: word(q.categories[i]), filed: filed.length ? word(modalOf(filed.map((a) => a[qIndex[n]][i] || ''))) : '' }])) })),
  };

  const goals = judge({ places, small, runs, modal, recur, nmiRuns, filing, summaries });
  const card = {
    atlas: named, layer: layer.id || '', places, small, when: new Date().toISOString().slice(0, 10),
    model: models.flash, stub: o.stub, marks: MARKS,
    calls: { used: pot.spent(), ceiling },
    goals, typicalReading: typical ? typical.run : null, recurrence: recur,
    runs: runs.map(({ _raw, _asked, ...r }) => r),
    overlap: nmiRuns.map((list, k) => ({ run: k + 1, pairs: list.map((p) => ({ a: p.a, b: p.b, nmi: Math.round(p.nmi * 1000) / 1000, places: p.places })) })),
    filing, summaries: summaries.map((s) => s),
    personCheck: { places: personPlaces.places.length, questions: personPlaces.questions.length },
  };

  /* The only writing this tool does, and only into the report's folder. */
  fs.mkdirSync(where.dir, { recursive: true });
  const put = (name, text) => fs.writeFileSync(path.join(where.dir, name), text);
  put('scorecard.json', JSON.stringify(card, null, 2) + '\n');
  put('scorecard.md', markdown(card));
  put('person-check-places.json', JSON.stringify(personPlaces, null, 2) + '\n');
  put('person-check-ai-answers.json', JSON.stringify(personAI, null, 2) + '\n');

  console.log('');
  for (const g of goals) console.log('  ' + g.n + '. ' + g.goal.padEnd(40) + ' ' + g.result.padEnd(12) + ' ' + g.measured);
  console.log('\nCalls used: ' + pot.spent() + ' of at most ' + ceiling + '.');
  console.log('Report written to ' + where.dir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}
