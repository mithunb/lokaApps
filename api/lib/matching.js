// Name matching for admin-boundary joins — a JS port of the cascade proven in
// the deoria build scripts (build_boundaries.py): normalize → alias → dice
// similarity with a conservative auto-accept, everything else goes to the
// human fix-list (optionally pre-filled by a Gemini adjudication pass).

export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// Seeded from the deoria work; grows as orgs correct matches.
const ALIAS = {
  bishunpura: 'vishunpura', dudahi: 'dudhahi', kasia: 'kasaya',
  desahideoria: 'desaideoria', parthardeva: 'pathardewa', tarkulwa: 'tarkalua',
  kaptanganj: 'kaptainganj', nebuanaurangiya: 'nebuanaurangia',
  tamkuhi: 'tamkuhiraj', sewrahi: 'seorahi', kathkuiyanpadrauna: 'padrauna',
};

export function canon(name) {
  const n = norm(name);
  return ALIAS[n] || n;
}

// Sørensen–Dice over character bigrams — cheap and solid for short place names.
export function dice(a, b) {
  a = canon(a); b = canon(b);
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const c = grams.get(g) || 0;
    if (c > 0) { hits++; grams.set(g, c - 1); }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

export const AUTO_ACCEPT = 0.85;
export const CANDIDATE_FLOOR = 0.5;

/**
 * Join table rows to boundary features by name.
 * targets: [{code, name, parent?}] — code is any stable id (lgd code / index).
 * Returns per-row: {row, name, match: code|null, score, candidates:[{code,name,parent,score}]}
 */
export function joinByName(rows, nameCol, parentCol, targets) {
  const byKey = new Map();       // canon(name) -> targets[]
  const byCompound = new Map();  // canon(parent)|canon(name) -> targets[]
  for (const t of targets) {
    const k = canon(t.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
    if (t.parent) {
      const ck = canon(t.parent) + '|' + k;
      if (!byCompound.has(ck)) byCompound.set(ck, []);
      byCompound.get(ck).push(t);
    }
  }

  return rows.map((row, idx) => {
    const raw = String(row[nameCol] ?? '').trim();
    const parent = parentCol ? String(row[parentCol] ?? '').trim() : '';
    const out = { row: idx, name: raw, match: null, score: 0, candidates: [] };
    if (!raw) return out;

    // 1) exact (compound first when a parent column exists)
    if (parent) {
      const hit = byCompound.get(canon(parent) + '|' + canon(raw));
      if (hit && hit.length === 1) { out.match = hit[0].code; out.score = 1; return out; }
    }
    const exact = byKey.get(canon(raw));
    if (exact && exact.length === 1) { out.match = exact[0].code; out.score = 1; return out; }
    if (exact && exact.length > 1 && parent) {
      const scoped = exact.filter((t) => t.parent && canon(t.parent) === canon(parent));
      if (scoped.length === 1) { out.match = scoped[0].code; out.score = 1; return out; }
    }

    // 2) similarity over all targets (scoped to parent when it disambiguates)
    let pool = targets;
    if (parent) {
      const scoped = targets.filter((t) => t.parent && canon(t.parent) === canon(parent));
      if (scoped.length) pool = scoped;
    }
    const scored = pool
      .map((t) => ({ code: t.code, name: t.name, parent: t.parent || '', score: dice(raw, t.name) }))
      .filter((c) => c.score >= CANDIDATE_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    out.candidates = scored;
    if (scored.length && scored[0].score >= AUTO_ACCEPT &&
        (scored.length === 1 || scored[0].score - scored[1].score > 0.1)) {
      out.match = scored[0].code;
      out.score = scored[0].score;
    }
    return out;
  });
}
