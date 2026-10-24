#!/usr/bin/env node
/* Switch an atlas to Explore mode (atlas/explore-mode.js).
 *
 *   node deploy/apply-explore-mode.mjs <atlas address>            # dry run: the buttons and their counts
 *   node deploy/apply-explore-mode.mjs <atlas address> --apply    # writes, after a backup
 *
 * The settings are in deploy/explores/<atlas>.json; a copy of an atlas (a
 * local preview folder) finds them by the id its manifest.json still carries.
 * They are copied into manifest.local.json as `mode` — the file a rebuild
 * leaves alone — and nothing else is written. To switch it off, take `mode`
 * out of manifest.local.json (or put the backup back).
 *
 * The dry run says how many places each button holds, how many have no
 * button (they stay on the map and in the list), and the box the map opens
 * on. A mode in use (Event, say) is put aside under modeKept[its name], as
 * the Owner menu's switch does, never overwritten.
 *
 * Options: --server-is-stopped. Backups go to api/data/atlas/backups/
 * explore-<atlas>-<time>/. Never touches deoria-bioregion.
 *
 *   pm2 stop lokaApps && node deploy/apply-explore-mode.mjs <atlas> --apply; pm2 start lokaApps */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, checkSlug, checkServerStopped, backupFiles, writeJson, stop, keepAside } from './event-mode-lib.mjs';

const require = createRequire(import.meta.url);
const XM = require(path.join(ROOT, 'atlas', 'explore-mode.js'));
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;   // what the private data route serves

export function loadExplore(slug, dir) {
  const tries = [slug];
  try { const id = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).id; if (id && id !== slug) tries.push(id); } catch {}
  for (const name of tries) {
    if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(String(name))) continue;
    const file = path.join(ROOT, 'deploy', 'explores', name + '.json');
    if (fs.existsSync(file)) return { file, cfg: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  return null;
}

export async function run(opts) {
  const log = opts.log || console.log;
  const dir = checkSlug(opts.slug, 'apply-explore-mode.mjs');
  const found = loadExplore(opts.slug, dir);
  if (!found) stop('no explore settings for ' + opts.slug + ' (deploy/explores/' + opts.slug + '.json)');
  const mode = Object.assign({}, found.cfg.mode, { name: 'explore' });
  if (!XM.isOn({ mode }) || !(mode.buttons || []).length) stop('the settings have no buttons');
  const localFile = path.join(dir, 'manifest.local.json');
  if (!fs.existsSync(localFile)) stop('this atlas has no places of its own (no manifest.local.json)');
  const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
  // a file name only, as the private data route serves it: never a path out of the atlas's folder
  const layers = (local.layers || []).filter((L) => (L.group || 'userdata') === 'userdata' &&
    SAFE_NAME.test(String(L.source || '')) && !String(L.source).includes('..') && fs.existsSync(path.join(dir, L.source)));
  const col = mode.tagColumn || 'categories';
  const read = (L) => JSON.parse(fs.readFileSync(path.join(dir, L.source), 'utf8'));
  let layer = layers.find((L) => L.id === mode.layer);
  // after a fresh upload the layer can carry a new id: the first of the atlas's own whose places have the words
  if (!layer) layer = layers.find((L) => (read(L).features || []).some((f) => f.properties && f.properties[col] != null));
  if (!layer) stop('could not find a layer whose places have "' + col + '"');
  mode.layer = layer.id;
  const feats = read(layer).features || [];

  log(opts.apply ? 'APPLYING' : 'DRY RUN — nothing is written; add --apply to write');
  log('Atlas:   ' + opts.slug + '  (' + dir + ')');
  log('Settings: ' + path.relative(ROOT, found.file));
  log('Places:  layer "' + layer.id + '", ' + layer.source + ', ' + feats.length + ' places');
  const counts = XM.countButtons(feats, mode);
  log('Buttons:');
  for (const b of mode.buttons) log('  ' + String(counts[b.id]).padStart(4) + '  ' + b.label + '  (' + b.words.join(', ') + ')');
  log('  ' + String(counts.none).padStart(4) + '  with no button (on the map and in the list all the same)');
  const box = XM.frameBox(feats.map((f) => f.geometry && f.geometry.coordinates), mode.frameShare);
  if (box) log('Opens on: ' + Math.round((mode.frameShare || 0.8) * 100) + '% of the places, ' + JSON.stringify(box));
  const aside = local.mode != null && !(local.mode && local.mode.name === 'explore');
  log('Mode:    ' + (aside ? 'switched on; the ' + ((local.mode && local.mode.name) || 'unnamed') + ' mode in use is put aside in modeKept' : local.mode ? 'updated' : 'switched on') + ' in manifest.local.json');
  if (!opts.apply) return { counts, box, mode };

  await checkServerStopped(opts.serverIsStopped);
  const backup = backupFiles('explore', opts.slug, dir, ['manifest.local.json']);
  log('Backup:  ' + backup);
  const fresh = JSON.parse(fs.readFileSync(localFile, 'utf8'));   // the newest copy
  // only `mode` is replaced; a different mode in use goes into `modeKept`, which otherwise stays as it is
  fresh.modeKept = keepAside(fresh, 'explore');
  if (!fresh.modeKept) delete fresh.modeKept;
  fresh.mode = mode;
  writeJson(localFile, fresh, 1);
  log('Wrote:   manifest.local.json');
  log('Done. Undo: copy the file in the backup folder back into place.');
  return { counts, box, mode, backup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  try {
    await run({ slug: args.find((a) => !a.startsWith('--')), apply: args.includes('--apply'), serverIsStopped: args.includes('--server-is-stopped') });
  } catch (e) {
    console.error('Stopped: ' + (e && e.message));
    if (!(e && e.stop)) console.error(e && e.stack);
    process.exit(1);
  }
}
