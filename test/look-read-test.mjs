/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* Reading a website's colours and logo on the server (api/lib/atlas/look-read.js),
   docs/design-style-from-website.md §2–§3, §13. What these hold: the address
   rules (private, loopback, link-local and metadata addresses are refused on
   every hop; raw IPs, ports, localhost and our own hosts too); the caps (a
   page over 2 MB is cut and still read; a ninth stylesheet is not fetched;
   Content-Length is not believed); no script from a site ever runs; and the
   fixtures — the Emergence festival's real page (test/fixtures/look/emergence,
   saved 2 Nov 2026) must give the look that was made by hand for it in
   October (deploy/themes/emergence-festival.json) within a ΔE of 3 on every
   colour, plus hand-made pages for the other platforms and the failure
   cases. No network: every fetch here is a fake. */

const R = await import(ROOT + '/api/lib/atlas/look-read.js');
const LM = require(ROOT + '/atlas/look-map.js');
const T = require(ROOT + '/atlas/theme.js');
const emergence = JSON.parse(fs.readFileSync(ROOT + '/deploy/themes/emergence-festival.json', 'utf8'));

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ---- a fake site: { url: [body, type] } → a fetch like fetchBounded's ---- */
function siteFetch(files, log) {
  return async function (url, o) {
    if (log) log.push(url);
    const f = files[url];
    if (!f) return { status: 404, type: 'text/plain', body: Buffer.alloc(0), url };
    const body = Buffer.isBuffer(f[0]) ? f[0] : Buffer.from(f[0]);
    if (f[2]) return f[2];                      // a canned answer ({ error }, redirect…)
    const bare = f[1] === '' && ((o.acceptByPath && o.acceptByPath.test(new URL(url).pathname)) || (o.sniff && o.sniff(body)));
    if (!o.accept.test(f[1]) && !bare) return { dropped: true, type: f[1], status: 200, url };
    const cut = body.length > o.maxBytes;
    return { status: 200, type: f[1], body: cut ? body.subarray(0, o.maxBytes) : body, url, cut };
  };
}
// a PNG's first bytes: enough for imageSize to read width and height
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b, 0);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const clock = () => 1762060000000;

console.log('\n  address rules');
for (const [ip, why] of [['10.1.2.3', '10/8'], ['172.16.0.1', '172.16/12'], ['172.31.255.255', '172.16/12'], ['192.168.1.1', '192.168/16'], ['127.0.0.1', 'loopback'], ['169.254.169.254', 'link-local (cloud metadata)'],
  ['0.0.0.0', '0/8'], ['100.64.0.1', '100.64/10'], ['224.0.0.1', 'multicast'], ['255.255.255.255', 'broadcast'], ['::1', 'IPv6 loopback'], ['::', 'IPv6 unspecified'], ['fc00::1', 'fc00::/7'], ['fd12::1', 'fc00::/7'],
  ['fe80::1', 'fe80::/10'], ['::ffff:10.0.0.1', 'a mapped private IPv4'], ['::ffff:127.0.0.1', 'a mapped loopback'], ['::ffff:a9fe:a9fe', 'a mapped metadata address, written in hex'], ['ff02::1', 'IPv6 multicast'], ['not-an-address', 'not an address']]) {
  check('refused: ' + ip + ' (' + why + ')', R.isPrivateAddress(ip), true);
}
for (const [ip, why] of [['192.0.0.8', '192.0.0.0/24'], ['198.18.0.1', '198.18.0.0/15'], ['198.19.255.254', '198.18.0.0/15'], ['2002:c0a8:101::1', '6to4 (2002::/16) wrapping a private IPv4'], ['2001:0:4136:e378::1', 'Teredo (2001::/32)']]) check('refused: ' + ip + ' (' + why + ')', R.isPrivateAddress(ip), true);
for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '192.0.1.1', '198.17.0.1', '198.20.0.1', '2606:4700::1111', '2001:4860:4860::8888', '::ffff:93.184.216.34']) check('allowed: ' + ip, R.isPrivateAddress(ip), false);
check('a bare host is tried as https', R.checkAddress('emergencefestival.in').url, 'https://emergencefestival.in/');
check('http is allowed, read only (D8)', R.checkAddress('http://example.org/about').url, 'http://example.org/about');
check('the #fragment is dropped', R.checkAddress('https://example.org/#top').url, 'https://example.org/');
for (const [typed, why] of [['192.168.1.1', 'raw IP'], ['http://10.0.0.1/', 'raw IP with scheme'], ['[::1]', 'raw IPv6'], ['localhost', 'localhost'], ['dev.localhost', '*.localhost'], ['myhost', 'a name with no dot'],
  ['https://example.org:8080/', 'a port that is not the scheme’s'], ['http://example.org:443/', 'the wrong port for http'], ['ftp://example.org/', 'not http(s)'], ['file:///etc/passwd', 'file:'], ['javascript:alert(1)', 'javascript:'],
  ['https://user:pw@example.org/', 'credentials in the address'], ['loka.place', 'our own host'], ['https://staging.loka.place/x', 'our own host, any subdomain'], ['', 'empty'], ['x'.repeat(600), 'too long']]) {
  check('refused: ' + why, !!R.checkAddress(typed).error, true);
}
check('discoverloka.org is not refused: it is a site like any other, the second real one checked', R.checkAddress('discoverloka.org').url, 'https://discoverloka.org/');
for (const [typed, why] of []) {
  check('refused: ' + why, !!R.checkAddress(typed).error, true);
}
check('https on its own port is fine (and the port is the scheme’s, so it is dropped)', R.checkAddress('https://example.org:443/').url, 'https://example.org/');

