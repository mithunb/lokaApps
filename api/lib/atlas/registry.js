// Atlas instance/account registry — one JSON file, one Node process, atomic writes
// (same tmp+rename discipline as the wildlife cache). SQLite only if scale demands.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* LOKA_DATA_DIR is for the checks in test/: a throwaway folder, so a check can
   start a real server and make a real atlas private without touching the
   registry this checkout keeps. Never set in production. */
export const DATA_DIR = process.env.LOKA_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'atlas');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set([
  'api', 'a', 'app', 'apps', 'atlas', 'setup', 'create', 'datasets', 'new',
  'admin', 'auth', 'jobs', 'instances', 'drafts', 'layers', 'share', 'static',
  'deoria-bioregion',
]);

let db = { instances: {}, accounts: {}, drafts: {}, lokaRequests: {} };

function load() {
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const obj = JSON.parse(raw);
    db = {
      instances: obj.instances || {},
      accounts: obj.accounts || {},
      drafts: obj.drafts || {},
      lokaRequests: obj.lokaRequests || {},
    };
    console.log(`[atlas] registry: ${Object.keys(db.instances).length} instances, ${Object.keys(db.accounts).length} accounts`);
    // only ever after a successful read: a failed one leaves db empty, and
    // pruning against an empty instance map would erase every account's list
    const dropped = pruneOrphanedLinks();
    for (const [email, slugs] of Object.entries(dropped)) {
      console.log(`[atlas] registry: dropped stale atlas links for ${email}: ${slugs.join(', ')}`);
    }
  } catch {
    // first run
  }
}

let persistPending = false;
export function persist() {
  if (persistPending) return;
  persistPending = true;
  setImmediate(() => {
    persistPending = false;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = REGISTRY_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, REGISTRY_FILE);
    } catch (e) {
      console.warn('[atlas] registry persist failed:', e.message);
    }
  });
}

// Loaded here, not beside the declaration of db: load() prunes stale account
// links, pruning persists, and persist() reads state declared below it — from
// above, that is a temporal-dead-zone ReferenceError that load()'s own catch
// would swallow in silence.
load();

/* ---------- tokens ---------- */

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}
export function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

/* ---------- slugs ---------- */

export function validSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug) && !RESERVED.has(slug);
}
export function slugAvailable(slug, datasetsRoot) {
  if (!validSlug(slug)) return false;
  if (db.instances[slug]) return false;
  if (datasetsRoot && fs.existsSync(path.join(datasetsRoot, slug))) return false;
  return true;
}
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/* ---------- instances ---------- */

export function getInstance(slug) {
  return db.instances[slug] || null;
}
export function allInstances() {
  return Object.values(db.instances);
}
export function listPublic() {
  return Object.values(db.instances)
    .filter((i) => i.status === 'published' && i.visibility === 'public')
    .map(publicFields);
}
export function publicFields(i) {
  return {
    slug: i.slug, title: i.title, subtitle: i.subtitle || '', org: i.org || '',
    regionLabel: i.regionLabel || '', tier: i.tier, publishedAt: i.publishedAt || null,
  };
}
export function createInstance(fields) {
  db.instances[fields.slug] = fields;
  persist();
  return fields;
}
export function updateInstance(slug, patch) {
  const cur = db.instances[slug];
  if (!cur) return null;
  Object.assign(cur, patch);
  persist();
  return cur;
}
export function deleteInstance(slug) {
  delete db.instances[slug];
  // An atlas is listed under its owner AND under every collaborator it was
  // linked to, so deleting the instance alone left the slug in several
  // people's "Your atlases" — an entry they can see and never open.
  dropLinksTo(slug);
  for (const r of Object.values(db.lokaRequests)) if (r.slug === slug) delete db.lokaRequests[r.id];
  persist();
}
// Every account reference to one slug, gone. Returns the emails it touched.
function dropLinksTo(slug) {
  const touched = [];
  for (const acc of Object.values(db.accounts)) {
    if (!Array.isArray(acc.instances) || !acc.instances.includes(slug)) continue;
    acc.instances = acc.instances.filter((s) => s !== slug);
    touched.push(acc.email);
  }
  return touched;
}

