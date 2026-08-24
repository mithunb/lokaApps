// Constrained layer-spec → manifest fragment. Gemini only ever fills the spec
// (enums + column names); THIS code builds the actual stanza, so the dangerous
// manifest surface (tile URLs, raster types, raw expressions) is unreachable.

// Curated ramps in the atlas's rustic-pastel register (light → dark). The
// single-hue sequential ramps stay readable with any colour-vision deficiency
// because lightness — not hue — carries the order. The diverging pair runs
// brown↔teal: red↔green diverging ramps collapse either side of their midpoint
// for deuteranopes (the two middle classes of the old rdylgn were 4.4 ΔE00
// apart once simulated, i.e. the same colour).
export const PALETTES = {
  greens: ['#e7e3d8', '#cdd3b4', '#a9bd8e', '#7f9c65', '#566f42', '#39502f'],
  blues: ['#e6ebec', '#c2d2d8', '#93b1bd', '#6690a1', '#446e80', '#2d4f5e'],
  rust: ['#f0e6dd', '#e0c4ab', '#cb9c77', '#b06f47', '#8f4d2c', '#6e371d'],
  ylorbr: ['#efe6d9', '#ddc4a0', '#caa06f', '#a8703f', '#824e26', '#5e3618'],
  brteal: ['#8a5a25', '#bb8f4e', '#e2cfa4', '#9fc7bd', '#4e8f86', '#2c625d'],
  tealbr: ['#2c625d', '#4e8f86', '#9fc7bd', '#e2cfa4', '#bb8f4e', '#8a5a25'],
  purples: ['#e9e4ea', '#cfc3d4', '#ac97b6', '#8a6e96', '#6a4d75', '#4c3454'],
};
// Retired ramp names keep resolving, at the same polarity (low → high), so a
// spec saved before the swap still applies instead of silently falling back.
export const PALETTE_ALIASES = { rdylgn: 'brteal', gnrd: 'tealbr' };
export function rampFor(name) {
  return PALETTES[name] || PALETTES[PALETTE_ALIASES[name]] || PALETTES.greens;
}
// Named single colours a HUMAN picks for a whole layer — brand choices, not
// auto-assignment, so they stay exactly as chosen.
export const MARKER_COLORS = {
  rust: '#A6522F', moss: '#40573D', ochre: '#B0863A', sienna: '#9C5A34', slate: '#5f7f92',
};
// AUTO-assigned categorical palette: Paul Tol's colourblind-safe "muted" scheme
// (indigo, olive, teal, purple, green, wine, cyan, sand — its rose is left out
// because it lands on the neutral used for "other" under protanopia). Ordered so
// (a) every prefix stays distinct, since a layer with k categories only uses
// slots 1..k, and (b) the two palest colours come last — the cream page/basemap
// (#FFFAEB family) swallows them. Checked with Viénot-Brettel dichromacy
// simulation + CIEDE2000: worst pair 14.5 ΔE00 under deuteranopia and 15.0
// under protanopia (the previous earth palette collapsed to 1.4).
export const CATEGORY_COLORS = ['#332288', '#999933', '#44AA99', '#AA4499', '#117733', '#882255', '#88CCEE', '#DDCC77'];
// warm grey for the residual bucket: ≥14.5 ΔE00 from all eight in every mode.
export const CATEGORY_OTHER = '#7a756c';
export const MAX_CATEGORIES = 8;
export const KINDS = ['markers', 'choropleth', 'line', 'polygon', 'category', 'bubble'];
const MAX_TOTAL_VERTICES = 300000;
const CAT_KEY = '_category';   // derived per-feature primary tag (multi-value columns)

