#!/usr/bin/env node
/* Small photos for an atlas's lists — any atlas.
 *
 *   node deploy/make-small-photos.mjs <atlas address>            # dry run: says what it would do
 *   node deploy/make-small-photos.mjs <atlas address> --apply    # makes them, after a backup
 *
 * A LOKA tag's photograph is a phone photo, 0.3–0.8 MB, and the small copy
 * the export names (thumbnail_url, thumb_<x>.jpg) is not there (404). A list
 * of places that shows a photo per row would fetch every full photograph. So
 * each place gets its own small copy, kept beside the atlas's data:
 *
 *   - for every place in each of the atlas's own layers (group "userdata" in
 *     manifest.local.json), its first photograph: the photo a fix put beside
 *     the data (photo_file) when there is one, else photo_1_url (else the
 *     first link in photo_urls / image_urls);
 *   - made 160 px on its longest side, JPEG quality 70 (about 5–10 KB), with
 *     Pillow (deploy/small_photo.py; ATLAS_PYTHON names the Python to use);
 *   - saved as small-<tag_id>.jpg in the atlas's folder, and the place gets
 *     photo_small = "small-<tag_id>.jpg", read by the viewer the way it reads
 *     photo_file (beside the data, through the same address, key and all).
 *
 * Why beside the data and not in a small/ folder: a private atlas's files are
 * served one name at a time (GET /api/datasets/<atlas>/<file>), and a name
 * with a "/" in it is refused. Flat names work for public and private alike.
 *
 * A photo already made from the same source is kept (small-photos.json
 * records where each came from). thumbnail_url is never touched: the upload
 * owns it. A fresh upload writes the places again without photo_small, so run
 * this again after one (the photos already made are kept, not fetched again).
 *
 * Only https links on an allowed host are fetched: loka.place by default,
 * --hosts=loka.place,example.org to name others (a host's subdomains count).
 * A download stops at 20 MB. A link not fetched is reported as a failure,
 * with why. A place that no longer has a photo loses photo_small, and its old
 * small photo is deleted (only small-*.jpg files in the atlas's own folder).
 *
 * Options: --server-is-stopped, --hosts=. Backups go to api/data/atlas/backups/
 * small-photos-<atlas>-<time>/. Never touches deoria-bioregion. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, checkSlug, checkServerStopped, backupFiles, writeJson, stop } from './event-mode-lib.mjs';

export const SIZE = 160, QUALITY = 70;
export const INDEX = 'small-photos.json';
export const MAX_BYTES = 20 * 1024 * 1024;
export const HOSTS = ['loka.place'];
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;   // what the private data route serves
export const SMALL_NAME = /^small-[A-Za-z0-9-]+\.jpg$/;  // the only files this ever deletes

// why a link is not fetched, or null when it may be: https, and a host on the list (or under one)
export function linkRefused(url, hosts = HOSTS) {
  let u;
  try { u = new URL(url); } catch { return 'not a web address'; }
  if (u.protocol !== 'https:') return 'not fetched: only https links are';
  if (u.username || u.password || u.port) return 'not fetched: an address with a login or a port';
  const h = u.hostname.toLowerCase();
  if (!hosts.some((a) => h === a || h.endsWith('.' + a))) return 'not fetched: ' + h + ' is not on the list (' + hosts.join(', ') + ')';
  return null;
}

export function python() {
  if (process.env.ATLAS_PYTHON) return process.env.ATLAS_PYTHON;
  const venv = path.join(ROOT, 'api', 'atlas-builders', '.venv', 'bin', 'python3');
  return fs.existsSync(venv) ? venv : 'python3';
}

function firstLink(v) {
  const m = String(v == null ? '' : v).match(/https:\/\/[^\s;,|"'\]]+/);
  return m ? m[0] : '';
}
// where a place's first photograph comes from: { label, file?, url? } or null
export function photoSource(props, dir) {
  const p = props || {};
  const own = String(p.photo_file || '').trim();
  if (own && SAFE_NAME.test(own) && !own.includes('..') && fs.existsSync(path.join(dir, own))) {
    const st = fs.statSync(path.join(dir, own));
    return { label: 'file:' + own + ':' + st.size, file: path.join(dir, own) };
  }
  const url = firstLink(p.photo_1_url) || firstLink(p.photo_urls) || firstLink(p.image_urls);
  return url ? { label: url, url } : null;
}
// the small photo's name: the tag's own id when it has one, else a hash of the source
export function smallName(props, label) {
  const id = String((props && props.tag_id) || '').trim();
  const key = /^[A-Za-z0-9-]{8,64}$/.test(id) ? id.toLowerCase() : crypto.createHash('sha1').update(label).digest('hex').slice(0, 16);
  return 'small-' + key + '.jpg';
}

/* One photo into a file. Redirects are followed by hand, at most three, and
   only to a host on the list; the body is counted as it comes and the
   download stopped past maxBytes. */
