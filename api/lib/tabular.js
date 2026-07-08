// Column profiling for uploaded tables — pure code, no model calls.
// The compact profile (not the full table) is what goes into the Gemini prompt.

export function profileColumns(columns, rows) {
  return columns.map((name) => {
    const vals = rows.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '');
    const nums = vals.map(Number).filter((n) => Number.isFinite(n));
    const allNumeric = vals.length > 0 && nums.length === vals.length;
    const distinct = new Set(vals.map((v) => String(v).trim().toLowerCase()));
    const strVals = vals.map(String);
    const avgLen = strVals.length ? strVals.reduce((a, s) => a + s.length, 0) / strVals.length : 0;
    const p = {
      name,
      type: allNumeric ? 'number' : 'string',
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