// Multi-value cells like "Culture; Heritage" or "a, b, c". Returns the separator
// if a strong majority of values carry it, else null. ';' wins over ',' (commas
// appear in prose/addresses). Shared by profiling (which column is categorical)
// and rendering (how to colour it) so both agree.
export function detectDelimiter(values) {
  const n = values.length;
  if (!n) return null;
  for (const d of [';', ',']) {
    if (values.filter((v) => String(v).includes(d)).length >= n * 0.4) return d;
  }
  return null;
}
export function primaryToken(value, delim) {
  const s = String(value);
  if (!delim) return s.trim();
  const i = s.indexOf(delim);
  return (i < 0 ? s : s.slice(0, i)).trim();
}
export function splitTokens(value, delim) {
  if (!delim) return [String(value).trim()].filter(Boolean);
  return String(value).split(delim).map((t) => t.trim()).filter(Boolean);
}

// Only SHORT, single-line, name-like values belong drawn on the map face.
// Long/descriptive text (a `description` column) must stay in the popup — on the
// map it overlaps into an unreadable mess. Decides whether a title column may be
// used as an on-map label_text.
export function isMapLabelColumn(feats, col) {
  if (!col) return false;
  const vals = feats.map((f) => (f.properties ? f.properties[col] : undefined))
    .filter((v) => v !== undefined && v !== null && v !== '').map(String);
  if (!vals.length) return false;
  const avg = vals.reduce((a, s) => a + s.length, 0) / vals.length;
  const anyLong = vals.some((s) => s.length > 40 || /[\r\n]/.test(s));
  return avg <= 25 && !anyLong;
}

// Above this many points a layer is drawn as plain circles instead of pins, which
// costs it the badges, the rows of shapes, the hover and the fan-out. It was 300
// on the assertion that "DOM markers don't scale past this"; nobody had measured
// it. Measured now, on a grid of pins each carrying three rows of shapes:
//
//     300   ~5,700 pieces of page    comfortable
//   1,000  ~19,000                   comfortable
//   3,000  ~57,000                   moves, with the odd visible hitch
//   6,000 ~114,000                   collapses
//
// So the cliff sits between 3,000 and 6,000, and 300 was about ten times more
// cautious than it needed to be. 3,000 is deliberately the same number the upload
// warns about, so the two agree: at 3,001 rows a person is told the map may feel
// slow AND gets circles, rather than being silently given circles at 301.
const MAX_CIRCLE_SWITCH = Number(process.env.ATLAS_MAX_PINS) || 3000;
const CLASS_MIN = 3, CLASS_MAX = 7;
const BUBBLE_MIN_R = 4, BUBBLE_MAX_R = 26;   // px — the proportional-symbol range

// Largest "nice" number (1/2/5 × 10^k) not above x — legend reference values.
function niceBelow(x) {
  if (!(x > 0)) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / pow;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * pow;
}

export function slugifyId(text) {
  const s = String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'layer';
}

export function quantileBreaks(values, classes) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const n = Math.max(CLASS_MIN, Math.min(CLASS_MAX, classes || 5));
  const breaks = [];
  for (let i = 1; i < n; i++) {
    const q = v[Math.min(v.length - 1, Math.floor((v.length * i) / n))];
    if (!breaks.length || q > breaks[breaks.length - 1]) breaks.push(q);
  }
  return breaks;
}

function fmt(x) {
  if (Math.abs(x) >= 1000) return Math.round(x).toLocaleString('en-IN');
  if (Math.abs(x) >= 10) return String(Math.round(x * 10) / 10);
  return String(Math.round(x * 100) / 100);
}

/**
 * Build a manifest layer stanza from a validated spec + the transformed data.
 * spec: {kind, label, group, subgroup?, valueColumn?, unit?, palette?, reverse?,
 *        classCount?, markerColor?, popupTitleColumn?, popupColumns?}
 * feats: GeoJSON features carrying the (whitelisted) properties.
 * Returns {stanza, sourceFile, kindUsed}.
 */
