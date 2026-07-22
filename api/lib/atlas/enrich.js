// Text -> category + labels enrichment for the data bench.
//
// Two tiers derived from a free-text description column when the upload has no
// categories of its own:
//   category = ONE coarse bucket per row, from a small set INDUCED across the
//              whole dataset (emergent — not a fixed LOKA enum), so the legend
//              is coherent and colour-able.
//   labels   = several fine-grained tags per row, for popup chips / filtering.
//
// The LLM does only the semantic work (induce the set, assign a category,
// propose labels). Everything that can be wrong in a checkable way is handled
// deterministically here — grounding (drop labels with no anchor in the source
// text), normalisation, dedupe, count caps, gap-fill coverage — and the result
// is shown to the user as editable columns before anything reaches the map.
// Labels carry NO numbers, so the dangerous "fabricated statistic" failure
// cannot occur; the worst case is an irrelevant tag, which the grounding filter
// and the human review catch.

const MAX_LABELS = 6;
const MAX_GAPFILL_LABELS = 3;
const INDUCE_SAMPLE = 60;        // descriptions shown to the induction call
const CLASSIFY_BATCH = 40;       // rows per assignment call (prompt-budget bound)
const MIN_CATS = 3, MAX_CATS = 10;

const STOP = new Set(('a an the of and or to in on at for with from by is are was were be been being this that ' +
  'these those it its as into over under near out up down off about made out made-of using used various ' +
  'other others new old big small very more most some any all each per').split(/\s+/));

/* ---------------- pure helpers (unit-testable, no LLM) ---------------- */

export function normalizeLabel(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// stems just enough to match "lights" vs "lighting" vs "lit" loosely
function stem(w) { return String(w).toLowerCase().replace(/(ing|ed|es|s)$/,'').slice(0, 12); }

function descTokens(desc) {
  return new Set(String(desc).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem));
}

// a label is grounded if any of its words (stemmed) appears in the description —
// drops hallucinated tags that have no anchor in the source text
export function groundLabels(labels, desc) {
  const toks = descTokens(desc);
  return labels.filter((lab) => {
    const words = String(lab).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
    if (!words.length) return false;
    return words.some((w) => toks.has(stem(w)));
  });
}

// normalise, drop blanks/stop-only, dedupe (against `existing` too for gap-fill)
export function cleanLabels(labels, existing = [], cap = MAX_LABELS) {
  const seen = new Set(existing.map(normalizeLabel));
  const out = [];
  for (const raw of labels) {
    const n = normalizeLabel(raw);
    if (!n || n.replace(/-/g, '').length < 2) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= cap) break;
  }
  return out;
}

// which salient description tokens are NOT already covered by existing labels —
// used to decide whether gap-fill is even needed and to steer it
export function coverageGaps(desc, existingLabels) {
  const covered = new Set();
  existingLabels.forEach((l) => String(l).toLowerCase().split(/[^a-z0-9]+/).forEach((w) => { if (w) covered.add(stem(w)); }));
  const salient = [...descTokens(desc)].filter((t) => t.length >= 3 && !STOP.has(t));
  return salient.filter((t) => !covered.has(t));
}

// no-LLM fallback: extractive keyword labels straight from the description
export function extractLabels(desc, cap = MAX_LABELS) {
  const words = String(desc).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  const freq = new Map();
  words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  const ranked = [...new Set(words)].sort((a, b) => (freq.get(b) - freq.get(a)) || (b.length - a.length));
  return cleanLabels(ranked.slice(0, cap), [], cap);
}

export function coerceCategory(value, set) {
  const names = new Set(set.map((c) => (typeof c === 'string' ? c : c.name)));
  const v = String(value || '').trim();
  return names.has(v) ? v : 'other';
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
    type: 'object', required: ['i', 'category', 'labels'], properties: {
      i: { type: 'integer' }, category: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } } } } } },
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

// Returns { category, labels } per input row, hygiene applied. Falls back to
// extractive labels (and empty category) when AI is unavailable.
export async function classifyAndLabel({ rows, descCol, existingLabelsCol, categorySet, callJSON, model }) {
  const result = rows.map(() => ({ category: '', labels: [] }));
  const desc = rows.map((r) => String((r && r[descCol]) || ''));
  const existing = rows.map((r) => {
    if (!existingLabelsCol) return [];
    const v = r && r[existingLabelsCol];
    return v ? String(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean) : [];
  });

  if (!callJSON || !categorySet.length) {
    // deterministic fallback: extractive labels, gap-filled, no invented category
    rows.forEach((_, i) => {
      const gen = existing[i].length ? extractLabels(desc[i], MAX_GAPFILL_LABELS) : extractLabels(desc[i]);
      result[i] = { category: existingLabelsCol ? '' : '',
        labels: cleanLabels([...existing[i], ...groundLabels(gen, desc[i])], [], MAX_LABELS) };
    });
    return result;
  }

  const names = categorySet.map((c) => c.name);
  for (let start = 0; start < rows.length; start += CLASSIFY_BATCH) {
    const batch = [];
    for (let i = start; i < Math.min(rows.length, start + CLASSIFY_BATCH); i++) {
      batch.push({ i, description: desc[i], existingLabels: existing[i] });
    }
    const prompt = [
      'Assign each item to EXACTLY ONE category from this set, or "other" if none fits.',
      'Categories: ' + JSON.stringify(categorySet.map((c) => ({ name: c.name, definition: c.definition }))),
      `Also propose up to ${MAX_LABELS} fine-grained LABELS per item describing specifics.`,
      'Use ONLY concepts present in or directly entailed by the description — invent nothing. Short kebab-case tags.',
      'If existingLabels are given, add ONLY labels for aspects they do NOT already cover; do not restate them.',
      'Items:', JSON.stringify(batch),
    ].join('\n');
    let out = null;
    try { out = await callJSON(model, prompt, CLASSIFY_SCHEMA); } catch { out = null; }
    const byIdx = new Map();
    if (out && Array.isArray(out.rows)) out.rows.forEach((r) => byIdx.set(r.i, r));
    for (let i = start; i < Math.min(rows.length, start + CLASSIFY_BATCH); i++) {
      const r = byIdx.get(i);
      if (!r) { // model dropped this row — extractive fallback for labels
        result[i] = { category: 'other', labels: cleanLabels([...existing[i], ...groundLabels(extractLabels(desc[i]), desc[i])]) };
        continue;
      }
      const grounded = groundLabels((r.labels || []).map(String), desc[i]);
      const cap = existing[i].length ? existing[i].length + MAX_GAPFILL_LABELS : MAX_LABELS;
      result[i] = {
        category: coerceCategory(r.category, categorySet),
        labels: cleanLabels([...existing[i], ...grounded], [], cap),
      };
    }
  }
  return result;
}

// Full pipeline. opts: {rows, descCol, existingLabelsCol?, seedSet?, callJSON?, models:{flash,flashLite}}
export async function enrichRows(opts) {
  const { rows, descCol, existingLabelsCol, seedSet, callJSON, models = {} } = opts;
  let categorySet = Array.isArray(seedSet) && seedSet.length ? seedSet : [];
  if (!categorySet.length) {
    categorySet = await induceCategories({
      descriptions: rows.map((r) => String((r && r[descCol]) || '')),
      callJSON, model: models.flash,
    });
  }
  const per = await classifyAndLabel({
    rows, descCol, existingLabelsCol, categorySet, callJSON, model: models.flashLite || models.flash,
  });
  return { categorySet, rows: per };
}
