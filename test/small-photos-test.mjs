/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Small photos for every atlas's lists (deploy/make-small-photos.mjs): a
 * place's first photograph made 160 px and about 10 KB, kept beside the data
 * as small-<tag_id>.jpg, named on the place as photo_small. What these hold:
 * a dry run writes nothing; --apply makes, keeps what is already made, says
 * why one failed; a name the private data route would refuse is never made;
 * deoria-bioregion is refused. The photo is the event fixture's own
 * kala-academy.jpg; no network. Pillow is needed (ATLAS_PYTHON, or the
 * builders' .venv): without it the making is skipped and said so. */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = await import(ROOT + '/deploy/make-small-photos.mjs');
const { CONTRIBUTED, carryContributed } = await import(ROOT + '/api/lib/atlas/jobs.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
// a JPEG's width and height, from its frame header
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-small-test-'));
const pub = path.join(tmp, 'datasets');
const A = path.join(pub, 'small-photo-test');
fs.mkdirSync(A, { recursive: true });
fs.copyFileSync(ROOT + '/deploy/events/emergence-festival-of-future-cities/kala-academy.jpg', A + '/kala-academy.jpg');
fs.writeFileSync(A + '/broken.jpg', 'not a picture');
fs.writeFileSync(A + '/manifest.json', JSON.stringify({ id: 'small-photo-test', layers: [] }));
fs.writeFileSync(A + '/manifest.local.json', JSON.stringify({ layers: [
  { id: 'tags', group: 'userdata', source: 'user-tags.geojson' },
  { id: 'admin', group: 'base', source: 'admin.geojson' }] }));
const pt = (props) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [77.6, 12.9] } });
const gj = { type: 'FeatureCollection', features: [
  pt({ tag_id: 'aaaaaaaa-1111-2222-3333-444444444444', photo_file: 'kala-academy.jpg', thumbnail_url: 'https://loka.place/api/images/thumb_x.jpg' }),
  pt({ tag_id: 'bbbbbbbb-1111-2222-3333-444444444444', photo_file: 'broken.jpg' }),
  pt({ name: 'no photo' }),
  pt({ tag_id: 'cccccccc-1111-2222-3333-444444444444', photo_1_url: 'https://elsewhere.example/x.jpg' }),
] };
fs.writeFileSync(A + '/user-tags.geojson', JSON.stringify(gj));
fs.writeFileSync(A + '/admin.geojson', '{"type":"FeatureCollection","features":[]}');
const env = Object.assign({}, process.env, { LOKA_DATA_DIR: tmp, LOKA_PUBLIC_DATASETS: pub });
const run = (args) => spawnSync(process.execPath, [ROOT + '/deploy/make-small-photos.mjs', ...args], { encoding: 'utf8', env });
const read = () => JSON.parse(fs.readFileSync(A + '/user-tags.geojson', 'utf8'));

console.log('\n  the rules');
check('the name is the tag\'s own id, flat beside the data (the private route serves no "/")', SP.smallName({ tag_id: 'AAAAAAAA-1111-2222-3333-444444444444' }, 'x'), 'small-aaaaaaaa-1111-2222-3333-444444444444.jpg');
check('no tag id: a hash of where the photo came from', /^small-[0-9a-f]{16}\.jpg$/.test(SP.smallName({}, 'https://example.org/a.jpg')), true);
check('every name passes the private data route\'s test', [SP.smallName({ tag_id: '../../etc' }, 'u'), SP.smallName({ tag_id: 'aaaaaaaa-1' }, 'u')].every((n) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(n)), true);
check('photo_file first, else photo_1_url, else the first link in photo_urls', [
  SP.photoSource({ photo_file: 'kala-academy.jpg', photo_1_url: 'https://x/a.jpg' }, A).file === A + '/kala-academy.jpg',
  SP.photoSource({ photo_1_url: 'https://x/a.jpg', photo_urls: 'https://x/b.jpg' }, A).url,
  SP.photoSource({ photo_urls: 'https://x/b.jpg; https://x/c.jpg' }, A).url,
  SP.photoSource({ photo_file: '../secret.jpg' }, A)], [true, 'https://x/a.jpg', 'https://x/b.jpg', null]);
