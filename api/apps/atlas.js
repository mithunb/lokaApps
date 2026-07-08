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
router.use(express.json({ limit: '2mb' }));

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
  if (job.status === 'done') {
    reg.updateInstance(job.slug, { status: 'built', sizeBytes: job.sizeBytes || 0, builtAt: Date.now() });
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

function callerCanEdit(req, inst) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && reg.hashToken(bearer) === inst.tokenHash) return true;
  const session = auth.sessionFromReq(req);
  if (session && inst.ownerAccount && session.email === inst.ownerAccount) return true;
  if (auth.isAdmin(req)) return true;
  return false;
}

router.get('/instances', (_req, res) => {
  res.json({ instances: reg.listPublic() });
});

router.get('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (callerCanEdit(req, inst)) {
    const { tokenHash, viewKeyHash, spec, ...rest } = inst;
    return res.json({ ...rest, canEdit: true });
  }
  if (inst.status === 'published' && inst.visibility === 'public') {
    return res.json(reg.publicFields(inst));
  }
  res.status(404).json({ error: 'not found' });
});

router.post('/instances/:slug/publish', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  if (inst.status === 'published') return res.json({ ok: true, already: true });
  if (inst.status !== 'built') return res.status(409).json({ error: `cannot publish while ${inst.status}` });
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

router.delete('/instances/:slug', (req, res) => {
  const inst = reg.getInstance(String(req.params.slug));
  if (!inst) return res.status(404).json({ error: 'not found' });
  if (!callerCanEdit(req, inst)) return res.status(403).json({ error: 'not allowed' });
  for (const root of [DATASETS_ROOT, PRIVATE_ROOT]) {
    const dir = path.join(root, inst.slug);
    if (dir.startsWith(root) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  reg.deleteInstance(inst.slug);
  res.json({ ok: true });
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
  let next = String((req.body && req.body.next) || '');
  if (!/^\/[a-zA-Z0-9/_\-.?=&%]*$/.test(next)) next = '';
  const link = `${siteBase(req)}/apps/atlas/api/auth/verify?token=${makeSafe(auth.makeLoginToken(email))}` +
    (next ? `&next=${encodeURIComponent(next)}` : '');
  const result = await sendMail({
    to: email,
    subject: 'Sign in to LOKA Atlas',
    text: `Click to sign in (valid 15 minutes):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
  });
  res.json({ ok: true, sent: !!result.sent, via: result.via || 'log' });
});
function makeSafe(t) { return encodeURIComponent(t); }

router.get('/auth/verify', (req, res) => {
  const p = auth.readLoginToken(String(req.query.token || ''));
  if (!p) return res.status(400).send(page('Link expired', 'This sign-in link is invalid or has expired. Request a new one from the wizard.'));
  reg.markVerified(p.email);
  res.setHeader('Set-Cookie', auth.sessionCookie(p.email));
  let next = String(req.query.next || '');
  if (!/^\/[a-zA-Z0-9/_\-.?=&%]*$/.test(next)) next = '';
  if (next) return res.redirect(302, next);
  res.send(page('Signed in', `You're signed in as <b>${p.email}</b>. Return to the wizard tab — it will pick this up automatically.`));
});

router.get('/auth/me', (req, res) => {
  const session = auth.sessionFromReq(req);
  if (!session) return res.status(401).json({ error: 'not signed in' });
  const acc = reg.getAccount(session.email);
  res.json({
    email: session.email,
    verifiedAt: acc ? acc.verifiedAt : null,
    instances: acc ? acc.instances : [],
    drafts: reg.listDrafts(session.email).map((d) => ({ id: d.id, title: d.title || '', updatedAt: d.updatedAt })),
  });
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
        id: L.id, label: L.label || L.id, source: L.source,
        count: feats.length, nameProp, parentProp,
        exampleNames: feats.slice(0, 10).map((f) => String(f.properties[nameProp])),
      });
    } catch {}
  }
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
    kind: { type: Type.STRING, enum: ['markers', 'choropleth'] },
    label: { type: Type.STRING },
    group: { type: Type.STRING, enum: ['base', 'agri', 'eco'] },
    subgroup: { type: Type.STRING },
    valueColumn: { type: Type.STRING },
    unit: { type: Type.STRING },
    palette: { type: Type.STRING, enum: Object.keys(PALETTES) },
    reverse: { type: Type.BOOLEAN },
    classCount: { type: Type.INTEGER },
    markerColor: { type: Type.STRING, enum: Object.keys(MARKER_COLORS) },
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

  if (strategy === 'coordinates') {
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
  const frag = buildFragment(spec, feats, existingIds);
  const clean = sanitizeFeatures(feats, [...keep], m.manifest.bounds);
  report.outside = clean.outside;

  return { frag, features: clean.features, report };
}

function applyAndDraft(session) {
  const { frag, features, report } = transform(session);
  const draftId = imports.writeDraft(session.dataset, session.id, frag.stanza,
    frag.sourceFile, { type: 'FeatureCollection', features });
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
  const { options } = boundaryOptions(dataset);
  res.json({
    boundaries: options.map(({ id, label, count, exampleNames }) => ({ id, label, count, exampleNames: exampleNames.slice(0, 5) })),
    palettes: Object.keys(PALETTES),
    markerColors: Object.keys(MARKER_COLORS),
    geminiAvailable: !!ai,
  });
});

router.post('/layers/infer', async (req, res) => {
  const b = req.body || {};
  const dataset = String(b.dataset || '');
  if (!imports.datasetDir(dataset)) return res.status(404).json({ error: 'unknown dataset' });
  if (!Array.isArray(b.columns) || !Array.isArray(b.rows) || !b.rows.length) {
    return res.status(400).json({ error: 'columns and rows required' });
  }
  const columns = b.columns.map(String).slice(0, MAX_COLS);
  const rows = b.rows.slice(0, MAX_ROWS).map((r) => {
    const o = {};
    for (const c of columns) {
      const v = r[c];
      o[c] = typeof v === 'number' ? v : (v == null ? '' : String(v).slice(0, 500));
    }
    return o;
  });

  const profiles = profileColumns(columns, rows);
  const { options } = boundaryOptions(dataset);
  const m = imports.readManifest(dataset);

  const session = imports.newImport({
    dataset, filename: String(b.filename || '').slice(0, 120),
    columnsRaw: columns, rows, profilesSummary: profiles.map((p) => ({ name: p.name, type: p.type })),
  });

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
    const firstOpt = options[0];
    let nameGuess = null;
    if (firstOpt) {
      const bt = boundaryTargets(dataset, firstOpt.id);
      nameGuess = bestNameColumn(profiles, rows, bt.targets.map((t) => t.name), norm);
    }
    const numeric = profiles.find((p) => p.type === 'number' && !p.looksLikeLat && !p.looksLikeLng);
    session.strategy = lat && lng ? 'coordinates' : 'adminJoin';
    session.joinLayer = firstOpt && firstOpt.id;
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
    let result = applyAndDraft(session);

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
        if (applied) result = applyAndDraft(session);
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
  if (b.spec && typeof b.spec === 'object') session.spec = b.spec;
  if (b.strategy && ['coordinates', 'adminJoin'].includes(b.strategy)) session.strategy = b.strategy;
  if (b.joinLayer) session.joinLayer = String(b.joinLayer);
  if (Array.isArray(b.columns)) {
    session.columns = b.columns
      .filter((c) => c && session.columnsRaw.includes(c.name))
      .map((c) => ({ name: c.name, role: String(c.role) }));
  }
  try {
    res.json(applyAndDraft(session));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/resolve', (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  session.matchState = session.matchState || {};
  for (const f of (Array.isArray(b.fixes) ? b.fixes : [])) {
    if (!Number.isInteger(f.row)) continue;
    if (f.skip) session.matchState[f.row] = 'skip';
    else if (typeof f.code === 'string') session.matchState[f.row] = f.code;
  }
  try {
    res.json(applyAndDraft(session));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/refine', async (req, res) => {
  const b = req.body || {};
  const session = imports.getImport(String(b.importId || ''));
  if (!session) return res.status(404).json({ error: 'import expired or unknown' });
  const message = String(b.message || '').slice(0, 500);
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!ai) return res.status(503).json({ error: 'AI refine is unavailable — use the pickers instead' });
  if (!geminiAllowed(clientIp(req))) return res.status(429).json({ error: 'AI limit reached — try later' });

  const prompt = [
    'Patch this atlas layer spec according to the user instruction. Keep unrelated fields unchanged.',
    'Current spec: ' + JSON.stringify(session.spec),
    'Available numeric columns: ' + JSON.stringify((session.columns || []).filter((c) => c.role === 'value').map((c) => c.name)),
    'All columns: ' + JSON.stringify(session.columnsRaw),
    'Palettes: ' + Object.keys(PALETTES).join(', ') + ' (rdylgn = red→green, gnrd = green→red).',
    'User instruction: ' + message,
    'reply: one short friendly sentence describing what you changed.',
  ].join('\n');

  try {
    let out;
    try {
      out = await geminiJSON(getFlashLiteModel(), prompt, REFINE_SCHEMA);
    } catch {
      out = await geminiJSON(getFlashModel(), prompt, REFINE_SCHEMA);
    }
    session.spec = out.layer;
    const result = applyAndDraft(session);
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

  // auth: instance edit token (registry) or admin token (e.g. the deoria dataset)
  const inst = reg.getInstance(session.dataset);
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const ok = (inst && bearer && reg.hashToken(bearer) === inst.tokenHash) || auth.isAdmin(req);
  if (!ok) return res.status(403).json({ error: 'edit token required to change this atlas' });

  try {
    const { frag, features } = (function () {
      const t = transform(session);
      return { frag: t.frag, features: t.features };
    })();
    const out = imports.commitLayer(session.dataset, frag.stanza, frag.sourceFile,
      { type: 'FeatureCollection', features });
    imports.discardImport(session.id);
    res.json({ ok: true, layerId: out.layerId, dataset: session.dataset });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/layers/discard', (req, res) => {
  const session = imports.getImport(String((req.body || {}).importId || ''));
  if (session) imports.discardImport(session.id);
  res.json({ ok: true });
});

router.get('/layers/imports', (req, res) => {
  res.json({ imports: imports.listImports(String(req.query.dataset || '')) });
});
