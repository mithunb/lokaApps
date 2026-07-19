// LOKA Atlas API — instance wizard backend.
// Mounted by server.js as an Express Router at /api/atlas (see the `router` export).
//
// Design notes:
// - Anyone can create & publish a PUBLIC atlas without login (free-tier layers).
// - Magic-link registration is required only to save drafts or build PRIVATE atlases.
// - Layers whose catalog `cost` is "approval" park the instance as pending-approval
//   and email the admin signed approve/deny links.
// - Builds run through the FIFO queue in lib/atlas/jobs.js (Python orchestrator).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as reg from '../lib/atlas/registry.js';
import * as auth from '../lib/atlas/auth.js';
import { sendMail } from '../lib/mailer.js';
import {
  enqueueBuild, getJob, setJobDoneHook, DATASETS_ROOT, PRIVATE_ROOT,
} from '../lib/atlas/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const CATALOG_FILE = path.join(REPO_ROOT, 'atlas', 'setup', 'catalog.json');
const GEOCACHE_DIR = path.join(reg.DATA_DIR, 'geocache');

const FREE_AREA_DEG2 = Number(process.env.ATLAS_MAX_AREA_DEG2) || 6;   // beyond this: admin approval
const HARD_AREA_DEG2 = Number(process.env.ATLAS_HARD_AREA_DEG2) || 40; // beyond this: refuse politely
const MAX_INSTANCES = Number(process.env.ATLAS_MAX_INSTANCES) || 50;
const PER_IP_PER_DAY = Number(process.env.ATLAS_PER_IP_PER_DAY) || 3;
const ADMIN_EMAIL = process.env.ATLAS_ADMIN_EMAIL || 'mithun@socratus.org';

export const router = express.Router();
// Data ingests carry whole tables; everything else stays small.
const jsonBig = express.json({ limit: '10mb' });
const jsonStd = express.json({ limit: '2mb' });
router.use((req, res, next) => (req.path === '/layers/ingest' ? jsonBig : jsonStd)(req, res, next));

/* ================= catalog ================= */

let catalogCache = null, catalogMtime = 0;
function catalog() {
  const mtime = fs.statSync(CATALOG_FILE).mtimeMs;
  if (!catalogCache || mtime !== catalogMtime) {
    catalogCache = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    catalogMtime = mtime;
  }
  return catalogCache;
}
function tierOf(iso3) {
  return iso3 === 'IND' ? 'india' : 'global';
}
function layersForTier(tier) {
  return catalog().layers.filter((l) => l.tiers.includes(tier));
}

router.get('/catalog', (req, res) => {
  const iso3 = String(req.query.iso3 || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) return res.status(400).json({ error: 'iso3 required' });
  const tier = tierOf(iso3);
  res.json({ tier, layers: layersForTier(tier) });
});

router.get('/config', (_req, res) => {
  res.json({ freeAreaDeg2: FREE_AREA_DEG2, hardAreaDeg2: HARD_AREA_DEG2 });
});

/* ================= geography (geoBoundaries picker data) ================= */

const GB_API = (iso3, lvl) =>
  `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM${lvl}/`;

async function loadAdmin(iso3, level) {
  fs.mkdirSync(GEOCACHE_DIR, { recursive: true });
  const cacheFile = path.join(GEOCACHE_DIR, `${iso3}-ADM${level}.json`);
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {}

  const metaRes = await fetch(GB_API(iso3, level), {
    headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' },
  });
  if (!metaRes.ok) throw new Error(`geoBoundaries meta ${metaRes.status}`);
  const meta = await metaRes.json();
  const gjUrl = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!gjUrl) throw new Error('no geometry URL in geoBoundaries response');
  const gjRes = await fetch(gjUrl, { headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' } });
  if (!gjRes.ok) throw new Error(`geoBoundaries geojson ${gjRes.status}`);
  const gj = await gjRes.json();

  const features = (gj.features || []).map((f) => ({
    type: 'Feature',
    properties: {
      name: f.properties.shapeName || f.properties.shapeID,
      id: f.properties.shapeID || f.properties.shapeName,
    },
    geometry: f.geometry,
    bbox: featureBbox(f.geometry),
  }));
  const doc = {
    iso3, level, fetchedAt: Date.now(),
    fullResUrl: meta.gjDownloadURL || gjUrl,
    license: meta.boundaryLicense || 'CC-BY 4.0',
    features,
  };
  const tmp = cacheFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, cacheFile);
  return doc;
}