export async function fetchTo(url, file, hosts = HOSTS, maxBytes = MAX_BYTES) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    let r = null;
    for (let hop = 0; hop < 4; hop++) {
      const refused = linkRefused(url, hosts);
      if (refused) return hop ? 'redirected, and ' + refused : refused;
      r = await fetch(url, { signal: ctl.signal, redirect: 'manual' });
      if (r.status < 300 || r.status >= 400) break;
      const to = r.headers.get('location');
      if (!to || hop === 3) return 'too many redirects';
      url = new URL(to, url).href;
    }
    if (!r.ok) return 'the photo address answered ' + r.status;
    const type = r.headers.get('content-type') || '';
    if (type && !/^image\//.test(type)) return 'not a picture (' + type.split(';')[0] + ')';
    const said = Number(r.headers.get('content-length') || 0);
    if (said > maxBytes) { ctl.abort(); return 'larger than ' + Math.round(maxBytes / 1048576) + ' MB'; }
    const parts = [];
    let got = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > maxBytes) { ctl.abort(); return 'larger than ' + Math.round(maxBytes / 1048576) + ' MB'; }
      parts.push(value);
    }
    if (!got) return 'an empty answer';
    fs.writeFileSync(file, Buffer.concat(parts.map((x) => Buffer.from(x))));
    return null;
  } catch (e) {
    return e && e.name === 'AbortError' ? 'no answer in 30 s' : 'could not fetch (' + ((e && e.cause && e.cause.code) || (e && e.message) || e) + ')';
  } finally { clearTimeout(t); }
}

// Never deoria-bioregion — by name (any case) or by where the name actually
// points (a symlink, a server temp copy): the standing rule, checked again
// here because the core is also called from the server, which never ran
// checkSlug. See docs/server-temp-copies-link-live for why the real path
// matters as much as the one given.
function refuseDeoria(dir) {
  const bad = (s) => String(s || '').toLowerCase().indexOf('deoria-bioregion') >= 0;
  if (bad(dir)) stop('deoria-bioregion is never touched by this script');
  let real = dir;
  try { real = fs.realpathSync(dir); } catch { /* not there yet: the name already told us enough */ }
  if (bad(real)) stop('deoria-bioregion is never touched by this script');
}

/* The core: given a folder (and the slug it is known by, for backups and log
   lines), make the small photos. No checkSlug, no checkServerStopped — the
   caller already knows what folder this is and whether it is safe to write
   to right now. `onProgress({ done, total })` is called as photos are
   fetched and made, so a caller (the server) can show "120 of 200". */
