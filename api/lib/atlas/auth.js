// Passwordless auth for the atlas wizard: HMAC-signed tokens for magic links,
// admin approve/deny actions, and the session cookie. No passwords anywhere;
// the signing secret is generated once and persisted alongside the registry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './registry.js';

const SECRET_FILE = path.join(DATA_DIR, 'secret');
const SESSION_COOKIE = 'atlas_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_TTL_MS = 15 * 60 * 1000;             // magic links: 15 minutes
const ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // admin approve/deny links: 7 days

let secret = null;
function getSecret() {
  if (secret) return secret;
  try {
    secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    secret = crypto.randomBytes(32).toString('base64url');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  }
  return secret;
}

function hmac(data) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/* ---------- generic signed tokens: base64url(payload).sig ---------- */

export function signToken(payload, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }))
    .toString('base64url');
  return body + '.' + hmac(body);
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = hmac(body);
  if (sig.length !== expect.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- purpose-specific wrappers ---------- */

// Login links carry a SHORT random single-use code (not a self-contained
// signed token) so the emailed URL stays compact. The code maps to {email, exp}
// in a small persisted file (survives restarts within the 15-min TTL); it is
// deleted the first time it's read, so a link works exactly once.
const LOGIN_CODES_FILE = path.join(DATA_DIR, 'login-codes.json');
let loginCodes = null; // Map: code -> { email, exp }

function loadLoginCodes() {
  if (loginCodes) return loginCodes;
  loginCodes = new Map();
  try {
    const obj = JSON.parse(fs.readFileSync(LOGIN_CODES_FILE, 'utf8'));
    const now = Date.now();
    for (const [code, rec] of Object.entries(obj)) {
      if (rec && rec.exp > now) loginCodes.set(code, rec);
    }
  } catch { /* no file yet */ }
  return loginCodes;
}

function persistLoginCodes() {
  const codes = loadLoginCodes();
  const now = Date.now();
  const obj = {};
  for (const [code, rec] of codes) if (rec.exp > now) obj[code] = rec;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = LOGIN_CODES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, LOGIN_CODES_FILE);
  } catch (e) {
    console.warn('[atlas] login-codes persist failed:', e.message);
  }
}

export function makeLoginToken(email) {
  const codes = loadLoginCodes();
  const now = Date.now();
  for (const [c, rec] of codes) if (rec.exp <= now) codes.delete(c); // prune
  const code = crypto.randomBytes(16).toString('base64url'); // ~22 URL-safe chars
  codes.set(code, { email, exp: now + LOGIN_TTL_MS });
  persistLoginCodes();
  return code;
}
export function readLoginToken(code) {
  if (typeof code !== 'string' || !code) return null;
  const codes = loadLoginCodes();
  const rec = codes.get(code);
  if (!rec) return null;
  codes.delete(code);       // single-use — invalidate immediately
  persistLoginCodes();
  if (rec.exp <= Date.now()) return null;
  return { t: 'login', email: rec.email };
}

export function makeActionToken(slug, action) {
  return signToken({ t: 'action', slug, action }, ACTION_TTL_MS);
}
export function readActionToken(token) {
  const p = verifyToken(token);
  return p && p.t === 'action' ? p : null;
}

/* ---------- session cookie ---------- */

export function sessionCookie(email) {
  const tok = signToken({ t: 'session', email }, SESSION_TTL_MS);
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export function sessionFromReq(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) {
      const p = verifyToken(rest.join('='));
      if (p && p.t === 'session' && p.email) return { email: p.email };
    }
  }
  return null;
}

/* ---------- admin ---------- */

export function isAdmin(req) {
  const want = process.env.ATLAS_ADMIN_TOKEN;
  if (!want) return false;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return got.length === want.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