export function buildFragment(spec, feats, existingIds) {
  const kind = KINDS.includes(spec.kind) ? spec.kind : 'markers';
  let id = slugifyId(spec.label);
  let i = 2;
  while (existingIds.includes(id)) id = slugifyId(spec.label) + '-' + i++;
  const sourceFile = 'user-' + id + '.geojson';
  // contributed layers default to their own "Your data" group, not a themed one
  const group = ['base', 'agri', 'eco', 'userdata'].includes(spec.group) ? spec.group : 'userdata';

  const sampleVals = (col) => feats.slice(0, 200)
    .map((f) => (f.properties ? f.properties[col] : undefined))
    .filter((v) => v !== undefined && v !== null && v !== '').map(String);

  const popup = { title: null, fields: [] };
  // The stanza must describe the data it ships with, not the data the spec
  // remembers: a title column that was renamed or dropped upstream produced
  // popups that opened as an empty white box. Only a column the features
  // actually carry may be the title; failing that, fall back to the most
  // readable text column on board.
  const colsAboard = Object.keys((feats[0] && feats[0].properties) || {});
  const hasCol = (c) => c && colsAboard.includes(String(c)) && sampleVals(String(c)).length > 0;
  if (hasCol(spec.popupTitleColumn)) popup.title = String(spec.popupTitleColumn);
  // a photo column renders as an image at the top of the popup
  if (spec.imageColumn) popup.fields.push({ label: prettify(spec.imageColumn), property: String(spec.imageColumn), type: 'image' });
  for (const c of (spec.popupColumns || []).slice(0, 6)) {
    if (c === popup.title || c === spec.imageColumn) continue;
    if (!hasCol(c)) continue;   // a field the data no longer carries says nothing
    const fld = { label: prettify(c), property: String(c) };
    // ';'-delimited columns (labels, categories) render as tag chips — ';' is a
    // deliberate tag separator; commas stay plain text (prose, addresses)
    if (detectDelimiter(sampleVals(c)) === ';') fld.type = 'tags';
    popup.fields.push(fld);
  }
  if (!popup.title && !popup.fields.length) {
    // Nothing the spec asked for survived. A pin that answers a tap with
    // silence reads as broken, so show what the rows really hold: readable
    // columns, tag-like ones first, never coordinates, ids or engine columns.
    const looksNumeric = (vals) => vals.length > 0 && vals.every((v) => v !== '' && !Number.isNaN(Number(v)));
    const candidates = colsAboard.filter((c) => {
      if (c.startsWith('_')) return false;
      if (/^(lat|latitude|lng|lon|long|longitude|x|y)$/i.test(c)) return false;
      const vals = sampleVals(c);
      if (!vals.length) return false;
      if (looksNumeric(vals)) return false;
      if (/(^|_)(id|uuid|guid)$/i.test(c)) return false;
      if (vals.every((v) => /^https?:\/\//i.test(v))) return false;
      return true;
    });
    const tagish = (c) => (detectDelimiter(sampleVals(c)) === ';' ? 0 : 1);
    candidates.sort((a, b) => tagish(a) - tagish(b));
    popup.title = candidates.find((c) => tagish(c) === 1) || null;
    for (const c of candidates.slice(0, 5)) {
      if (c === popup.title) continue;
      const fld = { label: prettify(c), property: String(c) };
      if (detectDelimiter(sampleVals(c)) === ';') fld.type = 'tags';
      popup.fields.push(fld);
    }
  }

  let stanza;
  let derivedKeys = [];
  if (kind === 'category') {
    // colour by the observed distinct values of a column — the values come from
    // the data itself (ordered by frequency), never generated
    const prop = String(spec.categoryColumn || '');
    // multi-value columns ("Culture; Heritage") colour by their PRIMARY tag —
    // derived per-feature in code (not the LLM), stored on a hidden property so
    // MapLibre's match can hit an exact value
    const delim = detectDelimiter(feats.map((f) => (f.properties ? f.properties[prop] : '')).filter(Boolean).map(String));
    const matchProp = delim ? CAT_KEY : prop;
    const counts = new Map();
    for (const f of feats) {
      const v = f.properties ? f.properties[prop] : undefined;
      if (v === undefined || v === null || v === '') continue;
      const rep = (delim ? primaryToken(v, delim) : String(v)).slice(0, 40);
      if (!rep) continue;
      if (delim) f.properties[CAT_KEY] = rep;
      counts.set(rep, (counts.get(rep) || 0) + 1);
    }
    if (delim) derivedKeys = [CAT_KEY];
    const values = [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const kept = values.slice(0, MAX_CATEGORIES);
    let color;
    if (kept.length) {
      color = ['match', ['to-string', ['get', matchProp]]];
      kept.forEach((v, i) => { color.push(v, CATEGORY_COLORS[i % CATEGORY_COLORS.length]); });
      color.push(CATEGORY_OTHER);
    } else {
      color = CATEGORY_OTHER;   // empty column — still renders, just unclassed
    }
    const gt = feats.length && feats[0].geometry ? feats[0].geometry.type : 'Point';
    const shape = /LineString/.test(gt) ? 'line' : /Point/.test(gt) ? 'dot' : undefined;
    // categorical:true tells the viewer to derive an icon/badge per value
    // (colour + icon reinforce each other — the agreed default)
    const legend = kept.map((v, i) => {
      const it = { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length], label: v, categorical: true };
      if (shape) it.shape = shape;
      return it;
    });
    if (values.length > kept.length || !kept.length) {
      const it = { color: CATEGORY_OTHER, label: 'other', categorical: true };
      if (shape) it.shape = shape;
      legend.push(it);
    }
    const base = {
      id, group, source: sourceFile,
      label: String(spec.label).slice(0, 60), default: true,
      legend,
      popup: { title: popup.title || 'name', fields: popup.fields },
      userLayer: true,
    };
    if (/Point/.test(gt) && feats.length <= MAX_CIRCLE_SWITCH) {
      // within the pin budget → marker pins, which can carry a colour per kind and
      // the rows of shapes beside them (see MAX_CIRCLE_SWITCH above)
      const markers = {};
      kept.forEach((v, i) => { markers[v] = { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }; });
      stanza = { ...base, type: 'marker', markerBy: matchProp, markers,
        markerDefault: { color: CATEGORY_OTHER }, categoryIcons: true,
        label_text: (popup.title && isMapLabelColumn(feats, popup.title)) ? { property: popup.title } : undefined };
    } else if (/Point/.test(gt)) {
      stanza = { ...base, type: 'circle',
        paint: { radius: 5, color, strokeColor: '#ffffff', strokeWidth: 1.2 } };
    } else if (/LineString/.test(gt)) {
      stanza = { ...base, type: 'line',
        paint: { color, width: Math.min(6, Math.max(0.5, Number(spec.lineWidth) || 2.5)), opacity: 0.9 } };
    } else {
      stanza = { ...base, type: 'fill',
        paint: { fillColor: color, fillOpacity: Math.min(0.9, Math.max(0.15, Number(spec.fillOpacity) || 0.55)),
                 outlineColor: '#5c544a', outlineWidth: 0.5 } };
    }
  } else if (kind === 'line') {
    const color = MARKER_COLORS[spec.lineColor] || MARKER_COLORS[spec.markerColor] || MARKER_COLORS.rust;
    const width = Math.min(6, Math.max(0.5, Number(spec.lineWidth) || 2));
    const paint = { color, width, opacity: 0.9 };
    if (spec.lineDash) paint.dash = [2, 1.6];
    stanza = {
      id, group, type: 'line', source: sourceFile,
      label: String(spec.label).slice(0, 60), default: true,
      paint,
      legend: [{ color, label: String(spec.label).slice(0, 40), shape: spec.lineDash ? 'dashed' : 'line' }],
      popup: { title: popup.title || 'name', fields: popup.fields },
      userLayer: true,
    };
  } else if (kind === 'polygon') {
    const color = MARKER_COLORS[spec.fillColor] || MARKER_COLORS[spec.markerColor] || MARKER_COLORS.moss;
    const fillOpacity = Math.min(0.9, Math.max(0.15, Number(spec.fillOpacity) || 0.45));
    const paint = { fillColor: color, fillOpacity };
    if (spec.outline !== false) { paint.outlineColor = '#5c544a'; paint.outlineWidth = 0.8; }
    stanza = {
      id, group, type: 'fill', source: sourceFile,
      label: String(spec.label).slice(0, 60), default: true,
      paint,
      legend: [{ color, label: String(spec.label).slice(0, 40) }],
      popup: { title: popup.title || 'name', fields: popup.fields },
      userLayer: true,
    };
  } else if (kind === 'choropleth') {
    const prop = String(spec.valueColumn || '');
    const values = feats.map((f) => Number(f.properties[prop])).filter(Number.isFinite);
    const ramp = rampFor(spec.palette);
    const colors = spec.reverse ? [...ramp].reverse() : ramp;
    const breaks = quantileBreaks(values, spec.classCount);
    const used = colors.slice(0, breaks.length + 1);
    const expr = ['step', ['get', prop], used[0]];
    breaks.forEach((b, j) => { expr.push(b, used[j + 1]); });
    const legend = used.map((color, j) => ({
      color,
      label: j === 0 ? '< ' + fmt(breaks[0] != null ? breaks[0] : 0)
        : j === used.length - 1 ? '≥ ' + fmt(breaks[j - 1])
        : fmt(breaks[j - 1]) + '–' + fmt(breaks[j]),
    }));
    if (spec.unit) legend.push({ color: 'transparent', label: '(' + String(spec.unit).slice(0, 20) + ')', faint: true });
    stanza = {
      id, group, type: 'fill', source: sourceFile,
      label: String(spec.label).slice(0, 60), default: true,
      paint: { fillColor: expr, fillOpacity: 0.72, outlineColor: '#5c544a', outlineWidth: 0.5 },
      legend,
      popup: { title: popup.title || 'name', fields: popup.fields },
      userLayer: true,
    };
  } else if (kind === 'bubble') {
    // proportional symbols: the circle's AREA carries the number, so radius
    // follows sqrt(value) — the honest encoding for absolute counts (shading
    // suits rates and averages). Fixed pixel radii, so bubbles keep their
    // meaning at every zoom instead of swallowing the map when zoomed out.
    const prop = String(spec.valueColumn || '');
    const color = MARKER_COLORS[spec.markerColor] || MARKER_COLORS.rust;
    const values = feats.map((f) => Number(f.properties ? f.properties[prop] : NaN))
      .filter((v) => Number.isFinite(v) && v > 0);
    const vmax = values.length ? Math.max(...values) : 0;
    const radius = vmax > 0
      ? ['interpolate', ['linear'],
         ['sqrt', ['max', 0, ['to-number', ['get', prop], 0]]],
         0, BUBBLE_MIN_R, Math.sqrt(vmax), BUBBLE_MAX_R]
      : 5;   // no usable numbers — plain dots beat a broken expression
    // three reference circles for the size legend: the max and two nice round
    // values below it (quarter / sixteenth of max → clearly distinct radii)
    const sizeLegend = [];
    if (vmax > 0) {
      const seen = new Set();
      for (const v of [vmax, vmax / 4, vmax / 16]) {
        const nice = niceBelow(v);
        if (nice <= 0 || seen.has(nice)) continue;
        seen.add(nice);
        sizeLegend.push({
          radius: Math.round((BUBBLE_MIN_R + (BUBBLE_MAX_R - BUBBLE_MIN_R) * Math.sqrt(nice / vmax)) * 10) / 10,
          label: fmt(nice),
          color,
        });
      }
    }
    stanza = {
      id, group, type: 'circle', source: sourceFile,
      label: String(spec.label).slice(0, 60), default: true,
      paint: { radius, color, strokeColor: '#ffffff', strokeWidth: 1, opacity: 0.75 },
      sizeLegend: sizeLegend.length ? sizeLegend : undefined,
      // the unit rides the ordinary legend as a faint note, like choropleth's
      legend: spec.unit ? [{ color: 'transparent', label: '(' + String(spec.unit).slice(0, 20) + ')', faint: true }] : undefined,
      popup: { title: popup.title || 'name', fields: popup.fields },
      userLayer: true,
    };
  } else {
    const color = MARKER_COLORS[spec.markerColor] || MARKER_COLORS.rust;
    if (feats.length > MAX_CIRCLE_SWITCH) {
      stanza = {
        id, group, type: 'circle', source: sourceFile,
        label: String(spec.label).slice(0, 60), default: true,
        paint: { radius: 4.5, color, strokeColor: '#ffffff', strokeWidth: 1.2 },
        legend: [{ color, label: String(spec.label).slice(0, 40), shape: 'dot' }],
        popup: { title: popup.title || 'name', fields: popup.fields },
        userLayer: true,
      };
    } else {
      stanza = {
        id, group, type: 'marker', source: sourceFile,
        label: String(spec.label).slice(0, 60), default: true,
        marker: { color },
        // long/descriptive titles stay in the popup, never drawn on the map
        label_text: (popup.title && isMapLabelColumn(feats, popup.title)) ? { property: popup.title } : undefined,
        legend: [{ color, label: String(spec.label).slice(0, 40), shape: 'dot' }],
        popup: { title: popup.title || 'name', fields: popup.fields },
        userLayer: true,
      };
    }
  }
  if (spec.subgroup) stanza.subgroup = String(spec.subgroup).slice(0, 30);
  return { stanza, sourceFile, kindUsed: stanza.type, derivedKeys };
}

function prettify(col) {
  return String(col).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\w/, (c) => c.toUpperCase()).slice(0, 40);
}

/* ---------------- sanitisation ---------------- */

const MAX_FEATURES = 5000;
const MAX_STR = 500;

/** Whitelist-copy properties onto null-prototype objects; validate coords.
    outsideAction 'drop' removes points beyond the padded atlas bounds instead
    of only counting them — a visible Check-step decision, not a silent one. */
export function sanitizeFeatures(feats, keepProps, bounds, outsideAction) {
  const out = [];
  let outside = 0, totalVerts = 0;
  const pad = bounds ? padBounds(bounds, 0.5) : null;
  for (const f of feats.slice(0, MAX_FEATURES)) {
    if (!f || !f.geometry) continue;
    if (!validGeom(f.geometry)) continue;
    if (pad) {
      // points by position, lines/polygons by their bbox centre
      const [x, y] = f.geometry.type === 'Point' ? f.geometry.coordinates : bboxCenter(f.geometry);
      if (x < pad[0] || x > pad[2] || y < pad[1] || y > pad[3]) {
        outside++;
        if (outsideAction === 'drop') continue;
      }
    }
    totalVerts += countVerts(f.geometry);
    if (totalVerts > MAX_TOTAL_VERTICES) break;
    const props = Object.create(null);
    for (const k of keepProps) {
      const v = f.properties ? f.properties[k] : undefined;
      if (v === undefined || v === null) continue;
      props[k] = typeof v === 'number' && Number.isFinite(v) ? v : String(v).slice(0, MAX_STR);
    }
    out.push({ type: 'Feature', properties: { ...props }, geometry: f.geometry });
  }
  return { features: out, outside, dropped: feats.length - out.length };
}

function padBounds(b, frac) {
  // manifest bounds are [[w,s],[e,n]]
  const w = b[0][0], s = b[0][1], e = b[1][0], n = b[1][1];
  const dx = (e - w) * frac, dy = (n - s) * frac;
  return [w - dx, s - dy, e + dx, n + dy];
}

function bboxCenter(g) {
  let w = 180, s = 90, e = -180, n = -90;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  })(g.coordinates);
  return [(w + e) / 2, (s + n) / 2];
}

function countVerts(g) {
  let n = 0;
  (function walk(c) {
    if (typeof c[0] === 'number') { n++; return; }
    c.forEach(walk);
  })(g.coordinates);
  return n;
}

function validGeom(g) {
  if (!g || typeof g !== 'object') return false;
  if (!['Point', 'MultiPoint', 'Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(g.type)) return false;
  let ok = true, count = 0;
  (function walk(c) {
    if (!ok || !Array.isArray(c)) { ok = false; return; }
    if (typeof c[0] === 'number') {
      count++;
      if (c.length < 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) ||
          c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
    } else c.forEach(walk);
  })(g.coordinates);
  return ok && count > 0 && count < 200000;
}
