// Six decimal places for every coordinate a contributed layer writes.
//
// The map builder (api/atlas-builders/common.py, COORD_DP) already trims the
// layers it draws to six decimals: about 11 cm of latitude, finer than one
// pixel at zoom 19, the closest this product ever goes. Layers added through
// the upload flow skipped that step and kept whatever the spreadsheet or the
// geocoder handed over, often fifteen decimals — nanometres, paid for in bytes
// on every load. This is the same trim for them.
//
// Rounding can make two neighbouring vertices of a line or an outline land on
// the same point. Those exact repeats are dropped, but never so far that a
// line keeps fewer than 2 points or a ring fewer than 4 (a closed triangle);
// a shape that would shrink below that keeps its rounded points as they are.
// A ring that was closed stays closed: its first and last points are rounded
// the same way, and dropping repeats never removes either end.
//
// No imports on purpose: deploy/trim-uploaded-coordinates.mjs uses this too,
// and must not start the job queue just by loading a module.

export const COORD_DP = 6;

function roundNum(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return n;
  const r = Number(n.toFixed(COORD_DP));
  return Object.is(r, -0) ? 0 : r;
}

function roundPos(p) {
  return Array.isArray(p) ? p.map(roundNum) : p;
}

function samePos(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Drop exact consecutive repeats, unless that would leave fewer than `min`.
function dedupe(points, min) {
  if (!Array.isArray(points)) return points;
  const out = [];
  for (const p of points) {
    if (out.length && samePos(out[out.length - 1], p)) continue;
    out.push(p);
  }
  return out.length >= min ? out : points;
}

function line(coords) {
  return Array.isArray(coords) ? dedupe(coords.map(roundPos), 2) : coords;
}
function ring(coords) {
  return Array.isArray(coords) ? dedupe(coords.map(roundPos), 4) : coords;
}
function polygon(coords) {
  return Array.isArray(coords) ? coords.map(ring) : coords;
}

export function trimGeometry(g) {
  if (!g || typeof g !== 'object') return g;
  const c = g.coordinates;
  switch (g.type) {
    case 'Point': return { ...g, coordinates: roundPos(c) };
    case 'MultiPoint': return { ...g, coordinates: Array.isArray(c) ? c.map(roundPos) : c };
    case 'LineString': return { ...g, coordinates: line(c) };
    case 'MultiLineString': return { ...g, coordinates: Array.isArray(c) ? c.map(line) : c };
    case 'Polygon': return { ...g, coordinates: polygon(c) };
    case 'MultiPolygon': return { ...g, coordinates: Array.isArray(c) ? c.map(polygon) : c };
    case 'GeometryCollection':
      return { ...g, geometries: Array.isArray(g.geometries) ? g.geometries.map(trimGeometry) : g.geometries };
    default: return g;
  }
}

// A new collection: features are shallow copies with a trimmed geometry, so
// the caller's objects (a session's parsed rows, say) are never changed.
export function trimFeatureCollection(gj) {
  if (!gj || typeof gj !== 'object') return gj;
  if (gj.type === 'Feature') return { ...gj, geometry: trimGeometry(gj.geometry) };
  if (!Array.isArray(gj.features)) return gj.type ? trimGeometry(gj) : gj;
  return {
    ...gj,
    features: gj.features.map((f) => (f && typeof f === 'object' && f.geometry)
      ? { ...f, geometry: trimGeometry(f.geometry) } : f),
  };
}