function featureBbox(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  eachCoord(geom, (x, y) => {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  });
  return [w, s, e, n];
}
function eachCoord(geom, fn) {
  const walk = (c) => {
    if (typeof c[0] === 'number') fn(c[0], c[1]);
    else c.forEach(walk);
  };
  if (geom && geom.coordinates) walk(geom.coordinates);
}
// ray-cast against outer rings — plenty for assigning admin2 to a parent in the picker
function pointInGeom(x, y, geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.type === 'MultiPolygon' ? geom.coordinates.map((p) => p[0]) : [];
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// Which ADM depths does geoBoundaries actually have for this country? (cached probe)
const MAX_LEVEL = 4;
router.get('/geo/levels', async (req, res) => {
  const iso3 = String(req.query.iso3 || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(iso3)) return res.status(400).json({ error: 'iso3 required' });
  fs.mkdirSync(GEOCACHE_DIR, { recursive: true });
  const cacheFile = path.join(GEOCACHE_DIR, `${iso3}-levels.json`);
  try {
    return res.json(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  } catch {}
  const MAX_LEVEL_MB = Number(process.env.ATLAS_MAX_LEVEL_MB) || 80;
  const levels = [];
  for (let l = 1; l <= MAX_LEVEL; l++) {
    try {
      const r = await fetch(GB_API(iso3, l), { headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' } });
      if (!r.ok) break;
      const meta = await r.json();
      const url = meta && (meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL);
      if (!url) break;
      // very deep levels of big countries can be enormous — skip what we can't serve
      if (l >= 3) {
        try {
          const h = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'LOKA-Atlas (mithun@socratus.org)' } });
          const size = Number(h.headers.get('content-length') || 0);
          if (size > MAX_LEVEL_MB * 1024 * 1024) break;
        } catch {}
      }
      levels.push(l);
    } catch { break; }
  }
  const doc = { iso3, levels: levels.length ? levels : [1] };
  try { fs.writeFileSync(cacheFile, JSON.stringify(doc)); } catch {}
  res.json(doc);
});

router.get('/geo/admin', async (req, res) => {
  const iso3 = String(req.query.iso3 || '').toUpperCase();
  const level = Number(req.query.level) || 1;
  if (!/^[A-Z]{3}$/.test(iso3) || level < 1 || level > MAX_LEVEL) {
    return res.status(400).json({ error: `iso3 and level (1–${MAX_LEVEL}) required` });
  }
  try {
    const doc = await loadAdmin(iso3, level);
    let features = doc.features;
    const parents = String(req.query.parents || '').split(',').filter(Boolean);
    if (parents.length && level > 1) {
      const up = await loadAdmin(iso3, level - 1);
      const parentGeoms = up.features
        .filter((f) => parents.includes(f.properties.id))
        .map((f) => f.geometry);
      features = features.filter((f) => {
        const [w, s, e, n] = f.bbox;
        const cx = (w + e) / 2, cy = (s + n) / 2;
        return parentGeoms.some((g) => pointInGeom(cx, cy, g));
      });
    }
    res.json({ type: 'FeatureCollection', license: doc.license, features });
  } catch (e) {
    console.warn('[atlas] geo/admin failed:', e.message);
    res.status(502).json({ error: 'boundary source unavailable: ' + e.message });
  }
});

/* ================= slug ================= */

router.get('/slug-check', (req, res) => {
  const slug = String(req.query.slug || '');
  res.json({
    slug,
    valid: reg.validSlug(slug),
    available: reg.slugAvailable(slug, DATASETS_ROOT) && !fs.existsSync(path.join(PRIVATE_ROOT, slug)),
  });
});

/* ================= instance creation ================= */

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress || 'unknown';
}
function cap(str, n) {
  return String(str || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
}
function siteBase(req) {
  if (process.env.ATLAS_PUBLIC_BASE) return process.env.ATLAS_PUBLIC_BASE.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8181';
  const proto = req.headers['x-forwarded-proto'] ||
    (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
function validLogo(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 200 * 1024) return null;
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) return null;
  return dataUrl;
}

router.post('/instances', async (req, res) => {
  const b = req.body || {};
  const session = auth.sessionFromReq(req);
  const ip = clientIp(req);

  // limits first
  if (reg.instanceCount() >= MAX_INSTANCES) {
    return res.status(429).json({ error: 'instance limit reached — contact us to raise it' });
  }
  if (reg.countByIpSince(ip, Date.now() - 24 * 3600 * 1000) >= PER_IP_PER_DAY) {
    return res.status(429).json({ error: 'daily creation limit reached — try again tomorrow' });
  }

  // fields
  const title = cap(b.title, 80);
  const subtitle = cap(b.subtitle, 160);
  const about = cap(b.about, 500);
  const org = cap(b.org, 60);
  const email = reg.normEmail(session ? session.email : b.email);
  const visibility = b.visibility === 'private' ? 'private' : 'public';
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (b.email && !reg.validEmail(b.email)) return res.status(400).json({ error: 'invalid email' });

  if (visibility === 'private' && !session) {
    return res.status(401).json({ error: 'private atlases need a verified email', needsAuth: true });
  }

  const branding = {
    orgName: cap(b.branding && b.branding.orgName, 60) || org,
    orgUrl: /^https:\/\/[^\s]+$/.test((b.branding && b.branding.orgUrl) || '') ? b.branding.orgUrl.slice(0, 200) : '',
    footerLine: cap(b.branding && b.branding.footerLine, 160),
    logoData: validLogo(b.branding && b.branding.logoData),
  };

  // region
  const r = b.region || {};
  const iso3 = String(r.iso3 || '').toUpperCase();
  const level = Number(r.level) || 1;
  const shapeIDs = Array.isArray(r.shapeIDs) ? r.shapeIDs.map(String).slice(0, 100) : [];
  if (!/^[A-Z]{3}$/.test(iso3) || !shapeIDs.length) {
    return res.status(400).json({ error: 'region (iso3 + shapeIDs) is required' });
  }
  let regionDoc;
  try {
    regionDoc = await loadAdmin(iso3, level);
  } catch (e) {
    return res.status(502).json({ error: 'boundary source unavailable: ' + e.message });
  }
  const picked = regionDoc.features.filter((f) => shapeIDs.includes(f.properties.id));
  if (!picked.length) return res.status(400).json({ error: 'no matching boundary units' });
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of picked) {
    w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]);
    e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]);
  }
  const areaDeg2 = (e - w) * (n - s);
  if (areaDeg2 > HARD_AREA_DEG2) {
    return res.status(400).json({
      error: 'That region is larger than a single atlas can cover right now — open a unit on the map and pick smaller areas inside it.',
      tooLarge: true,
    });
  }
  // Bigger than the free tier → same approval pipeline as heavy layers.
  const largeRegion = areaDeg2 > FREE_AREA_DEG2;
  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  // tier + layers
  const tier = tierOf(iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : []).filter((id) => allowed.has(id));
  for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  if (!layerIds.length) return res.status(400).json({ error: 'no valid layers chosen' });

  // slug
  const slug = b.slug ? String(b.slug) : reg.slugify(`${title}`);
  if (!reg.slugAvailable(slug, DATASETS_ROOT) || fs.existsSync(path.join(PRIVATE_ROOT, slug))) {
    return res.status(409).json({ error: 'slug unavailable', slug });
  }

  // cost gate: heavy layers OR a large region both go through admin approval
  const approvalLayers = layerIds.filter((id) => allowed.get(id).cost === 'approval');
  const approvalReasons = [];
  if (approvalLayers.length) approvalReasons.push(`heavy layers: ${approvalLayers.join(', ')}`);
  if (largeRegion) approvalReasons.push(`large region: ${regionLabel} (~${Math.round(areaDeg2 * 12300).toLocaleString('en-IN')} km²)`);
  const needsApproval = approvalReasons.length > 0;
  if (needsApproval && !reg.validEmail(email)) {
    return res.status(400).json({ error: 'this build needs a quick approval from the LOKA team — add a contact email so we can reach you', needsEmail: true });
  }

  const editToken = reg.newToken();
  const viewKey = visibility === 'private' ? reg.newToken() : null;

  const spec = {
    slug, visibility, tier, title, subtitle, about, branding,
    region: {
      iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n],
      simplifiedFile: path.join(GEOCACHE_DIR, `${iso3}-ADM${level}.json`),
      fullResUrl: regionDoc.fullResUrl,
    },
    layers: layerIds,
  };

  reg.createInstance({
    slug, title, subtitle, about, org, email: email || null, branding: { ...branding, logoData: undefined, hasLogo: !!branding.logoData },
    ownerAccount: session ? session.email : null,
    tier, region: { iso3, level, shapeIDs, shapeNames, bbox: [w, s, e, n], areaDeg2 }, regionLabel,
    layers: layerIds, visibility,
    tokenHash: reg.hashToken(editToken),
    viewKeyHash: viewKey ? reg.hashToken(viewKey) : null,
    status: needsApproval ? 'pending-approval' : 'building',
    createdAt: Date.now(), publishedAt: null, sizeBytes: 0, createdByIp: ip,
    jobId: null, spec,
  });
  if (session) reg.bindInstance(session.email, slug);

  let jobId = null;
  if (needsApproval) {
    const base = siteBase(req);
    const approve = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'approve')}`;
    const deny = `${base}/apps/atlas/api/admin/action?token=${auth.makeActionToken(slug, 'deny')}`;
    await sendMail({
      to: ADMIN_EMAIL,
      subject: `[LOKA Atlas] approval needed: ${title} (${slug})`,
      text: `New atlas needs approval (${approvalReasons.join('; ')}).\n\n` +
        `Org: ${org || '—'}\nContact: ${email}\nRegion: ${regionLabel} (${iso3}, ${areaDeg2.toFixed(1)} deg²)\n` +
        `Layers: ${layerIds.join(', ')}\nVisibility: ${visibility}\n\n` +
        `Approve: ${approve}\nDeny:    ${deny}\n`,
    });
  } else {
    jobId = enqueueBuild(spec);
    reg.updateInstance(slug, { jobId });
  }

  res.json({
    slug, jobId, status: needsApproval ? 'pending-approval' : 'building',
    editToken, viewKey: viewKey || undefined,
  });
});

/* ================= approval ================= */

router.get('/admin/action', async (req, res) => {
  const p = auth.readActionToken(String(req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This approval link is invalid or has expired.'));
  const inst = reg.getInstance(p.slug);
  if (!inst) return res.status(404).send(page('Not found', 'That atlas no longer exists.'));
  if (inst.status !== 'pending-approval') {
    return res.send(page('Already handled', `“${inst.title}” is already ${inst.status}.`));
  }
  if (p.action === 'approve') {
    const jobId = enqueueBuild(inst.spec);
    reg.updateInstance(p.slug, { status: 'building', jobId });
    if (inst.email) {
      await sendMail({
        to: inst.email,
        subject: `[LOKA Atlas] approved: ${inst.title}`,
        text: `Your atlas “${inst.title}” was approved and is building now.\nCheck progress in the wizard, or view it soon at your atlas link.`,
      });
    }
    return res.send(page('Approved', `“${inst.title}” approved — build queued.`));
  }
  reg.updateInstance(p.slug, { status: 'denied' });
  if (inst.email) {
    await sendMail({
      to: inst.email,
      subject: `[LOKA Atlas] not approved: ${inst.title}`,
      text: `Your atlas “${inst.title}” wasn't approved this time. Reply to this email if you'd like to talk it through.`,
    });
  }
  res.send(page('Denied', `“${inst.title}” denied.`));
});

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title} — LOKA Atlas</title>` +
    `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#2B2723;background:#E6E4DF">` +
    `<h2>${title}</h2><p>${body}</p></body>`;
}

/* ================= jobs ================= */

