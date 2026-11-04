#!/usr/bin/env node
/* The list of Google Fonts families LOKA may load for an atlas's words.
 *
 *   node deploy/refresh-google-fonts.mjs          # rewrites api/lib/atlas/google-fonts.json
 *
 * A look read from a website (api/lib/atlas/look-read.js) takes the site's
 * body font only when it is a family in this list: every family here is a
 * free face (OFL, Apache or UFL) that Google serves, so the licence is
 * settled by construction and the font is loaded from fonts.googleapis.com,
 * never from the site (docs/design-style-from-website.md §3.3, D6).
 *
 * The list is committed and refreshed by hand with this script, never at run
 * time: a read must not depend on Google answering. The source is the same
 * file fonts.google.com reads for its own directory; it needs no key. What is
 * kept per family: its kind (sans, serif, display, handwriting, mono) and the
 * upright weights it comes in, so the reader can say whether a family is made
 * for headlines and which weights to ask for. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'api', 'lib', 'atlas', 'google-fonts.json');
const SOURCE = 'https://fonts.google.com/metadata/fonts';
const KIND = { 'Sans Serif': 'sans', Serif: 'serif', Display: 'display', Handwriting: 'handwriting', Monospace: 'mono' };

const r = await fetch(SOURCE, { headers: { 'User-Agent': 'LOKA-Atlas (+https://loka.place)' } });
if (!r.ok) { console.error('Google answered ' + r.status); process.exit(1); }
// the file starts with a guard line (")]}'") before the JSON
const text = (await r.text()).replace(/^\)\]\}'\n?/, '');
const meta = JSON.parse(text);
const families = {};
for (const f of meta.familyMetadataList || []) {
  if (!f.family || !KIND[f.category]) continue;
  const weights = Object.keys(f.fonts || {}).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  if (!weights.length) continue;
  families[f.family] = [KIND[f.category], ...weights];
}
const names = Object.keys(families).sort();
const out = { source: SOURCE, refreshed: new Date().toISOString().slice(0, 10), families: Object.fromEntries(names.map((n) => [n, families[n]])) };
fs.writeFileSync(OUT, JSON.stringify(out).replace(/\],"/g, '],\n"') + '\n');
console.log(names.length + ' families written to ' + path.relative(ROOT, OUT));
