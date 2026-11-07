/* Run me with: node test/run.mjs — or on my own with node.
 *
 * The split bar under a picked answer's "N places" header (Mithun, 7 Nov
 * 2026, "ship the split bar first"): one ready-made bar of how the places
 * behind that answer answer the compare rule's best-pair question
 * (atlas/insight-mode.js, bestPair/splitRow, wired into listHTML's
 * splitBarHTML, which is not exported — these checks hold the building
 * blocks it is built from, on the fixtures that already prove the compare
 * rule, plus the source text for the DOM-only wiring and the "Doesn't say"
 * slice trap Fable found).
 * The places are test/fixtures/insight/*.json (no taggers' names or ids). */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const IM = require(ROOT + '/atlas/insight-mode.js');
const imSrc = fs.readFileSync(ROOT + '/atlas/insight-mode.js', 'utf8');
const BLR = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/insight/bengaluru.json', 'utf8'));
const CUB = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/insight/cubbon.json', 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}
const bl = BLR.layer, bf = BLR.features;
const blList = IM.shownStats(bl, bf, {});
const byCol = {}; blList.forEach((s) => { byCol[s.col] = s; });

// the panel's own wording (IM.splitWording, exported), over bestPair + splitRow
function wording(st, ansKey) {
  const pair = IM.bestPair(blList, bf, st.col);
  if (!pair) return null;
  const a = ansKey === null ? null : st.answers.find((x) => x.key === ansKey);
  const total = ansKey === null ? st.none : (a ? a.count : 0);
  if (!total) return null;
  const row = IM.splitRow(bf, st.col, ansKey, pair.st);
  if (!row.count) return null;
  return Object.assign({ row }, IM.splitWording(ansKey === null ? null : a.name, total, row, pair.st.question));
}

/* ---------------- partner chosen by the rule ---------------- */
console.log('\n  the split bar’s partner question');
check('Bengaluru: "What is its current status?" pairs with "What is its primary function?" (most places answering both)',
  IM.bestPair(blList, bf, 'pattern_1').st.col, 'pattern_4');
check('no qualifying partner: bestPair is null (the compare rule, re-used)', IM.bestPair([{ col: 'a', answers: [] }], [], 'a'), null);

/* ---------------- the three wordings ---------------- */
console.log('\n  the three wordings');
const est = byCol.pattern_1.answers.find((a) => a.name === 'Established');
const w1 = wording(byCol.pattern_1, est.key);
check('all N answer the partner, more than one colour: the plain "How these N places answer" line',
  [w1.kind, w1.row.count, w1.text], ['bar', 86, 'How 86 of the 92 places that say Established answer “What is its primary function?”']);
const mat = byCol.pattern_2.answers.find((a) => a.name === 'Modern or industrial');
const w2 = wording(byCol.pattern_2, mat.key);
check('every place that answers says the same thing: no bar, one line naming the answer',
  [w2.kind, w2.text], ['one', 'All 21 places that say Modern or industrial answer “What is its current status?” with Established.']);
const nat = byCol.pattern_2.answers.find((a) => a.name === 'Natural elements');
const w3 = wording(byCol.pattern_2, nat.key);
check('all N answer the partner, in two colours: "How these N places answer"',
  [w3.kind, w3.row.count, w3.text], ['bar', 55, 'How the 55 places that say Natural elements answer “What is its current status?”']);

/* ---------------- singular, "no answer", and the line after a slice tap ---------------- */
console.log('\n  the line names the picked answer; never "All 1"');
const r1 = { count: 1, cells: [{ answer: 'Cultural or spiritual', count: 1 }] };
check('one place of several answers the partner: "the one that answers … says", never "All 1"',
  IM.splitWording(null, 3, r1, 'What is its primary function?').text,
  'Of the 3 places with no answer here, the one that answers “What is its primary function?” says Cultural or spiritual.');