console.log('\n  every hop is checked and pinned');
// a fake http: `answers` maps a URL to a response plan, `seen` records what was connected to
function fakeHttp(answers, seen) {
  const lookup = async (host) => (answers['dns:' + host] || [{ address: '93.184.216.34', family: 4 }]);
  const request = (u, opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {
      const plan = answers[u.toString()] || { status: 404, body: '' };
      seen.push({ url: u.toString(), pinned: null, timeout: opts.timeout });
      // node asks both ways: one address, or (with all: true) a list
      opts.lookup(u.hostname, {}, (_e, address) => { seen[seen.length - 1].pinned = address; });
      opts.lookup(u.hostname, { all: true }, (_e, list) => { if (!Array.isArray(list) || list[0].address !== seen[seen.length - 1].pinned) seen[seen.length - 1].pinned = 'MISMATCH'; });
      if (plan.hang) return;
      const res = new EventEmitter();
      res.statusCode = plan.status; res.headers = Object.assign({ 'content-type': plan.type || 'text/html' }, plan.headers || {});
      res.resume = () => {}; res.destroy = () => { res.destroyed = true; };
      cb(res);
      if (plan.dripMs) {
        // a byte every dripMs, for ever — the idle timeout never fires
        const tick = () => { if (res.destroyed) return; res.emit('data', Buffer.from('x')); setTimeout(tick, plan.dripMs); };
        setTimeout(tick, plan.dripMs);
        return;
      }
      setImmediate(() => {
        const chunks = plan.chunks || [Buffer.from(plan.body || '')];
        for (const ch of chunks) { if (res.destroyed) return; res.emit('data', Buffer.from(ch)); }
        if (!res.destroyed) res.emit('end');
      });
    };
    req.destroy = () => {};
    req.setTimeout = () => {};
    if (opts.timeout && answers[u.toString()] && answers[u.toString()].hang) setTimeout(() => req.emit('timeout'), 5);
    return req;
  };
  return { lookup, request };
}
{
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 301, headers: { location: 'https://b.example/page' } }, 'https://b.example/page': { status: 200, body: '<html></html>' },
    'dns:a.example': [{ address: '93.184.216.34', family: 4 }], 'dns:b.example': [{ address: '93.184.216.35', family: 4 }] }, seen);
  const r = await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/ });
  check('a redirect is followed, and each hop connects to the address that was checked', [r.status, r.url, seen.map((s) => s.pinned)], [200, 'https://b.example/page', ['93.184.216.34', '93.184.216.35']]);
}
{
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } } }, seen);
  const r = await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/ });
  check('a redirect to the cloud metadata address is refused before any connection', [r.error, seen.length], ['raw-ip', 1]);
}
{
  const seen = [];
  const h = fakeHttp({ 'dns:inner.example': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] }, seen);
  const r = await R.fetchBounded('https://inner.example/', { lookup: h.lookup, request: h.request, accept: /html/ });
  check('a name with one private answer among public ones is refused, and nothing is connected', [r.error, seen.length], ['private-address', 0]);
}
{
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 302, headers: { location: 'https://b.example/' } }, 'dns:b.example': [{ address: '::ffff:127.0.0.1', family: 6 }] }, seen);
  const r = await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/ });
  check('a redirect whose name resolves to a mapped loopback is refused on that hop', [r.error, seen.length], ['private-address', 1]);
}
{
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 302, headers: { location: 'file:///etc/hosts' } } }, seen);
  check('a redirect to file: is refused', (await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/ })).error, 'scheme');
}
{
  const seen = [];
  const plan = {}; for (let i = 0; i < 8; i++) plan['https://r' + i + '.example/'] = { status: 302, headers: { location: 'https://r' + (i + 1) + '.example/' } };
  const h = fakeHttp(plan, seen);
  const r = await R.fetchBounded('https://r0.example/', { lookup: h.lookup, request: h.request, accept: /html/ });
  check('a sixth redirect is one too many', [r.error, seen.length], ['too-many-redirects', R.LIMITS.redirects + 1]);
}
{
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 302, headers: { location: 'https://loka.place/' } } }, seen);
  check('a redirect to loka.place is refused', (await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/ })).error, 'own-host');
}
{
  const seen = [];
  const h = fakeHttp({ 'https://slow.example/': { hang: true } }, seen);
  check('a connection that does not answer times out', (await R.fetchBounded('https://slow.example/', { lookup: h.lookup, request: h.request, accept: /html/ })).error, 'timeout');
  check('a read past its overall deadline is not even started', (await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/, deadline: Date.now() - 1 })).error, 'timeout');
}
{
  const seen = [];
  const big = 'x'.repeat(600);
  const h = fakeHttp({ 'https://a.example/': { status: 200, headers: { 'content-length': '10' }, chunks: [big, big, big, big] } }, seen);
  const r = await R.fetchBounded('https://a.example/', { lookup: h.lookup, request: h.request, accept: /html/, maxBytes: 1000 });
  check('a body is read as a stream and cut at the cap, whatever Content-Length said', [r.cut, r.body.length], [true, 1000]);
  const h2 = fakeHttp({ 'https://a.example/x.bin': { status: 200, type: 'application/octet-stream', body: 'zzz' } }, seen);
  check('a body of the wrong kind is dropped, not an error', (await R.fetchBounded('https://a.example/x.bin', { lookup: h2.lookup, request: h2.request, accept: /^text\/css$/ })).dropped, true);
  const h3 = fakeHttp({ 'https://a.example/x.css': { status: 200, type: '', body: 'a{}' } }, seen);
  check('a .css path with no type is taken as a stylesheet', (await R.fetchBounded('https://a.example/x.css', { lookup: h3.lookup, request: h3.request, accept: /^text\/css$/, acceptByPath: /\.css$/ })).status, 200);
}
{
  // the page itself may take 6 s of the 8 (Mithun, 2 Nov 2026); every other connection 4 s
  const seen = [];
  const h = fakeHttp({ 'https://a.example/': { status: 200, body: '<html><body><style>body{background:#fff;color:#222} a{color:#1E5AA8}</style><link rel="stylesheet" href="/s.css"><p>' + 'word '.repeat(50) + '</p></body></html>' }, 'https://a.example/s.css': { status: 200, type: 'text/css', body: 'a{}' } }, seen);
  await R.readSite('https://a.example/', { fetch: (u, o) => R.fetchBounded(u, { ...o, lookup: h.lookup, request: h.request }), now: Date.now });
  check('the page is given 6 s, a stylesheet 4 s, both inside the 8 s whole', [R.LIMITS.pageHopMs, R.LIMITS.hopMs, R.LIMITS.totalMs, seen[0].timeout, seen[1].timeout], [6000, 4000, 8000, 6000, 4000]);
  const late = [];
  const h2 = fakeHttp({ 'https://a.example/': { status: 200, body: '' } }, late);
  await R.fetchBounded('https://a.example/', { lookup: h2.lookup, request: h2.request, accept: /html/, hopMs: 6000, deadline: Date.now() + 2500 });
  check('…and never more than what is left of the whole', late[0].timeout <= 2500, true);
}
{
  // a site that drips a byte every 40 ms holds the idle timeout open for ever; the hard clock ends it at the budget
  const seen = [];
  const h = fakeHttp({ 'https://drip.example/': { status: 200, dripMs: 40 } }, seen);
  const t0 = Date.now();
  const r = await R.fetchBounded('https://drip.example/', { lookup: h.lookup, request: h.request, accept: /html/, hopMs: 300 });
  check('a dripping body is cut off at the hop budget, not held open', [r.error, Date.now() - t0 < 1500], ['timeout', true]);
  const late = [];
  const h2 = fakeHttp({ 'https://drip2.example/': { status: 200, dripMs: 20 } }, late);
  const t1 = Date.now();
  const r2 = await R.fetchBounded('https://drip2.example/', { lookup: h2.lookup, request: h2.request, accept: /html/, hopMs: 5000, deadline: Date.now() + 150 });
  check('and past the whole read’s deadline a dripping body ends at once (cut with what came, or timed out), never held open', [r2.cut === true || r2.error === 'timeout', Date.now() - t1 < 1500], [true, true]);
  check('the hard clock is cleared when a request finishes (no timer left to fire on a finished read)', /const finish = \(v\) => \{ if \(!done\) \{ done = true; clearTimeout\(hard\); resolve\(v\); \} \};/.test(fs.readFileSync(ROOT + '/api/lib/atlas/look-read.js', 'utf8')), true);
}
{
  const src = fs.readFileSync(ROOT + '/api/lib/atlas/look-read.js', 'utf8');
  check('the request names us and asks in English, and sends no cookie', /'User-Agent': USER_AGENT, Accept: [^,]+, 'Accept-Language': 'en'/.test(src) && !/[Cc]ookie/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), true);
  check('…as LOKA-Atlas-look (+https://loka.place)', /const USER_AGENT = 'LOKA-Atlas-look \(\+https:\/\/loka\.place\)';/.test(src), true);
  check('no new dependency: node’s own http, https, dns and net only', (src.match(/^import .* from '([^']+)';$/gm) || []).every((l) => /from 'node:/.test(l)), true);
}

