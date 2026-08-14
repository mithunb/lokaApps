// Passwordless auth for the atlas wizard: HMAC-signed tokens for magic links,
// admin approve/deny actions, and the session cookie. No passwords anywhere;
// the signing secret is generated once and persisted alongside the registry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, normEmail } from './registry.js';

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

/* ---------- sign-in OTP: a 6-digit code typed into the wizard ----------
   Stored alongside the legacy link codes (same file): key "otp:<email>",
   value { hash, exp, tries }. One active code per email; verifying consumes
   it, and 5 wrong tries burn it. */

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_TRIES = 5;

export function makeOtp(email) {
  const codes = loadLoginCodes();
  const now = Date.now();
  for (const [c, rec] of codes) if (rec.exp <= now) codes.delete(c); // prune
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const key = 'otp:' + String(email).toLowerCase();
  codes.set(key, { email: String(email).toLowerCase(), hash: hmac('otp' + otp), exp: now + OTP_TTL_MS, tries: 0 });
  persistLoginCodes();
  return otp;
}

export function verifyOtp(email, otp) {
  const key = 'otp:' + String(email || '').toLowerCase();
  const codes = loadLoginCodes();
  const rec = codes.get(key);
  if (!rec || !rec.hash) return false;
  if (rec.exp <= Date.now()) { codes.delete(key); persistLoginCodes(); return false; }
  rec.tries = (rec.tries || 0) + 1;
  const want = hmac('otp' + String(otp || '').trim());
  const ok = want.length === rec.hash.length &&
    crypto.timingSafeEqual(Buffer.from(want), Buffer.from(rec.hash));
  if (ok || rec.tries >= OTP_MAX_TRIES) codes.delete(key); // single-use; lockout after 5 tries
  persistLoginCodes();
  return ok;
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

// The second, deliberately narrow admin path: a signed-in session whose email
// is the operator's (ATLAS_ADMIN_EMAIL, defaulting to the same address
// apps/atlas.js notifies). Sessions are minted from normEmail'd addresses and
// the comparison re-normalises both sides the same way, so case or stray
// whitespace can never mint a second identity.
// Kept separate from isAdmin on purpose: every isAdmin call site grants owner
// powers (delete, publish, rebuild, edit), and this check must only ever guard
// READ-ONLY surfaces — today, the admin dashboard's listing.
export function isAdminSession(req) {
  const admin = normEmail(process.env.ATLAS_ADMIN_EMAIL || 'mithun@socratus.org');
  const session = sessionFromReq(req);
  return !!(session && session.email && normEmail(session.email) === admin);
}
