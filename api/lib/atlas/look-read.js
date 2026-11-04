/* LOKA Atlas — reading a website's colours and logo, on the server.
 *
 * The owner types an address in Settings; this reads the page and its
 * stylesheets and hands back what it found, for look-map.js to turn into an
 * atlas's look (docs/design-style-from-website.md §2–§3, §13).
 *
 * The owner's browser never touches the site: the browser cannot (CORS), what
 * comes back must be bounded, and a site must never learn who the owner is.
 * So everything here is bounded and careful:
 *   - the address is checked before every connection, first request and each
 *     redirect: a public name only, resolved here, refused if any answer is a
 *     private, loopback, link-local or cloud-metadata address, and the
 *     connection is made to the very address that was checked (pinned), so
 *     the answer cannot change between the check and the connection;
 *   - time and size caps on everything, bodies read as streams and cut at the
 *     cap (Content-Length is not trusted);
 *   - no script from the site ever runs: the HTML is tokenised, not loaded,
 *     and <script> and <noscript> bodies are skipped entirely.
 *
 * The parsers are small tokenisers written for this, not a full cascade. They
 * need to be right for the common platforms, which test/look-read-test.mjs
 * holds with saved fixtures. No new dependency. */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireScript = createRequire(import.meta.url);
const LM = requireScript(path.join(__dirname, '..', '..', '..', 'atlas', 'look-map.js'));

/* ---------- limits (§2) ---------- */
export const LIMITS = {
  totalMs: 8000, hopMs: 4000, pageHopMs: 6000, redirects: 5,   // the page itself may take 6 s of the 8 (Mithun, 2 Nov 2026): a cold connection is often slow
  html: 2 * 1024 * 1024, css: 1024 * 1024, sheets: 8, images: 6, image: 3 * 1024 * 1024, svg: 200 * 1024,
  readsPerAtlasPerHour: 12, readsPerAccountPerDay: 60,
};
const USER_AGENT = 'LOKA-Atlas-look (+https://loka.place)';

/* What the owner reads when a read fails (§2's table). The code keeps a short
   reason for the log; the sheet shows only these. */
export const WORDS = {
  unreachable: 'We couldn’t reach that address. Check it and try again.',
  refused: 'That site doesn’t let us read it. You can still add your logo and colours by hand in Settings.',
  slow: 'That site took too long to answer. Try again in a minute.',
  nothing: 'We couldn’t find colours or a logo on that page. Try the site’s front page, or add them by hand.',
  partial: 'That site draws itself in the browser, so we could only read part of it.',
  busy: 'We are already reading that site — one moment.',
  often: 'That is enough reads for now. Try again in an hour.',
};

/* ---------- address rules ---------- */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;       // 192.0.0.0/24, IETF protocol assignments
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;  // 198.18.0.0/15, benchmarking
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/) || v.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
    if (mapped) {
      if (mapped[2]) {
        const a = parseInt(mapped[1], 16), b = parseInt(mapped[2], 16);
        return isPrivateAddress([a >> 8, a & 255, b >> 8, b & 255].join('.'));
      }
      return isPrivateAddress(mapped[1]);
    }
    if (v === '::' || v === '::1' || /^0*(:0*)*:0*1$/.test(v)) return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true;         // fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true;         // fe80::/10
    if ((first & 0xff00) === 0xff00) return true;         // multicast
    if (/^64:ff9b:/.test(v)) return true;                 // NAT64 to anything, not ours to judge
    if (/^2002:/.test(v)) return true;                    // 6to4, wraps any IPv4
    if (/^2001:0*:/.test(v)) return true;                 // Teredo, 2001::/32, wraps any IPv4
    return false;
  }
  return true;   // not an address at all
}

/* The address as typed → a URL to try, or the reason it cannot be tried.
   "emergencefestival.in" is tried as https. Raw IPs, ports other than the
   scheme's own, credentials in the address, localhost and our own hosts are
   refused — nothing to learn there, and some of it is a loop. */
export function checkAddress(typed) {
  const s = String(typed || '').trim();
  if (!s || s.length > 500) return { error: 'empty' };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { return { error: 'not-a-url' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'scheme' };
  if (u.username || u.password) return { error: 'credentials' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || net.isIP(host)) return { error: 'raw-ip' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return { error: 'local-name' };
  if (host === 'loka.place' || host.endsWith('.loka.place')) return { error: 'own-host' };   // nothing to learn, and a loop
  if (u.port && u.port !== (u.protocol === 'https:' ? '443' : '80')) return { error: 'port' };
  u.hash = '';
  return { url: u.toString(), host };
}

/* Resolve a host and refuse it if any answer is private. Returns the one
   address the connection must use. A name server that never answers is given
   up on after `ms`, so a lookup cannot outlast the whole read. */
export async function resolvePublic(host, lookup, ms) {
  let answers, timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), Math.max(0, ms == null ? LIMITS.totalMs : ms)); });
  try {
    answers = await Promise.race([(lookup || ((h) => dns.lookup(h, { all: true, verbatim: true })))(host), late]);
  } catch { return { error: 'no-such-name' }; } finally { clearTimeout(timer); }
  if (answers === 'timeout') return { error: 'timeout' };
  if (!answers || !answers.length) return { error: 'no-such-name' };
  for (const a of answers) if (isPrivateAddress(a.address)) return { error: 'private-address' };
  return { address: answers[0].address, family: answers[0].family };
}

/* One bounded GET, following redirects itself so each hop is checked and
   pinned. Returns { status, type, body, url, cut } or { error }.
   opts: { maxBytes, accept (regex on content type), deadline (ms epoch),
           lookup, request } — the last two are for the checks. */
export async function fetchBounded(url, opts) {
  const o = Object.assign({ maxBytes: LIMITS.html, accept: /./, deadline: Date.now() + LIMITS.totalMs }, opts || {});
  let current = url;
  for (let hop = 0; hop <= LIMITS.redirects; hop++) {
    const chk = checkAddress(current);
    if (chk.error) return { error: chk.error, url: current };
    const left = o.deadline - Date.now();
    if (left <= 0) return { error: 'timeout', url: current };
    const u = new URL(chk.url);
    const where = await resolvePublic(u.hostname, o.lookup, Math.min(o.hopMs || LIMITS.hopMs, left));
    if (where.error) return { error: where.error, url: current };
    const r = await oneRequest(u, where, Math.min(o.hopMs || LIMITS.hopMs, o.deadline - Date.now()), o);
    if (r.error) return { error: r.error, url: current };
    if (r.status >= 300 && r.status < 400 && r.location) {
      let next;
      try { next = new URL(r.location, u).toString(); } catch { return { error: 'bad-redirect', url: current }; }
      current = next;
      continue;
    }
    const type = String(r.type || '').split(';')[0].trim().toLowerCase();
    // a body with no type is taken by its path (.css) or, for pictures, by its first bytes (a logo served from a bare address)
    const bare = type === '' && ((o.acceptByPath && o.acceptByPath.test(u.pathname)) || (o.sniff && o.sniff(r.body)));
    if (!o.accept.test(type) && !bare) return { dropped: true, status: r.status, type, url: chk.url };
    return { status: r.status, type, body: r.body, url: chk.url, cut: r.cut, headers: r.headers };
  }
  return { error: 'too-many-redirects', url: current };
}

