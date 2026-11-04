/* Bringing a LOKA space's places into an atlas.

   This file is the LOKA side and the arithmetic, nothing else: how the server
   signs in to LOKA, how a space is downloaded, how one LOKA place becomes one
   row of the same columns a LOKA export file has, and how a fresh download is
   laid beside the places an atlas already holds. Writing the atlas (the same
   path as an owner's re-upload) and the routes are in api/apps/atlas.js.

   Two ways to sign in, and the first one set wins:
     - LOKA_API_KEY: sent as X-LOKA-API-Key on the download, no renewal.
     - LOKA_REFRESH_TOKEN: swapped for a 60-minute key before each download
       (POST /auth/refresh); LOKA hands back a renewed refresh key every time,
       and the newest one lives in loka-key.json, a file only the server can
       read, so the 90-day window keeps sliding.
   Neither secret is ever logged, returned, or put in an error message. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const RULES = createRequire(import.meta.url)('../../../atlas/reading-rules.js');

/* The same folder registry.js keeps its files in (worked out here for the same
   reason questions-queue.js does it: no loading the registry from a library). */
const dataDir = () => process.env.LOKA_DATA_DIR ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'atlas');
export const keyFile = () => path.join(dataDir(), 'loka-key.json');
const base = () => String(process.env.LOKA_API_BASE || 'https://loka.place/api').replace(/\/+$/, '');

export const TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_BYTES = 200 * 1024 * 1024;

/* A reason in plain words, safe to show an owner. */
export class LokaError extends Error {}
const fail = (m) => new LokaError(m);
// "LOKA is busy. Try again in N minutes." — from Retry-After (seconds) when LOKA says how long
function busy(r) {
  const s = parseInt(r && r.headers && r.headers.get('retry-after'), 10);
  if (!(s > 0)) return fail('LOKA is busy. Try again in a few minutes.');
  const n = Math.max(1, Math.ceil(s / 60));
  return fail('LOKA is busy. Try again in ' + (n === 1 ? '1 minute' : n + ' minutes') + '.');
}

/* ---------- signing in ---------- */

function savedRefreshToken() {
  try {
    const j = JSON.parse(fs.readFileSync(keyFile(), 'utf8'));
    if (j && typeof j.refreshToken === 'string' && j.refreshToken) return j.refreshToken;
  } catch { /* none saved yet: the environment's one is used */ }
  return process.env.LOKA_REFRESH_TOKEN || '';
}

function saveRefreshToken(token) {
  const file = keyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ refreshToken: token, savedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export const isSetUp = () => Boolean(process.env.LOKA_API_KEY || savedRefreshToken());

/* The header that signs a download in. */
async function signInHeaders() {
  if (process.env.LOKA_API_KEY) return { 'X-LOKA-API-Key': process.env.LOKA_API_KEY };
  const refresh = savedRefreshToken();
  if (!refresh) throw fail('LOKA hasn’t been set up on this server yet. Your atlas is unchanged.');
  let r;
  try {
    r = await fetch(base() + '/auth/refresh', {
      method: 'POST', headers: { Authorization: 'Bearer ' + refresh }, signal: AbortSignal.timeout(30000),
    });
  } catch { throw fail('LOKA couldn’t be reached. Your atlas is unchanged.'); }
  if (r.status === 429) throw busy(r);
  if (!r.ok) throw fail('LOKA turned down the server’s sign-in. Your atlas is unchanged.');
  let j = null;
  try { j = await r.json(); } catch { /* handled below */ }
  if (!j || typeof j.token !== 'string' || !j.token) throw fail('LOKA’s sign-in came back empty. Your atlas is unchanged.');
  // the renewed key is kept every time; a failure to keep it must not lose this download
  if (typeof j.refreshToken === 'string' && j.refreshToken) {
    try { saveRefreshToken(j.refreshToken); } catch (e) { console.warn('[loka-sync] could not keep the renewed key — ' + (e && e.code)); }
  }
  return { Authorization: 'Bearer ' + j.token };
}

/* ---------- downloading ---------- */

export const SPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* One whole space, as LOKA's own places (not yet rows). Fails, and so changes
   nothing, unless the list ends with its closing line and says it is whole. */
export async function downloadSpace(spaceId) {
  if (!SPACE_ID.test(String(spaceId || ''))) throw fail('That doesn’t look like a LOKA space id.');
  const headers = await signInHeaders();
  const url = base() + '/tags/download?space_id=' + encodeURIComponent(spaceId) + '&format=ndjson';
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch { throw fail('LOKA couldn’t be reached. Your atlas is unchanged.'); }
  if (r.status === 401) throw fail('LOKA turned down the server’s sign-in. Your atlas is unchanged.');
  if (r.status === 403) throw fail('LOKA doesn’t share that space with this atlas. Your atlas is unchanged.');
  if (r.status === 429) throw busy(r);
  if (r.status === 400) throw fail('LOKA didn’t understand that space. Check the space id. Your atlas is unchanged.');
  if (!r.ok || !r.body) throw fail('LOKA couldn’t be reached. Your atlas is unchanged.');
  const chunks = []; let size = 0;
  try {
    for await (const c of r.body) {
      size += c.length;
      if (size > MAX_BYTES) throw fail('That space is bigger than this atlas can bring in. Your atlas is unchanged.');
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof LokaError) throw e;
    throw fail('LOKA’s list of places was cut short. Your atlas is unchanged.');
  }
  const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter((l) => l.trim());
  let eof = null; const tags = [];
  for (let i = 0; i < lines.length; i++) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { throw fail('LOKA’s list of places was cut short. Your atlas is unchanged.'); }
    if (o && o._eof === true) { if (i === lines.length - 1) eof = o; continue; }
    if (o && typeof o === 'object') tags.push(o);
  }
  if (!eof || eof.truncated !== false) throw fail('LOKA’s list of places was cut short. Your atlas is unchanged.');
  return { tags };
}

