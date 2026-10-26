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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, NEVER, CALLS_PER_ATTEMPT, CHECK_CALLS, helpOf, die, refused, loadAtlas, loadFile,
  loadModels, budget, freshReading } from './lib-measure.mjs';

// the finding, the model calls, the stand-in and the ceiling are shared with deploy/scorecard.mjs
export { refused };
const HELP = helpOf(import.meta.url);

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

  const models = await loadModels(o.stub);
  console.log('Measuring ' + named + (layer.id ? ' / ' + layer.id : '') + ': ' + rows.length + ' places, ' +
    fields.length + ' columns with words; ' + o.runs + ' fresh reading' + (o.runs === 1 ? '' : 's') +
    ' on ' + models.flash + '; at most ' + o.maxCalls + ' calls.');

  const pot = budget(o.maxCalls, o.stub);
  const sets = [];
  for (let k = 1; k <= o.runs; k++) {
    const before = pot.spent();
    // afresh: no settled questions, nothing carried from an earlier reading's record
    const { out, retry: again } = await freshReading({ rows, fields, title, nameCol, pot, models });
    const retry = again ? 'asked again for ' + again.missed.map((m) => m.word + ' on ' + m.places + ' places' +
      (m.under ? ' left blank by “' + m.under + '”' : ' asked about by nothing')).join('; ') +
      ' — ' + (again.better ? 'the second set was better, and is the one shown' : 'the second set was no better; the first is shown') : '';
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