function oneRequest(u, where, ms, o) {
  return new Promise((resolve) => {
    const mod = u.protocol === 'https:' ? https : http;
    const chunks = []; let got = 0, cut = false, done = false, req = null;
    // `timeout` below is node's idle timeout: it never fires while bytes keep
    // dripping in. This clock is the hard one: at `ms` the request is torn
    // down whatever it is doing, so a site that drips a byte every few seconds
    // cannot hold a read (and the atlas) for longer than the budget.
    const hard = setTimeout(() => { if (req) req.destroy(); finish({ error: 'timeout' }); }, ms);
    const finish = (v) => { if (!done) { done = true; clearTimeout(hard); resolve(v); } };
    req = (o.request || mod.request)(u, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: o.acceptHeader || '*/*', 'Accept-Language': 'en' },
      timeout: ms,
      // the address that was checked, not a second resolution of the name
      // (node asks with { all: true } when it may pick between families, and
      // then wants a list; otherwise one address)
      lookup: (_host, lo, cb) => (lo && lo.all ? cb(null, [{ address: where.address, family: where.family }]) : cb(null, where.address, where.family)),
      servername: u.hostname,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return finish({ status: res.statusCode, location: res.headers.location });
      }
      res.on('data', (d) => {
        if (done) return;
        got += d.length;
        // past the whole read's deadline: what has come is kept, cut, and the rest is not waited for
        if (o.deadline && Date.now() > o.deadline) {
          chunks.push(d); cut = true; res.destroy();
          finish({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks), cut: true, headers: res.headers });
          return;
        }
        if (got > o.maxBytes) {
          chunks.push(d.subarray(0, d.length - (got - o.maxBytes)));
          cut = true;
          res.destroy();
          finish({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks), cut: true, headers: res.headers });
          return;
        }
        chunks.push(d);
      });
      res.on('end', () => finish({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks), cut, headers: res.headers }));
      res.on('error', () => finish({ error: 'connection' }));
    });
    req.on('timeout', () => { req.destroy(); finish({ error: 'timeout' }); });
    req.on('error', () => finish({ error: 'connection' }));
    req.end();
  });
}

/* ---------- HTML: a flat list of tokens, never a DOM ---------- */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
function unent(s) {
  return String(s).replace(/&(amp|quot|lt|gt|#39|#x27|apos|nbsp);/g, (m, k) => ({ amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'", '#x27': "'", apos: "'", nbsp: ' ' })[k]);
}
function parseAttrs(s) {
  const out = {}; ATTR.lastIndex = 0; let m;
  while ((m = ATTR.exec(s))) out[m[1].toLowerCase()] = unent(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] != null ? m[4] : '');
  return out;
}
export function tokeniseHTML(html) {
  const s = String(html), out = []; let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { out.push({ type: 'text', text: s.slice(i) }); break; }
    if (lt > i) out.push({ type: 'text', text: s.slice(i, lt) });
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? s.length : e + 3; continue; }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; continue; }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(s.slice(lt, lt + 40));
    if (!m) { out.push({ type: 'text', text: '<' }); i = lt + 1; continue; }
    const name = m[2].toLowerCase();
    // the tag's end, minding quotes in attributes
    let j = lt + m[0].length, q = null;
    while (j < s.length) {
      const ch = s[j];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '>') break;
      j++;
    }
    const inside = s.slice(lt + m[0].length, j), end = j + 1;
    if (m[1]) { out.push({ type: 'close', name }); i = end; continue; }
    const attrs = parseAttrs(inside);
    const selfClosing = /\/\s*$/.test(inside) || VOID.has(name);
    // raw-text elements: their bodies are not markup. Script and noscript are
    // skipped entirely; style is kept as CSS text; svg is kept whole (as text).
    if (name === 'script' || name === 'style' || name === 'noscript' || name === 'svg' || name === 'textarea' || name === 'title') {
      const close = new RegExp('</' + name + '\\s*>', 'ig'); close.lastIndex = end;
      const c = close.exec(s);
      const body = s.slice(end, c ? c.index : s.length);
      if (name === 'style') out.push({ type: 'style', attrs, css: body });
      else if (name === 'svg') out.push({ type: 'svg', attrs, svg: s.slice(lt, c ? c.index + c[0].length : s.length) });
      else if (name === 'title') out.push({ type: 'title', text: unent(body).replace(/\s+/g, ' ').trim() });
      i = c ? c.index + c[0].length : s.length;
      continue;
    }
    out.push({ type: 'open', name, attrs, selfClosing });
    i = end;
  }
  return out;
}

/* ---------- CSS: { selector, decls, dark } per rule ---------- */
function splitDecls(block) {
  const decls = []; let depth = 0, cur = '';
  for (const ch of block) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
  }
  decls.push(cur);
  return decls.map((d) => {
    const k = d.indexOf(':');
    if (k < 0) return null;
    const prop = d.slice(0, k).trim().toLowerCase(), value = d.slice(k + 1).replace(/!important/i, '').trim();
    return prop && value ? { prop, value } : null;
  }).filter(Boolean);
}
export function parseCSS(css, opts) {
  const s = String(css).replace(/\/\*[\s\S]*?\*\//g, ''), rules = [], fontFaces = [], imports = [];
  const dark = !!(opts && opts.dark);
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i), semi = s.indexOf(';', i);
    if (open < 0) break;
    // an @import (or any statement) that ends before the next block
    if (semi >= 0 && semi < open) {
      const st = s.slice(i, semi).trim();
      if (/^@import/i.test(st)) imports.push(st);
      i = semi + 1; continue;
    }
    const head = s.slice(i, open).trim();
    // find the matching close brace
    let depth = 1, j = open + 1;
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
    const body = s.slice(open + 1, j - 1);
    i = j;
    if (!head) continue;
    if (head[0] === '@') {
      const at = head.toLowerCase();
      if (/^@font-face/.test(at)) { fontFaces.push(splitDecls(body)); continue; }
      if (/^@(keyframes|-webkit-keyframes|page|counter-style|property|charset|namespace)/.test(at)) continue;
      if (/^@(media|supports|layer|container|scope|document)/.test(at)) {
        const inner = parseCSS(body, { dark: dark || /prefers-color-scheme\s*:\s*dark/.test(at) });
        rules.push(...inner.rules); fontFaces.push(...inner.fontFaces); imports.push(...inner.imports);
      }
      continue;
    }
    // nested rules inside a plain rule (modern CSS) are not followed
    const flat = body.includes('{') ? body.slice(0, body.indexOf('{')).replace(/[^;]*$/, '') : body;
    rules.push({ selector: head.replace(/\s+/g, ' '), decls: splitDecls(flat), dark });
  }
  return { rules, fontFaces, imports };
}