// Self-healing for references that predate the fix above, and for any future
// path that removes an instance without coming through deleteInstance. An
// account pointing at an instance that does not exist is always stale: nothing
// creates the link before the instance, and drafts live in their own map.
export function pruneOrphanedLinks() {
  const live = new Set(Object.keys(db.instances));
  const dropped = {};
  for (const acc of Object.values(db.accounts)) {
    if (!Array.isArray(acc.instances)) continue;
    const gone = acc.instances.filter((s) => !live.has(s));
    if (!gone.length) continue;
    acc.instances = acc.instances.filter((s) => live.has(s));
    dropped[acc.email] = gone;
  }
  if (Object.keys(dropped).length) persist();
  return dropped;
}
export function instanceCount() {
  return Object.keys(db.instances).length;
}
export function countByIpSince(ip, sinceMs) {
  return Object.values(db.instances)
    .filter((i) => i.createdByIp === ip && i.createdAt >= sinceMs).length;
}

/* ---------- accounts (email = id; magic-link verified) ---------- */

export function getAccount(email) {
  return db.accounts[normEmail(email)] || null;
}
export function upsertAccount(email) {
  const key = normEmail(email);
  if (!db.accounts[key]) {
    db.accounts[key] = { email: key, createdAt: Date.now(), verifiedAt: null, instances: [] };
  }
  persist();
  return db.accounts[key];
}
export function markVerified(email) {
  const acc = upsertAccount(email);
  acc.verifiedAt = Date.now();
  persist();
  return acc;
}
// Who the person is — captured once after their first sign-in; used to credit
// contributed layers ("Added by <org>").
export function setProfile(email, { name, org }) {
  const acc = upsertAccount(email);
  if (name != null) acc.name = String(name).trim().slice(0, 80);
  if (org != null) acc.org = String(org).trim().slice(0, 60);
  persist();
  return acc;
}
export function bindInstance(email, slug) {
  const acc = upsertAccount(email);
  if (!acc.instances.includes(slug)) acc.instances.push(slug);
  const inst = db.instances[slug];
  if (inst) inst.ownerAccount = normEmail(email);
  persist();
}
// Link an atlas to an account WITHOUT transferring ownership — used for invited
// collaborators, so the atlas shows up under their "Your atlases".
export function linkInstance(email, slug) {
  const acc = upsertAccount(email);
  if (!acc.instances.includes(slug)) acc.instances.push(slug);
  persist();
}
export function unlinkInstance(email, slug) {
  const acc = db.accounts[normEmail(email)];
  if (acc) acc.instances = acc.instances.filter((s) => s !== slug);
  persist();
}

/* ---------- collaborators ----------

   An atlas has one account that made it, and any number of people invited to
   work on it. An invitation used to mean one thing: editor, which is allowed to
   add its own layers and change the ones it added. It can now mean owner
   instead, which is allowed everything the account that made the atlas is —
   publishing it, asking questions of any layer on it, removing it.

   An atlas can therefore have several owners. The one that made it keeps its
   place in ownerAccount, because that is who the atlas is listed under and who
   an invitation says it came from; the others are collaborators wearing the
   owner role. Nobody is ever demoted by being invited again: asking for editor
   where owner already stands leaves owner alone. */
export function collaboratorRole(inst, email) {
  const key = normEmail(email);
  const c = (inst && (inst.collaborators || []).find((x) => x.email === key));
  if (!c) return null;
  return c.role === 'owner' ? 'owner' : 'editor';
}

export function addCollaborator(slug, email, role) {
  const inst = db.instances[slug];
  if (!inst) return null;
  const key = normEmail(email);
  const want = role === 'owner' ? 'owner' : 'editor';
  inst.collaborators = inst.collaborators || [];
  let c = inst.collaborators.find((x) => x.email === key);
  if (!c) {
    c = { email: key, invitedAt: Date.now(), acceptedAt: null, role: want };
    inst.collaborators.push(c);
  } else if (want === 'owner') {
    c.role = 'owner';                 // raised; never lowered by a second invite
  } else if (!c.role) {
    c.role = 'editor';
  }
  linkInstance(key, slug);
  persist();
  return c;
}
export function removeCollaborator(slug, email) {
  const inst = db.instances[slug];
  if (!inst) return false;
  const key = normEmail(email);
  const before = (inst.collaborators || []).length;
  inst.collaborators = (inst.collaborators || []).filter((x) => x.email !== key);
  if (inst.ownerAccount !== key) unlinkInstance(key, slug); // never detach the owner
  persist();
  return inst.collaborators.length < before;
}
export function isCollaborator(inst, email) {
  const key = normEmail(email);
  return !!(inst && (inst.collaborators || []).some((x) => x.email === key));
}
// First sign-in after an invite marks it accepted (called on OTP verification).
export function acceptInvites(email) {
  const key = normEmail(email);
  let n = 0;
  for (const inst of Object.values(db.instances)) {
    const c = (inst.collaborators || []).find((x) => x.email === key && !x.acceptedAt);
    if (c) { c.acceptedAt = Date.now(); n++; }
  }
  if (n) persist();
  return n;
}
/* ---------- the account's own LOKA sign-in ----------

   What LOKA said about the person when they linked their account from Atlas
   (api/lib/atlas/loka-sync.js linkByCode): their LOKA user id and email, the
   organisations they are in, the spaces they are a member of, and every space
   LOKA lists for them (the snapshot the build wizard picks from, as old as
   the link). It is what lets an owner connect an atlas to a space of theirs.
   Kept on the account, not on any atlas, and never any LOKA token. Linking
   again replaces it. */
