#!/usr/bin/env node
/* One-off: give one atlas its own look (colours, type, corners) and logo.
 *
 *   node deploy/apply-theme.mjs <slug> <theme.json>           # dry run: says what would change
 *   node deploy/apply-theme.mjs <slug> <theme.json> --apply   # writes, after a backup
 *
 * The theme file holds { "theme": {...}, "logo": "<https URL or local .png>" }
 * (deploy/themes/emergence-festival.json is the first). What a theme may say,
 * and what it can never change, is in atlas/theme.js; this script uses the
 * same rules, so what it prints is what the viewer will do.
 *
 * Where things go, and why there:
 *   - the theme -> manifest.local.json, top level. A rebuild of the base map
 *     carries that file across (api/lib/atlas/jobs.js, CONTRIBUTED) and every
 *     server writer of it keeps keys it does not know.
 *   - the logo  -> branding-logo.png in the atlas's folder, `branding.logo` in
 *     manifest.json, and `branding.hasLogo` in the registry: the same three
 *     places the owner's Settings sheet uses, so a later edit in Settings or a
 *     rebuild keeps it.
 *
 * The registry is held in memory by the running server, which writes the
 * whole of it back on any change. Stop the server first or the logo flag may
 * be written over:
 *
 *   pm2 stop lokaApps && node deploy/apply-theme.mjs <slug> <file> --apply; pm2 start lokaApps
 *
 * Backups go to api/data/atlas/backups/theme-<slug>-<time>/ (outside the web
 * root and outside the atlas's folder, so a rebuild cannot sweep them away).
 * Never touches deoria-bioregion. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LokaTheme = require(path.join(ROOT, 'atlas', 'theme.js'));

const DATA_DIR = process.env.LOKA_DATA_DIR || path.join(ROOT, 'api', 'data', 'atlas');
const ROOTS = [path.join(ROOT, 'atlas', 'datasets'), path.join(DATA_DIR, 'private-datasets')];
const REGISTRY = path.join(DATA_DIR, 'registry.json');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const NEVER = new Set(['deoria-bioregion']);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const [slug, themeFile] = args.filter((a) => !a.startsWith('--'));

function die(msg) { console.error('Stopped: ' + msg); process.exit(1); }
function writeJson(file, obj, indent = 1) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(obj, null, indent));
  fs.renameSync(file + '.tmp', file);
}

if (!slug || !themeFile) die('usage: node deploy/apply-theme.mjs <slug> <theme.json> [--apply]');
if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) die('not an atlas address: ' + slug);
if (NEVER.has(slug)) die(slug + ' is never touched by this script');

let spec;
try { spec = JSON.parse(fs.readFileSync(themeFile, 'utf8')); } catch (e) { die('cannot read ' + themeFile + ': ' + e.message); }
const theme = spec.theme;
const resolved = LokaTheme.resolve(theme);
if (!Object.keys(resolved.vars).length) die('the theme sets nothing the viewer can use');

const dir = ROOTS.map((r) => path.join(r, slug)).find((d) => fs.existsSync(path.join(d, 'manifest.json')));
if (!dir) die('no atlas called ' + slug + ' under ' + ROOTS.join(' or '));

async function readLogo(src) {
  if (!src) return null;
  let buf;
  if (/^https:\/\//.test(src)) {
    const r = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) die('logo: ' + src + ' answered ' + r.status);
    buf = Buffer.from(await r.arrayBuffer());
  } else {
    buf = fs.readFileSync(path.resolve(src));
  }
  // the server's own rule for an owner's logo (validLogo, api/apps/atlas.js)
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) die('logo: not a PNG');
  if (buf.length > 200 * 1024) die('logo: larger than 200 KB');
  return buf;
}

const logo = await readLogo(spec.logo);

console.log(APPLY ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write');
console.log('Atlas:  ' + slug + '  (' + dir + ')');
console.log('Theme:');
for (const [k, v] of Object.entries(resolved.vars)) console.log('  ' + k.padEnd(24) + v);
if (resolved.fontCss) console.log('  fonts from             ' + resolved.fontCss);
for (const n of resolved.notes) console.log('  NOTE  ' + n);
console.log('Logo:   ' + (logo ? spec.logo + ' (' + logo.length + ' bytes, PNG)' : 'none given; left as it is'));

if (!APPLY) process.exit(0);

/* The running server keeps the registry in memory and writes it back whole,
   so writing while it runs would lose hasLogo (and a Settings save in the same
   seconds could lose the theme). Refuse unless pm2 says lokaApps is stopped,
   or the operator says so in so many words. */
if (!args.includes('--server-is-stopped')) {
  let online = false;
  try {
    const { execSync } = await import('node:child_process');
    const list = JSON.parse(execSync('pm2 jlist', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    online = list.some((p) => p.name === 'lokaApps' && p.pm2_env && p.pm2_env.status === 'online');
  } catch (e) { /* no pm2 here (a local run): nothing to clash with */ }
  if (online) die('lokaApps is running: stop it first (pm2 stop lokaApps), or add --server-is-stopped');
}

// ---- backup ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(DATA_DIR, 'backups', 'theme-' + slug + '-' + stamp);
fs.mkdirSync(backup, { recursive: true });
for (const f of ['manifest.json', 'manifest.local.json', 'branding-logo.png']) {
  if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(backup, f));
}
if (fs.existsSync(REGISTRY)) fs.copyFileSync(REGISTRY, path.join(backup, 'registry.json'));
console.log('Backup: ' + backup);

// ---- the theme, onto the overlay ----
const localFile = path.join(dir, 'manifest.local.json');
let local = { layers: [] };
if (fs.existsSync(localFile)) local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
local.theme = theme;
writeJson(localFile, local);
console.log('Wrote theme to manifest.local.json');

// ---- the logo, the way Settings keeps one ----
if (logo) {
  fs.writeFileSync(path.join(dir, 'branding-logo.png'), logo);
  const mfFile = path.join(dir, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
  mf.branding = Object.assign({}, mf.branding || {}, { logo: 'branding-logo.png' });
  writeJson(mfFile, mf);
  if (fs.existsSync(REGISTRY)) {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
    const inst = reg.instances && reg.instances[slug];
    if (inst) {
      inst.branding = Object.assign({}, inst.branding || {}, { hasLogo: true });
      writeJson(REGISTRY, reg, 2);
      console.log('Logo saved; registry says hasLogo. Start the server again if you stopped it.');
    } else {
      console.log('Logo saved; NOTE no registry entry for ' + slug + ', so Settings will not show it');
    }
  } else {
    console.log('Logo saved; NOTE no registry at ' + REGISTRY + ', so Settings will not show it');
  }
}
console.log('Done. Undo: copy the files in the backup folder back into place.');