/* ---------- colours ---------- */
const NAMED = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32',
};
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('').toUpperCase();
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
const num = (t) => { const v = parseFloat(t); return Number.isFinite(v) ? v : null; };
/* One colour value → "#RRGGBB" or null. `vars` resolves var(--x) one level;
   `depth` stops a var that points at a var that points back. */
export function parseColour(value, vars, depth) {
  let v = String(value == null ? '' : value).trim();
  if (!v) return null;
  const low = v.toLowerCase();
  if (/^(currentcolor|inherit|initial|unset|transparent|none|revert)$/.test(low)) return null;
  if (/gradient\(|color-mix\(|url\(/.test(low)) return null;
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/i.exec(v))) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return ('#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2]).toUpperCase();
    if (h.length === 6 || h.length === 8) return ('#' + h.slice(0, 6)).toUpperCase();
    return null;
  }
  if ((m = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/i.exec(v))) {
    const got = vars && vars[m[1].toLowerCase()];
    if (got != null && (depth || 0) < 2) { const r = parseColour(got, vars, (depth || 0) + 1); if (r) return r; }
    return m[2] != null ? parseColour(m[2], vars, (depth || 0) + 1) : null;
  }
  if ((m = /^rgba?\(\s*([^)]*)\)$/i.exec(v))) {
    const parts = m[1].replace(/\s*\/\s*[^,\s]+\s*$/, '').split(/[\s,]+/).filter(Boolean).slice(0, 3);
    if (parts.length !== 3) return null;
    const ch = parts.map((p) => /%$/.test(p) ? num(p) * 2.55 : num(p));
    if (ch.some((x) => x == null)) return null;
    return toHex(ch[0], ch[1], ch[2]);
  }
  if ((m = /^hsla?\(\s*([^)]*)\)$/i.exec(v))) {
    const parts = m[1].replace(/\s*\/\s*[^,\s]+\s*$/, '').split(/[\s,]+/).filter(Boolean).slice(0, 3);
    if (parts.length !== 3) return null;
    const h = num(parts[0]), s = num(parts[1]), l = num(parts[2]);
    if (h == null || s == null || l == null) return null;
    return hslToHex(h, s / 100, l / 100);
  }
  if (NAMED[low]) return ('#' + NAMED[low]).toUpperCase();
  return null;
}
// a `background` shorthand holds a colour among images and positions
function colourIn(value, vars) {
  const direct = parseColour(value, vars);
  if (direct) return direct;
  const toks = String(value).match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|var\([^)]*\)|\b[a-zA-Z]+\b/g) || [];
  for (const t of toks) { const c = parseColour(t, vars); if (c) return c; }
  return null;
}