export function setLokaLink(email, link) {
  const acc = upsertAccount(email);
  acc.lokaLink = {
    lokaUserId: String(link.lokaUserId), lokaEmail: String(link.lokaEmail || ''),
    orgIds: (link.orgIds || []).map(String), memberSpaces: (link.memberSpaces || []).map((s) => ({
      id: String(s.id), orgId: String(s.orgId || ''), name: String(s.name || ''), type: String(s.type || ''), role: String(s.role || '') })),
    spaces: (link.spaces || []).map((s) => ({
      id: String(s.id), name: String(s.name || ''), type: String(s.type || ''), role: String(s.role || ''), ownerId: String(s.ownerId || ''),
      orgId: String(s.orgId || ''), tagsCount: Number(s.tagsCount) || 0, updatedAt: String(s.updatedAt || ''),
      // a web address or nothing: it goes into an <img> on the wizard
      thumbnailUrl: /^https?:\/\//.test(String(s.thumbnailUrl || '')) ? String(s.thumbnailUrl).slice(0, 500) : '' })),
    spacesAt: link.spacesAt || link.linkedAt || new Date().toISOString(),
    linkedAt: link.linkedAt || new Date().toISOString(),
  };
  persist();
  return acc.lokaLink;
}
export function clearLokaLink(email) {
  const acc = db.accounts[normEmail(email)];
  if (acc && acc.lokaLink) { delete acc.lokaLink; persist(); }
}
export function lokaLinkOf(email) {
  const acc = db.accounts[normEmail(email)];
  return acc && acc.lokaLink ? acc.lokaLink : null;
}

/* ---------- asking to connect a space one may not ----------

   An owner whose LOKA account is in neither a space nor its organisation asks
   the operator for that one space on that one atlas. One open request per
   (atlas, space, person); the operator approves or declines it. */
// { request, created }: created is false when the same open request already stood
export function askLokaAccess({ slug, spaceId, spaceName, by }) {
  const who = normEmail(by);
  const open = Object.values(db.lokaRequests).find((r) => r.slug === slug && r.spaceId === spaceId && r.by === who && r.state === 'pending');
  if (open) return { request: open, created: false };
  const id = crypto.randomBytes(8).toString('hex');
  db.lokaRequests[id] = { id, slug, spaceId, spaceName: String(spaceName || '').slice(0, 80), by: who, at: new Date().toISOString(), state: 'pending', decidedAt: null };
  persist();
  return { request: db.lokaRequests[id], created: true };
}
export function lokaRequests(where = {}) {
  return Object.values(db.lokaRequests).filter((r) => Object.keys(where).every((k) => r[k] === where[k]));
}
export function decideLokaAccess(id, state) {
  const r = db.lokaRequests[id];
  if (!r || (state !== 'approved' && state !== 'declined')) return null;
  r.state = state; r.decidedAt = new Date().toISOString();
  persist();
  return r;
}

export function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}
export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(email));
}

/* ---------- drafts (registered users only) ---------- */

export function saveDraft(email, draft) {
  const id = draft.id || crypto.randomBytes(8).toString('hex');
  db.drafts[id] = { ...draft, id, owner: normEmail(email), updatedAt: Date.now() };
  persist();
  return db.drafts[id];
}
export function listDrafts(email) {
  const key = normEmail(email);
  return Object.values(db.drafts).filter((d) => d.owner === key);
}
export function getDraft(id) {
  return db.drafts[id] || null;
}
export function deleteDraft(id) {
  delete db.drafts[id];
  persist();
}
