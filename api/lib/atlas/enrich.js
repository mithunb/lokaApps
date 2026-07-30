// Data enrichment: one NEW categorical field derived from a free-text column.
//
// The whole corpus is read together — every value of the chosen column — and
// ONE coherent category scheme is induced from it, then each row is assigned
// exactly one category from that scheme. The point is to give the user a new
// way to inspect their data; it never rewrites what they uploaded.
//
//   AI path        a taxonomy pass over all values (sampled when very large)
//                  proposes the set; an assignment pass classifies each row
//                  into it. The LLM does only that semantic work.
//   fallback path  extractive keyword clustering over the whole corpus: rank
//                  salient stems by how many rows mention them, greedily pick
//                  themes that each cover several still-uncovered rows.
//
// Everything checkable is deterministic here — category names are clamped and
// deduped, assignments are coerced onto the set ("other" when nothing fits) —
// and the result comes back as an editable NEW column, so the worst case is a
// dull theme name, which the human review catches.

const INDUCE_SAMPLE = 60;        // descriptions shown to the induction call
const CLASSIFY_BATCH = 40;       // rows per assignment call (prompt-budget bound)
const MIN_CATS = 3, MAX_CATS = 10;
const MIN_THEME_ROWS = 2;        // a fallback theme must cover at least this many rows

const STOP = new Set(('a an the of and or to in on at for with from by is are was were be been being this that ' +
  'these those it its as into over under near out up down off about made out made-of using used various ' +
  'other others new old big small very more most some any all each per').split(/\s+/));

/* ---------------- pure helpers (unit-testable, no LLM) ---------------- */

// stems just enough to match "lights" vs "lighting" vs "lit" loosely
function stem(w) { return String(w).toLowerCase().replace(/(ing|ed|es|s)$/,'').slice(0, 12); }

// salient stemmed tokens of one description — what the fallback clusters on
function rowStems(desc) {
  const out = new Set();
  String(desc).toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
    if (w.length >= 3 && !STOP.has(w)) out.add(stem(w));
  });
  return out;
}

export function coerceCategory(value, set) {
  const names = new Set(set.map((c) => (typeof c === 'string' ? c : c.name)));
  const v = String(value || '').trim();
  return names.has(v) ? v : 'other';
}

// no-LLM fallback: corpus-level keyword clustering. Ranks stems by how many
// rows mention them, then greedily picks themes that each cover several rows
// no earlier theme covered (a set-cover pass) — so the scheme describes the
// corpus as a whole, not any single row. Returns the set plus one category
// per row ("other" when no theme matches, "" when the row has no text).
export function clusterCorpus(descriptions, { maxCats = MAX_CATS, minRows = MIN_THEME_ROWS } = {}) {
  const stems = descriptions.map(rowStems);
  const stemRows = new Map();      // stem -> row indices that mention it
  const surfaces = new Map();      // stem -> Map(word -> count), for a readable name
  descriptions.forEach((d, i) => {
    const counted = new Set();
    String(d).toLowerCase().split(/[^a-z0-9]+/).forEach((w) => {
      if (w.length < 3 || STOP.has(w)) return;
      const s = stem(w);
      if (!counted.has(s)) { counted.add(s); (stemRows.get(s) || stemRows.set(s, []).get(s)).push(i); }
      const m = surfaces.get(s) || surfaces.set(s, new Map()).get(s);
      m.set(w, (m.get(w) || 0) + 1);
    });
  });
  const assigned = descriptions.map(() => '');
  const categorySet = [];
  const used = new Set();
  while (categorySet.length < maxCats) {
    let best = null, bestCover = 0;
    for (const [s, idxs] of stemRows) {
      if (used.has(s)) continue;
      let cover = 0;
      for (const i of idxs) if (!assigned[i]) cover++;
      if (cover > bestCover) { best = s; bestCover = cover; }
    }
    if (!best || bestCover < minRows) break;
    used.add(best);
    // the commonest surface word gives the theme a human-readable name
    let name = best, top = 0;
    for (const [w, n] of surfaces.get(best)) if (n > top) { top = n; name = w; }
    categorySet.push({ name, definition: 'rows whose text mentions "' + name + '"' });
    for (const i of stemRows.get(best)) if (!assigned[i]) assigned[i] = name;
  }
  for (let i = 0; i < assigned.length; i++) {
    if (!assigned[i]) assigned[i] = stems[i].size ? 'other' : '';
  }
  return { categorySet, categories: assigned };
}