setJobDoneHook((job) => {
  const inst = reg.getInstance(job.slug);
  if (!inst) return;
  const keepPublished = inst.rebuildKeepPublished; // set when rebuilding an already-published atlas
  if (job.status === 'done') {
    reg.updateInstance(job.slug, {
      status: keepPublished ? 'published' : 'built',
      sizeBytes: job.sizeBytes || 0, builtAt: Date.now(), rebuildKeepPublished: undefined,
    });
  } else if (keepPublished) {
    // a published rebuild failed — the build only swaps on success, so the old
    // dataset is untouched and still live; keep it published.
    reg.updateInstance(job.slug, { status: 'published', failReason: job.message, rebuildKeepPublished: undefined });
  } else {
    reg.updateInstance(job.slug, { status: 'failed', failReason: job.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  const j = getJob(String(req.params.id));
  if (!j) return res.status(404).json({ error: 'unknown job' });
  res.json(j);
});

/* ================= instances: read, publish, claim, delete ================= */

// Roles: 'owner' (full control: delete, manage collaborators) or 'editor'
// (an invited collaborator — may edit details/region/layers and add data).
// The edit token and the admin token both act as the owner.
function callerRole(req, inst) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && reg.hashToken(bearer) === inst.tokenHash) return 'owner';
  if (auth.isAdmin(req)) return 'owner';
  const session = auth.sessionFromReq(req);
  if (session) {
    if (inst.ownerAccount && session.email === inst.ownerAccount) return 'owner';
    if (reg.isCollaborator(inst, session.email)) return 'editor';
  }
  return null;
}
function callerCanEdit(req, inst) { return callerRole(req, inst) !== null; }

router.get('/instances', (_req, res) => {
  res.json({ instances: reg.listPublic() });
});

router.get('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const role = callerRole(req, inst);
  if (role) {
    const { tokenHash, viewKeyHash, spec, ...rest } = inst;
    return res.json({ ...rest, canEdit: true, role });
  }
  if (inst.status === 'published' && inst.visibility === 'public') {
    return res.json(reg.publicFields(inst));
  }
  res.status(404).json({ error: 'not found' });
});

// Publishing requires a signed-in account (owner decision: anonymous create &
// build stay friction-free, but a published atlas must be attached to an email
// so it stays manageable and reachable). The instance is bound to the account.
router.post('/instances/:slug/publish', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const session = auth.sessionFromReq(req);
  if (!session && !auth.isAdmin(req)) {
    return res.status(401).json({ error: 'publishing needs a verified email — sign in first', needsAuth: true });
  }
  if (inst.status === 'published') return res.json({ ok: true, already: true });
  if (inst.status !== 'built') return res.status(409).json({ error: `cannot publish while ${inst.status}` });
  if (session) {
    reg.bindInstance(session.email, inst.slug);
    if (!inst.email) reg.updateInstance(inst.slug, { email: session.email });
  }
  reg.updateInstance(inst.slug, { status: 'published', publishedAt: Date.now() });
  res.json({ ok: true });
});

// Email the edit token to its owner — proves possession of the token first,
// so this can't be used to phish tokens for someone else's atlas.
router.post('/instances/:slug/email-token', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearer || reg.hashToken(bearer) !== inst.tokenHash) {
    return res.status(403).json({ error: 'edit token required' });
  }
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (linkRate.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'too many emails — try later' });
  hits.push(now);
  linkRate.set(ip, hits);

  const link = inst.visibility === 'private'
    ? `(private atlas — use the view link from the wizard)`
    : `${siteBase(req)}/apps/atlas/a/${inst.slug}`;
  const result = await sendMail({
    to: email,
    subject: `[LOKA Atlas] your edit token for “${inst.title}”`,
    text: `Your atlas: ${inst.title}\nLink: ${link}\n\n` +
      `Edit token (keep it safe — it's the only way to manage this atlas):\n${bearer}\n\n` +
      `Use it to add data layers, publish changes, or delete the atlas.\n`,
  });
  if (!inst.email) reg.updateInstance(inst.slug, { email });
  res.json({ ok: true, sent: !!result.sent, via: result.via || 'log' });
});

router.post('/instances/:slug/claim', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'sign in first', needsAuth: true });
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  const tok = (req.body && req.body.editToken) || '';
  if (reg.hashToken(tok) !== inst.tokenHash) return res.status(403).json({ error: 'wrong edit token' });
  reg.bindInstance(session.email, inst.slug);
  res.json({ ok: true });
});

/* ---------- edit: details (no rebuild) + rebuild (layers/region) ---------- */

function datasetDirFor(inst) {
  const root = inst.visibility === 'private' ? PRIVATE_ROOT : DATASETS_ROOT;
  return path.join(root, inst.slug);
}

// Keep the viewer's manifest.json in step with edited details — the viewer reads
// title/subtitle/about/branding from there, not from the registry.
function rewriteManifest(inst) {
  const mf = path.join(datasetDirFor(inst), 'manifest.json');
  let m;
  try { m = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { return false; }
  m.title = inst.title;
  m.subtitle = inst.subtitle || '';
  m.about = inst.about || '';
  const b = inst.branding || {};
  const bset = {};
  if (b.orgName) bset.orgName = b.orgName;
  if (b.orgUrl) bset.orgUrl = b.orgUrl;
  if (b.footerLine) bset.footerLine = b.footerLine;
  if (b.hasLogo) bset.logo = 'branding-logo.png';
  if (Object.keys(bset).length) m.branding = bset; else delete m.branding;
  try {
    const tmp = mf + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m, null, 1));
    fs.renameSync(tmp, mf);
    return true;
  } catch { return false; }
}

// Fast edit — text, branding, logo and public/private — with no rebuild.
router.post('/instances/:slug/details', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  const b = req.body || {};
  const session = auth.sessionFromReq(req);
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const curB = inst.branding || {};

  // Fields absent from the body are preserved (so a partial call can't wipe them);
  // the wizard always sends the full form, so it behaves as a straight edit.
  const title = has('title') ? cap(b.title, 80) : inst.title;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const org = has('org') ? cap(b.org, 60) : (inst.org || '');
  const bb = has('branding') ? (b.branding || {}) : {};
  const hasB = (k) => has('branding') && Object.prototype.hasOwnProperty.call(bb, k);
  const branding = {
    orgName: hasB('orgName') ? (cap(bb.orgName, 60) || org) : (curB.orgName || org),
    orgUrl: hasB('orgUrl') ? (/^https:\/\/[^\s]+$/.test(bb.orgUrl || '') ? String(bb.orgUrl).slice(0, 200) : '') : (curB.orgUrl || ''),
    footerLine: hasB('footerLine') ? cap(bb.footerLine, 160) : (curB.footerLine || ''),
    hasLogo: !!curB.hasLogo,
  };

  const patch = {
    title,
    subtitle: has('subtitle') ? cap(b.subtitle, 160) : (inst.subtitle || ''),
    about: has('about') ? cap(b.about, 500) : (inst.about || ''),
    email: has('email') && b.email ? cap(b.email, 120) : inst.email,
    org, branding,
  };

  // logo add / replace / remove (written straight into the current dataset dir)
  const curDir = datasetDirFor(inst);
  if (bb.removeLogo) {
    try { fs.rmSync(path.join(curDir, 'branding-logo.png'), { force: true }); } catch { /* ignore */ }
    branding.hasLogo = false;
  } else if (bb.logoData) {
    const valid = validLogo(bb.logoData);
    if (!valid) return res.status(400).json({ error: 'logo must be a PNG under 200 KB' });
    try {
      fs.writeFileSync(path.join(curDir, 'branding-logo.png'), Buffer.from(valid.split(',')[1], 'base64'));
      branding.hasLogo = true;
    } catch { return res.status(500).json({ error: 'could not save the logo' }); }
  }

  // visibility change moves the dataset between the web root and the private root
  let viewKey;
  const newVis = b.visibility === 'private' ? 'private' : b.visibility === 'public' ? 'public' : inst.visibility;
  if (newVis !== inst.visibility) {
    if (newVis === 'private' && !session) return res.status(401).json({ error: 'making an atlas private needs a verified email', needsAuth: true });
    const fromDir = datasetDirFor(inst);
    const toRoot = newVis === 'private' ? PRIVATE_ROOT : DATASETS_ROOT;
    const toDir = path.join(toRoot, inst.slug);
    try {
      fs.mkdirSync(toRoot, { recursive: true });
      if (fs.existsSync(fromDir)) fs.renameSync(fromDir, toDir);
    } catch { return res.status(500).json({ error: 'could not change who can see this atlas' }); }
    patch.visibility = newVis;
    if (newVis === 'private') { viewKey = reg.newToken(); patch.viewKeyHash = reg.hashToken(viewKey); }
    else patch.viewKeyHash = null;
  }

  const updated = reg.updateInstance(inst.slug, patch);
  rewriteManifest(updated);
  res.json({ ok: true, visibility: updated.visibility, viewKey: viewKey || undefined });
});

