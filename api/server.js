import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LOKA_PORT) || 8181;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

const appsDir = path.join(__dirname, 'apps');
const appFiles = fs.existsSync(appsDir)
  ? fs.readdirSync(appsDir).filter((f) => f.endsWith('.js'))
  : [];

(async () => {
  for (const file of appFiles) {
    const name = path.basename(file, '.js');
    const mod = await import(pathToFileURL(path.join(appsDir, file)).href);
    if (typeof mod.default !== 'function') {
      console.warn(`apps/${file}: no default export — skipped`);
      continue;
    }
    app.post(`/api/${name}`, mod.default);
    console.log(`mounted POST /api/${name}`);
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`lokaApps api listening on 127.0.0.1:${PORT}`);
  });
})().catch((err) => {
  console.error('startup error', err);
  process.exit(1);
});