/* ---------- one place, one row ---------- */

/* The columns of a LOKA export file, in its order. */
export const EXPORT_COLUMNS = ['tag_id', 'description', 'categories', 'labels', 'created_by', 'created_by_user_id',
  'created_at', 'latitude', 'longitude', 'address', 'likes', 'comments', 'photo_count', 'photo_urls',
  'photo_1_url', 'photo_2_url', 'photo_3_url', 'photo_4_url', 'thumbnail_url', 'public_link', 'spaces'];

const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x)).filter(Boolean);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

/* null for a place with no usable coordinates: it cannot be put on a map. */
export function toRow(tag, spaceName) {
  const lat = num(tag && tag.latitude), lng = num(tag && tag.longitude);
  if (!tag || !tag.id || lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const photos = list(tag.image_urls);
  const str = (v) => (v == null ? '' : String(v));
  return {
    tag_id: String(tag.id),
    description: str(tag.description),
    categories: list(tag.categories).join('; '),
    labels: list(tag.labels).join('; '),
    created_by: str(tag.creatorName),
    created_by_user_id: str(tag.creator),
    created_at: str(tag.created_at),
    latitude: lat,
    longitude: lng,
    address: str(tag.address),
    likes: Number(tag.likes_count) || 0,
    comments: Number(tag.comments_count) || 0,
    photo_count: photos.length,
    photo_urls: photos.join(' | '),
    photo_1_url: photos[0] || '', photo_2_url: photos[1] || '', photo_3_url: photos[2] || '', photo_4_url: photos[3] || '',
    thumbnail_url: str(tag.thumbnail_url),
    public_link: 'https://loka.place/t/' + tag.id,
    spaces: String(spaceName || ''),
  };
}

/* Every place of a download as rows, and how many had to be left out. */
export function toRows(tags, spaceName) {
  const rows = []; let skipped = 0;
  const seen = new Set();
  for (const t of tags || []) {
    const r = toRow(t, spaceName);
    if (!r) { skipped += 1; continue; }
    if (seen.has(r.tag_id)) continue;
    seen.add(r.tag_id);
    rows.push(r);
  }
  return { rows, skipped };
}

/* ---------- laying a download beside what the atlas holds ---------- */

// the words a reading is made from: a change to any of these is a change to what its answers were about
const TEXT = ['description', 'categories', 'labels', 'address'];
const PHOTOS = ['photo_urls', 'photo_1_url', 'photo_2_url', 'photo_3_url', 'photo_4_url'];
// a saved layer keeps at most 500 characters of a cell (ingestLayer), so both sides are cut the same way
const clip = (v) => String(v == null ? '' : v).slice(0, 500);
const same = (a, b) => clip(a) === clip(b);
const sameNum = (a, b) => same(a, b) || (num(a) !== null && num(a) === num(b));
// a saved upload turns a " | " list into "; " (found on a real LOKA-layer copy), so the two spell one list
const listed = (v) => String(v == null ? '' : v).replace(/\s*[|;]\s*/g, '; ');
const differs = (cols, a, b) => cols.some((c) => !(c === 'latitude' || c === 'longitude' ? sameNum(a[c], b[c])
  : c === 'photo_urls' ? same(listed(a[c]), listed(b[c])) : same(a[c], b[c])));

/* The marker a place carries until its answers have been found
   (api/apps/atlas.js runReading looks for it, the reading's own write clears it). */
export const UNREAD = 'pattern_unread';

/* The rows the atlas should hold after this download.
     - unchanged place: the old row, whole (its answers and the atlas's own columns);
     - changed place: LOKA's new values, with the atlas's own columns kept, except
       what depended on what changed (answers when the words changed, the short
       name when the description did, the small photo when the photos did);
     - new place: the new row;
     - a place LOKA no longer lists: gone.
   `asking`: the layer already has questions, so a place needing answers is marked. */
export function lay(oldRows, rows, { asking = false } = {}) {
  const had = new Map();
  for (const o of oldRows || []) if (o && o.tag_id) had.set(String(o.tag_id), o);
  const out = []; let added = 0, changed = 0;
  const now = new Set(rows.map((r) => r.tag_id));
  for (const r of rows) {
    const o = had.get(r.tag_id);
    if (!o) { added += 1; out.push(asking ? Object.assign({}, r, { [UNREAD]: '1' }) : r); continue; }
    // the space's name is not a change to the place (a taken-over upload may carry another)
    if (!differs(EXPORT_COLUMNS.filter((c) => c !== 'spaces'), o, r)) { out.push(o); continue; }
    changed += 1;
    const row = {};
    for (const k of Object.keys(o)) if (EXPORT_COLUMNS.indexOf(k) < 0 && k.charAt(0) !== '_') row[k] = o[k];
    Object.assign(row, r);
    const words = differs(TEXT, o, r);
    if (words) for (const k of Object.keys(row)) if (/^pattern_/.test(k)) delete row[k];
    if (differs(['description'], o, r)) delete row[RULES.NAME_FIELD];
    if (differs(PHOTOS, o, r)) { delete row.photo_small; delete row.photo_file; }
    if (words && asking) row[UNREAD] = '1';
    out.push(row);
  }
  const removed = [...had.keys()].filter((id) => !now.has(id)).length;
  // every row carries every column (a saved layer is a table), the export's first
  const cols = EXPORT_COLUMNS.slice();
  for (const r of out) for (const k of Object.keys(r)) if (cols.indexOf(k) < 0) cols.push(k);
  const even = out.map((r) => { const o = {}; for (const c of cols) o[c] = r[c] === undefined ? '' : r[c]; return o; });
  return { rows: even, added, changed, removed };
}

/* The answers for only the marked places, laid beside the answers the others
   already have: one list per settled question over every place, in the order of
   the settled questions, so the write that follows is the ordinary one. Wording
   is matched trimmed, as the reading trims it. Null when a settled question
   came back with no answers for the marked places: nothing is written then, so
   a marked place is never cleared without its answer. */
export function mergeNewReading(rows, todo, labels, asked, out) {
  const t = (v) => String(v == null ? '' : v).trim();
  const at = new Map(todo.map((i, k) => [i, k]));
  const questions = [];
  for (const q of asked) {
    const col = Object.keys(labels).find((c) => RULES.isQuestionColumn(c) && t(labels[c]) === t(q.question));
    const got = (out.questions || []).find((x) => t(x.question) === t(q.question));
    if (!got || !Array.isArray(got.categories) || got.categories.length !== todo.length) return null;
    questions.push({
      question: q.question, noun: q.noun || '', columns: q.columns || [],
      counts: q.kinds.map((k) => ({ name: k.name, definition: k.definition || '' })),
      categories: rows.map((r, i) => at.has(i) ? (got.categories[at.get(i)] || '') : (col ? String(r[col] || '') : '')),
      why: rows.map((r, i) => at.has(i) ? ((got.why && got.why[at.get(i)]) || [])
        : (col ? String(r[col + '_why'] || '').split(', ').filter(Boolean) : [])),
    });
  }
  return Object.assign({}, out, { questions });
}