// Rebuild — change layers and/or region, then rebuild into the same slug. The
// build swaps the dataset atomically on success, so a published atlas has no
// downtime; a published atlas stays published (see the job-done hook).
router.post('/instances/:slug/rebuild', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  if (inst.status === 'building' || inst.status === 'pending-approval') {
    return res.status(409).json({ error: 'a build is already running for this atlas' });
  }
  const b = req.body || {};
  const r = b.region;
  const useR = (r && r.iso3 && Array.isArray(r.shapeIDs) && r.shapeIDs.length)
    ? { iso3: String(r.iso3).toUpperCase(), level: Number(r.level) || 1, shapeIDs: r.shapeIDs.map(String).slice(0, 100) }
    : { iso3: inst.region.iso3, level: inst.region.level, shapeIDs: inst.region.shapeIDs };
  if (!/^[A-Z]{3}$/.test(useR.iso3) || !useR.shapeIDs.length) return res.status(400).json({ error: 'region is required' });

  let regionDoc;
  try { regionDoc = await loadAdmin(useR.iso3, useR.level); } catch (e) { return res.status(502).json({ error: 'boundary source unavailable: ' + e.message }); }
  const picked = regionDoc.features.filter((f) => useR.shapeIDs.includes(f.properties.id));
  if (!picked.length) return res.status(400).json({ error: 'no matching boundary units' });
  let w = 180, s = 90, e = -180, n = -90;
  for (const f of picked) { w = Math.min(w, f.bbox[0]); s = Math.min(s, f.bbox[1]); e = Math.max(e, f.bbox[2]); n = Math.max(n, f.bbox[3]); }
  const bbox = [w, s, e, n];
  const areaDeg2 = (e - w) * (n - s);
  if (areaDeg2 > HARD_AREA_DEG2) return res.status(400).json({ error: 'That region is larger than a single atlas can cover.', tooLarge: true });

  const tier = tierOf(useR.iso3);
  const allowed = new Map(layersForTier(tier).map((l) => [l.id, l]));
  let layerIds = (Array.isArray(b.layers) ? b.layers.map(String) : inst.layers).filter((id) => allowed.has(id));
  for (const l of allowed.values()) if (l.required && !layerIds.includes(l.id)) layerIds.unshift(l.id);
  if (!layerIds.length) return res.status(400).json({ error: 'pick at least one layer' });

  // v1: a rebuild that would newly need approval (big region / heavy layer) is
  // refused with guidance — keeps the live atlas untouched.
  const heavy = layerIds.some((id) => allowed.get(id).cost === 'approval');
  if (heavy || areaDeg2 > FREE_AREA_DEG2) {
    return res.status(400).json({
      error: 'This change is bigger than the free tier (a large region or a heavy layer) and needs a quick approval — email mithun@socratus.org and we’ll set it up.',
      approvalNeeded: true,
    });
  }

  const shapeNames = picked.map((f) => f.properties.name);
  const regionLabel = shapeNames.slice(0, 3).join(' · ') + (shapeNames.length > 3 ? ` +${shapeNames.length - 3}` : '');

  // preserve org branding + logo across the rebuild (read the current logo back
  // into the spec so the builder re-emits it)
  const branding = { orgName: inst.branding && inst.branding.orgName, orgUrl: inst.branding && inst.branding.orgUrl, footerLine: inst.branding && inst.branding.footerLine };
  const logoPath = path.join(datasetDirFor(inst), 'branding-logo.png');
  if (inst.branding && inst.branding.hasLogo && fs.existsSync(logoPath)) {
    try { branding.logoData = 'data:image/png;base64,' + fs.readFileSync(logoPath).toString('base64'); } catch { /* ignore */ }
  }

  const spec = {
    slug: inst.slug, visibility: inst.visibility, tier,
    title: inst.title, subtitle: inst.subtitle, about: inst.about, branding,
    region: {
      iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox,
      simplifiedFile: path.join(GEOCACHE_DIR, `${useR.iso3}-ADM${useR.level}.json`),
      fullResUrl: regionDoc.fullResUrl,
    },
    layers: layerIds,
  };

  const wasPublished = inst.status === 'published';
  reg.updateInstance(inst.slug, {
    tier, region: { iso3: useR.iso3, level: useR.level, shapeIDs: useR.shapeIDs, shapeNames, bbox, areaDeg2 },
    regionLabel, layers: layerIds, spec,
    rebuildKeepPublished: wasPublished || undefined,
    status: wasPublished ? 'published' : 'building',
  });
  const jobId = enqueueBuild(spec);
  reg.updateInstance(inst.slug, { jobId });
  res.json({ ok: true, jobId, slug: inst.slug, wasPublished });
});

router.delete('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can delete this atlas' });
  for (const root of [DATASETS_ROOT, PRIVATE_ROOT]) {
    const dir = path.join(root, inst.slug);
    if (dir.startsWith(root) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  reg.deleteInstance(inst.slug);
  res.json({ ok: true });
});

/* ================= collaborators (owner invites editors by email) =================
   Use case: several orgs working one geography pool their data on a single atlas.
   Editors get the full edit flow (details, region, layers, add-data) but cannot
   delete the atlas or manage collaborators. */

const MAX_COLLABORATORS = 20;

function collabList(inst) {
  return (inst.collaborators || []).map((c) => ({
    email: c.email, invitedAt: c.invitedAt, acceptedAt: c.acceptedAt || null,
  }));
}

router.post('/instances/:slug/collaborators', async (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can invite collaborators' });
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  if (inst.ownerAccount && email === inst.ownerAccount) return res.status(400).json({ error: 'that email already owns this atlas' });
  if ((inst.collaborators || []).length >= MAX_COLLABORATORS) {
    return res.status(400).json({ error: `collaborator limit reached (${MAX_COLLABORATORS})` });
  }
  const c = reg.addCollaborator(inst.slug, email);
  const invitedBy = inst.ownerAccount || inst.email || 'the atlas owner';
  const result = await sendMail({
    to: email,
    subject: `You're invited to contribute to “${inst.title}” — LOKA Atlas`,
    text:
      `${invitedBy} invited you to contribute to “${inst.title}”` +
      (inst.regionLabel ? ` (${inst.regionLabel})` : '') + ` on LOKA Atlas.\n\n` +
      `As a collaborator you can edit the atlas and add your organisation's data layers.\n\n` +
      `To get started:\n` +
      `1. Open ${siteBase(req)}/apps/atlas/setup/\n` +
      `2. Sign in with this email address — we'll send you a 6-digit code.\n` +
      `3. “${inst.title}” will appear under Your atlases.\n\n` +
      `If you weren't expecting this, you can ignore this email.\n`,
  });
  res.json({ ok: true, collaborator: { email: c.email, invitedAt: c.invitedAt, acceptedAt: c.acceptedAt || null }, sent: !!result.sent, collaborators: collabList(inst) });
});

router.delete('/instances/:slug/collaborators', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerRole(req, inst) !== 'owner') return res.status(403).json({ error: 'only the owner can remove collaborators' });
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  reg.removeCollaborator(inst.slug, email);
  res.json({ ok: true, collaborators: collabList(inst) });
});

/* ================= auth (magic links) ================= */

