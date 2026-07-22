// Column profiling for uploaded tables — pure code, no model calls.
// The compact profile (not the full table) is what goes into the Gemini prompt.
import { detectDelimiter, primaryToken, splitTokens } from './fragment.js';

const BOOL_RE = /^(true|false|yes|no)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

export function profileColumns(columns, rows) {
  return columns.map((name) => {
    const vals = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '');
    const bools = vals.filter((v) => typeof v === 'boolean' || BOOL_RE.test(String(v).trim()));
    const allBool = vals.length > 0 && bools.length === vals.length;
    const dates = vals.filter((v) => DATE_RE.test(String(v).trim()));
    const allDate = vals.length > 0 && dates.length === vals.length;
    const nums = vals.filter((v) => typeof v !== 'boolean').map(Number).filter((n) => Number.isFinite(n));
    const allNumeric = !allBool && vals.length > 0 && nums.length === vals.length;
    const distinct = new Set(vals.map((v) => String(v).trim().toLowerCase()));
    const strVals = vals.map(String);
    const avgLen = strVals.length ? strVals.reduce((a, s) => a + s.length, 0) / strVals.length : 0;
    const p = {
      name,
      type: allBool ? 'boolean' : allDate ? 'date' : allNumeric ? 'number' : 'string',
      filled: vals.length,
      nullShare: rows.length ? +(1 - vals.length / rows.length).toFixed(2) : 1,
      distinct: distinct.size,
      samples: [...new Set(strVals)].slice(0, 5).map((s) => s.slice(0, 60)),
    };
    if (allNumeric) {
      p.min = Math.min(...nums);
      p.max = Math.max(...nums);
      p.looksLikeLat = p.min >= -90 && p.max <= 90 && /lat/i.test(name);
      p.looksLikeLng = p.min >= -180 && p.max <= 180 && /(lon|lng)/i.test(name);
      // heuristics also fire on plausible ranges without a name hint
      if (!p.looksLikeLat && p.min >= 6 && p.max <= 38 && distinct.size > 3) p.maybeLatIndia = true;
      if (!p.looksLikeLng && p.min >= 68 && p.max <= 98 && distinct.size > 3) p.maybeLngIndia = true;
    } else {
      p.looksLikeName = avgLen >= 3 && avgLen <= 40 && distinct.size > Math.min(3, rows.length - 1);
      const IMG_RE = /^https:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i;
      const imgs = strVals.filter((s) => IMG_RE.test(s.trim()));
      p.looksLikeImage = vals.length > 0 && imgs.length / vals.length >= 0.6;

      // multi-value cells ("Culture; Heritage") colour by the PRIMARY tag, so
      // cardinality is measured on primary tokens, not whole-string combos
      const delim = p.looksLikeImage ? null : detectDelimiter(strVals);
      p.multiValue = delim ? { delimiter: delim } : null;
      const primaries = new Set(strVals.map((s) => primaryToken(s, delim).toLowerCase()).filter(Boolean));
      const primaryCard = delim ? primaries.size : distinct.size;
      const enough = vals.length >= Math.max(4, rows.length * 0.5);
      // low-cardinality strings colour a map better than any number — but only
      // when values actually repeat (distinct < filled), else it's id-like
      p.categorical = p.type === 'string' && !p.looksLikeImage && enough &&
        primaryCard >= 2 && primaryCard <= (delim ? 12 : 8) &&
        primaryCard < vals.length && (delim || avgLen <= 40);
      // a high-cardinality delimited column is a TAG SET (e.g. labels): rich for
      // popups/filtering, useless for colouring — flag so it lands in popups
      if (delim && !p.categorical) {
        const tokens = new Set();
        let tokLen = 0, tokN = 0;
        strVals.forEach((s) => splitTokens(s, delim).forEach((t) => { tokens.add(t.toLowerCase()); tokLen += t.length; tokN++; }));
        p.tagList = tokens.size > 12 && tokN > 0 && tokLen / tokN <= 30;
      }
    }
    return p;
  });
}

// Best name-column guess by join hit-rate against boundary names — used by the
// no-Gemini fallback to pre-fill the manual pickers.
export function bestNameColumn(profiles, rows, boundaryNames, normFn) {
  const normed = new Set(boundaryNames.map(normFn));
  let best = null, bestRate = 0;
  for (const p of profiles) {
    if (p.type !== 'string') continue;
    const vals = rows.map((r) => r[p.name]).filter(Boolean);
    if (!vals.length) continue;
    const hits = vals.filter((v) => normed.has(normFn(String(v)))).length;
    const rate = hits / vals.length;
    if (rate > bestRate) { bestRate = rate; best = p.name; }
  }
  return { column: best, rate: bestRate };
}
