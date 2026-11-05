/* A stand-in for api/atlas-builders/build_dataset.py, for checks that need an
 * atlas to be built — quickly, deterministically and without touching the
 * network — but not the map itself. A check points ATLAS_PYTHON at a two-line
 * shell script that runs this file with the builder's own arguments
 * (build_dataset.py --jobspec FILE); the jobspec is read like the real
 * builder reads it, a manifest naming the spec's layers is written to outDir,
 * and the progress lines jobs.js listens for are printed. ATLAS_FAKE_BUILD_MS
 * makes the build take that long, so a check can act while it is running;
 * ATLAS_FAKE_BUILD_FAIL=1 makes it stop as a real build stops. built-with.json
 * in the output says what the builder was given. */
import fs from 'node:fs';
import path from 'node:path';

const i = process.argv.indexOf('--jobspec');
const spec = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8'));
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
say({ event: 'progress', step: 'region', pct: 5, msg: 'pretending to build' });
fs.mkdirSync(spec.outDir, { recursive: true });
fs.writeFileSync(path.join(spec.outDir, 'manifest.json'), JSON.stringify({
  title: spec.title, subtitle: spec.subtitle || '', about: spec.about || '',
  bbox: spec.region && spec.region.bbox, region: { label: (spec.region && spec.region.shapeNames || []).join(' · ') },
  basemaps: [{ id: 'light', label: 'Streets & colour', default: true }],
  layers: (spec.layers || []).map((id) => ({ id, label: id, group: 'base', type: 'geojson', file: id + '.geojson', default: false })),
  attribution: [], fake: true,
}, null, 1));
for (const id of spec.layers || []) fs.writeFileSync(path.join(spec.outDir, id + '.geojson'), '{"type":"FeatureCollection","features":[]}');
fs.writeFileSync(path.join(spec.outDir, 'built-with.json'), JSON.stringify({ layers: spec.layers || [], timeoutMs: spec.timeoutMs || null, estSeconds: spec.estSeconds || null }));
const wait = Number(process.env.ATLAS_FAKE_BUILD_MS) || 0;
setTimeout(() => {
  // ATLAS_FAKE_BUILD_FAIL: a build that stops, the way a real one does (an error line, a non-zero exit)
  if (process.env.ATLAS_FAKE_BUILD_FAIL === '1') { say({ event: 'error', msg: 'pretend failure' }); process.exit(1); }
  say({ event: 'progress', step: 'manifest', pct: 95, msg: 'writing the manifest' });
  say({ event: 'done' });
  process.exit(0);
}, wait);
