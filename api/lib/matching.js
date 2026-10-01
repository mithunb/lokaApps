// Name matching for admin-boundary joins — a JS port of the cascade proven in
// the deoria build scripts (build_boundaries.py): normalize → alias → dice
// similarity with a conservative auto-accept, everything else goes to the
// human fix-list (optionally pre-filled by a Gemini adjudication pass).

// Digits are KEPT. "Ward 12" and "Ward 7" are different places, and dropping the
// number let one silently take the other's rows. The python cascade this was
// ported from still drops them, but that script only ever ran over deoria's own
// digit-free village names, so the two agree on everything either has seen.
import { hasDevanagari, transliterate, variants, skeleton } from './devanagari.js';

/* A cell written in Hindi or Marathi script becomes its Latin spelling before
   the ascii squeeze below, which used to leave nothing of it. A cell written
   in BOTH — "Deoria / देवरिया" — keeps the English, which is what the boundary
   list is written in; joinByName tries the Devanagari half as well. Latin-only
   text never comes through here, so its key is exactly what it was. */
function latinOf(s) {
  const latin = s.replace(/[\u0900-\u097F]+/g, ' ');
  return /[a-zA-Z]/.test(latin) ? latin : transliterate(s);
}

export function norm(s) {
  s = String(s || '');
  if (hasDevanagari(s)) s = latinOf(s);
  return s
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

/* Every exact key a cell could be looked up under. One for Latin text, so
   nothing changes there. For Devanagari, the spellings English is known to
   use for the same letters (व as v or w, देव as deo, -िया as -ia, the unwritten
   a kept or dropped), each squeezed and aliased like a key of its own. */
export function spellings(raw) {
  const s = String(raw || '');
  const first = canon(s);
  if (!hasDevanagari(s)) return [first];
  const dev = s.replace(/[^\u0900-\u097F\s]+/g, ' ');
  const out = [first];
  for (const v of variants(dev)) {
    const k = canon(v);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/* Two parent names the same? Latin against Latin is the plain key; a
   Devanagari parent ("उत्तर प्रदेश") is compared on the skeleton, since its
   English spelling is not something a table can promise. */
function sameName(a, b) {
  const ka = canon(a), kb = canon(b);
  if (ka === kb) return true;
  if (!hasDevanagari(a) && !hasDevanagari(b)) return false;
  return spellings(a).some((k) => skeleton(k) === skeleton(kb));
}

/* Does a target sit inside the place a row's parent column names? Its own
   parent first; then the district it lies in, which boundaries finer than the
   atlas carry (area) so a district column can narrow a block's name even on
   a state-wide atlas. */
function inParent(t, parent) {
  return !!((t.parent && sameName(t.parent, parent)) || (t.area && sameName(t.area, parent)));
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
/* The floor for what the model may be OFFERED when nothing reached the
   candidate floor, and how many. A name that matched nothing still has a few
   look-alikes; the model chooses among them or says none — it never names a
   place that is not on this list. */
export const LOOSE_FLOOR = 0.3, LOOSE_MAX = 5;

/* Similarity of a cell to a target name. Latin cells: dice, as before. A
   Devanagari cell is scored on the skeleton as well — the lossy form both
   sides are reduced to — and the better of the two counts, because a
   transliteration is a guess at spelling and the skeleton forgives the
   guess where English itself is inconsistent. */
function similarity(raw, targetName, keys) {
  let best = dice(raw, targetName);
  if (hasDevanagari(raw)) {
    const ts = skeleton(canon(targetName));
    if (ts) for (const k of keys) best = Math.max(best, dice(skeleton(k), ts));
  }
  return best;
}

/**
 * Join table rows to boundary features by name.
 * targets: [{code, name, parent?}] — code is any stable id (lgd code / index).
 * Returns per-row: {row, name, match: code|null, score, candidates:[{code,name,parent,score}]}
 */
/* A unit whose name is a statement that it has none. geoBoundaries' finest
   Indian level carries 33 units called "Not under any CD block"; a row that
   says so is not naming them, and they must never be one of a name's
   candidates. */
const NO_NAME = /^not ?under ?any/;

export function joinByName(rows, nameCol, parentCol, targets, opts) {
  targets = targets.filter((t) => !NO_NAME.test(canon(t.name)));
  const results = joinRows(rows, nameCol, parentCol, targets);
  if (!(opts && opts.neighbours === false)) {
    const sum = settleByNeighbours(results, targets);
    // the area the confident rows cover, for the question screen's small map
    if (sum.home) Object.defineProperty(results, 'home', { value: sum.home.box.map((v) => +v.toFixed(3)) });
  }
  return results;
}

function joinRows(rows, nameCol, parentCol, targets) {
  const byKey = new Map();       // canon(name) -> targets[]
  const byCompound = new Map();  // canon(parent)|canon(name) -> targets[]
  const byLetters = new Map();   // lettersOnly(name) -> targets[], digit-free names only
  const bySkeleton = new Map();  // skeleton(canon(name)) -> targets[], consulted for Devanagari cells only
  const skel = (nm, t) => {
    const sk = skeleton(canon(nm));
    if (!sk) return;
    if (!bySkeleton.has(sk)) bySkeleton.set(sk, []);
    if (!bySkeleton.get(sk).includes(t)) bySkeleton.get(sk).push(t);
  };
  for (const t of targets) {
    /* A target may go by more than one name. Districts do not; ranges and
       reserves do, and the alternatives come from the source rather than
       being guessed here — "BRT Tiger Reserve" is how everybody writes the
       sanctuary whose official name is four words longer. Each alias is an
       EXACT key like the name itself, so this adds reach without adding
       fuzziness. */
    for (const alt of [t.name, ...(Array.isArray(t.aliases) ? t.aliases : [])]) {
      const ak = canon(alt);
      if (!ak || ak === canon(t.name)) continue;
      if (!byKey.has(ak)) byKey.set(ak, []);
      if (!byKey.get(ak).includes(t)) byKey.get(ak).push(t);
      skel(alt, t);
    }
    const k = canon(t.name);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(t);
    skel(t.name, t);
    if (!/[0-9]/.test(k)) {
      const lk = lettersOnly(t.name);
      if (lk) {
        if (!byLetters.has(lk)) byLetters.set(lk, []);
        byLetters.get(lk).push(t);
      }
    }
    for (const up of [t.parent, t.area]) {
      if (!up) continue;
      const ck = canon(up) + '|' + k;
      if (!byCompound.has(ck)) byCompound.set(ck, []);
      if (!byCompound.get(ck).includes(t)) byCompound.get(ck).push(t);
    }
  }

  return rows.map((row, idx) => {
    const raw = String(row[nameCol] ?? '').trim();
    const parent = parentCol ? String(row[parentCol] ?? '').trim() : '';
    const out = { row: idx, name: raw, match: null, score: 0, candidates: [] };
    if (!raw) return out;

    // 1) exact (compound first when a parent column exists). A Latin cell has
    // one key here; a Devanagari cell has each spelling English is known to
    // give it, tried in turn, the plain transliteration first.
    const keys = spellings(raw);
    const parentKeys = parent ? spellings(parent) : [];
    if (parent) {
      for (const pk of parentKeys) for (const k of keys) {
        const hit = byCompound.get(pk + '|' + k);
        if (hit && hit.length === 1) { out.match = hit[0].code; out.score = 1; return out; }
      }
    }
    for (const k of keys) {
      const exact = byKey.get(k);
      if (exact && exact.length === 1) { out.match = exact[0].code; out.score = 1; return out; }
      if (exact && exact.length > 1 && parent) {
        const scoped = exact.filter((t) => inParent(t, parent));
        if (scoped.length === 1) { out.match = scoped[0].code; out.score = 1; return out; }
        // the parent column narrowed it but not to one: those are the choice
        if (scoped.length > 1 && !out.same) out.same = scoped;
      }
      // one spelling, several places: settleByNeighbours may choose among them
      if (exact && exact.length > 1 && !out.same) out.same = exact;
    }

    // 1b) the data has a number and nothing is spelled that way: it may be a
    // serial number on a real name. Accept only when taking the digits out
    // lands on exactly ONE place that has no number of its own — so "Rampur 23"
    // still finds Rampur, while "Ward 12" can never take Ward 7's rows.
    if (/[0-9]/.test(canon(raw))) {
      const letters = byLetters.get(lettersOnly(raw));
      if (letters && letters.length === 1) { out.match = letters[0].code; out.score = 1; return out; }
    }

    // 1c) a Devanagari cell whose skeleton — the lossy form both scripts are
    // reduced to — is exactly one target's. "देवरिया" and "Deoria" meet here.
    // Several targets sharing it is a question for the fix list, not a guess.
    if (hasDevanagari(raw)) {
      const seen = new Set();
      let hits = [];
      for (const k of keys) {
        const sk = skeleton(k);
        if (!sk || seen.has(sk)) continue;
        seen.add(sk);
        for (const t of (bySkeleton.get(sk) || [])) if (!hits.includes(t)) hits.push(t);
      }
      if (hits.length > 1 && parent) {
        const scoped = hits.filter((t) => inParent(t, parent));
        if (scoped.length) hits = scoped;
      }
      if (hits.length === 1) { out.match = hits[0].code; out.score = 0.95; out.script = true; return out; }
      if (hits.length > 1) {
        out.candidates = hits.slice(0, 3).map((t) => ({ code: t.code, name: t.name, parent: t.parent || '', ...(t.area ? { area: t.area } : {}), score: 0.9 }));
        if (!out.same) out.same = hits;
        return out;
      }
    }

    // 2) similarity over all targets (scoped to parent when it disambiguates)
    let pool = targets;
    if (parent) {
      const scoped = targets.filter((t) => inParent(t, parent));
      if (scoped.length) pool = scoped;
    }
    const scored = pool
      .map((t) => ({ code: t.code, name: t.name, parent: t.parent || '', ...(t.area ? { area: t.area } : {}), score: similarity(raw, t.name, keys) }))
      .filter((c) => c.score >= LOOSE_FLOOR)
      .sort((a, b) => b.score - a.score);
    const firm = scored.filter((c) => c.score >= CANDIDATE_FLOOR).slice(0, 3);
    out.candidates = firm;
    if (firm.length && firm[0].score >= AUTO_ACCEPT &&
        (firm.length === 1 || firm[0].score - firm[1].score > 0.1)) {
      out.match = firm[0].code;
      out.score = firm[0].score;
    } else if (!firm.length && scored.length) {
      // nothing firm: the look-alikes a model may be asked to choose between
      out.loose = scored.slice(0, LOOSE_MAX);
    }
    return out;
  });
}

/* ---------- same-name places, settled by their neighbours ----------

   Ramnagar is eight places in India and Rampur is more. A sheet that says
   "Rampur" once among forty rows in one district almost always means the
   Rampur in that district, and the rest of the sheet says which district that
   is. Region inference (atlas.js, inferRegionFromNames) has worked this way for
   a while; the row join did not, so a shared name went straight to a
   question — or to the model, which sees only the names.

   The rule, in order:
     1. Confident rows: every row the cascade above placed on exactly one unit
        (the parent column has already narrowed what it could).
     2. Home area: the box around those rows' unit centres, padded by 0.25°
        (about 25 km). It needs at least three confident rows — two points
        make a line, not an area, and one wrong row would move it.
     3. A shared name with exactly ONE of its places inside the home area is
        put there, marked byNeighbours so the owner can check it in one tap.
     4. None inside, or two or more: it stays a question. Its places are
        ranked nearest the middle of the home area first, each with its
        distance, so the likeliest answer is the first one offered.
   With fewer than three confident rows nothing is placed; the places are
   still ordered, by which of them packs tightest with the other shared names.

   Measured on India's geoBoundaries by test/measure/same-name.mjs, 300
   sheets of 40 rows drawn from one district and its neighbours: 83% of the
   block-level rows with a shared name settle this way (3 wrong picks in
   804), 86% at the locality level (none wrong in 894). The rest are asked. */
export const HOME_PAD_DEG = 0.25, HOME_MIN_ROWS = 3;

export function centreOfGeometry(g) {
  if (!g || !g.coordinates) return null;
  let w = 180, s = 90, e = -180, n = -90, any = false;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      any = true;
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else for (const x of c) walk(x);
  })(g.coordinates);
  return any ? [(w + e) / 2, (s + n) / 2] : null;
}

export function kmBetween(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// the box around the confident centres, padded; null below the minimum
export function homeArea(centres) {
  const pts = centres.filter(Boolean);
  if (pts.length < HOME_MIN_ROWS) return null;
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const box = [w - HOME_PAD_DEG, s - HOME_PAD_DEG, e + HOME_PAD_DEG, n + HOME_PAD_DEG];
  return { box, centre: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], rows: pts.length };
}

/* Nothing confident to stand on: try each place of the most-repeated shared
   name as the anchor, let every other shared name fall to its nearest place,
   and keep the anchor that packs them tightest (region inference's fallback,
   anchorFromSpread, on the row join's own shapes). */
function anchorFromSpread(groups) {
  let seed = null;
  for (const g of groups) if (!seed || g.rows > seed.rows) seed = g;
  if (!seed) return null;
  let best = null, bestCost = Infinity;
  for (const c of seed.places.slice(0, 12)) {
    if (!c.at) continue;
    let cost = 0;
    for (const g of groups) {
      let near = Infinity;
      for (const p of g.places) if (p.at) near = Math.min(near, (p.at[0] - c.at[0]) ** 2 + (p.at[1] - c.at[1]) ** 2);
      if (Number.isFinite(near)) cost += near * g.rows;
    }
    if (cost < bestCost) { bestCost = cost; best = c.at; }
  }
  return best;
}

export function settleByNeighbours(results, targets) {
  const at = new Map();
  const centre = (t) => {
    if (!at.has(t.code)) at.set(t.code, t.centre || centreOfGeometry(t.geometry));
    return at.get(t.code);
  };
  const byCode = new Map(targets.map((t) => [String(t.code), t]));
  const confident = results.filter((r) => r.match != null).map((r) => byCode.get(String(r.match))).filter(Boolean).map(centre);
  const home = homeArea(confident);
  const open = results.filter((r) => r.match == null && Array.isArray(r.same) && r.same.length > 1);
  const inBox = (p, b) => !!p && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

  // one group per name: "same for all rows with this name" is the default
  const groups = new Map();
  for (const r of open) {
    const key = r.same.map((t) => t.code).sort().join(',');
    if (!groups.has(key)) groups.set(key, { rows: 0, members: [], places: r.same.map((t) => ({ t, at: centre(t) })) });
    const g = groups.get(key);
    g.rows++; g.members.push(r);
  }
  const anchor = home ? home.centre : anchorFromSpread([...groups.values()]);

  for (const g of groups.values()) {
    const ranked = g.places.map((p) => ({
      code: p.t.code, name: p.t.name, parent: p.t.parent || '', ...(p.t.area ? { area: p.t.area } : {}), score: 1,
      inside: !!(home && inBox(p.at, home.box)),
      km: home && p.at ? Math.round(kmBetween(p.at, home.centre)) : null,
      at: p.at ? [+p.at[0].toFixed(3), +p.at[1].toFixed(3)] : null,
      _d: anchor && p.at ? (p.at[0] - anchor[0]) ** 2 + (p.at[1] - anchor[1]) ** 2 : Infinity,
    })).sort((a, b) => a._d - b._d);
    for (const c of ranked) delete c._d;
    const inside = ranked.filter((c) => c.inside);
    for (const r of g.members) {
      r.candidates = ranked.map((c) => ({ ...c }));
      r.sameName = true;
      if (inside.length === 1) {
        r.match = inside[0].code;
        r.score = 1;
        r.byNeighbours = true;
      }
    }
  }
  for (const r of results) delete r.same;
  return { home, settled: open.filter((r) => r.byNeighbours).length, asked: open.filter((r) => !r.byNeighbours).length };
}

/* ---------- the model as a last resort, on a short leash ----------

   Plain matching first; only what it could not place goes to the model, and
   the model is handed NAMES, never rows: each unplaced name with the short
   list of boundaries it might be, and it may pick from that list or say none.
   It cannot name a place of its own. Whatever it picks is applied as a
   SUGGESTION — placed, but marked for the owner to confirm — because a model
   choosing between two Raigarhs is guessing, however confidently. Both halves
   are pure so the leash can be checked without a key. */
export const FALLBACK_MAX = 40;

// what to ask: [{sourceName, candidates:[{code, name, parent}]}] — nothing else
export function fallbackRequest(report) {
  const out = [], seen = new Set();
  const take = (entry, list) => {
    if (!entry || !entry.name || !Array.isArray(list) || !list.length) return;
    const name = String(entry.name);
    if (seen.has(name)) return;
    seen.add(name);
    out.push({
      sourceName: name,
      candidates: list.map((c) => ({ code: String(c.code), name: String(c.name || ''), parent: String(c.parent || '') })),
    });
  };
  for (const a of (report && report.ambiguous) || []) take(a, a.candidates);
  for (const u of (report && report.unmatched) || []) take(u, u.loose);
  return out.slice(0, FALLBACK_MAX);
}

// what to keep of the answer: {row: code}, only where the code was offered for that name
export function applyFallback(report, answer) {
  const chosen = {};
  const offered = new Map(fallbackRequest(report).map((q) => [q.sourceName, new Set(q.candidates.map((c) => c.code))]));
  for (const mt of (answer && Array.isArray(answer.matches) ? answer.matches : [])) {
    if (!mt || !mt.chosenCode) continue;
    const name = String(mt.sourceName), code = String(mt.chosenCode);
    const ok = offered.get(name);
    if (!ok || !ok.has(code)) continue;
    for (const list of [report.ambiguous || [], report.unmatched || []]) {
      for (const e of list) if (String(e.name) === name && Number.isInteger(e.row)) chosen[e.row] = code;
    }
  }
  return chosen;
}