const linkRate = new Map(); // ip -> [timestamps]
router.post('/auth/request-link', async (req, res) => {
  const email = reg.normEmail(req.body && req.body.email);
  if (!reg.validEmail(email)) return res.status(400).json({ error: 'valid email required' });
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (linkRate.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= 5) return res.status(429).json({ error: 'too many link requests — try later' });
  hits.push(now);
  linkRate.set(ip, hits);

  reg.upsertAccount(email);
  const otp = auth.makeOtp(email);
  const result = await sendMail({
    to: email,
    subject: `${otp} is your LOKA Atlas sign-in code`,
    text: `Your sign-in code is:\n\n    ${otp}\n\nType it into the LOKA Atlas sign-in box. It works once and expires in 10 minutes.\n\nIf you didn't request this, ignore this email.`,
  });
  res.json({ ok: true, sent: !!result.sent, via: result.via || 'log' });
});

// The 6-digit code from the email, typed straight into the wizard — no link,
// no tab-switching. Sets the session cookie on this same tab.
router.post('/auth/verify-code', (req, res) => {
  const email = reg.normEmail(req.body && req.body.email);
  const code = String((req.body && req.body.code) || '').trim();
  if (!reg.validEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'email and the 6-digit code are required' });
  }
  if (!auth.verifyOtp(email, code)) {
    return res.status(401).json({ error: 'that code isn’t right or has expired — request a fresh one' });
  }
  reg.markVerified(email);
  reg.acceptInvites(email); // pending collaborator invites become active on first sign-in
  res.setHeader('Set-Cookie', auth.sessionCookie(email));
  res.json({ ok: true, email });
});

router.get('/auth/verify', (req, res) => {
  const p = auth.readLoginToken(String(req.query.t || req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This sign-in link is invalid or has already been used. Request a fresh one from the wizard.'));
  reg.markVerified(p.email);
  reg.acceptInvites(p.email);
  res.setHeader('Set-Cookie', auth.sessionCookie(p.email));
  // No redirect: the wizard tab you came from is polling and will continue on its
  // own with your work intact. Redirecting here would open a second, empty wizard.
  res.send(page('Signed in',
    `You're signed in as <b>${p.email}</b>.<br><br>` +
    `Return to the <b>LOKA Atlas</b> tab you were using — your atlas is still there and will continue automatically. You can close this tab.`));
});

router.get('/auth/me', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const acc = reg.getAccount(session.email);
  const instances = (acc ? acc.instances : [])
    .map((slug) => reg.getInstance(slug))
    .filter(Boolean)
    .map((i) => ({
      slug: i.slug, title: i.title, regionLabel: i.regionLabel || '', status: i.status, visibility: i.visibility,
      role: i.ownerAccount === session.email ? 'owner' : 'editor',
    }));
  res.json({
    email: session.email,
    verifiedAt: acc ? acc.verifiedAt : null,
    name: (acc && acc.name) || '',
    org: (acc && acc.org) || '',
    instances,
    drafts: reg.listDrafts(session.email).map((d) => ({ id: d.id, title: d.title || '', updatedAt: d.updatedAt })),
  });
});

// Captured once after the first sign-in: who the person is and which org they
// belong to. Used to credit contributed layers ("Added by <org>").
router.post('/auth/profile', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const name = String((req.body && req.body.name) || '').trim();
  const org = String((req.body && req.body.org) || '').trim();
  if (!name || !org) return res.status(400).json({ error: 'your full name and organisation are both needed' });
  const acc = reg.setProfile(session.email, { name, org });
  res.json({ ok: true, name: acc.name, org: acc.org });
});

router.post('/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  res.json({ ok: true });
});

/* ================= drafts ================= */

router.post('/drafts', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'sign in to save drafts', needsAuth: true });
  const d = req.body && req.body.draft;
  if (!d || typeof d !== 'object') return res.status(400).json({ error: 'draft object required' });
  if (JSON.stringify(d).length > 100 * 1024) return res.status(413).json({ error: 'draft too large' });
  const saved = reg.saveDraft(session.email, { id: d.id, title: cap(d.title, 80), state: d.state });
  res.json({ ok: true, id: saved.id });
});
router.get('/drafts', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  res.json({ drafts: reg.listDrafts(session.email) });
});
router.delete('/drafts/:id', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const d = reg.getDraft(String(req.params.id));
  if (!d || d.owner !== session.email) return res.status(404).json({ error: 'not found' });
  reg.deleteDraft(d.id);
  res.json({ ok: true });
});

/* ================= private dataset serving ================= */

const MIME = {
  '.json': 'application/json', '.geojson': 'application/geo+json',
  '.png': 'image/png', '.jpg': 'image/jpeg',
};
router.get('/datasets/:slug/:file', (req, res) => {
  const slug = String(req.params.slug);
  const file = String(req.params.file);
  const inst = reg.getInstance(slug);
  if (!inst || inst.visibility !== 'private') return res.status(404).json({ error: 'not found' });

  const key = String(req.query.key || req.headers['x-atlas-key'] || '');
  const keyOk = key && reg.hashToken(key) === inst.viewKeyHash;
  if (!keyOk && !callerCanEdit(req, inst)) return res.status(403).json({ error: 'view key required' });

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(file) || file.includes('..')) {
    return res.status(400).json({ error: 'bad path' });
  }
  const full = path.join(PRIVATE_ROOT, slug, file);
  if (!full.startsWith(path.join(PRIVATE_ROOT, slug))) return res.status(400).json({ error: 'bad path' });
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'not found' });

  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.type(MIME[path.extname(full)] || 'application/octet-stream');
  fs.createReadStream(full).pipe(res);
});

/* ==================================================================
   DATA-TO-LAYER MODULE (the Gemini-assisted import workbench)
   Pipeline: client-parsed table → column profiling (code) → schema
   inference (Gemini, structured output) → transform (code: coordinates
   or admin-name join, Gemini only adjudicates ambiguous matches) →
   whitelist fragment builder (code) → draft dataset preview → commit
   to the manifest.local.json overlay. Gemini never writes manifest JSON.
================================================================== */
import { GoogleGenAI, Type } from '@google/genai';
import { getFlashModel, getFlashLiteModel } from '../lib/models.js';
import { profileColumns, bestNameColumn } from '../lib/tabular.js';
import { norm, joinByName, AUTO_ACCEPT } from '../lib/matching.js';
import { PALETTES, MARKER_COLORS, buildFragment, sanitizeFeatures } from '../lib/fragment.js';
import * as imports from '../lib/atlas/imports.js';

const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
imports.sweepImports();
setInterval(imports.sweepImports, 3600 * 1000).unref();

// Every import route mutates disk (sessions, draft folders) — owner/editor only.
// Datasets without a registry entry (hand-built ones like deoria) are admin-only.
function requireDatasetEditor(req, res, datasetId) {
  const inst = reg.getInstance(datasetId);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) {
    res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
    return null;
  }
  return role;
}

const MAX_ROWS = 5000, MAX_COLS = 40;
const geminiRate = new Map();
function geminiAllowed(ip) {
  const now = Date.now();
  const hits = (geminiRate.get(ip) || []).filter((t) => now - t < 3600 * 1000);
  if (hits.length >= 30) return false;
  hits.push(now);
  geminiRate.set(ip, hits);
  return true;
}

/* ---------- boundary discovery: joinable polygon layers in the dataset ---------- */

function boundaryOptions(datasetId) {
  const m = imports.readManifest(datasetId);
  if (!m) return { options: [], manifest: null };
  const options = [];
  for (const L of imports.mergedLayers(m)) {
    if (L.type !== 'fill' && L.type !== 'categories') continue;
    if (!L.source || !/\.geojson$/.test(L.source) || L.userLayer) continue;
    try {
      const gj = JSON.parse(fs.readFileSync(path.join(m.dir, L.source), 'utf8'));
      const feats = gj.features || [];
      if (!feats.length) continue;
      const props = feats[0].properties || {};
      const nameProp = 'name' in props ? 'name' : null;
      if (!nameProp) continue;
      const parentProp = 'district' in props ? 'district' : ('state' in props ? 'state' : null);
      const geomOk = /Polygon/.test(feats[0].geometry && feats[0].geometry.type);
      if (!geomOk) continue;
      options.push({
        id: L.id, label: L.label || L.id, source: L.source, group: L.group || '',
        count: feats.length, nameProp, parentProp,
        exampleNames: feats.slice(0, 10).map((f) => String(f.properties[nameProp])),
      });
    } catch {}
  }
  // Plain boundary layers (base group) join better than thematic layers that
  // happen to share the same geometry — offer and default to them first.
  options.sort((a, b) => (a.group === 'base' ? 0 : 1) - (b.group === 'base' ? 0 : 1));
  return { options, manifest: m };
}