check('160 px, quality 70', [SP.SIZE, SP.QUALITY], [160, 70]);
check('only https links on an allowed host (loka.place and under it by default)', [
  SP.linkRefused('https://loka.place/api/images/a.jpg'), SP.linkRefused('https://img.loka.place/a.jpg'),
  !!SP.linkRefused('http://loka.place/a.jpg'), !!SP.linkRefused('https://notloka.place/a.jpg'), !!SP.linkRefused('https://loka.place:8443/a.jpg'),
  !!SP.linkRefused('https://169.254.169.254/latest'), SP.linkRefused('https://example.org/a.jpg', ['example.org'])], [null, null, true, true, true, true, null]);

console.log('\n  fetching (a stand-in for the network)');
const realFetch = globalThis.fetch;
const chunks = (n, size) => new ReadableStream({ start(c) { for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(size)); c.close(); } });
const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-small-fetch-'));
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(url);
  if (url.endsWith('/big.jpg')) return new Response(chunks(3, 1024), { headers: { 'content-type': 'image/jpeg' } });
  if (url.endsWith('/said-big.jpg')) return new Response(chunks(1, 10), { headers: { 'content-type': 'image/jpeg', 'content-length': String(1e9) } });
  if (url.endsWith('/away.jpg')) return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x.jpg' } });
  if (url.endsWith('/hop.jpg')) return new Response(null, { status: 301, headers: { location: '/ok.jpg' } });
  if (url.endsWith('/page.jpg')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
  return new Response(chunks(1, 500), { headers: { 'content-type': 'image/jpeg' } });
};
check('a download past the cap is stopped (counted as it comes)', /larger than/.test(await SP.fetchTo('https://loka.place/big.jpg', tmpF + '/a', SP.HOSTS, 2048)), true);
check('…and one that says it is past the cap is not read at all', /larger than/.test(await SP.fetchTo('https://loka.place/said-big.jpg', tmpF + '/b')), true);
check('a redirect off the allowed hosts is refused, and never asked for', [/redirected, and not fetched: elsewhere\.example/.test(await SP.fetchTo('https://loka.place/away.jpg', tmpF + '/c')), asked.includes('https://elsewhere.example/x.jpg')], [true, false]);
check('a redirect on the same host is followed', [await SP.fetchTo('https://loka.place/hop.jpg', tmpF + '/d'), fs.statSync(tmpF + '/d').size], [null, 500]);
check('a page that is not a picture is refused', /not a picture/.test(await SP.fetchTo('https://loka.place/page.jpg', tmpF + '/e')), true);
check('the cap is 20 MB', SP.MAX_BYTES, 20 * 1024 * 1024);
globalThis.fetch = realFetch;
fs.rmSync(tmpF, { recursive: true, force: true });

console.log('\n  the command');
const before = fs.readFileSync(A + '/user-tags.geojson', 'utf8');
const dry = run(['small-photo-test']);
check('a dry run says what it would do', [dry.status, /DRY RUN/.test(dry.stdout), /2 to make, 0 kept as they are, 1 places with no photo, 1 links not fetched/.test(dry.stdout)], [0, true, true]);
check('…and names the link it will not fetch, and why', /small-cccccccc[^\n]*not fetched: elsewhere\.example is not on the list \(loka\.place\)/.test(dry.stdout), true);
check('…and writes nothing', fs.readFileSync(A + '/user-tags.geojson', 'utf8') === before && !fs.readdirSync(A).some((f) => /^small-/.test(f)), true);
const deo = run(['deoria-bioregion', '--apply', '--server-is-stopped']);
check('deoria-bioregion is never touched', [deo.status, /never touched/.test(deo.stderr)], [1, true]);
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin);
fs.writeFileSync(bin + '/pm2', '#!/bin/sh\necho \'[{"name":"lokaApps","pm2_env":{"status":"online"}}]\'\n', { mode: 0o755 });
const busy = spawnSync(process.execPath, [ROOT + '/deploy/make-small-photos.mjs', 'small-photo-test', '--apply'], { encoding: 'utf8', env: Object.assign({}, env, { PATH: bin + ':' + process.env.PATH }) });
check('with lokaApps running (pm2 says so), --apply stops before writing', [busy.status, /lokaApps is running: stop it first/.test(busy.stderr), fs.readFileSync(A + '/user-tags.geojson', 'utf8') === before], [1, true, true]);