check('a picked answer held by one place only', IM.splitWording('Ruins', 1, r1, 'Q').text, 'The one place that says Ruins answers “Q” with Cultural or spiritual.');
check('some of several answer, all the same: "Of the N places that say X, all M that answer"',
  IM.splitWording('Ruins', 9, { count: 5, cells: [{ answer: 'Y', count: 5 }] }, 'Q').text, 'Of the 9 places that say Ruins, all 5 that answer “Q” say Y.');
check('"Doesn’t say" bar reads "places with no answer here"',
  IM.splitWording(null, 7, { count: 4, cells: [{ answer: 'A', count: 2 }, { answer: 'B', count: 2 }] }, 'Q').text, 'How 4 of the 7 places with no answer here answer “Q”');
check('the bar is Research mode\'s alone, and hides while "Compare with" is set (never the same bar twice)',
  /function splitBarHTML\(st, f\) \{\s*if \(!state\.research\) return "";[^\n]*\n\s*if \(state\.cmp\) return "";/.test(imSrc), true);
check('splitWording is plain ES5', /=>|`|\b(const|let)\b/.test((imSrc.match(/function splitWording[\s\S]*?\n  \}/) || [''])[0]), false);

/* ---------------- slices filter with AND ---------------- */
console.log('\n  a slice filters col+ans AND col2+ans2');
const pairFor1 = IM.bestPair(blList, bf, 'pattern_1').st;
const sliceCount = IM.splitRow(bf, 'pattern_1', est.key, pairFor1).cells.find((c) => c.answer === 'Commerce or services').count;
const manual = bf.filter((f) => {
  const p = f.properties || {};
  return IM.answerOf(p, 'pattern_1').toLowerCase() === est.key && IM.answerOf(p, 'pattern_4').toLowerCase() === 'commerce or services';
}).length;
check('the slice’s count is places answering BOTH the picked answer and the partner cell, same as bothCount’s AND', sliceCount, manual);

/* ---------------- "Doesn't say" keeps a readable chip ---------------- */
console.log('\n  a "Doesn’t say" slice keeps a readable chip');
const cub = CUB.layer, cf = CUB.features;
const cubList = IM.shownStats(cub, cf, {});
const cubByCol = {}; cubList.forEach((s) => { cubByCol[s.col] = s; });
const cubPair = IM.bestPair(cubList, cf, 'pattern_1');
const noneRow = IM.splitRow(cf, 'pattern_1', null, cubPair.st);
check('splitRow reads "Doesn’t say" (ansKey null) as the empty-answer places, not zero rows', noneRow.count > 0, true);
check('the fixed slice handler reads data-a="" back as null, as the "ans" case already does (not left as "", which blanked the chip label)',
  /if \(d === "slice"\) \{[\s\S]{0,400}?var a1 = t\.getAttribute\("data-a"\) \|\| null/.test(imSrc), true);

/* ---------------- ES5 ---------------- */
console.log('\n  ES5');
function fnBody(name) {
  const m = imSrc.match(new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}'));
  return m ? m[1] : '';
}
['bestPair', 'splitRow'].forEach((name) => {
  const body = fnBody(name);
  check(name + ' is plain ES5 (no =>, const, let, template literals, var only)',
    [body.length > 0, /=>/.test(body), /\b(const|let)\b/.test(body), /`/.test(body)], [true, false, false, false]);
});
const splitBarBody = (imSrc.match(/function splitBarHTML[\s\S]*?\n    \}/) || [''])[0];
check('splitBarHTML (the DOM-building wiring) is plain ES5 too', [splitBarBody.length > 0, /=>/.test(splitBarBody), /\b(const|let)\b/.test(splitBarBody), /`/.test(splitBarBody)], [true, false, false, false]);

/* ---------------- owner and visitor both see it ---------------- */
console.log('\n  owner and visitor both see it');
check('splitBarHTML carries no owner-only gate (no "api.isOwner", no "mode.owner" check) — it runs off the same shownStats() + bestPair()/splitRow() every visitor’s panel already computes',
  /function splitBarHTML[\s\S]*?\n    \}/.exec(imSrc)[0].indexOf('owner') === -1 && /function splitBarHTML[\s\S]*?\n    \}/.exec(imSrc)[0].indexOf('isOwner') === -1, true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