export async function makeSmallPhotos(opts) {
  const { dir, slug } = opts;
  const log = opts.log || console.log;
  const onProgress = opts.onProgress || (() => {});
  refuseDeoria(dir);
  const localFile = path.join(dir, 'manifest.local.json');
  if (!fs.existsSync(localFile)) stop('this atlas has no places of its own (no manifest.local.json)');
  const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
  const layers = (local.layers || []).filter((L) => (L.group || 'userdata') === 'userdata' &&
    /\.geojson$/.test(String(L.source || '')) && SAFE_NAME.test(L.source) && fs.existsSync(path.join(dir, L.source)));
  if (!layers.length) stop('this atlas has no layers of its own with places');
  const indexFile = path.join(dir, INDEX);
  const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};

  log(opts.apply ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write');
  log('Atlas:   ' + slug + '  (' + dir + ')');
  const hosts = opts.hosts && opts.hosts.length ? opts.hosts : HOSTS;
  const files = [];          // { L, gj, changed }
  const todo = [];           // places that need a small photo made
  const failed = [];         // { name, place, why }
  const used = new Set();    // small photos still named by a place
  const was = new Set();     // small photos named before this run
  let kept = 0, none = 0, dropped = 0;
  for (const L of layers) {
    const raw = fs.readFileSync(path.join(dir, L.source), 'utf8');
    const gj = JSON.parse(raw);
    const rec = { L, gj, raw, changed: false };   // raw: to tell, at writing time, whether the file changed meanwhile
    files.push(rec);
    let n = 0;
    for (const f of gj.features || []) {
      const p = f.properties || (f.properties = {});
      n++;
      if (p.photo_small) was.add(String(p.photo_small));
      const src = photoSource(p, dir);
      if (!src) {
        none++;
        if (p.photo_small) { delete p.photo_small; rec.changed = true; dropped++; }
        continue;
      }
      const name = smallName(p, src.label);
      used.add(name);
      if (src.url && linkRefused(src.url, hosts)) {
        failed.push({ name, place: p.loka_name || p.name || p.tag_id || '', why: linkRefused(src.url, hosts) });
        continue;
      }
      const had = index[name];
      if (had && had.src === src.label && fs.existsSync(path.join(dir, name))) {
        kept++;
        if (p.photo_small !== name) { p.photo_small = name; rec.changed = true; }
        continue;
      }
      todo.push({ rec, p, src, name });
    }
    log('Places:  layer "' + L.id + '", ' + L.source + ', ' + n + ' places');
  }
  // small photos no place names any more: deleted on --apply (only small-*.jpg, only in this folder)
  const orphans = [...new Set([...was, ...Object.keys(index)])].filter((nm) => !used.has(nm) && SMALL_NAME.test(nm));
  log('Small photos: ' + todo.length + ' to make, ' + kept + ' kept as they are, ' + none + ' places with no photo' +
    (dropped ? ' (' + dropped + ' places lose theirs)' : '') + (orphans.length ? ', ' + orphans.length + ' old ones to delete' : '') +
    (failed.length ? ', ' + failed.length + ' links not fetched' : ''));
  for (const f of failed) log('         ' + f.name + ' (' + f.place + '): ' + f.why);
  if (!opts.apply) return { made: 0, kept, failed, none, todo: todo.length, orphans };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loka-small-'));
  const jobs = [];
  const total = todo.length;
  let fetched = 0;
  onProgress({ done: 0, total });
  try {
    // fetch the photographs, six at a time
    let at = 0;
    const worker = async () => {
      while (at < todo.length) {
        const t = todo[at++];
        if (t.src.file) { jobs.push({ t, in: t.src.file }); fetched++; onProgress({ done: fetched, total }); continue; }
        const into = path.join(tmp, t.name + '.src');
        const why = await fetchTo(t.src.url, into, hosts);
        if (why) failed.push({ name: t.name, place: t.p.loka_name || t.p.name || t.p.tag_id || '', why });
        else jobs.push({ t, in: into });
        fetched++;
        onProgress({ done: fetched, total });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    // make them, all in one go, into the temporary folder first
    const made = [];
    if (jobs.length) {
      const input = JSON.stringify(jobs.map((j) => ({ in: j.in, out: path.join(tmp, j.t.name) })));
      const r = spawnSync(python(), [path.join(ROOT, 'deploy', 'small_photo.py'), String(SIZE), String(QUALITY)], { input, encoding: 'utf8', maxBuffer: 1 << 26 });
      if (r.error || (r.status !== 0 && !r.stdout)) stop('could not run Python with Pillow (' + python() + '): ' + ((r.error && r.error.message) || r.stderr.trim().split('\n').pop()));
      const said = new Map(r.stdout.trim().split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); return [path.basename(o.out), o]; }));
      for (const j of jobs) {
        const o = said.get(j.t.name);
        if (o && o.ok) made.push({ j, bytes: o.bytes });
        else failed.push({ name: j.t.name, place: j.t.p.loka_name || j.t.p.name || j.t.p.tag_id || '', why: (o && o.why) || 'Pillow said nothing about it' });
      }
    }
    onProgress({ done: total, total });
    // the caller may say no at the last moment (the server: a rebuild has started) — nothing is written
    if (opts.beforeWrite && opts.beforeWrite() === false) { log('Stopped: the atlas is being rebuilt; nothing written'); return { made: 0, kept, failed, none, stopped: true }; }
    for (const m of made) { m.j.t.p.photo_small = m.j.t.name; m.j.t.rec.changed = true; }
    /* Never write back the copy read minutes ago: a reading or a commit may have
       replaced a file since (new places, new answers, short names). Each file is
       read again now. Unchanged: this run's copy is written. Changed, and every
       place carries a tag_id: only photo_small is carried across, by tag_id.
       Changed, and some place has no tag_id: the file is left as it is — a place
       cannot be matched by its position when places may have moved — and the
       next run (the commit that changed it queued one) gives it its photos. */
    const plan = [];   // { file, out } to write
    const onDisk = []; // every layer's places as they will be after this run
    const hasIds = (g) => (g.features || []).every((f) => f && f.properties && f.properties.tag_id);
    let leftAlone = 0;
    for (const r of files) {
      const file = path.join(dir, r.L.source);
      let raw2, fresh;
      try { raw2 = fs.readFileSync(file, 'utf8'); fresh = JSON.parse(raw2); } catch { continue; }
      if (!r.changed) { onDisk.push(fresh); continue; }
      if (raw2 === r.raw) { plan.push({ file, out: r.gj }); onDisk.push(r.gj); continue; }
      if (!hasIds(r.gj) || !hasIds(fresh)) { leftAlone++; onDisk.push(fresh); continue; }
      const small = new Map((r.gj.features || []).map((f) => [f.properties.tag_id, f.properties.photo_small]));
      const before = new Map((JSON.parse(r.raw).features || []).map((f) => [f.properties.tag_id, f.properties.photo_small]));
      for (const f of fresh.features || []) {
        if (!small.has(f.properties.tag_id)) continue;   // a place added since: the next run gives it its photo
        const v = small.get(f.properties.tag_id);
        if (v) f.properties.photo_small = v;
        // take a name away only if it is still the one this run saw: a name written meanwhile stays
        else if (f.properties.photo_small === before.get(f.properties.tag_id)) delete f.properties.photo_small;
      }
      plan.push({ file, out: fresh });
      onDisk.push(fresh);
    }
    // a small photo is deleted only when no place names it in the files as they will be
    const stillNamed = new Set();
    for (const g of onDisk) for (const f of g.features || []) if (f && f.properties && f.properties.photo_small) stillNamed.add(String(f.properties.photo_small));
    const dead = orphans.filter((nm) => !stillNamed.has(nm));
    const gone = dead.filter((nm) => fs.existsSync(path.join(dir, nm)) && path.dirname(path.resolve(dir, nm)) === path.resolve(dir));
    // a backup of every file about to change, then the writes
    const backup = backupFiles('small-photos', slug, dir, plan.map((x) => path.basename(x.file)).concat([INDEX], gone));
    log('Backup:  ' + backup);
    for (const nm of dead) delete index[nm];
    for (const nm of gone) fs.unlinkSync(path.join(dir, nm));
    for (const m of made) {
      fs.copyFileSync(path.join(tmp, m.j.t.name), path.join(dir, m.j.t.name));
      index[m.j.t.name] = { src: m.j.t.src.label, bytes: m.bytes, at: new Date().toISOString() };
    }
    for (const x of plan) writeJson(x.file, x.out);
    if (leftAlone) log('Left as they are: ' + leftAlone + ' files changed meanwhile whose places have no tag_id (the next run does them)');
    writeJson(path.join(dir, INDEX), index, 1);
    const sizes = made.map((m) => m.bytes).sort((a, b) => a - b);
    const kb = (b) => (b / 1024).toFixed(1) + ' KB';
    log('Made:    ' + made.length + (sizes.length ? ' (median ' + kb(sizes[sizes.length >> 1]) + ', largest ' + kb(sizes[sizes.length - 1]) + ')' : ''));
    log('Kept:    ' + kept);
    log('Deleted: ' + gone.length + ' small photos no place names any more');
    log('Failed:  ' + failed.length);
    for (const f of failed) log('         ' + f.name + ' (' + f.place + '): ' + f.why);
    if (made.length) log('Example: ' + made[0].j.t.name + ' from ' + made[0].j.t.src.label);
    log('Wrote:   ' + plan.map((x) => path.basename(x.file)).concat([INDEX]).join(', ') + ' and ' + made.length + ' small photos');
    log('Done. Undo: copy the files in the backup folder back into place.');
    return { made: made.length, kept, failed, none, sizes, backup, deleted: gone.length };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// CLI entry: the checks that only make sense run by hand — a real atlas
// address, never NEVER, the server stopped before anything is written —
// then the core above does the actual work.
export async function run(opts) {
  const command = 'make-small-photos.mjs';
  const dir = checkSlug(opts.slug, command);
  if (opts.apply) await checkServerStopped(opts.serverIsStopped);
  return makeSmallPhotos({ ...opts, dir });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  try {
    const hosts = (args.find((a) => a.startsWith('--hosts=')) || '').slice(8).split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    await run({ slug: args.find((a) => !a.startsWith('--')), apply: args.includes('--apply'), serverIsStopped: args.includes('--server-is-stopped'), hosts });
  } catch (e) {
    console.error('Stopped: ' + (e && e.message));
    if (!(e && e.stop)) console.error(e && e.stack);
    process.exit(1);
  }
}