console.log('\n  the tokenisers');
{
  const t = R.tokeniseHTML('<!doctype html><html><head><title>T &amp; U</title><style>a{color:red}</style><script>var x = "<b>not a tag</b>";</script></head><body><!-- c --><p class="x" data-y=\'1\' hidden>Hi <b>there</b></p><img src=a.png alt="A &quot;b&quot;"><noscript><img src="tracker.gif"></noscript><svg viewBox="0 0 1 1"><rect/></svg></body></html>');
  check('a script’s body is skipped entirely, even one that holds tags', t.some((x) => x.type === 'text' && /not a tag/.test(x.text)) || t.some((x) => x.type === 'open' && x.name === 'b' && false), false);
  check('a noscript’s body is skipped too', t.some((x) => x.type === 'open' && x.name === 'img' && /tracker/.test(x.attrs.src)), false);
  check('a style’s body is kept as CSS text', t.find((x) => x.type === 'style').css, 'a{color:red}');
  check('the title, with its entities read', t.find((x) => x.type === 'title').text, 'T & U');
  check('attributes: quoted, single-quoted, bare and boolean', t.find((x) => x.type === 'open' && x.name === 'p').attrs, { class: 'x', 'data-y': '1', hidden: '' });
  check('an img is a void element with its attributes read', t.find((x) => x.name === 'img').attrs, { src: 'a.png', alt: 'A "b"' });
  check('an inline svg is kept whole as text, never walked', t.find((x) => x.type === 'svg').svg, '<svg viewBox="0 0 1 1"><rect/></svg>');
  check('comments are dropped', t.some((x) => x.type === 'text' && /c/.test(x.text) && x.text.trim() === 'c'), false);
}
{
  const p = R.parseCSS('/* c */ @import url(x.css); :root{--a:#123456;--b:var(--a)} a:hover, .btn{color:var(--a);background:url(data:image/png;base64,AAA;x) no-repeat #fff} @media (prefers-color-scheme: dark){body{background:#000}} @media (min-width:1px){body{background:#fff}} @font-face{font-family:X} @keyframes k{from{color:red}} .n{color:red;&:hover{color:blue}}');
  check('rules with their declarations; a url() holding ; is not split', p.rules.find((r) => r.selector === 'a:hover, .btn').decls.map((d) => d.prop + '=' + d.value), ['color=var(--a)', 'background=url(data:image/png;base64,AAA;x) no-repeat #fff']);
  check('a dark-scheme block is marked dark; another media block is not', [p.rules.find((r) => /#000/.test(r.decls[0].value)).dark, p.rules.find((r) => /#fff$/.test(r.decls[0].value) && r.selector === 'body').dark], [true, false]);
  check('@import collected, @font-face collected, @keyframes skipped', [p.imports.length, p.fontFaces.length, p.rules.some((r) => /from/.test(r.selector))], [1, 1, false]);
  check('a nested rule (modern CSS) does not leak its declarations into the parent', p.rules.find((r) => r.selector === '.n').decls, [{ prop: 'color', value: 'red' }]);
}
{
  const v = { '--a': '#6B1164', '--b': 'var(--a)', '--c': 'var(--d)', '--d': 'var(--c)' };
  check('colours: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), the space form, hsl(), a name, var() one level with a fallback', ['#abc', '#6B1164', '#6b116480', 'rgb(107, 17, 100)', 'rgba(107,17,100,.5)', 'rgb(107 17 100 / 50%)', 'hsl(305 73% 24%)', 'rebeccapurple', 'var(--a)', 'var(--b)', 'var(--zz, #fff)'].map((x) => R.parseColour(x, v)),
    ['#AABBCC', '#6B1164', '#6B1164', '#6B1164', '#6B1164', '#6B1164', '#6A1162', '#663399', '#6B1164', '#6B1164', '#FFFFFF']);
  check('not colours: currentColor, inherit, transparent, a gradient, color-mix, a var that loops, rubbish', ['currentColor', 'inherit', 'transparent', 'linear-gradient(red, blue)', 'color-mix(in srgb, red, blue)', 'var(--c)', 'red; x', '#12345'].map((x) => R.parseColour(x, v)), [null, null, null, null, null, null, null, null]);
}

console.log('\n  image sizes from the first bytes');
check('png', R.imageSize(png(800, 120), 'image/png'), { w: 800, h: 120, type: 'image/png' });
check('svg by width and height, else viewBox', [R.imageSize(Buffer.from('<svg width="200" height="50"></svg>'), 'image/svg+xml').w, R.imageSize(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 300 100"></svg>'), 'image/svg+xml').h], [200, 100]);
check('a gif', R.imageSize(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00, 0]), 'image/gif'), { w: 16, h: 32, type: 'image/gif' });
check('a jpeg (SOF0)', R.imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xc0, 0, 17, 8, 0, 100, 0, 200, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg'), { h: 100, w: 200, type: 'image/jpeg' });
check('rubbish is null', R.imageSize(Buffer.from('hello world!'), 'image/png'), null);
check('an SVG is cleaned: no script, no on*=, no foreignObject, no outside href; #refs stay', R.cleanSVG('<svg onload="x()"><script>1</script><foreignObject><div/></foreignObject><use href="#a"/><image xlink:href="https://evil/x.png"/></svg>'), '<svg><use href="#a"/><image/></svg>');

/* ---------------- fixtures ---------------- */
console.log('\n  the Emergence festival (WordPress) — the regression that proves the general rule reproduces the one-off');
{
  const DIR = ROOT + '/test/fixtures/look/emergence/';
  const F = (f, t) => [fs.readFileSync(DIR + f), t];
  const log = [];
  const files = {
    'https://emergencefestival.in/': F('index.html', 'text/html'),
    'https://emergencefestival.in/wp-content/themes/emergence-theme/assets/css/main.css?ver=0.17.24': F('main.css', 'text/css'),
    'https://emergencefestival.in/wp-includes/blocks/navigation/style.min.css?ver=7.1.4': F('navigation.css', 'text/css'),
    'https://emergencefestival.in/wp-content/themes/emergence-theme/assets/images/emergence-logo-purple.png': F('emergence-logo-purple.png', 'image/png'),
    'https://emergencefestival.in/wp-content/uploads/2026/10/emergence-site-icon-512-300x300.png': F('icon-300.png', 'image/png'),
    // the "presented by" mark and a partner's: served as any PNG, to see what the reader says of them
    'https://emergencefestival.in/wp-content/themes/emergence-theme/assets/images/TransitionResearchLogo.png': [png(768, 199), 'image/png'],
    'https://emergencefestival.in/wp-content/themes/emergence-theme/assets/images/partners/knowledge-culture/ai-knowledge-consortium.png': [png(110, 110), 'image/png'],
  };
  const p = await R.readSite('emergencefestival.in', { fetch: siteFetch(files, log), now: clock });
  check('read', !p.error, true);
  const want = emergence.theme.colors;
  const worst = Object.keys(want).map((k) => [k, p.theme.colors[k] ? LM.deltaE(want[k], p.theme.colors[k]) : 999]).sort((a, b) => b[1] - a[1])[0];
  check('every colour slot is within a ΔE of 3 of the hand-made theme (worst: ' + worst[0] + ' ' + worst[1].toFixed(2) + ')', worst[1] < 3, true);
  check('the purple accent, the red ring, the white page, exactly', [p.theme.colors.accent, p.theme.colors.highlight, p.theme.colors.page, p.theme.colors.text], ['#6B1164', '#FC3103', '#FFFDFD', '#060606']);
  check('the red darkened for words, as the guard did by hand in October', p.theme.colors.highlightDeep, '#CF2802');
  check('the festival green as the pale shading, like the hand-made #E8F7EC', LM.deltaE(p.theme.colors.surfaceAlt, '#E8F7EC') < 3, true);
  check('square corners, a wide logo', [p.theme.corners, p.theme.logoMaxWidth], ['square', 180]);
  check('the site’s font (phase 2): Poppins, named by the theme on everything the body holds, though WordPress’s global styles set the body itself in Lora', [p.font.name, p.font.status, p.theme.fonts], ['Poppins', 'ok', { text: 'Poppins', cssUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap' }]);
  check('…said in plain words', p.font.words, 'The site writes its words in Poppins. Your atlas can too.');
  check('titles take no face: the block names the words’ font only', p.theme.fonts.display, undefined);
  check('the site’s icon is offered for the tab (300 × 300, square, over 64 px), never taken silently (D7)', [p.icon.width, p.icon.height, p.icon.from], [300, 300, 'the site’s icon']);
  check('the header logo: 800 × 120, the site’s own', [p.logo.width, p.logo.height, p.logo.verdict, p.logo.from], [800, 120, 'own', 'the site’s header']);
  check('the “presented by” mark and a partner’s logo are shown and named as not the site’s own (D4)', p.logos.filter((l) => l.verdict === 'partner').length, 2);
  check('…with plain words', p.logos.find((l) => l.verdict === 'partner').words, 'Looks like a partner’s or sponsor’s logo — not yours to use here.');
  check('the site’s icon is offered too, as what it is, after the site’s own logo', p.logos.findIndex((l) => l.from === 'the site’s icon') > 0, true);
  check('WordPress’s stock colours (vivid-cyan-blue and friends) are not in the found list', p.found.colours.some((c) => ['#0693E3', '#9B51E0', '#FF6900', '#FCB900', '#7BDCB5'].includes(c.hex)), false);
  check('the site’s own names come through: the purple is for links and buttons', p.from.accent.usedFor.startsWith('links, buttons'), true);
  check('the source is recorded for the credit line (D3)', p.source, { url: 'https://emergencefestival.in/', host: 'emergencefestival.in', readAt: new Date(clock()).toISOString() });
  check('two stylesheets read, five pictures asked for at most six', [p.stats.sheets, log.filter((u) => /\.(png|jpe?g|webp|svg)$/.test(u)).length <= R.LIMITS.images], [2, true]);
  check('not a JavaScript-only page', p.partial, false);
  check('the read is said in plain words: one line about the red', p.lines, ['Darkened the site\'s red a little so warning words stay readable.']);
}

console.log('\n  discoverloka.org (a hand-built site with CSS tokens) — the second real site, for a different atlas');
{
  const DIR = ROOT + '/test/fixtures/look/discoverloka/';
  const F = (f, t) => [fs.readFileSync(DIR + f), t];
  const files = {
    'https://discoverloka.org/': F('index.html', 'text/html'),
    'https://discoverloka.org/assets/css/tokens.css': F('tokens.css', 'text/css'),
    'https://discoverloka.org/assets/css/base.css': F('base.css', 'text/css'),
    'https://discoverloka.org/assets/css/components.css': F('components.css', 'text/css'),
    'https://discoverloka.org/assets/css/layout.css': F('layout.css', 'text/css'),
    'https://discoverloka.org/loka_files/c3e192e7-f7ca-443e-9852-6ecf27ab1139': F('logo.png', ''),   // served with no type, from a bare address
    'https://discoverloka.org/images/favicon.jpg': F('favicon.jpg', 'image/jpeg'),
  };
  const log = [];
  const p = await R.readSite('discoverloka.org', { fetch: siteFetch(files, log), now: clock });
  check('read: LOKA’s moss green is the accent (links, buttons, headings), the cream page, the near-black words', [p.theme.colors.accent, p.theme.colors.page, p.theme.colors.text, p.from.text.name], ['#1A7048', '#F7F6F2', '#111B13', 'black']);
  check('the amber is one of the map’s own key hues, so the ring keeps LOKA’s; the amber becomes the pale shading instead', [p.theme.colors.highlight, p.from.surfaceAlt.hex], [undefined, '#C97A06']);
  check('soft corners: the buttons’ radius is a var(--radius-*) token, read through the site’s own names', p.theme.corners, 'soft');
  check('the nav logo, served from a bare address with no content type, is taken by its first bytes: 525 × 130, the site’s own', [p.logo.width, p.logo.height, p.logo.verdict], [525, 130, 'own']);
  check('the store badges in the nav are not logo candidates; the icon is the only other', p.logos.map((l) => l.from), ['the site’s header', 'the site’s icon']);
  check('a Google Fonts stylesheet is asked for like any other and simply yields no colours', log.some((u) => /fonts\.googleapis\.com/.test(u)) && p.stats.sheets === 4, true);
  check('the site’s font (phase 2): DM Sans from the body’s --font-body token; the address is built here, never copied from the site’s link', [p.font.name, p.theme.fonts.cssUrl], ['DM Sans', 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap']);
  check('the favicon is 399 × 400, not square: no icon is offered', p.icon, null);
  check('not a JavaScript-only page; nothing darkened', [p.partial, p.lines], [false, []]);
}

console.log('\n  other platforms, hand-made');
const html = (head, body) => '<!doctype html><html><head>' + head + '</head><body>' + body + '</body></html>';
const words = 'Welcome to our organisation. We work on rivers, soils and the people who tend them. '.repeat(3);
{
  // Squarespace-ish: colours as --siteBackgroundColor etc. in .sqs-* blocks, referenced from the stylesheet
  const files = {
    'https://sq.example/': [html('<link rel="stylesheet" href="/site.css"><link rel="icon" href="/favicon.png" sizes="64x64">', '<header class="Header"><a href="/"><img class="Header-branding-logo" src="/logo.png" alt="Sq"></a></header><p>' + words + '</p>'), 'text/html'],
    'https://sq.example/site.css': ['.sqs-block{--siteBackgroundColor:#FBF7F2;--accentColor:#1E5AA8;--siteTitleColor:#1A1A1A} :root{--accentColor:#1E5AA8;--siteBackgroundColor:#FBF7F2;--siteTitleColor:#1A1A1A} body{background:var(--siteBackgroundColor);color:var(--siteTitleColor)} a{color:var(--accentColor)} .sqs-block-button-element{background-color:var(--accentColor);border-radius:300px} .Header{background:#FBF7F2}', 'text/css'],
    'https://sq.example/logo.png': [png(600, 150), 'image/png'],
    'https://sq.example/favicon.png': [png(64, 64), 'image/png'],
  };
  const p = await R.readSite('sq.example', { fetch: siteFetch(files), now: clock });
  check('Squarespace: the accent from --accentColor via a, the page from the body, soft corners (pill buttons)', [p.theme.colors.accent, p.theme.colors.page, p.theme.corners], ['#1E5AA8', '#FBF7F2', 'soft']);
  check('…and the header logo wrapped in a link home', [p.logo.verdict, p.logo.width], ['own', 600]);
}
{
  // Webflow-ish: --brand on :root, a Tailwind-ish utility class, rgb() values, a dark section
  const files = {
    'https://wf.example/': [html('<meta name="theme-color" content="#E04A2F"><style>:root{--brand:#E04A2F;--ink:rgb(20 20 20);--paper:#FFFFFF} body{background:var(--paper);color:var(--ink)} .btn{background-color:var(--brand);color:#fff;border-radius:2px} a{color:var(--brand)} .section-dark{background:#111;color:#fff} h1{color:#1E5AA8} .bg-brand{background-color:rgb(30 90 168)}</style>', '<div class="navbar"><a href="/" class="brand"><img src="/wf-logo.svg" alt="WF"></a></div><section class="section-dark"><h1>Hello</h1></section><p>' + words + '</p>'), 'text/html'],
    'https://wf.example/wf-logo.svg': ['<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><script>alert(1)</script><rect width="240" height="60" fill="#E04A2F"/></svg>', 'image/svg+xml'],
  };
  const p = await R.readSite('https://wf.example/', { fetch: siteFetch(files), now: clock });
  check('Webflow/Tailwind: the brand red is the accent (theme-color, a, .btn all agree), darkened a little by the guard so white words read on a button; square-ish corners (2px)', [p.from.accent.hex, T.contrast('#FFFFFF', p.theme.colors.accent) >= 4.5, LM.deltaE(p.theme.colors.accent, '#E04A2F') < 12, p.theme.corners], ['#E04A2F', true, true, 'square']);
  check('…and the sheet is told', p.lines.some((l) => /Darkened the site's red a little so words stay readable/.test(l)), true);
  check('the blue heading colour is the ring, 40° or more from the accent', p.theme.colors.highlight, '#1E5AA8');
  check('the dark section is not the page: the page is the site’s white', p.theme.colors.page, '#FFFFFF');
  check('an SVG logo is taken, with its script stripped before the browser sees it', [p.logo.width, /script/.test(Buffer.from(p.logo.dataUrl.split(',')[1], 'base64').toString())], [240, false]);
}
{
  // a JavaScript-only shell: a theme-color and a favicon, no words, no colour on body/a/button
  const files = {
    'https://spa.example/': [html('<meta name="theme-color" content="#2B6CB0"><link rel="icon" href="/icon.png" sizes="192x192"><link rel="manifest" href="/m.json">', '<div id="root"></div><script src="/app.js"></script>'), 'text/html'],
    'https://spa.example/icon.png': [png(192, 192), 'image/png'],
  };
  const p = await R.readSite('spa.example', { fetch: siteFetch(files), now: clock });
  check('a JS-only site is read as far as it goes: partial, with the theme-color as the accent (darkened a little for white words)', [p.partial, p.from.accent.hex, T.contrast('#FFFFFF', p.theme.colors.accent) >= 4.5], [true, '#2B6CB0', true]);
  check('…and the icon offered as the one picture found', [p.logos.length, p.logos[0].from], [1, 'the site’s icon']);
  check('the owner reads the honest sentence (D5)', R.WORDS.partial, 'That site draws itself in the browser, so we could only read part of it.');
}
{
  // a dark site
  const files = { 'https://dark.example/': [html('<style>body{background:#0B0B0B;color:#F5F5F5} a{color:#F2C94C} .btn{background:#1E5AA8}</style>', '<p>' + words + '</p>'), 'text/html'] };
  const p = await R.readSite('dark.example', { fetch: siteFetch(files), now: clock });
  check('a dark site: the page stays light, tinted toward the accent; the light words are left out', [p.theme.colors.page !== '#0B0B0B' && p.theme.colors.page.length === 7, p.theme.colors.text, p.leftOut.length >= 2], [true, undefined, true]);
}
{
  // no logo, and nothing usable
  const files = {
    'https://nologo.example/': [html('<style>body{background:#fff;color:#222} a{color:#1E5AA8}</style>', '<p>' + words + '</p>'), 'text/html'],
    'https://blank.example/': [html('', '<p>' + words + '</p>'), 'text/html'],
    'https://pdf.example/': ['%PDF-1.4', 'application/pdf'],
  };
  const p = await R.readSite('nologo.example', { fetch: siteFetch(files), now: clock });
  check('a site with no logo: colours still come, logos are an empty list', [p.theme.colors.accent, p.logos, p.logo], ['#1E5AA8', [], null]);
  check('a page with no colours and no logo: the “nothing” sentence', (await R.readSite('blank.example', { fetch: siteFetch(files), now: clock })).error, 'nothing');
  check('a PDF is not a page', (await R.readSite('pdf.example', { fetch: siteFetch(files), now: clock })).error, 'nothing');
}
{
  // a bot wall, a 403, a 429, a 500, a redirect loop handled by the fetch
  const files = {
    'https://wall.example/': [html('<title>Just a moment...</title>', '<div id="cf-browser-verification"><script>x</script></div>'), 'text/html'],
    'https://forbidden.example/': ['', 'text/html', { status: 403, type: 'text/html', body: Buffer.alloc(0), url: 'https://forbidden.example/' }],
    'https://many.example/': ['', 'text/html', { status: 429, type: 'text/html', body: Buffer.alloc(0), url: 'https://many.example/' }],
    'https://broken.example/': ['', 'text/html', { status: 500, type: 'text/html', body: Buffer.alloc(0), url: 'https://broken.example/' }],
    'https://slow.example/': ['', 'text/html', { error: 'timeout' }],
    'https://loop.example/': ['', 'text/html', { error: 'too-many-redirects' }],
  };
  const f = siteFetch(files);
  check('a bot wall: “doesn’t let us read it”', (await R.readSite('wall.example', { fetch: f, now: clock })).error, 'refused');
  check('403 and 429 too', [(await R.readSite('forbidden.example', { fetch: f, now: clock })).error, (await R.readSite('many.example', { fetch: f, now: clock })).error], ['refused', 'refused']);
  check('a 500 is “couldn’t reach”', (await R.readSite('broken.example', { fetch: f, now: clock })).error, 'unreachable');
  check('a timeout is “took too long”', (await R.readSite('https://slow.example/', { fetch: f, now: clock })).error, 'slow');
  check('a redirect loop is “couldn’t reach”', (await R.readSite('https://loop.example/', { fetch: f, now: clock })).error, 'unreachable');
  check('each failure has its plain sentence', Object.keys(R.WORDS).sort(), ['busy', 'nothing', 'often', 'partial', 'refused', 'slow', 'unreachable']);
  check('…and none of them says fetch, scrape, render, theme or hex', Object.values(R.WORDS).some((w) => /fetch|scrape|render|theme|hex|palette|token/i.test(w)), false);
}
{
  // caps: a page over 2 MB is cut and still parsed; a ninth stylesheet is not fetched
  const links = Array.from({ length: 10 }, (_, i) => '<link rel="stylesheet" href="/s' + i + '.css">').join('');
  const pad = '<p>' + words + '</p>'.repeat(1) + '<!-- ' + 'y'.repeat(2.2 * 1024 * 1024) + ' -->';
  const files = { 'https://big.example/': [html('<style>body{background:#fff;color:#222} a{color:#1E5AA8}</style>' + links, '<p>' + words + '</p>' + pad), 'text/html'] };
  for (let i = 0; i < 10; i++) files['https://big.example/s' + i + '.css'] = ['.s' + i + '{color:#1E5AA8}', 'text/css'];
  const log = [];
  const p = await R.readSite('big.example', { fetch: siteFetch(files, log), now: clock });
  check('a page over 2 MB is cut at the cap and still read', [p.error, p.theme.colors.accent, p.stats.bytes], [undefined, '#1E5AA8', R.LIMITS.html]);
  check('at most eight stylesheets are fetched', log.filter((u) => /\.css$/.test(u)).length, 8);
}
{
  // no script ever runs: custom properties set by a script yield nothing; an inline style attribute on a div is not read
  const files = { 'https://js.example/': [html('<script>document.documentElement.style.setProperty("--brand", "#FF0000"); var css = ":root{--brand:#FF0000} a{color:#FF0000}";</script><style>:root{--x:1} body{background:#fff;color:#222} a{color:var(--brand, #1E5AA8)}</style>', '<div style="color:#00FF00;background:#00FF00">x</div><h1 style="color:#1E5AA8">Hi</h1><p>' + words + '</p>'), 'text/html'] };
  const p = await R.readSite('js.example', { fetch: siteFetch(files), now: clock });
  check('a colour a script would have set is not seen: the fallback in var() is', [p.theme.colors.accent, p.found.colours.some((c) => c.hex === '#FF0000')], ['#1E5AA8', false]);
  check('a style="" on a div is not read; on an h1 it is', [p.found.colours.some((c) => c.hex === '#00FF00'), p.found.colours.some((c) => c.hex === '#1E5AA8' && c.roles.includes('heading'))], [false, true]);
}

console.log('\n  the site’s font (phase 2, §3.3 and §14.1; Mithun’s answers of 4 Nov 2026)');
{
  const F = (css, linked) => R.fontsFrom([css], linked || [], []);
  check('the body’s family, from Google’s list: 400 and 600, from fonts.googleapis.com, &display=swap', F('body{font-family:"Open Sans",Arial,sans-serif}').theme, { text: 'Open Sans', cssUrl: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap' });
  check('700 when there is no 600 (Lora has 600; a face with 400 and 700 only takes 700)', R.fontFor('Lora').weights, [400, 600]);
  check('the family’s spelling is Google’s, whatever the site’s case', R.fontFor('dm sans').theme.text, 'DM Sans');
  check('the address always passes theme.js’s own rule for a font address', T.FONT_CSS.test(R.fontFor('DM Sans').theme.cssUrl), true);
  check('a font that is not free (Gotham): kept out, said in one sentence, words stay in Karla (D6)', F('body{font-family:Gotham,Arial,sans-serif}'), { name: 'Gotham', status: 'not-free', words: 'The site writes its words in Gotham. It isn’t a free font, so we can’t use it here. Your words stay in LOKA’s Karla.', theme: null });
  check('a plain text face with no bold (Abel) is not called a headline font: allowed, told its bold looks like the rest', [F('body{font-family:Abel,sans-serif}').status, F('body{font-family:Abel,sans-serif}').words], ['no-bold', 'The site writes its words in Abel. It has no bold, so words meant to stand out will look like the rest. You can still use it.']);
  check('a font name is capped, however long the site makes it', String(F('body{font-family:"' + 'Z'.repeat(5000) + '",sans-serif}').name || '').length <= 80, true);
  check('a headline face (Pacifico, handwriting): allowed, with a warning (Mithun, P2)', [F('body{font-family:Pacifico,cursive}').status, F('body{font-family:Pacifico,cursive}').theme.text, F('body{font-family:Pacifico,cursive}').words], ['headline', 'Pacifico', 'The site writes its words in Pacifico, a font made for big headlines. It may be hard to read in long text, but you can still use it.']);
  check('…and a family with no bold at all is read the same way', R.fontFor('Pacifico').weights, [400]);
  check('only the computer’s own fonts (Arial): nothing to take', F('body{font-family:Arial,Helvetica,sans-serif}'), { name: null, status: 'system', words: 'The site uses whatever font each computer has, so there is nothing to take. Your words stay in LOKA’s Karla.', theme: null });
  check('the system stack (-apple-system … Roboto): Roboto there is the phone’s, not a choice', F('body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}').status, 'system');
  check('…but Roboto the site asks Google for is its choice', F('body{font-family:-apple-system,Roboto,sans-serif}', ['https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap']).name, 'Roboto');
  check('a family named in a Google Fonts @import is the site’s own too', F('@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap"); body{font-family:Inter,Arial,sans-serif}').name, 'Inter');
  check('generic names are passed over', F('body{font-family:system-ui,sans-serif}').status, 'system');
  check('no font-family anywhere: say so', F('p{color:red}').status, 'none');
  check('the `font` shorthand is read past the size', F('body{font:400 16px/1.5 "DM Sans", sans-serif}').name, 'DM Sans');
  check('a var() is read through the site’s own names', F(':root{--f:"Karla",sans-serif} body{font-family:var(--f)}').name, 'Karla');
  check('no body rule: the family the most rules name; headings do not speak for the words', F('.a{font-family:Inter}.b{font-family:Inter}h1{font-family:Lora}h2{font-family:Lora}.c{font-family:Lora}').name, 'Inter');
  check('a body rule counts for eight: it beats a few scattered rules, not a theme that names another face on everything', [F('body{font-family:Karla}.a{font-family:Inter}.b{font-family:Inter}').name, F('body{font-family:Lora}' + '.x{font-family:Poppins}'.repeat(12)).name], ['Karla', 'Poppins']);
  check('the body’s weight is taken when it is 400–600, else 400', [F('body{font-family:Karla;font-weight:500}').weight, F('body{font-family:Karla;font-weight:300}').weight, F('body{font-family:Karla;font-weight:bold}').weight], [500, 400, 400]);
  check('a dark-mode rule does not speak', F('@media (prefers-color-scheme: dark){body{font-family:Inter}} body{font-family:Karla}').name, 'Karla');
  const list = JSON.parse(fs.readFileSync(ROOT + '/api/lib/atlas/google-fonts.json', 'utf8'));
  check('the committed list (deploy/refresh-google-fonts.mjs): over 1500 families, each a kind and its weights', [Object.keys(list.families).length > 1500, list.families.Poppins[0], list.families.Poppins.includes(600), typeof list.refreshed], [true, 'sans', true, 'string']);
  check('a name not in the list is nothing: no guessing at the closest face (D6)', R.fontFor('Gotham'), null);
}

console.log('\n  hostile sizes stay quick');
{
  // a hundred thousand distinct colours: merging is pairwise, so only the heaviest 300 are merged
  let css = ':root{--a:#1E5AA8} body{background:#fff;color:#222} a{color:#1E5AA8}';
  for (let i = 0; i < 100000; i++) css += '.c' + i + '{color:#' + ((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6) + '}';
  let t0 = Date.now();
  const found = R.coloursFrom([css], {}, []);
  check('100 000 distinct colours are read in under 3 s, the accent still first', [Date.now() - t0 < 3000, found.colours[0].hex], [true, '#1E5AA8']);
  const line = '<html><body>' + 'x'.repeat(2 * 1024 * 1024) + ' Access denied | something used Cloudflare</body></html>';
  t0 = Date.now();
  const wall = R.looksLikeBotWall(line);
  check('a 2 MB single-line page is judged in under 200 ms (the markers are looked for in the first 20 KB only)', [Date.now() - t0 < 200, wall], [true, false]);
  const unclosed = '<html><head>' + '<script>'.repeat(250000);
  t0 = Date.now();
  const wall2 = R.looksLikeBotWall(unclosed);
  check('2 MB of unclosed <script> tags is judged in under 200 ms (long pages are passed over before scripts are stripped)', [Date.now() - t0 < 200, wall2], [true, false]);
  check('a short challenge page is still recognised', R.looksLikeBotWall('<html><script>x()</script><p>Please verify you are human</p></html>'), true);
  t0 = Date.now();
  const never = await R.resolvePublic('slow.example', () => new Promise(() => {}), 150);
  check('a name server that never answers is given up on at the time left', [never.error, Date.now() - t0 < 1000], ['timeout', true]);
  const ok = await R.resolvePublic('ok.example', async () => [{ address: '93.184.216.34', family: 4 }], 150);
  check('a name that answers in time still resolves', ok.address, '93.184.216.34');
  const files = { 'https://alt.example/': [html('<style>body{background:#fff;color:#222} a{color:#1E5AA8}</style>', '<header><a href="/"><img src="/l.png" alt="' + 'A'.repeat(500) + '" class="logo"></a></header><p>' + words + '</p>'), 'text/html'], 'https://alt.example/l.png': [png(200, 60), 'image/png'] };
  const p = await R.readSite('alt.example', { fetch: siteFetch(files), now: clock });
  check('a logo’s alt text is capped at 120 characters', p.logo.alt.length, 120);
}

console.log('\n  how often');
R.resetReads();
{
  const now = 1000;
  let ok = 0;
  for (let i = 0; i < 14; i++) if (R.readAllowed('atlas-a', 'o@x.test', now + i).ok) ok++;
  check('twelve reads per atlas per hour', ok, 12);
  check('…the thirteenth says so', R.readAllowed('atlas-a', 'o@x.test', now + 20).error, 'often');
  check('an hour later it is fine again', R.readAllowed('atlas-a', 'o@x.test', now + 3600e3 + 1).ok, true);
  R.resetReads();
  for (let i = 0; i < 60; i++) R.readAllowed('atlas-' + i, 'busy@x.test', now + i);
  check('sixty per account per day', R.readAllowed('atlas-new', 'busy@x.test', now + 100).error, 'often');
  check('another account is not held back by it', R.readAllowed('atlas-new', 'other@x.test', now + 100).ok, true);
  R.resetReads();
  let release; const p = new Promise((r) => { release = r; });
  R.markRunning('atlas-b', p);
  check('one read at a time per atlas: a second press is told it is running', [R.readAllowed('atlas-b', null, now).error, !!R.runningRead('atlas-b')], ['busy', true]);
  release({}); await p; await new Promise((r) => setImmediate(r));
  check('…and may go once it is done', [R.runningRead('atlas-b'), R.readAllowed('atlas-b', null, now).ok], [null, true]);
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
