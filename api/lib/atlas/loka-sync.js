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
   Neither secret is ever logged, returned, or put in an error message.
   A person's own LOKA sign-in (linking their account, below) is a third
   token that lives only inside one call and is never kept at all. */

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
  // a name of its own per write: two renewals at once must not rename each other's half-written file
  const tmp = file + '.' + process.pid + '-' + Math.random().toString(36).slice(2, 8) + '.tmp';
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

/* ---------- a person's own LOKA account ---------- */

/* An owner proves who they are to LOKA by an emailed code, from Atlas: LOKA
   sends the code (sendCode), the person types it, and linkByCode swaps it for
   a LOKA token that lives only inside that one call — it asks LOKA who the
   person is (/users/me) and which spaces they are a member of, and is then
   dropped. What comes back is kept on the Atlas account (registry.js): the
   LOKA user id, email, organisations and space memberships. Never the token. */

// one small JSON call to LOKA; a network fault is the same plain sentence everywhere
async function lokaJson(p, { method = 'GET', headers = {}, body } = {}) {
  let r;
  try {
    r = await fetch(base() + p, { method, signal: AbortSignal.timeout(30000),
      headers: Object.assign({}, headers, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw fail('LOKA couldn’t be reached. Try again in a moment.'); }
  if (r.status === 429) throw busy(r);
  let j = null;
  try { j = await r.json(); } catch { /* an answer without a body: the status says enough */ }
  return { status: r.status, j: j && typeof j === 'object' ? j : {} };
}

/* The same sentence whether or not LOKA knows the email: this route must not
   be a way to find out who has a LOKA account. Only LOKA being down is said. */
export const CODE_SENT = 'If that email has a LOKA account, a code is on its way. It can take a minute.';
export async function sendCode(email) {
  const { status } = await lokaJson('/auth/send-otp', { method: 'POST', body: { email } });
  if (status !== 200 && status !== 400 && status !== 404) throw fail('LOKA couldn’t send a code just now. Try again in a moment.');
  return CODE_SENT;
}

const strs = (v) => (Array.isArray(v) ? v : []).map((x) => String(x == null ? '' : x)).filter(Boolean);

/* The spaces a LOKA user is a member of, as the little the atlas needs. */
async function memberships(token, userId) {
  const { status, j } = await lokaJson('/users/' + encodeURIComponent(userId) + '/spaces', { headers: { Authorization: 'Bearer ' + token } });
  if (status !== 200) throw fail('LOKA signed you in but couldn’t list your spaces. Try again in a moment.');
  return (Array.isArray(j.spaces) ? j.spaces : []).filter((s) => s && s.id).map((s) => ({
    id: String(s.id), orgId: s.orgId == null ? '' : String(s.orgId), name: String(s.name || '').slice(0, 80),
    type: String(s.type || ''), role: String(s.role || '') }));
}

/* Every space LOKA shows this person (GET /spaces/mine, live 4 Nov 2026): the
   ones they are in, their organisations', and for a platform admin all of
   them. Kept as a snapshot for the build wizard's list — name, how many
   places, public or private, a small picture — and as the rule's third arm
   (mayConnect). An older LOKA without the route gives an empty list. */
async function mySpaces(token) {
  const { status, j } = await lokaJson('/spaces/mine', { headers: { Authorization: 'Bearer ' + token } });
  if (status === 404) return [];
  if (status !== 200) throw fail('LOKA signed you in but couldn’t list your spaces. Try again in a moment.');
  return (Array.isArray(j.spaces) ? j.spaces : []).filter((s) => s && s.id).map((s) => ({
    id: String(s.id), name: String(s.name || '').slice(0, 80), type: String(s.type || ''),
    role: s.role == null ? '' : String(s.role), ownerId: s.ownerId == null ? '' : String(s.ownerId),
    orgId: s.orgId == null ? '' : String(s.orgId), tagsCount: Math.max(0, Number(s.tagsCount) || 0),
    // the picture's address only, and only one that is a web address (never `thumbnail`, which may be the picture itself)
    thumbnailUrl: /^https?:\/\//.test(String(s.thumbnailUrl || '')) ? String(s.thumbnailUrl).slice(0, 500) : '',
    updatedAt: String(s.updatedAt || '') }));
}

/* Who this person is, from LOKA's own answer and nothing else. */
export async function linkByCode(email, code) {
  const got = await lokaJson('/auth/verify-otp', { method: 'POST', body: { email, otp: code } });
  // one sentence for a wrong code and for an email LOKA does not know, for the same reason as above
  if (got.status === 400 || got.status === 401 || got.status === 404) throw fail('That code didn’t work. Check it, or send a new one.');
  if (got.status !== 200 || typeof got.j.token !== 'string' || !got.j.token) throw fail('LOKA couldn’t check that code just now. Try again in a moment.');
  const token = got.j.token;
  const me = await lokaJson('/users/me', { headers: { Authorization: 'Bearer ' + token } });
  if (me.status !== 200 || !me.j.userId) throw fail('LOKA signed you in but couldn’t say who you are. Try again in a moment.');
  const lokaUserId = String(me.j.userId);
  const at = new Date().toISOString();
  return {
    lokaUserId,
    /* LOKA's own email for the person; an older LOKA that does not say it yet
       leaves the one the code was sent to, which LOKA itself just confirmed */
    lokaEmail: String(me.j.email || email),
    orgIds: strs(me.j.orgIds),
    memberSpaces: await memberships(token, lokaUserId),
    // the list is as old as the link: bringing it up to date means linking again
    spaces: await mySpaces(token),
    spacesAt: at,
    linkedAt: at,
  };
}

/* The space itself, asked with the server's own sign-in: its organisation and
   name. Null when LOKA won't show it (a private space the sync account is not
   in) or has no such space. */
export async function spaceInfo(spaceId) {
  const { status, j } = await lokaJson('/spaces/' + encodeURIComponent(spaceId), { headers: await signInHeaders() });
  if (status === 403 || status === 404) return null;
  if (status !== 200 || !j.space) throw fail('LOKA couldn’t be reached. Try again in a moment.');
  const s = j.space;
  return { id: String(s.id || spaceId), orgId: s.orgId == null ? '' : String(s.orgId), name: String(s.name || '').slice(0, 80), type: String(s.type || '') };
}

/* Whether a linked account may connect a space: any space LOKA itself listed
   for them when they linked (the snapshot: a member's, one they made, their
   organisation's, or every space for a platform admin — whatever the role,
   none included), a member of the space, or of the organisation that owns it
   (space may be null when LOKA would not show it). All of the rule is here. */
export function mayConnect(link, spaceId, space) {
  if (!link) return false;
  if ((link.spaces || []).some((s) => s.id === spaceId)) return true;
  if ((link.memberSpaces || []).some((s) => s.id === spaceId)) return true;
  return !!(space && space.orgId && (link.orgIds || []).indexOf(space.orgId) >= 0);
}
/* A space from the snapshot, as the wizard shows it: name, places, public or
   private, the picture, and the person's relation to it in plain words. */
export function spaceCard(s) {
  const role = s.role === 'Owner' ? 'You made this' : s.role === 'Org' ? 'Your organisation’s' : s.role ? 'Member' : '';
  return { id: s.id, name: s.name, type: s.type, tagsCount: s.tagsCount, thumbnailUrl: s.thumbnailUrl || '', role };
}

/* ---------- downloading ---------- */

export const SPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// a space id typed on its own, or found inside a pasted loka.place link
export function spaceIdFrom(text) {
  const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(text || ''));
  return m ? m[0].toLowerCase() : '';
}

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
