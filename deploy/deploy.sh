#!/usr/bin/env bash
# One-command deploy: pull main on the server, refresh deps, restart, verify.
#
#   ./deploy/deploy.sh
#
# Runs over SSH from any machine that can reach the host (default:
# root@rarebooksocietyofindia.org — the box that serves loka.place).
# Touches no secrets: pull + npm/pip refresh + pm2 restart + health checks.
# Override with DEPLOY_HOST / DEPLOY_REPO / DEPLOY_OWNER env vars.
set -euo pipefail

HOST="${DEPLOY_HOST:-root@rarebooksocietyofindia.org}"
REPO="${DEPLOY_REPO:-/home/mithun/loka.place/lokaApps}"
OWNER="${DEPLOY_OWNER:-mithun}"

ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "REPO='$REPO' OWNER='$OWNER' bash -s" <<'REMOTE'
set -euo pipefail
echo "== deploying on $(hostname) =="

before=$(sudo -u "$OWNER" git -C "$REPO" rev-parse --short HEAD)
sudo -u "$OWNER" git -C "$REPO" pull --ff-only --quiet
after=$(sudo -u "$OWNER" git -C "$REPO" rev-parse --short HEAD)
echo "== $before -> $after =="
if [ "$before" != "$after" ]; then
  sudo -u "$OWNER" git -C "$REPO" log --oneline "$before..$after" | sed 's/^/   /'
else
  echo "   (already up to date)"
fi

# node deps — fast no-op when the lockfile is unchanged
sudo -u "$OWNER" bash -lc "cd '$REPO/api' && npm install --omit=dev --no-audit --no-fund --silent"

# python builder deps, if the venv has been set up (deploy/install.sh creates it)
if [ -x "$REPO/api/atlas-builders/.venv/bin/pip" ]; then
  sudo -u "$OWNER" "$REPO/api/atlas-builders/.venv/bin/pip" install -q -r "$REPO/api/atlas-builders/requirements.txt" \
    || echo "WARN: builder pip install failed — wizard builds may be affected"
else
  echo "NOTE: builder venv missing — run deploy/install.sh once to enable wizard builds"
fi

sudo -u "$OWNER" bash -lc "pm2 restart lokaApps --update-env" >/dev/null
sleep 2

code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8181/healthz || true)
if [ "$code" = "200" ]; then
  echo "healthz: OK"
else
  echo "healthz FAILED ($code) — recent logs:"
  sudo -u "$OWNER" bash -lc "pm2 logs lokaApps --lines 20 --nostream" || true
  exit 1
fi

home=$(curl -sk -o /dev/null -w '%{http_code}' https://loka.place/apps/atlas/ || true)
api=$(curl -sk -o /dev/null -w '%{http_code}' https://loka.place/apps/atlas/api/instances || true)
echo "public checks: /apps/atlas/ -> $home, api/instances -> $api"
echo "== deployed $after =="
REMOTE
