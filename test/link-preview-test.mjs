/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it.
 *
 * Link previews (Mithun, 7 Nov 2026): GET /api/atlas/preview?dataset=<slug>
 * (api/apps/atlas.js) and api/server.js's dev-parity rewrite of a crawler's
 * request to /apps/atlas/?dataset=<slug>. Covers: a public atlas gets
 * og:/twitter: tags, HTML-escaped, with the best place photo as an absolute
 * https og:image, and the description fallback chain (subtitle, about,
 * story sentence, region); a private atlas, an unknown slug and
 * deoria-bioregion get the generic block only; ?key= never appears in the
 * output; a query string carrying other parameters never leaks into a tag;
 * the rest of index.html is untouched; a plain (non-crawler) visit and a
 * dataset-less /apps/atlas/ keep the static file. No network beyond
 * 127.0.0.1; deoria-bioregion's own files are never read or written. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (ok ? '' : '\n        got ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}
function has(name, html, re) { check(name, re.test(html), true); }
function hasNot(name, html, re) { check(name, re.test(html), false); }

/* ---------------- the route is named for what it must never do (source check) ---------------- */
const api = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const previewSrc = api.slice(api.indexOf("router.get('/preview'"));
check('only req.query.dataset is ever read, never req.query.key', [...previewSrc.matchAll(/req\.query\.(\w+)/g)].map((m) => m[1]), ['dataset']);
check('deoria-bioregion is excluded, same published+public test as /instances/:slug', /inst\.slug !== 'deoria-bioregion'/.test(api), true);
check('answers with Cache-Control: no-cache, must-revalidate', /no-cache, must-revalidate/.test(previewSrc), true);

/* ---------------- against a real server ---------------- */
const PORT = 8950 + Math.floor(Math.random() * 40);
const BASEURL = `http://127.0.0.1:${PORT}`;
const TAG = Math.random().toString(36).slice(2, 7);
const PUB1 = 'preview-sub-' + TAG;     // subtitle wins; quoted place's photo
const PUB2 = 'preview-about-' + TAG;   // about wins, trimmed
const PUB3 = 'preview-story-' + TAG;   // story sentence wins; first-with-photo
const PUB4 = 'preview-region-' + TAG;  // nothing but the region
const PUB5 = 'preview-noplace-' + TAG; // no places at all -> default image
const PUB6 = 'preview-oneword-' + TAG; // an "about" with one giant unbreakable word
const UNPUB = 'preview-unpub-' + TAG;  // public visibility, but not published
const PRIV = 'preview-priv-' + TAG;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-preview-check-'));
const pubDir = (s) => path.join(ROOT, 'atlas', 'datasets', s);
const privDir = path.join(DATA, 'private-datasets', PRIV);

const TAGGED_NAME = 'A, place "quoted" <in> the story';
const PLACE_B = { type: 'Feature', properties: { tag_id: 'place-b', description: 'Place B', photo_1_url: 'https://loka.place/api/images/place-b.jpg' }, geometry: { type: 'Point', coordinates: [0, 0] } };
const PLACE_QUOTED = { type: 'Feature', properties: { tag_id: 'place-quoted', description: TAGGED_NAME, photo_small: 'small-place-quoted.jpg' }, geometry: { type: 'Point', coordinates: [0, 0] } };

function seedPublic(slug, { manifest, local, places }) {
  const dir = pubDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ title: 'Preview check & Co', ...manifest }));
  fs.writeFileSync(path.join(dir, 'manifest.local.json'), JSON.stringify(local || { layers: [] }));
  if (places) fs.writeFileSync(path.join(dir, 'places.geojson'), JSON.stringify({ type: 'FeatureCollection', features: places }));
}
const placesLayer = { id: 'places', group: 'userdata', source: 'places.geojson' };

// PUB1: subtitle set; a story quotes place-quoted ahead of place-b, which comes first in the file
seedPublic(PUB1, {
  local: {
    layers: [placesLayer],
    mode: { name: 'insight', layer: 'places', story: { sentences: [], quotes: [{ id: 'place-quoted', text: 'quoted', name: 'x' }] } },
  },
  places: [PLACE_B, PLACE_QUOTED],
});
// PUB2: no subtitle; a long "about", trimmed; first place with a photo (place-b) used
const LONG_ABOUT = 'This & that about the atlas, going on and on past the usual length so the trimmer has real work to do, well beyond a hundred and sixty characters of plain description text here.';
seedPublic(PUB2, { local: { layers: [placesLayer] }, places: [PLACE_B] });
// PUB3: no subtitle/about; a kept story sentence; no places at all with a photo
seedPublic(PUB3, {
  local: { layers: [], mode: { name: 'insight', layer: 'places', story: { sentences: [{ text: 'People say the market is busy at dawn.', quotes: [] }], quotes: [] } } },
});
// PUB4: nothing but a region (set via the registry record, not the dataset files)
seedPublic(PUB4, { local: { layers: [] } });
// PUB5: no places anywhere — og:image falls back to the default
seedPublic(PUB5, { local: { layers: [] } });
// PUB6: a single word past 160 chars, then one short word — never sliced through the long one
const ONE_WORD_ABOUT = 'x'.repeat(170) + ' end';
seedPublic(PUB6, { local: { layers: [] } });
// UNPUB: visibility public, but not published yet (still "built") — not listed, not previewable
seedPublic(UNPUB, { local: { layers: [] } });

