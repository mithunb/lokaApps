/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Small photos made automatically — at every build and every reading, in the
 * background, no owner action (31 Oct 2026). What these hold: the core
 * (makeSmallPhotos) is exported, takes a plain folder and refuses deoria;
 * the server queues it after a build finishes and after commitLayer; one run
 * per atlas at a time; the status route is gated to owner/editor; the
 * progress callback reports done/total; the event refresh script calls the
 * core too. Regex checks on source for the server wiring (api/apps/atlas.js
 * is too large a module to import cleanly in a unit test), and a real run of
 * the core on a temp folder for the photo-making itself — the fixture's own
 * local photo_file image, no network. Pillow is needed (ATLAS_PYTHON, or the
 * builders' .venv): without it that one check is skipped and says why. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = await import(ROOT + '/deploy/make-small-photos.mjs');
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
// owner.js is at its size ceiling (test/fold-test.mjs); the progress line
// lives in owner-modes.js, which it already loads for every atlas.
const ownerJs = fs.readFileSync(ROOT + '/atlas/owner-modes.js', 'utf8');
const eventLib = fs.readFileSync(ROOT + '/deploy/event-mode-lib.mjs', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  the core');
check('makeSmallPhotos is exported', typeof SP.makeSmallPhotos, 'function');
check('run (the CLI) is still exported, for the command line', typeof SP.run, 'function');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-small-build-test-'));
await SP.makeSmallPhotos({ dir: tmp, slug: 'x', apply: false, log: () => {} }).then(
  () => check('a plain, empty folder stops for its own reason, not deoria', false, true),
  (e) => check('a plain, empty folder stops for its own reason, not deoria', /no places of its own/.test(e.message), true));

for (const bad of [path.join(tmp, 'deoria-bioregion'), path.join(tmp, 'Deoria-Bioregion', 'nested')]) {
  fs.mkdirSync(bad, { recursive: true });
  let threw = null;
  try { await SP.makeSmallPhotos({ dir: bad, slug: 'deoria-bioregion', apply: false, log: () => {} }); } catch (e) { threw = e; }
  check('refuses a deoria-bioregion folder, any case (' + path.basename(path.dirname(bad) === tmp ? bad : path.dirname(bad)) + ')', !!(threw && /deoria/i.test(threw.message)), true);
}

console.log('\n  the server wiring');
check('the job-done hook queues small photos on a successful build', /job\.status === 'done'[\s\S]{0,400}queueSmallPhotos\(fresh\)/.test(api), true);
check('commitLayer queues small photos after a successful write', /queueSmallPhotos\(ds\)[\s\S]{0,40}return \{ ok: true, layerId/.test(api), true);
check('one run per atlas at a time (a second request marks "run again")', /if \(st && st\.running\) \{ st\.again = true; return; \}/.test(api), true);
check('never deoria (queueSmallPhotos checks isNeverTouched)', /function queueSmallPhotos\(inst\) \{\s*if \(!inst \|\| searchText\.isNeverTouched\(inst\.slug\)\) return;/.test(api), true);
check('trouble goes to console.warn, never thrown at a caller', /catch \(e\) \{\s*console\.warn\('\[small-photos\] '/.test(api), true);
check('the status route exists and is owner/editor gated', /router\.get\('\/instances\/:slug\/small-photos'[\s\S]{0,200}callerCanEdit\(req, inst\)/.test(api), true);

console.log('\n  the Owner menu');
check('polls the status route', /api\("instances\/" \+ encodeURIComponent\(SLUG\) \+ "\/small-photos"\)/.test(ownerJs), true);
check('shows the quiet line only while running, and polls every 3s', /photosTimer = setTimeout\(pollSmallPhotos, 3000\);/.test(ownerJs), true);
check('hides the line once it is not running, and looks again now and then for a later run', /if \(!s\.running\) \{ slot\.hidden = true; photosTimer = setTimeout\(pollSmallPhotos, 30000\); return; \}/.test(ownerJs), true);
check('never during a build, and stops before writing if a build starts meanwhile', /if \(inst\.status === 'building'\) return;/.test(api) && /beforeWrite: \(\) => \{ const now = reg\.getInstance\(slug\); return !!now && now\.status !== 'building'; \}/.test(api), true);
check('plain wording, with the count', /Preparing photos for the list/.test(ownerJs), true);

console.log('\n  the event refresh script');
check('refresh-event-atlas.mjs calls the core after an applied write', /makeSmallPhotos\(\{ dir, slug, apply: true/.test(eventLib), true);

console.log('\n  making one, for real (no network: a local photo_file)');
const py = spawnSync(SP.python(), ['-c', 'import PIL'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.log('  SKIP  the progress callback and the photo itself: no Python with Pillow at ' + SP.python() + ' (set ATLAS_PYTHON)');
} else {
  const dir = path.join(tmp, 'small-photo-build-test');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(ROOT + '/deploy/events/emergence-festival-of-future-cities/kala-academy.jpg', path.join(dir, 'kala-academy.jpg'));
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'tags', group: 'userdata', source: 'user-tags.geojson' }] }));
  const gj = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { tag_id: 'aaaaaaaa-1111-2222-3333-444444444444', photo_file: 'kala-academy.jpg' }, geometry: { type: 'Point', coordinates: [77.6, 12.9] } },
  ] };
  fs.writeFileSync(path.join(dir, 'user-tags.geojson'), JSON.stringify(gj));
  const seen = [];
  const r = await SP.makeSmallPhotos({ dir, slug: 'small-photo-build-test', apply: true, log: () => {}, onProgress: (p) => seen.push(p) });
  check('made one', r.made, 1);
  check('the progress callback reported done/total, ending at the total', seen.length > 0 && seen[seen.length - 1].done === seen[seen.length - 1].total && seen[seen.length - 1].total === 1, true);
  check('the place now names its small photo', JSON.parse(fs.readFileSync(path.join(dir, 'user-tags.geojson'), 'utf8')).features[0].properties.photo_small, 'small-aaaaaaaa-1111-2222-3333-444444444444.jpg');

  // a reading replaces the places while the photos are being made: nothing it wrote may be lost
  const dir2 = path.join(tmp, 'small-photo-race-test');
  fs.mkdirSync(dir2, { recursive: true });
  fs.copyFileSync(ROOT + '/deploy/events/emergence-festival-of-future-cities/kala-academy.jpg', path.join(dir2, 'kala-academy.jpg'));
  fs.writeFileSync(path.join(dir2, 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'tags', group: 'userdata', source: 'user-tags.geojson' }] }));
  const one = { type: 'Feature', properties: { tag_id: 'bbbbbbbb-1111-2222-3333-444444444444', photo_file: 'kala-academy.jpg' }, geometry: { type: 'Point', coordinates: [77.6, 12.9] } };
  fs.writeFileSync(path.join(dir2, 'user-tags.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [one] }));
  const later = { type: 'FeatureCollection', features: [
    { ...one, properties: { ...one.properties, pattern_1: 'Library' } },
    { type: 'Feature', properties: { tag_id: 'cccccccc-1111-2222-3333-444444444444', loka_name: 'New place' }, geometry: { type: 'Point', coordinates: [77.7, 12.8] } },
  ] };
  await SP.makeSmallPhotos({ dir: dir2, slug: 'small-photo-race-test', apply: true, log: () => {},
    onProgress: (p) => { if (p.total && p.done === p.total) fs.writeFileSync(path.join(dir2, 'user-tags.geojson'), JSON.stringify(later)); } });
  const after = JSON.parse(fs.readFileSync(path.join(dir2, 'user-tags.geojson'), 'utf8')).features;
  check('places written meanwhile are kept: the new place, and the new answer', [after.length, after[1].properties.loka_name, after[0].properties.pattern_1], [2, 'New place', 'Library']);
  check('and the photo still lands on its place', after[0].properties.photo_small, 'small-bbbbbbbb-1111-2222-3333-444444444444.jpg');

  // a place comes back meanwhile naming a small photo the run thought nobody used: it is not deleted
  const P = 'bbbbbbbb-1111-2222-3333-444444444444', pf = path.join(dir2, 'user-tags.geojson');
  const withP = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const pFeature = withP.features.find((f) => f.properties.tag_id === P);
  fs.writeFileSync(pf, JSON.stringify({ type: 'FeatureCollection', features: withP.features.filter((f) => f.properties.tag_id !== P) }));
  await SP.makeSmallPhotos({ dir: dir2, slug: 'small-photo-race-test', apply: true, log: () => {},
    onProgress: (p) => { if (p.done === p.total) fs.writeFileSync(pf, JSON.stringify(withP)); } });
  const back = JSON.parse(fs.readFileSync(pf, 'utf8')).features.find((f) => f.properties.tag_id === P);
  check('a small photo a place written meanwhile names is kept, with its name on the place',
    [fs.existsSync(path.join(dir2, pFeature.properties.photo_small)), back && back.properties.photo_small], [true, pFeature.properties.photo_small]);

  // places with no tag_id, and one inserted meanwhile: the file is left as it is, no photo on a wrong place
  const dir4 = path.join(tmp, 'small-photo-noid-test');
  fs.mkdirSync(dir4, { recursive: true });
  fs.copyFileSync(ROOT + '/deploy/events/emergence-festival-of-future-cities/kala-academy.jpg', path.join(dir4, 'kala-academy.jpg'));
  fs.writeFileSync(path.join(dir4, 'manifest.local.json'), JSON.stringify({ layers: [{ id: 'crops', group: 'userdata', source: 'user-crops.geojson' }] }));
  const crop = { type: 'Feature', properties: { name: 'Has a photo', photo_file: 'kala-academy.jpg' }, geometry: { type: 'Point', coordinates: [77.6, 12.9] } };
  const cf = path.join(dir4, 'user-crops.geojson');
  fs.writeFileSync(cf, JSON.stringify({ type: 'FeatureCollection', features: [crop] }));
  const inserted = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Inserted first' }, geometry: { type: 'Point', coordinates: [77.5, 12.8] } }, crop] };
  await SP.makeSmallPhotos({ dir: dir4, slug: 'small-photo-noid-test', apply: true, log: () => {},
    onProgress: (p) => { if (p.total && p.done === p.total) fs.writeFileSync(cf, JSON.stringify(inserted)); } });
  const got4 = JSON.parse(fs.readFileSync(cf, 'utf8')).features;
  check('no tag_id and the file changed meanwhile: left as written, no photo on the wrong place',
    [got4.length, got4[0].properties.name, 'photo_small' in got4[0].properties, 'photo_small' in got4[1].properties], [2, 'Inserted first', false, false]);
  await SP.makeSmallPhotos({ dir: dir4, slug: 'small-photo-noid-test', apply: true, log: () => {} });
  const got5 = JSON.parse(fs.readFileSync(cf, 'utf8')).features;
  check('and the next run gives the right place its photo', ['photo_small' in got5[0].properties, /^small-/.test(got5[1].properties.photo_small || '')], [false, true]);

  // a build starts meanwhile: nothing is written
  const before3 = fs.readFileSync(path.join(dir2, 'user-tags.geojson'), 'utf8');
  for (const f of fs.readdirSync(dir2)) if (/^small-/.test(f)) fs.unlinkSync(path.join(dir2, f));
  const r3 = await SP.makeSmallPhotos({ dir: dir2, slug: 'small-photo-race-test', apply: true, log: () => {}, beforeWrite: () => false });
  check('told to stop before writing: says so, and the places file is untouched', [!!r3.stopped, fs.readFileSync(path.join(dir2, 'user-tags.geojson'), 'utf8') === before3], [true, true]);
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