const py = spawnSync(SP.python(), ['-c', 'import PIL'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.log('  SKIP  making the photos: no Python with Pillow at ' + SP.python() + ' (set ATLAS_PYTHON)');
} else {
  const wet = run(['small-photo-test', '--apply', '--server-is-stopped']);
  const after = read().features.map((f) => f.properties);
  const name = 'small-aaaaaaaa-1111-2222-3333-444444444444.jpg';
  check('--apply makes one, and says why the other two failed', [wet.status, /Made:\s+1 /.test(wet.stdout), /Failed:\s+2/.test(wet.stdout), /broken|UnidentifiedImageError|cannot identify/i.test(wet.stdout), /not on the list/.test(wet.stdout)], [0, true, true, true, true]);
  check('the place now names its small photo; the failed and the photo-less ones do not', after.map((p) => p.photo_small || null), [name, null, null, null]);
  const buf = fs.readFileSync(A + '/' + name);
  const wh = jpegSize(buf);
  check('the small photo is a JPEG, 160 px on its longest side', [buf[0] === 0xFF && buf[1] === 0xD8, wh && Math.max(wh[0], wh[1])], [true, 160]);
  check('…and small: under 15 KB (' + (buf.length / 1024).toFixed(1) + ' KB)', buf.length < 15 * 1024, true);
  check('thumbnail_url is left as it was', after[0].thumbnail_url, 'https://loka.place/api/images/thumb_x.jpg');
  check('where it came from is recorded in small-photos.json', JSON.parse(fs.readFileSync(A + '/small-photos.json', 'utf8'))[name].src.startsWith('file:kala-academy.jpg:'), true);
  check('a backup of the places file was made first', fs.readdirSync(path.join(tmp, 'backups')).some((d) => /^small-photos-small-photo-test-/.test(d) && fs.existsSync(path.join(tmp, 'backups', d, 'user-tags.geojson'))), true);
  check('the base layer is left alone', fs.readFileSync(A + '/admin.geojson', 'utf8'), '{"type":"FeatureCollection","features":[]}');
  const again = run(['small-photo-test', '--apply', '--server-is-stopped']);
  check('a second run keeps what is made and tries the failed one again', [/1 to make, 1 kept as they are/.test(again.stdout), /Made:\s+0/.test(again.stdout)], [true, true]);
  const R = path.join(tmp, 'rebuilt');
  fs.mkdirSync(R);
  carryContributed(A, R, { log: [] });
  check('a rebuild carries the small photos and where they came from', [fs.existsSync(R + '/' + name), fs.existsSync(R + '/small-photos.json'), CONTRIBUTED.some((re) => re.test('small-photos.json'))], [true, true, true]);
  const g2 = read(); g2.features[0].properties.photo_file = ''; fs.writeFileSync(A + '/user-tags.geojson', JSON.stringify(g2));
  fs.writeFileSync(A + '/user-tags.geojson', JSON.stringify(g2));
  const gone = run(['small-photo-test', '--apply', '--server-is-stopped']);
  check('a place whose photo is gone loses photo_small', [gone.status, read().features[0].properties.photo_small], [0, undefined]);
  check('…its small photo is deleted, and so is its line in small-photos.json (after a backup)', [fs.existsSync(A + '/' + name), name in JSON.parse(fs.readFileSync(A + '/small-photos.json', 'utf8')), /Deleted: 1 /.test(gone.stdout),
    fs.readdirSync(path.join(tmp, 'backups')).some((d) => fs.existsSync(path.join(tmp, 'backups', d, name)))], [false, false, true, true]);
  check('…and nothing else in the folder is deleted', ['kala-academy.jpg', 'broken.jpg', 'admin.geojson', 'manifest.json'].every((f) => fs.existsSync(A + '/' + f)), true);
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n  the viewer');
const xm = fs.readFileSync(ROOT + '/atlas/explore-mode.js', 'utf8');
check('a list row reads photo_small through the same data address as photo_file (key and all)', /api\.dataUrl\(String\(p\.photo_small\)\)/.test(xm), true);
check('lazily, at 48 px', /loading="lazy" width="48" height="48"/.test(xm), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