fs.mkdirSync(privDir, { recursive: true });
fs.writeFileSync(path.join(privDir, 'manifest.json'), JSON.stringify({ title: 'Private preview check', subtitle: 'Should never show' }));
fs.writeFileSync(path.join(privDir, 'manifest.local.json'), JSON.stringify({ layers: [] }));

const rec = (slug, over) => ({ slug, title: 'Preview check & Co', visibility: 'public', status: 'published',
  ownerAccount: 'owner@example.test', email: 'owner@example.test', tier: 'india', layers: [],
  tokenHash: 'x', viewKeyHash: null, createdAt: 1, collaborators: [], ...over });
fs.writeFileSync(path.join(DATA, 'registry.json'), JSON.stringify({
  instances: {
    [PUB1]: rec(PUB1, { subtitle: 'The subtitle wins <first>' }),
    [PUB2]: rec(PUB2, { about: LONG_ABOUT }),
    [PUB3]: rec(PUB3, {}),
    [PUB4]: rec(PUB4, { regionLabel: 'Goa & the coast' }),
    [PUB5]: rec(PUB5, {}),
    [PUB6]: rec(PUB6, { about: ONE_WORD_ABOUT }),
    [UNPUB]: rec(UNPUB, { status: 'built', subtitle: 'Not published yet — should never show' }),
    [PRIV]: rec(PRIV, { visibility: 'private' }),
  },
  accounts: {},
  drafts: {},
}));

