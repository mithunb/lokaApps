// Name matching for admin-boundary joins — a JS port of the cascade proven in
// the deoria build scripts (build_boundaries.py): normalize → alias → dice
// similarity with a conservative auto-accept, everything else goes to the
// human fix-list (optionally pre-filled by a Gemini adjudication pass).

// Digits are KEPT. "Ward 12" and "Ward 7" are different places, and dropping the
// number let one silently take the other's rows. The python cascade this was
// ported from still drops them, but that script only ever ran over deoria's own
// digit-free village names, so the two agree on everything either has seen.
export function norm(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// The same name with the digits taken out. Used for ONE narrowly-scoped fallback
// in joinByName: a number in someone's data may be a serial number stuck onto a
// real name — "Rampur 23" for the 23rd row about Rampur. Ignoring it is only
// safe when the place it would match carries no number of its own.
export function lettersOnly(s) {
  return norm(s).replace(/[0-9]/g, '');
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
  const byLetters = new Map();   // lettersOnly(name) -> targets[], digit-free names only
  for (const t of targets) {
    const k = canon(t.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
    if (!/[0-9]/.test(k)) {
      const lk = lettersOnly(t.name);
      if (lk) {
        if (!byLetters.has(lk)) byLetters.set(lk, []);
        byLetters.get(lk).push(t);
      }
    }
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

    // 1b) the data has a number and nothing is spelled that way: it may be a
    // serial number on a real name. Accept only when taking the digits out
    // lands on exactly ONE place that has no number of its own — so "Rampur 23"
    // still finds Rampur, while "Ward 12" can never take Ward 7's rows.
    if (/[0-9]/.test(canon(raw))) {
      const letters = byLetters.get(lettersOnly(raw));
      if (letters && letters.length === 1) { out.match = letters[0].code; out.score = 1; return out; }
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