function boundaryTargets(datasetId, optionId) {
  const { options, manifest } = boundaryOptions(datasetId);
  const opt = options.find((o) => o.id === optionId) || options[0];
  if (!opt || !manifest) return null;
  const gj = JSON.parse(fs.readFileSync(path.join(manifest.dir, opt.source), 'utf8'));
  const targets = (gj.features || []).map((f, i) => ({
    code: String(i),
    name: String(f.properties[opt.nameProp] ?? ''),
    parent: opt.parentProp ? String(f.properties[opt.parentProp] ?? '') : '',
    geometry: f.geometry,
  }));
  return { opt, targets };
}

function centroidOf(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  (function walk(c) {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
    } else c.forEach(walk);
  })(geom.coordinates);
  return [(w + e) / 2, (s + n) / 2];
}

/* ---------- Gemini schemas ---------- */

const LAYER_SPEC_SCHEMA = {
  type: Type.OBJECT,
  required: ['kind', 'label', 'group'],
  properties: {
    kind: { type: Type.STRING, enum: ['markers', 'choropleth', 'line', 'polygon'] },
    label: { type: Type.STRING },
    group: { type: Type.STRING, enum: ['base', 'agri', 'eco'] },
    subgroup: { type: Type.STRING },
    valueColumn: { type: Type.STRING },
    unit: { type: Type.STRING },
    palette: { type: Type.STRING, enum: Object.keys(PALETTES) },
    reverse: { type: Type.BOOLEAN },
    classCount: { type: Type.INTEGER },
    markerColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    lineColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    lineWidth: { type: Type.NUMBER },
    lineDash: { type: Type.BOOLEAN },
    fillColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
    fillOpacity: { type: Type.NUMBER },
    outline: { type: Type.BOOLEAN },
    popupTitleColumn: { type: Type.STRING },
    popupColumns: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const INFER_SCHEMA = {
  type: Type.OBJECT,
  required: ['rowSubject', 'strategy', 'columns', 'layer'],
  properties: {
    rowSubject: { type: Type.STRING },
    strategy: { type: Type.STRING, enum: ['coordinates', 'adminJoin'] },
    joinLayer: { type: Type.STRING },
    columns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['name', 'role'],
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING, enum: ['placeName', 'adminParent', 'latitude', 'longitude', 'value', 'category', 'id', 'text', 'ignore'] },
        },
      },
    },
    layer: LAYER_SPEC_SCHEMA,
    notes: { type: Type.STRING },
  },
};

