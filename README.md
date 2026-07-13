# lokaApps

Embeddable widgets served at `https://loka.place/lokaApps/`.

## Layout

```
lokaApps/
├── index.html              # landing page listing apps
├── wildlife/               # wildlife habitat widget (static assets + installer)
│   ├── index.html
│   ├── habitat.js          # prebuilt widget bundle (fetches `./api` relative)
│   └── install.sh
├── api/                    # Node backend — one handler per app
│   ├── server.js
│   ├── apps/wildlife.js
│   └── package.json
└── deploy/
    ├── install.sh          # umbrella: Node deps, pm2, Apache modules
    └── lokaApps.conf       # Apache proxy snippet
```

## URL routing

- Static assets (`index.html`, `habitat.js`, preview pages) are served by
  Apache directly from `/home/mithun/loka.place/lokaApps/`.
- `POST /lokaApps/<app>/api` is proxied by Apache to Node at `127.0.0.1:8181`
  and handled by `api/apps/<app>.js`.

## First-time deployment

On the server (as a user with sudo):

```bash
cd /home/mithun/loka.place
git clone git@github.com:<owner>/lokaApps.git
cd lokaApps
sudo ./deploy/install.sh
sudo ./wildlife/install.sh        # prompts for GEMINI_API_KEY
```

Then add this line inside the `loka.place` Apache vhost (ports 80 and 443):

```
Include /home/mithun/loka.place/lokaApps/deploy/lokaApps.conf
```

Reload Apache: `sudo apachectl configtest && sudo systemctl reload apache2`.

## Updating

```bash
cd /home/mithun/loka.place/lokaApps
git pull
sudo ./deploy/install.sh     # re-runs npm install and reloads pm2
```

## Operating (pm2)

```bash
sudo -u mithun pm2 list
sudo -u mithun pm2 logs lokaApps
sudo -u mithun pm2 reload lokaApps --update-env   # after editing api/.env
sudo -u mithun pm2 restart lokaApps
```

## LOKA Atlas — a generic, data-driven map app

LOKA Atlas is a self-serve map publishing platform — organisations pick a region, choose layers built from open data, add their own, and publish a shareable atlas in minutes.

`atlas/` is its code: a reusable map engine, not a one-off. `atlas.js` renders
whatever a **dataset manifest** describes; a dataset is a self-contained folder of a
`manifest.json` plus its data files. Nothing about a specific geography is hard-coded.
The first atlas covers Deoria–Kushinagar–Gorakhpur, built with the
Systems Practice at Socratus and Jagriti. Orgs interested in their own atlas start
at `atlas/create/`.

```
atlas/
├── index.html                 # host page + LOKA styling + credits footer
├── atlas.js                   # generic engine (MapLibre GL): manifest → layers, controls, legends, popups
├── loka-logo.png
└── datasets/
    └── deoria-bioregion/      # one dataset = one geography/topic
        ├── manifest.json      # declares basemaps, groups, layers, attributions
        ├── districts.geojson  blocks.geojson  villages.geojson  clusters.geojson
        ├── valuechain.geojson rivers.geojson  basin.geojson  wetlands.geojson
        ├── canals.geojson     floodplain.geojson  agro_zones.geojson
        └── lulc.png + lulc.json   # georeferenced image overlay + bounds/legend
```

- Open a dataset with `atlas/?dataset=<folder-name>` (defaults to `deoria-bioregion`).
- **Add a new geography:** drop in a new `datasets/<id>/` folder with its own
  `manifest.json` + data — no code changes.
- **Layer types** the engine understands (set per layer in the manifest): `fill`, `line`,
  `circle`, `marker` (DOM pins), `image` (georeferenced overlay), `raster` (XYZ tiles),
  and `categories` (a choropleth with a category selector, e.g. crop-by-block).
- Draw order = manifest layer array order (bottom→top); markers sit on top.
- Basemaps (Esri World Imagery, CARTO) and glyphs (CARTO) load from public,
  no-API-key, CORS-enabled endpoints. All data is baked in and self-hosted, so the app
  is fully static.
- The credits footer is manifest-driven: each dataset's `attributions` render
  automatically alongside the fixed LOKA / Systems Practice / MapLibre credits.

The `deoria-bioregion` dataset was built from an attribute spreadsheet + open boundary/
hydrology/land-cover data (LGD, India-WRIS, NRSC-NDEM, ESA WorldCover) via one-off Python
scripts; the app itself only ever reads the finished files in the dataset folder.

## Deploying

`./deploy/deploy.sh` from any machine with SSH access to the server: pulls
main as the repo owner, refreshes npm/pip deps, restarts pm2 and runs health
checks. First-time server setup is still `sudo ./deploy/install.sh`.

## Adding a new app

1. Create `api/apps/<name>.js` exporting a default `(req, res) => …` handler.
2. Create `<name>/index.html` and (optionally) bundle assets.
3. The widget bundle should `fetch("./api", …)` so the same file works
   in dev and prod.
4. Optionally add `<name>/install.sh` for per-app setup steps.
