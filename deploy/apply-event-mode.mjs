#!/usr/bin/env node
/* Turn an atlas into a festival guide (Event mode, atlas/event-mode.js).
 *
 *   node deploy/apply-event-mode.mjs <slug>            # dry run: says what it would do
 *   node deploy/apply-event-mode.mjs <slug> --apply    # writes, after a backup
 *
 * Reads deploy/events/<slug>.json (the festival's days, which question marks a
 * venue, any pin to put right) and then:
 *   - on every place: `venue` (true/false), and on a venue its programme read
 *     into `sessions` — or, where the text cannot be read with certainty, the
 *     whole text kept as `programme_text`, shown on the card as written;
 *   - around.geojson: places to eat and drink and everyday services within the
 *     radius of each venue, from OpenStreetMap (credited, ODbL); a category
 *     with `perVenue` keeps that many per venue, nearest first (Eat & Drink: 8);
 *   - the pin corrections the settings list;
 *   - `mode` in manifest.local.json, which is what switches the guide on.
 * Remove `mode` from manifest.local.json and the atlas is as it was; nothing
 * of the places' own data is taken away.
 *
 * Options: --server-is-stopped (skip the pm2 check), --keep-osm (keep the
 * current around.geojson), --osm-file=<saved Overpass answer>.
 *
 * --full-text=<the LOKA export, .csv>: an atlas keeps only the first 500
 * characters of any cell, so a long programme arrives cut off (on 22 Oct
 * 2026: Old Secretariat and Sunaparanta, 15 of their 26 sessions lost). Give the
 * spreadsheet the places were exported from and each programme is read whole
 * from it, matched by tag_id. Without it, a cut programme is shown on the
 * card as the text that is there, and the dry run says so.
 *
 * Like apply-theme.mjs it refuses to write while pm2 shows lokaApps online,
 * keeps a backup in api/data/atlas/backups/event-<slug>-<time>/, and never
 * touches deoria-bioregion:
 *
 *   pm2 stop lokaApps && node deploy/apply-event-mode.mjs <slug> --apply; pm2 start lokaApps
 *
 * To bring it up to date later (new places tagged, OpenStreetMap moved on):
 * deploy/refresh-event-atlas.mjs <slug>. */
import { main } from './event-mode-lib.mjs';

await main('apply-event-mode.mjs', false);