// fallback assignment into an EXISTING set (the atlas's persisted scheme):
// best token overlap between the description and the category's name +
// definition, "other" when nothing overlaps — deterministic, no invention.
export function assignBySeed(descriptions, seedSet) {
  const catStems = seedSet.map((c) => rowStems((c.name || '') + ' ' + (c.definition || '')));
  return descriptions.map((d) => {
    const toks = rowStems(d);
    if (!toks.size) return '';
    let best = '', bestScore = 0;
    seedSet.forEach((c, k) => {
      let score = 0;
      for (const s of catStems[k]) if (toks.has(s)) score++;
      if (score > bestScore) { bestScore = score; best = c.name; }
    });
    return best || 'other';
  });
}

/* ---------------- LLM steps (caller injected for testability) ----------------
   callJSON(model, prompt, schema) -> parsed object, or null when AI is off. */

const INDUCE_SCHEMA = {
  type: 'object', required: ['categories'],
  properties: { categories: { type: 'array', items: {
    type: 'object', required: ['name'], properties: {
      name: { type: 'string' }, definition: { type: 'string' } } } } },
};
const CLASSIFY_SCHEMA = {
  type: 'object', required: ['rows'],
  properties: { rows: { type: 'array', items: {
    type: 'object', required: ['i', 'category'], properties: {
      i: { type: 'integer' }, category: { type: 'string' } } } } },
};

export async function induceCategories({ descriptions, callJSON, model }) {
  if (!callJSON) return [];
  const sample = descriptions.filter(Boolean).slice(0, INDUCE_SAMPLE);
  if (sample.length < MIN_CATS) return [];
  const prompt = [
    'You are grouping short descriptions of places into a small set of COARSE categories for a map legend.',
    `Propose between ${MIN_CATS} and ${MAX_CATS} categories that are mutually distinct and each cover several items.`,
    'Use ONLY what the descriptions evidence — do not invent themes not present. name: 1-3 words. definition: one short line.',
    'Descriptions:', JSON.stringify(sample),
  ].join('\n');
  try {
    const out = await callJSON(model, prompt, INDUCE_SCHEMA);
    const cats = (out && out.categories || [])
      .map((c) => ({ name: String(c.name || '').trim().slice(0, 40), definition: String(c.definition || '').slice(0, 120) }))
      .filter((c) => c.name);
    // dedupe by lowercased name, clamp
    const seen = new Set(); const uniq = [];
    for (const c of cats) { const k = c.name.toLowerCase(); if (!seen.has(k)) { seen.add(k); uniq.push(c); } }
    return uniq.slice(0, MAX_CATS);
  } catch { return []; }
}

// AI assignment pass: one category per row from the induced set, coerced onto
// it ("other" when the model strays or drops a row, "" when the row is blank).
export async function classifyRows({ descriptions, categorySet, callJSON, model }) {
  const out = descriptions.map(() => '');
  for (let start = 0; start < descriptions.length; start += CLASSIFY_BATCH) {
    const batch = [];
    for (let i = start; i < Math.min(descriptions.length, start + CLASSIFY_BATCH); i++) {
      if (descriptions[i].trim()) batch.push({ i, description: descriptions[i] });
    }
    if (!batch.length) continue;
    const prompt = [
      'Assign each item to EXACTLY ONE category from this set, or "other" if none fits.',
      'Categories: ' + JSON.stringify(categorySet.map((c) => ({ name: c.name, definition: c.definition }))),
      'Items:', JSON.stringify(batch),
    ].join('\n');
    let res = null;
    try { res = await callJSON(model, prompt, CLASSIFY_SCHEMA); } catch { res = null; }
    const byIdx = new Map();
    if (res && Array.isArray(res.rows)) res.rows.forEach((r) => byIdx.set(r.i, r));
    for (const item of batch) {
      const r = byIdx.get(item.i);
      out[item.i] = coerceCategory(r && r.category, categorySet);
    }
  }
  return out;
}

// Full pipeline. opts: {rows, descCol, seedSet?, callJSON?, models:{flash,flashLite}}
// -> { categorySet, categories } — categories index-aligned with rows, one per
// row. Never touches the input rows.
export async function enrichRows(opts) {
  const { rows, descCol, seedSet, callJSON, models = {} } = opts;
  const descriptions = rows.map((r) => String((r && r[descCol]) || ''));
  const seeded = Array.isArray(seedSet) && seedSet.length ? seedSet : null;

  if (callJSON) {
    const categorySet = seeded || await induceCategories({ descriptions, callJSON, model: models.flash });
    if (categorySet.length) {
      const categories = await classifyRows({
        descriptions, categorySet, callJSON, model: models.flashLite || models.flash,
      });
      return { categorySet, categories };
    }
    // induction came back empty — same deterministic path as no-AI below
  }
  if (seeded) return { categorySet: seeded, categories: assignBySeed(descriptions, seeded) };
  return clusterCorpus(descriptions);
}
