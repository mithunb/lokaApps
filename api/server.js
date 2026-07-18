import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startModelResolver, getResolverStatus } from './lib/models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LOKA_PORT) || 8181;

startModelResolver();

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Atlas-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Dev-only prod parity: serve the repo statically under /apps and mimic Apache's
// ProxyPassMatch (/apps/<app>/api/* -> /api/<app>/*) so one origin serves everything,
// exactly like loka.place. Enable with LOKA_DEV_STATIC=1; never set in production.
// Must run before body parsing so the /api/atlas parser exemption sees the
// rewritten URL.
if (process.env.LOKA_DEV_STATIC) {
  const repoRoot = path.join(__dirname, '..');
  app.use((req, res, next) => {
    const a = req.url.match(/^\/apps\/atlas\/a\/([a-z0-9-]+)\/?$/);
    if (a) return res.redirect(302, `/apps/atlas/?dataset=${a[1]}`);
    const m = req.url.match(/^\/apps\/([^/]+)\/api(\/.*|$)/);
    if (m) req.url = `/api/${m[1]}${m[2] || ''}`;
    next();
  });
  app.use('/apps', express.static(repoRoot));
  console.log(`[dev] serving ${repoRoot} at /apps with API rewrite`);
}

// The atlas router does its own body parsing (larger limits for data uploads);
// everything else gets the small default.
const smallJson = express.json({ limit: '256kb' });
app.use((req, res, next) => (req.url.startsWith('/api/atlas') ? next() : smallJson(req, res, next)));

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
app.get('/status', (_req, res) => res.json({ ok: true, model: getResolverStatus() }));

const appsDir = path.join(__dirname, 'apps');
const appFiles = fs.existsSync(appsDir)
  ? fs.readdirSync(appsDir).filter((f) => f.endsWith('.js'))
  : [];

(async () => {
  for (const file of appFiles) {
    const name = path.basename(file, '.js');
    const mod = await import(pathToFileURL(path.join(appsDir, file)).href);
    if (mod.router) {
      // App exports an express Router — mount it with full sub-path support.
      app.use(`/api/${name}`, mod.router);
      console.log(`mounted router at /api/${name}`);
      continue;
    }
    if (typeof mod.default !== 'function') {
      console.warn(`apps/${file}: no default export — skipped`);
      continue;
    }
    app.get(`/api/${name}`, mod.default);
    app.post(`/api/${name}`, mod.default);
    console.log(`mounted GET+POST /api/${name}`);
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`lokaApps api listening on 127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('startup error', err);
  process.exit(1);
});