let child = null, out = '';
function cleanup() {
  try { if (child) child.kill('SIGKILL'); } catch {}
  for (const d of [pubDir(PUB1), pubDir(PUB2), pubDir(PUB3), pubDir(PUB4), pubDir(PUB5), pubDir(PUB6), pubDir(UNPUB), DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}
process.on('exit', cleanup);
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'api', 'server.js')], {
    env: { ...process.env, LOKA_PORT: String(PORT), LOKA_DATA_DIR: DATA, LOKA_DEV_STATIC: '1', MAIL_TRANSPORT: 'log', GEMINI_API_KEY: '', ATLAS_OWNER_EMAILS: 'nobody@example.test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const t0 = Date.now();
  while (!/listening on/.test(out)) {
    if (Date.now() - t0 > 15000 || child.exitCode != null) throw new Error('server did not start:\n' + out.slice(-800));
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function preview(slug, extraQS) {
  const r = await fetch(BASEURL + '/api/atlas/preview?dataset=' + encodeURIComponent(slug) + (extraQS || ''));
  return { status: r.status, html: await r.text() };
}
async function previewViaApache(slug, ua) {
  const r = await fetch(BASEURL + '/apps/atlas/?dataset=' + encodeURIComponent(slug), { headers: ua ? { 'User-Agent': ua } : {} });
  return { status: r.status, html: await r.text() };
}

try {
  await startServer();
  console.log('\n  the route, on a throwaway server (' + BASEURL + ')');

  let r = await preview(PUB1);
  check('public: 200', r.status, 200);
  has('og:title present, escaped', r.html, /<meta property="og:title" content="Preview check &amp; Co — LOKA Atlas" \/>/);
  has('og:description is the subtitle, escaped', r.html, /<meta property="og:description" content="The subtitle wins &lt;first&gt;" \/>/);
  has('og:image is the QUOTED place\'s photo (place-quoted), not the first place in the file (place-b)', r.html, new RegExp('og:image" content="https://loka\\.place/apps/atlas/datasets/' + PUB1 + '/small-place-quoted\\.jpg"'));
  has('og:image is an absolute https URL', r.html, /og:image" content="https:\/\//);
  has('og:image:alt names the place, escaped', r.html, /og:image:alt" content="A, place &quot;quoted&quot; &lt;in&gt; the story"/);
  has('og:url is the plain dataset link, nothing else', r.html, new RegExp('og:url" content="https://loka\\.place/apps/atlas/\\?dataset=' + PUB1 + '" \\/>'));
  has('og:type is website', r.html, /og:type" content="website"/);
  has('twitter:card is summary_large_image', r.html, /twitter:card" content="summary_large_image"/);
  has('the plain <meta name="description"> carries the same words as og:description, not the generic line', r.html,
    /<meta name="description" content="The subtitle wins &lt;first&gt;" \/>/);

  r = await preview(PUB2);
  check('about, trimmed to about 160 chars, ends with an ellipsis, and the kept text is a true prefix of the original', (() => {
    const m = /og:description" content="([^"]*)"/.exec(r.html);
    const d = (m ? m[1] : '').replace(/&amp;/g, '&');
    const kept = d.endsWith('…') ? d.slice(0, -1).trim() : d;
    return d.length <= 162 && d.endsWith('…') && LONG_ABOUT.startsWith(kept) && !/\s$/.test(kept);
  })(), true);
  has('and the first place with a photo (place-b) is used, since there is no story', r.html, /og:image" content="https:\/\/loka\.place\/api\/images\/place-b\.jpg"/);

  r = await preview(PUB3);
  has('no subtitle/about: the first kept story sentence is the description', r.html, /og:description" content="People say the market is busy at dawn\." \/>/);
  has('no place has a photo: og:image falls back to the default', r.html, /og:image" content="https:\/\/loka\.place\/og-default\.png"/);

  r = await preview(PUB4);
  has('no subtitle/about/story: a plain line naming the region', r.html, /og:description" content="A map of Goa &amp; the coast on LOKA Atlas" \/>/);

  r = await preview(PUB5);
  has('an atlas with no places at all: og:image is the default, not broken', r.html, /og:image" content="https:\/\/loka\.place\/og-default\.png"/);

  r = await preview(PUB6);
  check('previewTrim never cuts through the middle of a word: the long run of x\'s is kept whole, or dropped whole, never partial', (() => {
    const m = /og:description" content="([^"]*)"/.exec(r.html);
    const d = m ? m[1] : '';
    const xRun = /x+/.exec(d);
    return !xRun || xRun[0].length === 170;
  })(), true);

  console.log('\n  private, unknown and deoria-bioregion: the generic block only');
  r = await preview(PRIV);
  check('private: 200 (never 404 — that would itself confirm the slug exists)', r.status, 200);
  hasNot('no title of the atlas', r.html, /Private preview check/);
  hasNot('no "Should never show" subtitle', r.html, /Should never show/);
  has('the generic og:title stands instead', r.html, /og:title" content="LOKA Atlas" \/>/);
  has('the generic og:image (og-default.png)', r.html, /og:image" content="https:\/\/loka\.place\/og-default\.png"/);

  r = await preview('no-such-atlas-' + TAG);
  check('unknown slug: 200, generic only', [r.status, /og:title" content="LOKA Atlas"/.test(r.html)], [200, true]);

  r = await preview('deoria-bioregion');
  check('deoria-bioregion: generic only, whatever its own status', /og:title" content="LOKA Atlas"/.test(r.html), true);

  r = await preview(UNPUB);
  check('public visibility but not yet published ("built"): generic only, 200', [r.status, /og:title" content="LOKA Atlas"/.test(r.html)], [200, true]);
  hasNot('its subtitle never shows', r.html, /Not published yet/);

  console.log('\n  the key, and everything but ?dataset=, never leaks');
  r = await preview(PUB1, '&key=super-secret-abc123&foo=bar&embed=1');
  hasNot('the key never appears anywhere in the page', r.html, /super-secret-abc123/);
  hasNot('the "foo" query param never leaks into a tag', r.html, /foo=bar/);
  check('everything after </head> is unaffected by the stray params (same as the plain case)', r.html.slice(r.html.indexOf('</head>')), fs.readFileSync(path.join(ROOT, 'atlas', 'index.html'), 'utf8').slice(fs.readFileSync(path.join(ROOT, 'atlas', 'index.html'), 'utf8').indexOf('</head>')));
  has('og:url still carries only ?dataset=', r.html, new RegExp('og:url" content="https://loka\\.place/apps/atlas/\\?dataset=' + PUB1 + '" \\/>'));

  console.log('\n  the rest of index.html, and the dev-parity rewrite');
  const original = fs.readFileSync(path.join(ROOT, 'atlas', 'index.html'), 'utf8');
  r = await preview(PUB1);
  const headIdx = original.indexOf('</head>');
  check('everything after </head> is untouched', r.html.slice(r.html.indexOf('</head>')), original.slice(headIdx));
  check('the title tag is untouched', /<title>LOKA Atlas<\/title>/.test(r.html), true);

  r = await previewViaApache(PUB1, 'Twitterbot/1.0');
  has('a crawler UA on /apps/atlas/?dataset= gets the built page (dev parity)', r.html, /og:title" content="Preview check &amp; Co — LOKA Atlas"/);

  r = await previewViaApache(PUB1, 'Mozilla/5.0 (a plain browser)');
  check('a person (no crawler UA) keeps the plain static file, untouched', r.html === original, true);

  r = await previewViaApache(PUB1, undefined);
  check('no User-Agent at all: also the plain static file', r.html === original, true);

  const noDataset = await fetch(BASEURL + '/apps/atlas/', { headers: { 'User-Agent': 'Twitterbot/1.0' } });
  check('a crawler with no ?dataset= gets the plain static file too (nothing to preview)', await noDataset.text() === original, true);
} catch (e) {
  fail++;
  console.log('  FAIL  unexpected: ' + (e && e.stack || e));
} finally {
  cleanup();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
