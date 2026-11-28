/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* A column of numbers is a key: three to five ranges the Atlas works out
   (Mithun, 28 Nov 2026: "build number ranges as a general feature"). Which
   columns, and which ranges, is one rule in atlas/label-rules.js (numberKey);
   the viewer's own key machinery (atlas.js computeKeyOptions, optValuesOf) is
   lifted out as it stands and run here, so a number key is checked as the map
   makes it. Three made-up shapes: recording sites with skewed counts, a
   LOKA-shaped layer, and a civic sheet. No network, no model. */
import { soundSites } from './fixtures/sound-sites.mjs';
const require = createRequire(import.meta.url);
const LokaLabelRules = require(ROOT + '/atlas/label-rules.js');
const js = fs.readFileSync(ROOT + '/atlas/atlas.js', 'utf8');
const im = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

// the key machinery, lifted out of atlas.js by name (as shared-answers-key-test.mjs does)
function fn(name) {
  const i = js.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error('no function ' + name);
  const j = js.indexOf('\n  }\n', i);
  const k = js.indexOf('\n', i + 1);
  return /\}\s*$/.test(js.slice(i, k)) && js.slice(i, k).split('{').length === js.slice(i, k).split('}').length
    ? js.slice(i, k) + '\n' : js.slice(i, j + 4) + '\n';
}
function constant(name) {
  const m = js.match(new RegExp('\\n  var ' + name + ' = [^;]*;'));
  if (!m) throw new Error('no var ' + name);
  return m[0] + '\n';
}
const body =
  ['KEY_MAX', 'KEY_CAP', 'KEY_DOMINANCE', 'QUESTION_MIN_REACH', 'KEY_LOPSIDED_MIN_KINDS', 'KEY_MIN_SHARED', 'DATEY', 'MONTHS'].map(constant).join('') +
  ['prettyCol', 'colLabel', 'dateKeyName', 'looksLikeDates', 'dateBucket', 'dateGrain', 'unbrace', 'unquotePiece', 'cellText', 'skipSearchValue',
    'sharedShare', 'computeKeyOptions', 'optValuesOf', 'keyKindColor'].map(fn).join('');