/* ---------- which element a selector speaks of ---------- */
const STATE = /:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|target)\b/;
function lastCompound(sel) {
  // :where(a:where(:not(.x))) → a ; drop :not(...) groups and :where/:is wrappers
  let s = sel.trim().replace(/::?[a-z-]+\([^()]*(?:\([^()]*\)[^()]*)*\)/gi, (m) => (/^::?(where|is)\(/i.test(m) ? ' ' + m.replace(/^::?(where|is)\(/i, '').replace(/\)$/, '') + ' ' : ' '));
  s = s.replace(/::[a-z-]+/gi, '').replace(/\s*[>+~]\s*/g, ' ').trim();
  const parts = s.split(/\s+/);
  return parts[parts.length - 1] || '';
}
const HEADERISH = /(^|[-_])(header|navbar|nav|masthead|topbar|banner)([-_]|$)/i;
const BUTTONISH = /(^|[-_])(btn|button|cta)([-_]|$)/i;
function classify(selector) {
  // the strongest class any part of a comma list earns
  let best = { weight: 1, kind: 'other' };
  for (const one of selector.split(',')) {
    const c = lastCompound(one);
    if (!c) continue;
    const stateful = STATE.test(one);
    const tag = (c.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
    const classes = (c.match(/\.[a-zA-Z0-9_-]+/g) || []).map((x) => x.slice(1));
    const id = (c.match(/#[a-zA-Z0-9_-]+/) || [''])[0].slice(1);
    const attrs = c.match(/\[[^\]]*\]/g) || [];
    let got = null;
    if ((tag === 'body' || tag === 'html' || tag === ':root') && !classes.length) got = { weight: 8, kind: 'page' };
    else if (tag === 'a' || tag === 'button' || classes.some((k) => BUTTONISH.test(k) || k === 'wp-element-button' || k === 'wp-block-button__link') ||
      attrs.some((a) => /class\*=.?btn|type=.?submit/.test(a))) got = { weight: 6, kind: 'accent' };
    else if (tag === 'header' || tag === 'nav' || classes.some((k) => HEADERISH.test(k)) || HEADERISH.test(id) || attrs.some((a) => /role=.?banner/.test(a))) got = { weight: 4, kind: 'header' };
    else if (tag === 'h1' || tag === 'h2' || classes.some((k) => /site-title|hero/.test(k))) got = { weight: 3, kind: 'heading' };
    if (got && stateful) got = { weight: 1, kind: 'other' };
    if (got && got.weight > best.weight) best = got;
  }
  return best;
}

/* ---------- names of custom properties → roles ---------- */
const PRESET = /^--(wp--preset--color--|color[_-]|tw-|sqs|siteColor|[a-z]*Color$)/i;
const PRESET_ECHO = /^\s*\.has-[a-z0-9-]+-(color|background-color|border-color)\s*$/i;
function rolesFromName(name) {
  const n = name.toLowerCase().replace(/^--/, '');
  const roles = [];
  if (/primary|brand|accent|main|link|button|cta/.test(n)) roles.push('accent');
  if (/secondary|highlight|alert|danger/.test(n)) roles.push('highlight');
  if (/background|bg\b|base|white|paper/.test(n)) roles.push('page');
  if (/\btext|foreground|body|ink|black/.test(n)) roles.push('text');
  return roles;
}

/* ---------- the extraction, pure ----------
   page: { html, sheets: [{ url, css }], url } → what look-map.js takes, plus
   the logo candidates (not yet fetched) and what the page is like. */
export function extract(page) {
  const tokens = tokeniseHTML(page.html || '');
  const base = page.url || 'https://example.invalid/';
  const sheetsCSS = [];   // in document order: inline <style> and linked sheets
  const linked = [];      // stylesheet URLs, in order
  const meta = { themeColor: null, title: '', icons: [], manifest: null };
  const imgs = [];        // logo candidates as seen in the markup
  const stack = [];       // open elements, for ancestry
  let words = 0, bodyChars = 0, inBody = false;
  const inlineStyled = [];
  const abs = (u) => { try { return new URL(u, base).toString(); } catch { return null; } };

  for (const t of tokens) {
    if (t.type === 'style') { sheetsCSS.push({ css: t.css, where: 'inline' }); continue; }
    if (t.type === 'title') { if (!meta.title) meta.title = t.text; continue; }
    if (t.type === 'text') {
      if (inBody) {
        const tx = t.text.replace(/\s+/g, ' ').trim();
        if (tx) { words += tx.split(' ').length; bodyChars += tx.length + 1; }
      }
      continue;
    }
    if (t.type === 'svg') {
      if (ancestryHints(stack).inHeader && t.svg.length <= LIMITS.svg) {
        const a = t.attrs || {};
        imgs.push({ kind: 'svg', svg: t.svg, hints: hintsOf(a, stack), early: bodyChars < 3000, from: 'a drawing in the site’s header', ...ancestryHints(stack) });
      }
      continue;
    }
    if (t.type === 'close') {
      for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === t.name) { stack.length = k; break; }
      continue;
    }
    // open
    const a = t.attrs;
    if (t.name === 'body') inBody = true;
    if (t.name === 'meta') {
      const n = (a.name || a.property || '').toLowerCase();
      if (n === 'theme-color' && !a.media && !meta.themeColor) meta.themeColor = a.content || null;
      else if (n === 'theme-color' && /light/.test(a.media || '') ) meta.themeColor = a.content || meta.themeColor;
    } else if (t.name === 'link') {
      const rel = (a.rel || '').toLowerCase().split(/\s+/);
      if (rel.includes('stylesheet') && a.href && !/print/.test(a.media || '')) { const u = abs(a.href); if (u) { linked.push(u); sheetsCSS.push({ where: 'link', url: u }); } }
      else if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
        const u = abs(a.href);
        if (u) meta.icons.push({ url: u, sizes: a.sizes || '', apple: rel.includes('apple-touch-icon') });
      } else if (rel.includes('manifest') && a.href) meta.manifest = abs(a.href);
    } else if (t.name === 'img' && inBody) {
      const src = a.src && !/^data:/.test(a.src) ? abs(a.src) : (a.src || null);
      const anc = ancestryHints(stack);
      const hints = hintsOf(a, stack);
      if (src && (anc.inHeader || bodyChars < 3000) && (hints || anc.homeLink || anc.partnerish)) {
        imgs.push({ kind: 'img', src, srcset: a.srcset || '', alt: a.alt || '', width: num(a.width), height: num(a.height), hints, early: bodyChars < 3000,
          from: anc.inHeader ? 'the site’s header' : 'the top of the site’s page', ...anc });
      }
    }
    if (['body', 'header', 'nav', 'h1', 'a', 'button'].includes(t.name) && a.style) inlineStyled.push({ selector: t.name, css: t.name + '{' + a.style + '}' });
    if (!t.selfClosing) stack.push({ name: t.name, attrs: a });
  }
  return { sheetsCSS, linked, meta, imgs, words, inlineStyled, base };
}
function hintsOf(a, stack) {
  const own = [a.class, a.id, a.alt, a.src, a['aria-label']].filter(Boolean).join(' ');
  const parents = stack.slice(-3).map((e) => [e.attrs.class, e.attrs.id].filter(Boolean).join(' ')).join(' ');
  return /logo|brand|site-title|wordmark/i.test(own + ' ' + parents);
}
function ancestryHints(stack) {
  let inHeader = false, homeLink = false, partnerish = false;
  for (const e of stack) {
    const a = e.attrs || {}, cls = (a.class || '') + ' ' + (a.id || '');
    if (e.name === 'header' || e.name === 'nav' || (a.role || '').toLowerCase() === 'banner' || HEADERISH.test(cls.replace(/\s+/g, '-')) || /site-header|logo/i.test(cls)) inHeader = true;
    if (e.name === 'a') {
      const h = (a.href || '').trim();
      if (h === '/' || h === '' || /^https?:\/\/[^/]+\/?$/.test(h) || (a.rel || '').includes('home')) homeLink = true;
    }
    // the words a site uses around other people's marks: partners, sponsors,
    // who presents or supports it, a wall of logos
    if (/partner|sponsor|client|supporter|funder|collaborat|presented|presents|organised|organized|hosted|supported|press|media-logos|logos-grid|logo-wall|logo-cloud|trusted/i.test(cls)) partnerish = true;
  }
  return { inHeader, homeLink, partnerish };
}

/* Colours from the page's CSS (all of it, in order) → look-map.js's `found`. */
export function coloursFrom(cssTexts, meta, inlineStyled) {
  const rules = [], fontFaces = [];
  for (const c of cssTexts) { const p = parseCSS(c); rules.push(...p.rules); fontFaces.push(...p.fontFaces); }
  for (const s of inlineStyled || []) rules.push(...parseCSS(s.css).rules);
  const light = rules.filter((r) => !r.dark);

  // custom properties: those on :root/html/body are the site's own names;
  // every other one is kept only to resolve var() through
  const rootVars = {}, anyVars = {}, referenced = new Set();
  for (const r of light) {
    const isRoot = r.selector.split(',').some((s) => /^\s*(:root|html|body)\s*$/.test(s));
    const echo = PRESET_ECHO.test(r.selector);
    for (const d of r.decls) {
      if (d.prop.startsWith('--')) { anyVars[d.prop] = d.value; if (isRoot) rootVars[d.prop] = d.value; }
      if (echo) continue;
      const uses = d.value.match(/var\(\s*(--[a-z0-9_-]+)/gi) || [];
      for (const u of uses) referenced.add(u.replace(/var\(\s*/i, '').toLowerCase());
    }
  }
  const vars = Object.assign({}, anyVars, rootVars);

  const cands = new Map();
  const add = (hex, w, role, use, other, bg) => {
    if (!hex) return;
    let c = cands.get(hex);
    if (!c) { c = { hex, weight: 0, other: 0, bg: 0, roles: new Set(), uses: {} }; cands.set(hex, c); }
    if (other) { if (c.other < 30) { c.other++; c.weight += w; } } else c.weight += w;
    if (bg) c.bg += w;   // painted as a background: what the pale shading is chosen from
    if (role) c.roles.add(role);
    if (use) c.uses[use] = (c.uses[use] || 0) + 1;
  };

  if (meta && meta.themeColor) add(parseColour(meta.themeColor, vars), 6, 'brand', 'the site’s own colour');
  for (const name of Object.keys(rootVars)) {
    const hex = parseColour(rootVars[name], vars);
    if (!hex) continue;
    const preset = PRESET.test(name);
    const w = preset ? (referenced.has(name) ? 3 : 0) : 4;
    const roles = rolesFromName(name);
    add(hex, w, roles[0] || null, null);
    for (const r of roles.slice(1)) add(hex, 0, r, null);
  }

  let page = null, text = null, corners = null, headerBg = null;
  const bodyish = (sel) => sel.split(',').some((s) => /^\s*(body|html)\s*$/.test(lastCompound(s)) && !STATE.test(s));
  // a button, by tag or by a class that says so (.btn, .button, .sqs-block-button-element, .wp-element-button…)
  const buttonish = (sel) => sel.split(',').some((s) => {
    const c = lastCompound(s);
    if (STATE.test(s)) return false;
    const tag = (c.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
    const classes = (c.match(/\.[a-zA-Z0-9_-]+/g) || []).map((x) => x.slice(1));
    return tag === 'button' || /\[type=.?submit/.test(c) || classes.some((k) => BUTTONISH.test(k) || k === 'wp-element-button' || k === 'wp-block-button__link');
  });
  let coloured = { body: false, a: false, button: false };
  for (const r of light) {
    // WordPress writes a `.has-<name>-color` rule for every preset whether
    // the site uses it or not; counting those would make every stock colour
    // look used. They are the preset list again, not the site.
    if (PRESET_ECHO.test(r.selector)) continue;
    const k = classify(r.selector);
    const isBody = bodyish(r.selector);
    for (const d of r.decls) {
      if (d.prop.startsWith('--')) continue;
      const isBg = d.prop === 'background' || d.prop === 'background-color';
      const isFg = d.prop === 'color';
      const isLine = d.prop === 'border-color' || d.prop === 'fill' || /^border(-(top|bottom|left|right))?$/.test(d.prop) || d.prop === 'outline';
      if (!isBg && !isFg && !isLine) {
        if (buttonish(r.selector) && d.prop === 'border-radius') {
          // a radius given as var(--radius-md) is read through the site's own names
          let v = d.value.trim();
          const m = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(v);
          if (m) v = (vars[m[1].toLowerCase()] != null ? vars[m[1].toLowerCase()] : (m[2] || '')).trim();
          corners = /^0(px|rem|em)?$|^[0-2]px$/.test(v) ? 'square' : 'soft';
        }
        continue;
      }
      const hex = isBg || isLine ? colourIn(d.value, vars) : parseColour(d.value, vars);
      if (!hex) continue;
      if (isBody) {
        if (isBg) { page = hex; coloured.body = true; add(hex, 8, 'page', 'the page', false, true); }
        else if (isFg) { text = hex; coloured.body = true; add(hex, 8, 'text', 'words'); }
        continue;
      }
      if (k.kind === 'accent') {
        if (isFg) { coloured.a = true; add(hex, k.weight, 'link', 'links'); }
        else if (isBg) { coloured.button = true; add(hex, k.weight, 'button', 'buttons', false, true); }
        else add(hex, k.weight, 'accent', 'buttons');
      } else if (k.kind === 'header') {
        if (isBg) { headerBg = hex; add(hex, k.weight, 'brand', 'the header', false, true); }
        else add(hex, k.weight, isFg ? 'brandText' : null, 'the header');
      } else if (k.kind === 'heading') {
        add(hex, k.weight, isFg ? 'heading' : null, 'headings', false, isBg);
      } else {
        add(hex, 1, null, isBg ? 'shading' : isFg ? 'words here and there' : 'lines and shapes', true, isBg);
      }
    }
  }

  // merge near-duplicates (keep the heavier one's hex), then the top 12
  // the heaviest 300 are plenty for a top twelve; merging is pairwise, and a
  // stylesheet can hold a hundred thousand distinct colours
  let list = [...cands.values()].sort((a, b) => b.weight - a.weight).slice(0, 300);
  const merged = [];
  for (const c of list) {
    const near = merged.find((m) => LM.deltaE(m.hex, c.hex) < 6);
    if (near) { near.weight += c.weight; near.bg += c.bg; c.roles.forEach((r) => near.roles.add(r)); Object.keys(c.uses).forEach((u) => { near.uses[u] = (near.uses[u] || 0) + c.uses[u]; }); }
    else merged.push(c);
  }
  const colours = merged.filter((c) => c.weight > 0 && !LM.isNeutral(c.hex)).slice(0, 12).map((c) => ({
    hex: c.hex, weight: Math.round(c.weight), bg: Math.round(c.bg), roles: [...c.roles], usedFor: usedForOf(c),
  }));
  return { colours, page, text, corners, headerBg, words: null, coloured, fontFaces };
}
function usedForOf(c) {
  const uses = Object.keys(c.uses).sort((a, b) => c.uses[b] - c.uses[a]);
  const named = [];
  if (c.roles.has('link') && c.roles.has('button')) named.push('links, buttons');
  else if (c.roles.has('link')) named.push('links');
  else if (c.roles.has('button')) named.push('buttons');
  if (c.roles.has('page')) named.push('the page');
  if (c.roles.has('text')) named.push('words');
  if (c.roles.has('heading')) named.push('headings');
  if (c.roles.has('brand') && !named.length) named.push(uses.includes('the site’s own colour') ? 'the site’s own colour' : 'the header');
  if (!named.length && uses.length) named.push(uses[0]);
  const two = named.slice(0, 2);
  return two.length === 2 ? two[0] + ' and ' + two[1] : (two[0] || 'here and there');
}

/* ---------- fonts (§3.3, §14.1) ----------
   The site's body face: the font-family on body/html, else the family the
   most rules name. Generic names and the computer's own faces are skipped. A
   family is used only if it is in LOKA's committed list of Google Fonts
   (google-fonts.json, deploy/refresh-google-fonts.mjs), and then always
   loaded from fonts.googleapis.com with an address built here — never from
   the site. A headline face is allowed with a warning (Mithun, 4 Nov 2026). */
const GOOGLE_FONTS = requireScript(path.join(__dirname, 'google-fonts.json')).families;
const FONT_BY_LOWER = new Map(Object.keys(GOOGLE_FONTS).map((n) => [n.toLowerCase(), n]));
const GENERIC_FACE = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-(sans-serif|serif|monospace|rounded)|emoji|math|fangsong|inherit|initial|unset|revert|none)$/i;
const SYSTEM_FACE = /^(-apple-system|blinkmacsystemfont|segoe ui|segoe ui emoji|segoe ui symbol|arial|helvetica|helvetica neue|verdana|tahoma|georgia|times|times new roman|courier|courier new|trebuchet ms|gill sans|optima|avenir|avenir next|san francisco|sf pro( text| display)?|apple color emoji|noto color emoji|cantarell|ubuntu|oxygen|oxygen-sans|fira sans|droid sans|liberation sans|dejavu sans|calibri|cambria|lucida grande|lucida sans|lucida sans unicode|palatino|book antiqua|garamond|baskerville|impact|menlo|monaco|consolas)$/i;
export const FONT_WORDS = {
  ok: (n) => 'The site writes its words in ' + n + '. Your atlas can too.',
  headline: (n) => 'The site writes its words in ' + n + ', a font made for big headlines. It may be hard to read in long text, but you can still use it.',
  'no-bold': (n) => 'The site writes its words in ' + n + '. It has no bold, so words meant to stand out will look like the rest. You can still use it.',
  'not-free': (n) => 'The site writes its words in ' + n + '. It isn’t a free font, so we can’t use it here. Your words stay in LOKA’s Karla.',
  system: () => 'The site uses whatever font each computer has, so there is nothing to take. Your words stay in LOKA’s Karla.',
  none: () => 'We couldn’t tell which font the site writes in. Your words stay in LOKA’s Karla.',
};
// one family name as CSS writes it → as Google lists it, or null
function familyName(s) {
  const n = String(s || '').slice(0, 200).trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return n || null;
}
// a font-family value → the family names in order (quotes minded, var() resolved one level)
function familyStack(value, vars) {
  let v = String(value || '').trim();
  const m = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/i.exec(v);
  if (m) v = vars[m[1].toLowerCase()] != null ? vars[m[1].toLowerCase()] : (m[2] || '');
  const out = []; let cur = '', q = null;
  for (const ch of v) {
    if (q) { if (ch === q) q = null; cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(familyName).filter(Boolean);
}
// the `font` shorthand: what follows the size (and line height) is the family stack
function familyOfShorthand(value) {
  const m = /\d[\d.]*(?:px|r?em|%|pt|vw|vh)(?:\s*\/\s*[\d.]+(?:px|r?em|%|)?)?\s+([\s\S]+)$/i.exec(String(value));
  return m ? m[1] : null;
}
/* The family a stack names as its own: the first that is neither generic nor
   one of the computer's faces. A family after a computer's face (…, "Segoe
   UI", Roboto, sans-serif) is part of that stack, not the site's choice,
   unless the site serves it. Returns { name } or { system: true } or null. */
function ownFamily(stack, served) {
  let sawSystem = false, any = false;
  for (const n of stack) {
    any = true;
    if (GENERIC_FACE.test(n)) continue;
    const isServed = served.has(n.toLowerCase());
    if (SYSTEM_FACE.test(n) && !isServed) { sawSystem = true; continue; }
    if (sawSystem && !isServed) continue;
    return { name: n };
  }
  return any ? { system: true } : null;   // generics alone are the computer's own faces too
}
/* What Google's list says of a family: { name, kind, weights } or null. */
export function googleFamily(name) {
  const key = FONT_BY_LOWER.get(String(name || '').toLowerCase());
  if (!key) return null;
  const row = GOOGLE_FONTS[key];
  return { name: key, kind: row[0], weights: row.slice(1) };
}
/* The theme's fonts block for a family, or null when it cannot be loaded:
   400 and 600, or 700 when there is no 600; a family with no bold at all is
   allowed, and the owner is told its bold words will look like the rest. The address is built here so it always matches
   theme.js's FONT_CSS. */
export function fontFor(name) {
  const g = googleFamily(name);
  if (!g) return null;
  const bold = g.weights.includes(600) ? 600 : g.weights.includes(700) ? 700 : null;
  const weights = bold ? [400, bold] : [400];
  const headline = g.kind === 'display' || g.kind === 'handwriting';
  const cssUrl = 'https://fonts.googleapis.com/css2?family=' + g.name.replace(/ /g, '+') + ':wght@' + weights.join(';') + '&display=swap';
  return { theme: { text: g.name, cssUrl }, status: headline ? 'headline' : !bold ? 'no-bold' : 'ok', weights };
}
/* The site's body face from its CSS → { name, status, words, theme } where
   status is ok | headline | no-bold | not-free | system | none and theme is
   the block to save (ok, headline and no-bold). `linked` are the stylesheet addresses the
   page named, read for Google Fonts families the site asks for itself. */
export function fontsFrom(cssTexts, linked, inlineStyled) {
  const rules = [], fontFaces = [], imports = [];
  for (const c of cssTexts) { const p = parseCSS(c); rules.push(...p.rules); fontFaces.push(...p.fontFaces); imports.push(...p.imports); }
  for (const s of inlineStyled || []) rules.push(...parseCSS(s.css).rules);
  const light = rules.filter((r) => !r.dark);
  const vars = {};
  for (const r of light) for (const d of r.decls) if (d.prop.startsWith('--')) vars[d.prop] = d.value;
  // families the site serves itself, or asks Google for: known to be its own choice
  const served = new Set();
  for (const ff of fontFaces) for (const d of ff) if (d.prop === 'font-family') familyStack(d.value, vars).forEach((n) => served.add(n.toLowerCase()));
  const googleLinks = (linked || []).concat(imports.map((i) => (i.match(/url\(\s*["']?([^"')]+)/i) || i.match(/["']([^"']+)["']/) || [])[1] || ''));
  for (const u of googleLinks) {
    if (!/^https?:\/\/fonts\.googleapis\.com\//i.test(u)) continue;
    for (const m of String(u).matchAll(/family=([^&:|]+)/g)) served.add(decodeURIComponent(m[1].replace(/\+/g, ' ')).toLowerCase());
  }
  const bodyish = (sel) => sel.split(',').some((s) => /^\s*(body|html|:root)\s*$/.test(lastCompound(s)) && !STATE.test(s));
  /* Weighted as the colours are (§3.1): a body rule counts eight, any other
     rule one, a heading rule nothing — a title face is not the body face.
     So a body rule alone wins, but not against a theme that names another
     family on everything the body holds (WordPress sets the body in its
     global styles and the theme then overrides every element). */
  let bodyWeight = null;
  const counts = new Map();
  for (const r of light) {
    const isBody = bodyish(r.selector);
    const w = isBody ? 8 : classify(r.selector).kind === 'heading' ? 0 : 1;
    for (const d of r.decls) {
      let fam = null;
      if (d.prop === 'font-family') fam = d.value;
      else if (d.prop === 'font') fam = familyOfShorthand(d.value);
      if (fam) {
        const stack = familyStack(fam, vars);
        if (!stack.length) continue;
        const own = ownFamily(stack, served);
        if (own) { const k = own.name ? own.name.toLowerCase() : '(system)'; const c = counts.get(k) || { n: 0, own }; c.n += w; counts.set(k, c); }
      }
      if (isBody && d.prop === 'font-weight') {
        let w = d.value.trim().toLowerCase();
        const m = /^var\(\s*(--[a-z0-9_-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(w);
        if (m) w = (vars[m[1].toLowerCase()] != null ? vars[m[1].toLowerCase()] : (m[2] || '')).trim().toLowerCase();
        bodyWeight = w === 'normal' ? 400 : w === 'bold' ? 700 : num(w);
      }
    }
  }
  const top = [...counts.values()].filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0];
  const own = top ? top.own : null;
  if (!own) return { name: null, status: 'none', words: FONT_WORDS.none(), theme: null };
  if (own.system) return { name: null, status: 'system', words: FONT_WORDS.system(), theme: null };
  const f = fontFor(own.name);
  if (!f) return { name: own.name, status: 'not-free', words: FONT_WORDS['not-free'](own.name), theme: null };
  const weight = bodyWeight >= 400 && bodyWeight <= 600 ? bodyWeight : 400;
  return { name: f.theme.text, status: f.status, words: FONT_WORDS[f.status](f.theme.text), theme: f.theme, weight, weights: f.weights };
}

/* ---------- image sizes from the first bytes ---------- */
export function imageSize(buf, type) {
  if (!buf || buf.length < 8) return null;
  if (type === 'image/svg+xml' || /^\s*<(\?xml|svg)/i.test(buf.subarray(0, 200).toString('utf8'))) {
    const head = buf.subarray(0, 4000).toString('utf8');
    const svg = /<svg[^>]*>/i.exec(head); if (!svg) return null;
    const w = /\swidth\s*=\s*["']?([\d.]+)/i.exec(svg[0]), h = /\sheight\s*=\s*["']?([\d.]+)/i.exec(svg[0]), vb = /viewBox\s*=\s*["']?\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg[0]);
    if (w && h) return { w: +w[1], h: +h[1], type: 'image/svg+xml' };
    if (vb) return { w: +vb[1], h: +vb[2], type: 'image/svg+xml' };
    return { w: 512, h: 512, type: 'image/svg+xml' };
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf.length >= 24) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'image/png' };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf.length >= 10) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), type: 'image/gif' };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'image/jpeg' };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: 'image/webp' };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, type: 'image/webp' }; }
    if (kind === 'VP8X') return { w: (buf.readUIntLE(24, 3)) + 1, h: (buf.readUIntLE(27, 3)) + 1, type: 'image/webp' };
  }
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf.length >= 8) return { w: buf[6] || 256, h: buf[7] || 256, type: 'image/x-icon' };
  return null;
}

/* An inline SVG, with what could run or reach out taken off before the
   browser draws it: scripts, on*= handlers, foreignObject, external hrefs. */
export function cleanSVG(svg) {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s((?:xlink:)?href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/<\?xml-stylesheet[\s\S]*?\?>/gi, '');
}

const PLATFORM_MARK = /wp-includes\/|\/wp-admin\/|squarespace|webflow|wixstatic\.com\/.*wix|shopify.*badge|powered-?by/i;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|svg\+xml|x-icon|vnd\.microsoft\.icon|gif)$/;

/* The logo candidates in order (§3.2), each with the words that say whether
   it looks like the organisation's own or a partner's (D4). */
function rankImages(ex) {
  const list = [];
  for (const im of ex.imgs) {
    let verdict, score;
    if (im.partnerish) { verdict = 'partner'; score = 1; }
    else if (im.inHeader && (im.hints || im.homeLink)) { verdict = 'own'; score = 10 + (im.hints ? 2 : 0) + (im.homeLink ? 1 : 0); }
    else if (im.hints) { verdict = 'likely'; score = 6; }
    else { verdict = 'unsure'; score = 3; }
    list.push({ ...im, verdict, score });
  }
  // icons after the page's own pictures, largest first; never with a tracker-sized hint
  const bySize = (i) => { const m = /(\d+)x(\d+)/.exec(i.sizes || ''); return m ? +m[1] : (i.apple ? 180 : 32); };
  const icons = ex.meta.icons.slice().sort((a, b) => bySize(b) - bySize(a)).slice(0, 2);
  for (const ic of icons) list.push({ kind: 'img', src: ic.url, from: 'the site’s icon', verdict: 'icon', score: 2, hints: true, inHeader: false });
  list.sort((a, b) => b.score - a.score);
  // one entry per address
  const seen = new Set();
  return list.filter((i) => { const k = i.kind === 'svg' ? i.svg.slice(0, 200) : i.src; if (seen.has(k)) return false; seen.add(k); return true; });
}
function largestInSrcset(srcset, base) {
  let best = null;
  for (const part of String(srcset).split(',')) {
    const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
    if (!m) continue;
    let u; try { u = new URL(m[1], base).toString(); } catch { continue; }
    if (!best || +m[2] > best.w) best = { url: u, w: +m[2] };
  }
  return best ? best.url : null;
}
export const VERDICT_WORDS = {
  own: 'Looks like the site’s own logo.',
  likely: 'Probably the site’s own logo.',
  unsure: 'Found near the top of the page — check it is yours.',
  partner: 'Looks like a partner’s or sponsor’s logo — not yours to use here.',
  icon: 'The site’s small icon.',
};

/* Read a site for real: the page, its stylesheets, the logo candidates.
   Returns a proposal (design §5) or { error: 'key' } where key names WORDS.
   deps: { fetch: fetchBounded-shaped, now } for the checks. */
export async function readSite(typed, deps) {
  const D = Object.assign({ fetch: fetchBounded, now: Date.now }, deps || {});
  const chk = checkAddress(typed);
  if (chk.error) return { error: 'unreachable', reason: chk.error };
  const deadline = D.now() + LIMITS.totalMs;
  const started = D.now();
  const pageOpts = { maxBytes: LIMITS.html, accept: /^text\/html$/, acceptHeader: 'text/html,application/xhtml+xml', deadline, hopMs: LIMITS.pageHopMs };
  let r = await D.fetch(chk.url, pageOpts);
  // a bare host typed without a scheme: https first, then http (D8)
  if ((r.error === 'connection' || r.error === 'timeout') && !/^[a-z][a-z0-9+.-]*:/i.test(String(typed).trim())) {
    r = await D.fetch(chk.url.replace(/^https:/, 'http:'), pageOpts);
  }
  if (r.error) return { error: r.error === 'timeout' ? 'slow' : 'unreachable', reason: r.error };
  if (r.dropped) return { error: 'nothing', reason: 'not-html:' + r.type };
  if (r.status === 401 || r.status === 403 || r.status === 429) return { error: 'refused', reason: 'status-' + r.status };
  if (r.status >= 400) return { error: 'unreachable', reason: 'status-' + r.status };
  const html = r.body.toString('utf8');
  if (looksLikeBotWall(html)) return { error: 'refused', reason: 'bot-wall' };

  const ex = extract({ html, url: r.url });
  const finalHost = new URL(r.url).hostname;

  // stylesheets and images, in parallel, each bounded
  const sheetUrls = ex.linked.slice(0, LIMITS.sheets);
  const sheetP = sheetUrls.map((u) => D.fetch(u, { maxBytes: LIMITS.css, accept: /^text\/css$/, acceptByPath: /\.css(\?|$)/i, acceptHeader: 'text/css,*/*;q=0.1', deadline }).catch(() => ({ error: 'connection' })));
  const ranked = rankImages(ex).slice(0, LIMITS.images);
  const imageP = ranked.map(async (im) => {
    if (im.kind === 'svg') return { ...im, dataUrl: 'data:image/svg+xml;base64,' + Buffer.from(cleanSVG(im.svg)).toString('base64'), size: imageSize(Buffer.from(im.svg), 'image/svg+xml') };
    if (/^data:image\//.test(im.src)) {
      if (im.src.length > LIMITS.svg * 1.4) return null;
      const m = /^data:(image\/[a-z+.-]+);base64,(.*)$/i.exec(im.src); if (!m) return null;
      const buf = Buffer.from(m[2], 'base64');
      return { ...im, dataUrl: m[1] === 'image/svg+xml' ? 'data:image/svg+xml;base64,' + Buffer.from(cleanSVG(buf.toString('utf8'))).toString('base64') : im.src, size: imageSize(buf, m[1]) };
    }
    if (PLATFORM_MARK.test(im.src)) return null;
    const tryUrls = [largestInSrcset(im.srcset, ex.base), im.src].filter(Boolean);
    for (const u of tryUrls) {
      const g = await D.fetch(u, { maxBytes: LIMITS.image, accept: IMAGE_TYPES, acceptHeader: 'image/*', deadline, sniff: (b) => !!imageSize(b) }).catch(() => ({ error: 'connection' }));
      if (g.error || g.dropped || g.cut || g.status !== 200) continue;
      const size = imageSize(g.body, g.type);
      if (!size) continue;
      const type = g.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : (g.type || size.type);
      if (!IMAGE_TYPES.test(type)) continue;
      const body = type === 'image/svg+xml' ? Buffer.from(cleanSVG(g.body.toString('utf8'))) : g.body;
      if (type === 'image/svg+xml' && body.length > LIMITS.svg) continue;
      return { ...im, dataUrl: 'data:' + type + ';base64,' + body.toString('base64'), size, url: u };
    }
    return null;
  });
  const sheets = await Promise.all(sheetP);
  const images = (await Promise.all(imageP)).filter(Boolean);

  // the CSS, in document order
  const cssTexts = [];
  let sheetsRead = 0;
  for (const s of ex.sheetsCSS) {
    if (s.where === 'inline') cssTexts.push(s.css);
    else {
      const k = sheetUrls.indexOf(s.url);
      const got = k >= 0 ? sheets[k] : null;
      if (got && !got.error && !got.dropped && got.status === 200) { cssTexts.push(got.body.toString('utf8')); sheetsRead++; }
    }
  }
  const found = coloursFrom(cssTexts, ex.meta, ex.inlineStyled);
  const font = fontsFrom(cssTexts, ex.linked, ex.inlineStyled);

  // the pictures that pass (§3.2): readable, big enough, not a sprite or a dot
  const passing = images.filter((im) => im.size && im.size.w >= 48 && im.size.h >= 48 && im.size.w / im.size.h <= 10 && im.size.h / im.size.w <= 10);
  const logos = passing.map((im) => ({
    dataUrl: im.dataUrl, from: im.from, width: im.size.w, height: im.size.h, verdict: im.verdict, words: VERDICT_WORDS[im.verdict] || '', alt: String(im.alt || '').slice(0, 120),
  }));
  const own = logos.find((l) => l.verdict === 'own' || l.verdict === 'likely') || null;

  const partial = ex.words < 40 && !found.coloured.body && !found.coloured.a && !found.coloured.button;
  const usable = found.colours.length > 0 || found.page || found.text || logos.length > 0;
  if (!usable && !partial) return { error: 'nothing', reason: 'nothing-found' };

  const mapped = LM.map({ colours: found.colours, page: found.page, text: found.text, corners: found.corners, logo: own ? { width: own.width, height: own.height } : null });
  const source = { url: r.url, host: finalHost, readAt: new Date(D.now()).toISOString() };
  mapped.theme.source = source;
  // the site's font goes with the look (P1: no switch); the sheet says which, or why not
  if (font.theme) mapped.theme.fonts = font.theme;
  // the site's own icon, when square and big enough for a tab (§14.2): offered, never taken silently (D7)
  const icon = logos.find((l) => l.verdict === 'icon' && l.width === l.height && l.width >= 64) || null;
  return {
    source,
    theme: mapped.theme,
    found: { colours: found.colours, page: found.page, text: found.text, corners: found.corners },
    from: mapped.from,
    logo: own,
    logos,
    font: { name: font.name, status: font.status, words: font.words },
    icon,
    lines: mapped.lines,
    leftOut: mapped.leftOut,
    partial,
    stats: { bytes: r.body.length, sheets: sheetsRead, images: images.length, ms: D.now() - started, words: ex.words },
  };
}

export function looksLikeBotWall(html) {
  const h = String(html);
  // the markers sit in the head of such a page; only the first 20 KB are read, so a huge page cannot make this slow
  if (/cf-browser-verification|_cf_chl_opt|challenge-platform|cf_chl_|Just a moment\.\.\.|Checking your browser|Attention Required! \| Cloudflare|captcha-delivery|px-captcha/i.test(h.slice(0, 20000))) return true;
  // a page that is nothing but a script and a few words; the length is tested first, since stripping scripts from a huge page with no closing tag is slow
  if (h.length >= 4000) return false;
  const text = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.split(' ').length < 12 && /<script/i.test(h) && /verify|challenge|robot|human/i.test(h);
}

/* ---------- how often (§2): per atlas per hour, per account per day,
   one read at a time per atlas ---------- */
const READS = { atlas: new Map(), account: new Map(), running: new Map() };
export function readAllowed(slug, account, now) {
  now = now || Date.now();
  if (READS.running.has(slug)) return { ok: false, error: 'busy' };
  const recent = (m, k, since) => (m.get(k) || []).filter((t) => t > since);
  const a = recent(READS.atlas, slug, now - 3600e3);
  if (a.length >= LIMITS.readsPerAtlasPerHour) return { ok: false, error: 'often' };
  const b = account ? recent(READS.account, account, now - 86400e3) : [];
  if (b.length >= LIMITS.readsPerAccountPerDay) return { ok: false, error: 'often' };
  READS.atlas.set(slug, a.concat([now]));
  if (account) READS.account.set(account, b.concat([now]));
  return { ok: true };
}
export function markRunning(slug, p) { READS.running.set(slug, p); return p.finally(() => READS.running.delete(slug)); }
export function runningRead(slug) { return READS.running.get(slug) || null; }
export function resetReads() { READS.atlas.clear(); READS.account.clear(); READS.running.clear(); }
