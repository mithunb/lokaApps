// Atlas instance/account registry — one JSON file, one Node process, atomic writes
// (same tmp+rename discipline as the wildlife cache). SQLite only if scale demands.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'atlas');
const REGISTRY_FILE = path.join(DATA_DIR, 'registry.json');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set([
  'api', 'a', 'app', 'apps', 'atlas', 'setup', 'create', 'datasets', 'new',
  'admin', 'auth', 'jobs', 'instances', 'drafts', 'layers', 'share', 'static',
  'deoria-bioregion',
]);

let db = { instances: {}, accounts: {}, drafts: {} };
load();

function load() {
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf8');
    const obj = JSON.parse(raw);
    db = {
      instances: obj.instances || {},
      accounts: obj.accounts || {},
      drafts: obj.drafts || {},
    };
    console.log(`[atlas] registry: ${Object.keys(db.instances).length} instances, ${Object.keys(db.accounts).length} accounts`);
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
  persist();
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
export function bindInstance(email, slug) {
  const acc = upsertAccount(email);
  if (!acc.instances.includes(slug)) acc.instances.push(slug);
  const inst = db.instances[slug];
  if (inst) inst.ownerAccount = normEmail(email);
  persist();
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
