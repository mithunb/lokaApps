import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LOKA_PORT) || 81;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

const appsDir = path.join(__dirname, 'apps');
const appFiles = fs.existsSync(appsDir)
  ? fs.readdirSync(appsDir).filter((f) => f.endsWith('.js'))
  : [];

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`lokaApps api listening on 0.0.0.0:${PORT}`);
});
