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
    ├── install.sh          # umbrella: Node deps, systemd, Apache modules
    ├── lokaApps.service    # systemd unit
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
sudo ./deploy/install.sh     # re-runs npm install and restarts the service
```

## Adding a new app

1. Create `api/apps/<name>.js` exporting a default `(req, res) => …` handler.
2. Create `<name>/index.html` and (optionally) bundle assets.
3. The widget bundle should `fetch("./api", …)` so the same file works
   in dev and prod.
4. Optionally add `<name>/install.sh` for per-app setup steps.
