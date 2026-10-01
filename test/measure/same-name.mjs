/* How often does a place name mean more than one place, and how many of those
 * does the "put by its neighbours" rule settle on its own?
 *
 *   node test/measure/same-name.mjs            (needs api/data/atlas/geocache/IND-ADM{2,3,4}.json)
 *
 * Not a check: it reads the boundary cache the server downloads, which is not
 * in the repository, so test/run.mjs leaves it alone. It is kept here so the
 * rule is measured by the code that runs it — joinByName and
 * settleByNeighbours from api/lib/matching.js — rather than by a copy of it.
 * (It began as a Python simulation of the rule written for the design review;
 * this replaces that copy.)
 *
 * Sheets are drawn the way an organisation's list usually is: N rows from one
 * district and the districts nearest it. Each row is a real block (level 3) or
 * locality (level 4) and is joined against every unit of that level in India,
 * so a shared name has all of its namesakes to choose from. For every row
 * whose name is shared: settled (put by its neighbours), and whether that was
 * the right one; or asked. Results go to same-name-results.json beside this. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinByName, norm, centreOfGeometry } from '../../api/lib/matching.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '..', '..', 'api', 'data', 'atlas', 'geocache');
if (!fs.existsSync(path.join(CACHE, 'IND-ADM3.json'))) {
  console.log('No boundary cache at ' + CACHE + ' — run the server once for India, then this.');
  process.exit(0);
}

// a small seeded generator, so a run can be repeated exactly
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
function sample(a, n) {
  const c = a.slice();
  for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
  return c.slice(0, n);
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(x, y, g) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
}
const load = (L) => JSON.parse(fs.readFileSync(path.join(CACHE, `IND-ADM${L}.json`), 'utf8')).features;

const districts = load(2).map((f) => ({ name: f.properties.name, g: f.geometry, bbox: f.bbox, c: centreOfGeometry(f.geometry) }));
const results = {};
for (const L of [3, 4]) {
  const t0 = Date.now();
  const units = load(L).map((f, i) => {
    const c = centreOfGeometry(f.geometry);
    const d = districts.findIndex((p) => p.bbox && c[0] >= p.bbox[0] && c[0] <= p.bbox[2] && c[1] >= p.bbox[1] && c[1] <= p.bbox[3] && inGeom(c[0], c[1], p.g));
    return { code: String(i), name: String(f.properties.name || ''), parent: '', centre: c, geometry: null, d };
  });
  const byName = new Map();
  for (const u of units) { const k = norm(u.name); if (!k) continue; if (!byName.has(k)) byName.set(k, []); byName.get(k).push(u); }
  const shared = [...byName.entries()].filter(([k, v]) => v.length > 1 && !/^notunderany/.test(k)).map(([, v]) => v);
  const perD = new Map();
  // a unit called "Not under any CD block" is not a name anybody writes in a sheet
  for (const u of units) if (u.d >= 0 && !/^notunderany/.test(norm(u.name))) { if (!perD.has(u.d)) perD.set(u.d, []); perD.get(u.d).push(u); }
  const dKeys = [...perD.keys()];
  const sheets = {};
  for (const N of [15, 40, 100]) {
    const trials = 300;
    let rowsN = 0, sharedRows = 0, settled = 0, wrong = 0, asked = 0, withQuestion = 0;
    const perSheet = [];
    for (let t = 0; t < trials; t++) {
      const d0 = pick(dKeys), c0 = districts[d0].c;
      const order = dKeys.slice().sort((a, b) => {
        const ca = districts[a].c, cb = districts[b].c;
        return ((ca[0] - c0[0]) ** 2 + (ca[1] - c0[1]) ** 2) - ((cb[0] - c0[0]) ** 2 + (cb[1] - c0[1]) ** 2);
      });
      let pool = [];
      for (const k of order) { pool = pool.concat(perD.get(k)); if (pool.length >= N * 2) break; }
      const truth = sample(pool, N);
      const out = joinByName(truth.map((u) => ({ place: u.name })), 'place', null, units);
      rowsN += N;
      const asks = new Set();
      out.forEach((r, i) => {
        if ((byName.get(norm(truth[i].name)) || []).length < 2) return;
        sharedRows++;
        if (r.byNeighbours) { settled++; if (r.match !== truth[i].code) wrong++; }
        else if (r.match == null) { asked++; asks.add(norm(truth[i].name)); }
      });
      perSheet.push(asks.size);
      if (asks.size) withQuestion++;
    }
    perSheet.sort((a, b) => a - b);
    sheets[N] = { trials, rows: rowsN, sharedRows, settled, wrongPicks: wrong, asked,
      settledShare: +(settled / Math.max(1, sharedRows)).toFixed(3),
      sheetsWithAQuestion: withQuestion, medianQuestions: perSheet[trials >> 1], p90Questions: perSheet[Math.floor(trials * 0.9)] };
  }
  results['ADM' + L] = {
    units: units.length, namesUsedMoreThanOnce: shared.length,
    unitsSharingAName: shared.reduce((n, v) => n + v.length, 0),
    mostRepeated: shared.sort((a, b) => b.length - a.length).slice(0, 6).map((v) => v[0].name + ' ×' + v.length),
    sheets, seconds: Math.round((Date.now() - t0) / 1000),
  };
  console.log('ADM' + L, JSON.stringify(results['ADM' + L], null, 1));
}
fs.writeFileSync(path.join(HERE, 'same-name-results.json'), JSON.stringify({ measuredOn: new Date().toISOString().slice(0, 10), results }, null, 1) + '\n');