const ADJUDICATE_SCHEMA = {
  type: Type.OBJECT,
  required: ['matches'],
  properties: {
    matches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ['sourceName', 'chosenCode'],
        properties: {
          sourceName: { type: Type.STRING },
          chosenCode: { type: Type.STRING },
          confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const REFINE_SCHEMA = {
  type: Type.OBJECT,
  required: ['layer', 'reply'],
  properties: { layer: LAYER_SPEC_SCHEMA, reply: { type: Type.STRING } },
};

async function geminiJSON(model, prompt, schema) {
  const response = await ai.models.generateContent({
    model, contents: prompt,
    config: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 2048 },
  });
  return JSON.parse(response.text ?? '');
}

/* ---------- transform: rows + spec → features ---------- */

function rolesMap(columns) {
  const map = {};
  for (const c of columns || []) map[c.role] = map[c.role] || c.name;
  return map;
}

function transform(session) {
  const { rows, strategy } = session;
  const roles = rolesMap(session.columns);
  const report = { strategy, matched: 0, unmatched: [], ambiguous: [], outside: 0, total: rows.length };
  let feats = [];

  if (strategy === 'geometry') {
    // spatial track: shapes came with the upload, side-file holds them
    const geoms = imports.readGeoms(session.id);
    if (!geoms) throw new Error('the uploaded geometry expired — start the upload again');
    rows.forEach((r, i) => {
      const gi = session.geomIdx ? session.geomIdx[i] : i;
      const g = gi != null && gi >= 0 ? geoms[gi] : null;
      if (!g) {
        report.unmatched.push({ row: i, name: String(r[roles.placeName] || 'row ' + (i + 1)), reason: 'no geometry' });
        return;
      }
      feats.push({ type: 'Feature', properties: { ...r }, geometry: g });
      report.matched++;
    });
  } else if (strategy === 'coordinates') {
    let latCol = roles.latitude, lngCol = roles.longitude;
    if (!latCol || !lngCol) throw new Error('latitude/longitude columns not set');
    // auto-detect swapped columns
    const lats = rows.map((r) => Number(r[latCol])).filter(Number.isFinite);
    const lngs = rows.map((r) => Number(r[lngCol])).filter(Number.isFinite);
    if (lats.length && lngs.length && Math.max(...lats.map(Math.abs)) > 90 && Math.max(...lngs.map(Math.abs)) <= 90) {
      const t = latCol; latCol = lngCol; lngCol = t;
      report.note = 'latitude/longitude looked swapped — corrected';
    }
    rows.forEach((r, i) => {
      const lat = Number(r[latCol]), lng = Number(r[lngCol]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        report.unmatched.push({ row: i, name: String(r[roles.placeName] || r[latCol] || i), reason: 'bad coordinates' });
        return;
      }
      feats.push({ type: 'Feature', properties: { ...r }, geometry: { type: 'Point', coordinates: [lng, lat] } });
      report.matched++;
    });
  } else {
    const bt = boundaryTargets(session.dataset, session.joinLayer);
    if (!bt) throw new Error('no joinable boundary layer in this dataset');
    session.joinLayer = bt.opt.id;
    report.joinLayer = bt.opt.id;
    report.joinLabel = bt.opt.label;
    const nameCol = roles.placeName;
    if (!nameCol) throw new Error('place-name column not set');
    const results = joinByName(rows, nameCol, roles.adminParent || null, bt.targets);
    session.matchState = session.matchState || {};   // row -> code | 'skip' (manual fixes)
    const wantChoropleth = session.spec && session.spec.kind === 'choropleth';
    results.forEach((res) => {
      const manual = session.matchState[res.row];
      const code = manual === 'skip' ? null : (manual || res.match);
      if (manual === 'skip') return;
      if (!code) {
        (res.candidates.length ? report.ambiguous : report.unmatched).push({
          row: res.row, name: res.name, candidates: res.candidates,
        });
        return;
      }
      const target = bt.targets[Number(code)];
      if (!target) return;
      const r = rows[res.row];
      const props = { ...r, name: target.name };
      feats.push({
        type: 'Feature', properties: props,
        geometry: wantChoropleth ? target.geometry : { type: 'Point', coordinates: centroidOf(target.geometry) },
      });
      report.matched++;
    });
  }

  // build the fragment + sanitize
  const m = imports.readManifest(session.dataset);
  const existingIds = imports.mergedLayers(m).map((l) => l.id);
  const keep = new Set(['name']);
  const roles2 = session.columns || [];
  for (const c of roles2) if (!['ignore'].includes(c.role)) keep.add(c.name);
  const spec = session.spec || {};
  // one layer = one geometry class; the kind must be renderable for that class
  const cls = session.meta && session.meta.geometry && session.meta.geometry.class;
  if (strategy === 'geometry' && cls) {
    const allowed = cls === 'line' ? ['line'] : cls === 'polygon' ? ['polygon', 'choropleth'] : ['markers'];
    if (!allowed.includes(spec.kind)) spec.kind = allowed[0];
  }
  const frag = buildFragment(spec, feats, existingIds);
  const clean = sanitizeFeatures(feats, [...keep], m.manifest.bounds, spec.outsideAction);
  report.outside = clean.outside;
  if (spec.outsideAction === 'drop' && clean.outside) report.outsideDropped = true;

  return { frag, features: clean.features, report };
}

// withDraft=false recomputes the match report without touching disk — the
// Check / Place-on-map steps iterate cheaply; entering Preview writes the draft.
function applyResult(session, withDraft) {
  const { frag, features, report } = transform(session);
  let draftId = null;
  if (withDraft) {
    draftId = imports.writeDraft(session.dataset, session.id, frag.stanza,
      frag.sourceFile, { type: 'FeatureCollection', features });
  }
  session.fragment = frag.stanza;
  session.sourceFile = frag.sourceFile;
  session.featureCount = features.length;
  imports.saveImport(session);
  return {
    importId: session.id,
    inference: session.inference || null,
    spec: session.spec,
    strategy: session.strategy,
    joinLayer: session.joinLayer || null,
    columns: session.columns,
    matchReport: report,
    fragment: frag.stanza,
    draftDataset: draftId,
    stats: { features: features.length, kind: frag.kindUsed },
  };
}

/* ---------- routes ---------- */

router.get('/layers/options', (req, res) => {
  const dataset = String(req.query.dataset || '');
  if (!requireDatasetEditor(req, res, dataset)) return;
  const { options } = boundaryOptions(dataset);
  res.json({
    boundaries: options.map(({ id, label, group, count, exampleNames }) => ({ id, label, group, count, exampleNames: exampleNames.slice(0, 5) })),
    palettes: Object.keys(PALETTES),
    markerColors: Object.keys(MARKER_COLORS),
    geminiAvailable: !!ai,
  });
});

// Canonical-table ingest: the client sends typed rows + a column schema
// (produced by atlas/ingest.js). Inference pre-fills roles/spec; NO draft is
// written — the Place-on-map step iterates report-only, Preview writes drafts.
router.post('/layers/ingest', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
  if (!requireDatasetEditor(req, res, dataset)) return;
  const schema = Array.isArray(b.schema) ? b.schema : null;
  if (!schema || !Array.isArray(b.rows) || !b.rows.length) {
    return res.status(400).json({ error: 'schema and rows required' });
  }
  const columns = schema.map((c) => String((c && c.name) || '')).filter(Boolean).slice(0, MAX_COLS);
  if (!columns.length) return res.status(400).json({ error: 'no usable columns' });
  const rows = b.rows.slice(0, MAX_ROWS).map((r) => {
    const o = {};
    for (const c of columns) {
      const v = r ? r[c] : undefined;
      o[c] = (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
        ? v : (v == null ? '' : String(v).slice(0, 500));
    }
    return o;
  });
  const meta = b.meta && typeof b.meta === 'object' ? {
    sourceType: String(b.meta.sourceType || '').slice(0, 20),
    encoding: String(b.meta.encoding || '').slice(0, 20),
    sheet: String(b.meta.sheet || '').slice(0, 60),
    truncated: b.meta.truncated || null,
    notices: (Array.isArray(b.meta.notices) ? b.meta.notices : []).slice(0, 10).map((n) => String(n).slice(0, 200)),
    geometry: b.meta.geometry && typeof b.meta.geometry === 'object' ? {
      class: ['point', 'line', 'polygon'].includes(b.meta.geometry.class) ? b.meta.geometry.class : null,
      count: Number(b.meta.geometry.count) || 0,
      vertices: Number(b.meta.geometry.vertices) || 0,
    } : null,
  } : null;

  // the spatial track: geometry rides alongside the rows, index-aligned
  const geoms = Array.isArray(b.geoms) && b.geoms.length ? b.geoms.slice(0, MAX_ROWS) : null;
  const geomIdx = geoms && Array.isArray(b.geomIdx)
    ? b.geomIdx.slice(0, MAX_ROWS).map((v) => (Number.isInteger(v) && v >= 0 && v < geoms.length ? v : null))
    : null;

  const profiles = profileColumns(columns, rows);
  const { options } = boundaryOptions(dataset);
  const m = imports.readManifest(dataset);

  const session = imports.newImport({
    dataset, filename: String(b.filename || '').slice(0, 120), meta,
    columnsRaw: columns, rows, profilesSummary: profiles.map((p) => ({ name: p.name, type: p.type })),
    geomIdx: geomIdx || undefined,
  });
  if (geoms) imports.writeGeoms(session.id, geoms);

  // Spatial uploads know where they live — no inference or joins needed, just
  // a sensible spec by geometry class. Chat refine remains available later.
  if (geoms) {
    const cls = (meta && meta.geometry && meta.geometry.class) || 'point';
    const numeric = profiles.find((p) => p.type === 'number');
    const nameCol = profiles.find((p) => p.type === 'string' && p.looksLikeName);
    session.strategy = 'geometry';
    session.columns = columns.map((c) => ({
      name: c,
      role: nameCol && c === nameCol.name ? 'placeName' : numeric && c === numeric.name ? 'value' : 'text',
    }));
    session.spec = {
      kind: cls === 'line' ? 'line' : cls === 'polygon' ? 'polygon' : 'markers',
      label: (session.filename || 'My data').replace(/\.[a-z]+$/i, '') || 'My data',
      group: 'agri',
      valueColumn: numeric ? numeric.name : undefined,
      palette: 'greens',
      markerColor: 'rust',
      lineColor: 'slate',
      fillColor: 'moss',
      popupTitleColumn: nameCol ? nameCol.name : columns[0],
      popupColumns: columns.slice(0, 4),
    };
    try {
      return res.json(applyResult(session, false));
    } catch (e) {
      return res.status(400).json({ error: e.message, importId: session.id, columns: session.columns, strategy: session.strategy });
    }
  }

  let inference = null;
  if (ai && !b.manual && geminiAllowed(clientIp(req))) {
    try {
      const prompt = [
        'You are helping map a tabular dataset onto an interactive atlas. Infer its schema.',
        'Column profiles (from code, trustworthy):', JSON.stringify(profiles),
        'First rows (sample):', JSON.stringify(rows.slice(0, 30)),
        'Atlas context: groups are base/agri/eco. Map bounds ' + JSON.stringify(m.manifest.bounds) + '.',
        'Joinable boundary layers (choose joinLayer from these ids when rows are admin units):',
        JSON.stringify(options.map((o) => ({ id: o.id, label: o.label, count: o.count, exampleNames: o.exampleNames }))),
        'Rules: strategy "coordinates" only when usable lat/lng columns exist; otherwise "adminJoin"',
        'with the boundary layer whose names match the place-name column. kind "choropleth" needs a',
        'numeric valueColumn; otherwise "markers". Pick popupTitleColumn = the place/name column.',
        'notes: 1-2 sentences for the user about your reading of the data and any caveats.',
      ].join('\n');
      inference = await geminiJSON(getFlashModel(), prompt, INFER_SCHEMA);
    } catch (e) {
      console.warn('[atlas] infer failed:', e.message);
    }
  }

  if (inference) {
    session.inference = { rowSubject: inference.rowSubject, notes: inference.notes || '' };
    session.strategy = inference.strategy;
    session.joinLayer = inference.joinLayer || (options[0] && options[0].id);
    session.columns = (inference.columns || []).filter((c) => columns.includes(c.name));
    session.spec = inference.layer;
  } else {
    // heuristic pre-fill (also the no-Gemini path)
    const lat = profiles.find((p) => p.looksLikeLat || p.maybeLatIndia);
    const lng = profiles.find((p) => p.looksLikeLng || p.maybeLngIndia);
    // best (name column, boundary layer) pair by join hit-rate across the options
    let nameGuess = null, joinGuess = options[0] && options[0].id;
    for (const opt of options.slice(0, 8)) {
      try {
        const bt = boundaryTargets(dataset, opt.id);
        const g = bestNameColumn(profiles, rows, bt.targets.map((t) => t.name), norm);
        if (g.column && (!nameGuess || g.rate > nameGuess.rate)) { nameGuess = g; joinGuess = opt.id; }
      } catch {}
    }
    const numeric = profiles.find((p) => p.type === 'number' && !p.looksLikeLat && !p.looksLikeLng);
    session.strategy = lat && lng ? 'coordinates' : 'adminJoin';
    session.joinLayer = joinGuess;
    session.columns = columns.map((c) => ({
      name: c,
      role: lat && c === lat.name ? 'latitude'
        : lng && c === lng.name ? 'longitude'
        : nameGuess && c === nameGuess.column ? 'placeName'
        : numeric && c === numeric.name ? 'value' : 'text',
    }));
    session.spec = {
      kind: session.strategy === 'coordinates' ? 'markers' : (numeric ? 'choropleth' : 'markers'),
      label: (session.filename || 'My data').replace(/\.[a-z]+$/i, '') || 'My data',
      group: 'agri',
      valueColumn: numeric ? numeric.name : undefined,
      palette: 'greens',
      markerColor: 'rust',
      popupTitleColumn: nameGuess ? nameGuess.column : columns[0],
      popupColumns: columns.slice(0, 4),
    };
  }

  try {
    let result = applyResult(session, false);

    // Gemini adjudication for ambiguous joins (constrained: only offered candidates)
    if (ai && result.matchReport.ambiguous.length && result.matchReport.ambiguous.length <= 40 && !b.manual) {
      try {
        const adj = await geminiJSON(getFlashLiteModel(), [
          'Pick the right boundary for each source place name (Indian transliterations vary).',
          'Only use chosenCode values from the candidates; use "" when none fits.',
          JSON.stringify(result.matchReport.ambiguous.map((a) => ({
            sourceName: a.name,
            candidates: a.candidates.map((c) => ({ code: c.code, name: c.name, parent: c.parent })),
          }))),
        ].join('\n'), ADJUDICATE_SCHEMA);
        let applied = 0;
        for (const mt of adj.matches || []) {
          const amb = result.matchReport.ambiguous.find((a) => a.name === mt.sourceName);
          if (!amb || !mt.chosenCode) continue;
          if (amb.candidates.some((c) => c.code === mt.chosenCode)) {
            session.matchState = session.matchState || {};
            session.matchState[amb.row] = mt.chosenCode;
            applied++;
          }
        }
        if (applied) result = applyResult(session, false);
      } catch (e) {
        console.warn('[atlas] adjudication failed:', e.message);
      }
    }
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message, importId: session.id, columns: session.columns, strategy: session.strategy });
  }
});

