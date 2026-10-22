#!/usr/bin/env node
/* Bring a festival guide up to date — one command, for the morning before.
 *
 *   node deploy/refresh-event-atlas.mjs <slug>            # dry run: says what would change
 *   node deploy/refresh-event-atlas.mjs <slug> --apply    # writes, after a backup
 *
 * For an atlas already in Event mode (deploy/apply-event-mode.mjs). It:
 *   - reads the places as they are NOW, so places tagged since the last run
 *     are in: which are venues, and each venue's programme, are worked out
 *     again from their own text;
 *   - asks OpenStreetMap again for what is near each venue;
 *   - applies again every fix listed in deploy/events/<slug>.json (pins,
 *     names, addresses, photos, merges): a fresh upload brings the tags back
 *     as they were tagged.
 * The dry run lists every venue with its sessions and nearby counts; read it
 * before adding --apply.
 *
 * Options: --server-is-stopped, --keep-osm (OpenStreetMap unreachable: keep
 * the nearby places as they are and refresh only the programmes),
 * --osm-file=<saved Overpass answer>.
 *
 * --full-text=<the LOKA export, .csv>: an atlas keeps only the first 500
 * characters of any cell, so a long programme arrives cut off (on 22 Oct
 * 2026: Old Secretariat and Sunaparanta, 15 of their 26 sessions lost). Give the
 * spreadsheet the places were exported from and each programme is read whole
 * from it, matched by tag_id. Without it, a cut programme is shown on the
 * card as the text that is there, and the dry run says so.
 *
 *   pm2 stop lokaApps && node deploy/refresh-event-atlas.mjs <slug> --apply; pm2 start lokaApps
 *
 * The order on the morning, as one sitting — uploading the new export first
 * takes the venues and their programmes off the live guide until this runs:
 *   0. the evening before: a dry run with the newest export, to read it early
 *   1. upload the new export to the atlas (it replaces the places)
 *   2. pm2 stop lokaApps
 *   3. node deploy/refresh-event-atlas.mjs <slug> --apply --full-text=<that export>
 *   4. pm2 start lokaApps, and open the guide
 *
 * Backups go to api/data/atlas/backups/event-<slug>-<time>/. Never touches
 * deoria-bioregion. */
import { main } from './event-mode-lib.mjs';

await main('refresh-event-atlas.mjs', true);