const lib = new Function('LokaLabelRules', 'KEY_COLORS',
  body + 'return { computeKeyOptions: computeKeyOptions, optValuesOf: optValuesOf, keyKindColor: keyKindColor };')(LokaLabelRules, ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888']);

const layer = (extra) => Object.assign({ id: 't', type: 'marker', userLayer: true }, extra || {});
const pins = (rows) => rows.map((p) => ({ type: 'Feature', properties: p,
  geometry: p.longitude != null ? { type: 'Point', coordinates: [Number(p.longitude), Number(p.latitude)] } : null }));
const keysOf = (L, feats) => lib.computeKeyOptions(L, feats).filter((o) => !o.tooFew && !o.scattered);
const numberKeys = (opts) => opts.filter((o) => o.ranges).map((o) => o.col).sort();
// how many places wear each kind of a key, asked the way the map asks every place
const tally = (L, opt, feats) => {
  const t = {};
  feats.forEach((f) => { const v = lib.optValuesOf(L, opt, f)[0] || 'Doesn’t say'; t[v] = (t[v] || 0) + 1; });
  return t;
};
// …in the order of the key's own kinds
const counted = (L, opt, feats) => { const t = tally(L, opt, feats); return opt.kept.map((k) => t[k] || 0); };
const N = 120, idx = [...Array(N).keys()];

console.log('\n  1. recording sites: counts, and one count badly skewed');
{
  const rows = soundSites().map((r, i) => Object.assign({}, r, {
    // most sites have 1 call logged, a few have some, one has 392
    calls_logged: i === 5 ? '392' : i % 10 < 6 ? '1' : i % 10 < 8 ? '2' : i % 10 < 9 ? String(3 + i % 3) : String(5 + i % 9),
    notes_count: i % 4 ? String(i % 13) : '',
  }));
  const L = layer(), feats = pins(rows), opts = keysOf(L, feats);
  check('the number columns are keys, and nothing else is one by ranges', numberKeys(opts), ['calls_logged', 'notes_count', 'recordings', 'species_count']);
  check('a point\'s own latitude and longitude never are', opts.some((o) => /itude/.test(o.col)), false);
  const species = opts.find((o) => o.col === 'species_count');
  check('the heading is the column\'s own label, the kinds are the ranges in the order of the numbers', [species.label, species.kept], ['Species count', ['1–5', '6–9', '10–13', '14–17', 'More than 17']]);
  check('every place with a number is in exactly one range, none of them empty', counted(L, species, feats), [30, 24, 24, 24, 18]);
  const skew = opts.find((o) => o.col === 'calls_logged');
  check('skewed counts do not land in one range: single values stand alone', [skew.kept, counted(L, skew, feats)],
    [['1', '2', '3', 'More than 3'], [71, 24, 4, 21]]);
  const notes = opts.find((o) => o.col === 'notes_count');
  check('a blank is "Doesn’t say", never a range', tally(L, notes, feats)['Doesn’t say'], 30);
  check('the colours run light to dark in one hue, one for each range', species.kept.map((_, i) => lib.keyKindColor(L, species, 0, i)), LokaLabelRules.rampColors(5));
  check('and the plain keys beside it keep the ordinary palette', lib.keyKindColor(L, opts.find((o) => o.col === 'main_animal_group'), 0, 0), '#111111');
  check('a plain column is still a plain key', opts.some((o) => o.col === 'main_animal_group' && !o.ranges), true);
  check('and it comes first: a number key never leads the list, so the map does not open coloured by a count', [opts[0].ranges == null, opts.findIndex((o) => o.ranges) > opts.findIndex((o) => o.col === 'main_animal_group')], [true, true]);
}

console.log('\n  2. a LOKA-shaped layer: likes, comments and photo counts become keys — never questions');
{
  const rows = idx.map((i) => ({ loka_name: 'Corner ' + (i + 1), description: 'Corner ' + (i + 1) + ' is where we come most evenings.',
    categories: ['Nature', 'Culture', 'Learning'][i % 3], likes: String((i * i) % 23), comments: String((i * 7) % 15), photo_count: String(1 + (i % 4)),
    tag_id: '0f8fad5b-d9cb-469f-a165-70867728' + String(1000 + i), created_at: '2026-0' + (1 + i % 9) + '-1' + (i % 9) + 'T10:00:00Z' }));
  const L = layer({ _loka: true }), opts = keysOf(L, pins(rows));
  check('likes, comments and the photo count are number keys; the id and the date are not', numberKeys(opts), ['comments', 'likes', 'photo_count']);
  check('a count of 1 to 4 is not cut into ranges: each number is its own kind, in order', opts.find((o) => o.col === 'photo_count').kept, ['1', '2', '3', '4']);
  check('likes, in ranges', opts.find((o) => o.col === 'likes').kept, ['0–2', '3–6', '7–9', '10–13', 'More than 13']);
  const RULES = require(ROOT + '/atlas/reading-rules.js');
  check('and none of them is sent to the reader', RULES.wordColumns(rows).filter((c) => /likes|comments|photo_count/.test(c)), []);
}

console.log('\n  3. a civic sheet: the right columns, and not the wrong ones');
{
  const rows = idx.map((i) => ({ name: 'Ward office ' + (i + 1),
    population: String(1200 + i * i * 37 + i * 911), area_sq_km: (0.4 + ((i * i) % 97) * 1.37).toFixed(2), year_built: String(1890 + ((i * 13) % 97)),
    rating: String(1 + i % 5), pincode: String(560001 + i * 3), record_id: String(40000 + i * 977), serial: String(1000 + i * 2),
    change_pct: String(-40 + ((i * 17) % 95)), budget: (1 + i % 30).toLocaleString('en-US') + ',000', storeys: '3' }));
  const L = layer(), feats = pins(rows), opts = keysOf(L, feats);
  check('population, area, year built, change, budget and the rating are number keys; the pincode, the id, the serial and the one-value column are not',
    numberKeys(opts), ['area_sq_km', 'budget', 'change_pct', 'population', 'rating', 'year_built']);
  check('a 1 to 5 rating keeps its five values, in order', opts.find((o) => o.col === 'rating').kept, ['1', '2', '3', '4', '5']);
  check('whole numbers, with their thousands marked', opts.find((o) => o.col === 'population').kept, ['1,200–40,000', '40,001–100,000', '100,001–300,000', '300,001–400,000', 'More than 400,000']);
  check('decimals, on round edges', opts.find((o) => o.col === 'area_sq_km').kept, ['Up to 20', '20–50', '50–70', '70–100', 'More than 100']);
  const years = opts.find((o) => o.col === 'year_built').kept;
  check('years are worded as years — never "1,990"', [years.some((k) => /,/.test(k)), years.every((k) => /^(After )?\d{4}(–\d{4})?$/.test(k))], [false, true]);
  check('numbers below zero say "to", so a dash is never read as a minus', opts.find((o) => o.col === 'change_pct').kept[0], '-40 to -20');
  check('numbers written with thousands separators are numbers', opts.find((o) => o.col === 'budget').kept.length >= 3, true);
  for (const o of opts.filter((x) => x.ranges)) {
    const t = tally(L, o, feats);
    check(o.col + ': three to five kinds, none empty, every place in one', [o.kept.length >= 3 && o.kept.length <= 5, o.kept.every((k) => t[k] > 0), o.kept.reduce((n, k) => n + t[k], 0)], [true, true, N]);
  }
  check('a number the layer is already drawn by is not offered again', numberKeys(keysOf(layer({ spec: { valueColumn: 'population' } }), feats)).includes('population'), false);
}

/* 4. The same promise on 400+ made-up columns, not just the three shapes
   above: whatever the numbers are — whole, decimal at any scale, in a band
   a thousandth wide, skewed, below zero — the ranges READ apart. The words
   used to round to two decimals whatever the data's own precision, so a
   narrow band came out as "200–200" four times over: two ranges with the
   same words are not two ranges (the panel counts them as one, the map
   colours them as two). Same numbers every run: the dice are seeded. */
console.log('\n  4. 400+ made-up number columns: the words always tell the ranges apart');
{
  let seed = 20261128;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const fixed = (x, d) => x.toFixed(d);
  const shapes = [
    // whole numbers, small and large
    () => { const hi = pick([5, 40, 900, 120000]); return (n) => String(Math.floor(rnd() * hi)); },
    // decimals at several scales
    () => { const sc = pick([0.0001, 0.01, 1, 1000, 1e6]), d = pick([1, 2, 3, 4]); return () => fixed(rnd() * sc, d + 4); },
    // a narrow band: salinity 0.001–0.009, a price 199.50–199.99, an elevation 920.0–921.0
    () => { const b = pick([[0.001, 0.008, 3], [199.5, 0.49, 2], [920, 1, 1], [12.34, 0.02, 4]]);
      return () => fixed(b[0] + rnd() * b[1], b[2]); },
    // skewed: most places on one small number, a few far out
    () => { const far = pick([392, 20000, 7.5]); return () => rnd() < 0.8 ? '1' : String(Math.round(rnd() * far * 100) / 100); },
    // below zero, and either side of it
    () => { const lo = pick([-40, -1, -0.005]), hi = pick([0, 19, 0.005]), d = pick([0, 2, 4]);
      return () => fixed(lo + rnd() * (hi - lo), d); },
  ];
  let columns = 0, keys = 0, bad = [];
  for (let c = 0; c < 420; c++) {
    const make = shapes[c % shapes.length]();
    const rows = Array.from({ length: 8 + Math.floor(rnd() * 150) }, (_, i) => make(i));
    columns++;
    const key = LokaLabelRules.numberKey('measure_' + c, rows);
    if (!key) continue;
    keys++;
    const labels = key.ranges.map((r) => r.label), maxes = key.ranges.map((r) => r.max);
    const say = (why) => { if (bad.length < 4) bad.push(why + '  ' + JSON.stringify(labels) + '  from ' + JSON.stringify(rows.slice(0, 6))); };
    if (labels.length < 2 || labels.length > 5) say('not 2 to 5 ranges');
    if (new Set(labels).size !== labels.length) say('the same words twice');
    if (labels.some((l) => !l || !String(l).trim())) say('a range with no words');
    if (labels.some((l) => /^(-?[\d.,]+)–\1$/.test(l) || /^(-?[\d.,]+) to \1$/.test(l))) say('a range from a number to itself');
    for (let i = 1; i < maxes.length; i++) if (!(maxes[i] > maxes[i - 1])) say('ranges out of order');
    if (maxes[maxes.length - 1] !== Infinity) say('the last range does not run on');
    // every number in exactly one range: the one the map asks for, and no other
    const held = labels.map(() => 0);
    rows.forEach((v) => {
      const x = Number(v), got = LokaLabelRules.numberBucket(v, key.ranges);
      const want = labels[maxes.findIndex((m) => x <= m)];
      if (got !== want || !got) say('a number in no range, or in the wrong one');
      const only = maxes.filter((m, i) => x <= m && (i === 0 || x > maxes[i - 1]));
      if (only.length !== 1) say('a number in two ranges');
      held[labels.indexOf(got)]++;
    });
    if (held.some((n) => !n)) say('an empty range');
  }
  check('every made-up column that becomes a key keeps the promise', bad, []);
  check('and most of them are keys (the fix is not "offer nothing")', [columns >= 400, keys >= columns * 0.9], [true, true]);
  // the three the reviewer found by hand
  const band = (lo, step, d, n) => Array.from({ length: n }, (_, i) => (lo + (i % 9) * step).toFixed(d));
  const labelsOf = (name, vals) => (LokaLabelRules.numberKey(name, vals) || { ranges: [] }).ranges.map((r) => r.label);
  for (const [name, vals] of [['salinity', band(0.001, 0.001, 3, 60)], ['price', band(199.5, 0.05, 2, 60)], ['elevation', band(920, 0.125, 2, 60)]]) {
    const ls = labelsOf(name, vals);
    check(name + ': as many decimals as it takes to tell the ranges apart', [ls.length >= 3, new Set(ls).size === ls.length, ls.some((l) => /\./.test(l))], [true, true, true]);
  }
}

/* 5. An id is not a measure — and "every value different" is not what tells
   them apart. The first rule refused any all-different whole-number column
   spanning less than three times the row count, which threw away a change of
   -20 to 19 percent, percentages 0 to 78, a column of likes where no two
   places agree, and one year per place. An id is told by its name, by values
   that run on at a fixed step from a counting base, or by being written as a
   code (leading zeros, or one width of five digits or more). */
console.log('\n  5. ids, serials and pincodes out — measures kept');
{
  const A = (n, f) => Array.from({ length: n }, (_, i) => String(f(i)));
  const ranged = (name, vals) => { const k = LokaLabelRules.numberKey(name, vals); return k ? k.ranges.map((r) => r.label) : null; };
  const out = (name, vals) => check('not a key: ' + name, ranged(name, vals), null);
  const inn = (name, vals) => check('a key: ' + name, ranged(name, vals) != null, true);
  out('record_id', A(120, (i) => 40000 + i * 977));
  out('serial', A(120, (i) => 1000 + i * 2));          // reads like a year by its values; the name says serial
  out('pincode', A(120, (i) => 560001 + i * 3));
  out('sl no', A(60, (i) => i + 1));
  out('row', A(60, (i) => i + 1));
  out('ward code', A(60, (i) => String(i + 1).padStart(3, '0')));   // written with leading zeros
  inn('change_pct', A(40, (i) => i - 20));             // -20 to 19, every one different
  inn('percent_green', A(79, (i) => i));               // 0 to 78
  inn('likes', A(60, (i) => (i * i) % 997 + i * 3));   // no two places agree
  inn('year_built', A(60, (i) => 1950 + i));           // one year per place
  inn('year_opened', A(50, (i) => 2000 + i));          // …even from a round year
  inn('count_of_bees', A(60, (i) => i + 1));           // a count that happens to run 1, 2, 3 …
}

/* 6. Most places on one number. An ordinary key whose commonest answer takes
   more than 85 in a hundred is dropped: the map comes out one colour. A
   number key is the exception — the handful of corners that do have likes
   are what a reader is after — as long as two ranges hold places and the
   minority is a real one (five places, or three in a hundred). */
console.log('\n  6. a number column where most places are 0 is still a key');
{
  const rows = idx.map((i) => ({ loka_name: 'Corner ' + (i + 1), categories: ['Nature', 'Culture'][i % 2],
    likes: i < 110 ? '0' : String((i - 109) * 7), quiet: i ? '0' : '1' }));
  const L = layer({ _loka: true }), feats = pins(rows), opts = keysOf(L, feats);
  const likes = opts.find((o) => o.col === 'likes');
  check('likes: 110 places on 0 and ten that spread is kept, and the ranges hold them all',
    [!!likes, likes ? likes.kept.length >= 2 : null, likes ? likes.kept.reduce((n, k) => n + (tally(L, likes, feats)[k] || 0), 0) : null], [true, true, N]);
  check('but a column where one place differs and no range holds the rest is not a key', opts.some((o) => o.col === 'quiet'), false);
  check('the rule itself: two ranges in use, and a minority of five places or three in a hundred',
    [LokaLabelRules.numberKeySpreads(2, 10, 120), LokaLabelRules.numberKeySpreads(2, 3, 120), LokaLabelRules.numberKeySpreads(1, 40, 120),
      LokaLabelRules.numberKeySpreads(2, 5, 4000), LokaLabelRules.numberKeySpreads(2, 0, 120)],
    [true, false, false, true, false]);
}

console.log('\n  the rule on its own');
check('too few numbers to cut', LokaLabelRules.numberKey('n', ['1', '5', '9', '30']), null);
check('words are not numbers', LokaLabelRules.numberKey('n', idx.map((i) => i + ' trees')), null);
check('a blank or a word falls in no range', [LokaLabelRules.numberBucket('', [{ label: 'a', max: 5 }]), LokaLabelRules.numberBucket('many', [{ label: 'a', max: 5 }]), LokaLabelRules.numberBucket('1,200', [{ label: 'a', max: 5 }, { label: 'b', max: Infinity }])], ['', '', 'b']);
check('the panel orders a number key by its ranges and colours it by the same ramp', /if \(o\.ranges && Array\.isArray\(o\.kept\)\)/.test(im) && /rules\.rampColors\(o\.kept\.length\)/.test(im), true);
check('the map and the panel read ONE answer for where a kind sits (label-rules kindIndex)',
  [/kindIndex\(opt\.kept, v\)/.test(js), /kindIndex\(o\.kept, a\.name\)/.test(im), LokaLabelRules.kindIndex(['a', 'b'], 'b'), LokaLabelRules.kindIndex(['a'], 'z')], [true, true, 1, -1]);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