router.post('/layers/apply', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  if (b.spec && typeof b.spec === 'object') session.spec = b.spec;
  if (b.strategy && ['coordinates', 'adminJoin'].includes(b.strategy)) session.strategy = b.strategy;
  if (b.joinLayer) session.joinLayer = String(b.joinLayer);
  if (Array.isArray(b.columns)) {
    session.columns = b.columns
      .filter((c) => c && session.columnsRaw.includes(c.name))
      .map((c) => ({ name: c.name, role: String(c.role) }));
  }
  try {
    res.json(applyResult(session, b.draft !== false));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/resolve', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  session.matchState = session.matchState || {};
  for (const f of (Array.isArray(b.fixes) ? b.fixes : [])) {
    if (!Number.isInteger(f.row)) continue;
    if (f.skip) session.matchState[f.row] = 'skip';
    else if (typeof f.code === 'string') session.matchState[f.row] = f.code;
  }
  try {
    res.json(applyResult(session, b.draft !== false));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/refine', async (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  if (!requireDatasetEditor(req, res, session.dataset)) return;
  const message = String(b.message || '').slice(0, 500);
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!ai) return res.status(503).json({ error: 'AI refine is unavailable — use the pickers instead' });
  if (!geminiAllowed(clientIp(req))) return res.status(429).json({ error: 'AI limit reached — try later' });

  const gcls = session.meta && session.meta.geometry && session.meta.geometry.class;
  const prompt = [
    'Patch this atlas layer spec according to the user instruction. Keep unrelated fields unchanged.',
    'Current spec: ' + JSON.stringify(session.spec),
    'Available numeric columns: ' + JSON.stringify((session.columns || []).filter((c) => c.role === 'value').map((c) => c.name)),
    'All columns: ' + JSON.stringify(session.columnsRaw),
    'Palettes: ' + Object.keys(PALETTES).join(', ') + ' (rdylgn = red→green, gnrd = green→red).',
    gcls ? 'This layer holds ' + gcls + ' geometry — valid kinds: ' +
      (gcls === 'line' ? 'line' : gcls === 'polygon' ? 'polygon, choropleth' : 'markers') + '.' : '',
    'User instruction: ' + message,
    'reply: one short friendly sentence describing what you changed.',
  ].filter(Boolean).join('\n');

  try {
    let out;
    try {
      out = await geminiJSON(getFlashLiteModel(), prompt, REFINE_SCHEMA);
    } catch {
      out = await geminiJSON(getFlashModel(), prompt, REFINE_SCHEMA);
    }
    session.spec = out.layer;
    const result = applyResult(session, true);
    result.reply = String(out.reply || 'Updated.').slice(0, 300);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: 'AI refine failed: ' + e.message });
  }
});

router.post('/layers/commit', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });

  // auth: the atlas's signed-in owner, its edit token, or admin (e.g. the deoria dataset)
  const inst = reg.getInstance(session.dataset);
  const ok = (inst && callerCanEdit(req, inst)) || auth.isAdmin(req);
  if (!ok) return res.status(403).json({ error: 'sign in as this atlas’s owner to change it', needsAuth: true });

  try {
    const { frag, features } = (function () {
      const t = transform(session);
      return { frag: t.frag, features: t.features };
    })();
    // credit the contributor: which org (and person) added this layer
    const who = auth.sessionFromReq(req);
    if (who) {
      const acc = reg.getAccount(who.email);
      frag.stanza.addedBy = { email: who.email, name: (acc && acc.name) || '', org: (acc && acc.org) || '' };
      frag.stanza.addedAt = Date.now();
    }
    const out = imports.commitLayer(session.dataset, frag.stanza, frag.sourceFile,
      { type: 'FeatureCollection', features });
    imports.discardImport(session.id);
    res.json({ ok: true, layerId: out.layerId, dataset: session.dataset });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// The atlas's contributed (overlay) layers — for the bench's manage list.
router.get('/layers/list', (req, res) => {
  const dataset = String(req.query.dataset || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
  let m = null;
  try { m = imports.readManifest(dataset); } catch { /* dataset dir missing */ }
  const who = auth.sessionFromReq(req);
  const layers = ((m && m.local && m.local.layers) || []).map((l) => ({
    id: l.id, label: l.label || l.id,
    addedBy: l.addedBy ? { email: l.addedBy.email, name: l.addedBy.name || '', org: l.addedBy.org || '' } : null,
    addedAt: l.addedAt || null,
    // owner removes any layer; an editor only the ones they added themselves
    canRemove: role === 'owner' || !!(who && l.addedBy && l.addedBy.email === who.email),
  }));
  res.json({ layers, role });
});

// Remove a contributed layer — owner: any; editor: only their own.
router.post('/layers/remove', (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  const layerId = String(b.layerId || '');
  const inst = reg.getInstance(dataset);
  const role = inst ? callerRole(req, inst) : (auth.isAdmin(req) ? 'owner' : null);
  if (!role) return res.status(403).json({ error: 'sign in as this atlas’s owner or a collaborator', needsAuth: true });
  let m = null;
  try { m = imports.readManifest(dataset); } catch { /* dataset dir missing */ }
  const layer = ((m && m.local && m.local.layers) || []).find((l) => l.id === layerId);
  if (!layer) return res.status(404).json({ error: 'layer not found' });
  if (role !== 'owner') {
    const who = auth.sessionFromReq(req);
    if (!who || !layer.addedBy || layer.addedBy.email !== who.email) {
      return res.status(403).json({ error: 'you can only remove layers your organisation added' });
    }
  }
  const gone = imports.removeLayer(dataset, layerId);
  res.json({ ok: gone });
});

router.post('/layers/discard', (req, res) => {
  const session = imports.getImport(String((req.body || {}).importId || ''));
  if (session) imports.discardImport(session.id);
  res.json({ ok: true });
});

router.get('/layers/imports', (req, res) => {
  const dataset = String(req.query.dataset || '');
  if (!requireDatasetEditor(req, res, dataset)) return;
  res.json({ imports: imports.listImports(dataset) });
});
