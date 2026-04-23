#!/usr/bin/env bash
# Umbrella installer — run after `git pull` on the server.
# Idempotent: safe to re-run. Run as root or via sudo.
#
# Usage:
#   cd /home/mithun/loka.place/lokaApps
#   sudo ./deploy/install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="${REPO_DIR}/api"
OWNER="${OWNER:-mithun}"

if [[ $EUID -ne 0 ]]; then
  echo "Must be run as root (sudo)." >&2
  exit 1
fi

echo "==> Trusting repo as root for future git operations"
git config --global --add safe.directory "${REPO_DIR}" 2>/dev/null || true

echo "==> Checking Node.js (need >= 20)"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
fi
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  echo "   installing Node 20.x (found v${NODE_MAJOR}.x)"
  apt-get purge -y nodejs libnode-dev libnode72 nodejs-doc 2>/dev/null || true
  rm -f /etc/apt/sources.list.d/nodesource.list
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "   node $(node -v)"
INSTALLED_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [[ "${INSTALLED_MAJOR}" -lt 20 ]]; then
  echo "ERROR: node is still < 20 after install ($(node -v))." >&2
  exit 1
fi

echo "==> Ensuring ${REPO_DIR} is owned by ${OWNER}"
chown -R "${OWNER}:${OWNER}" "${REPO_DIR}"

echo "==> Installing Node dependencies"
sudo -u "${OWNER}" bash -lc "cd '${API_DIR}' && npm install --omit=dev"

echo "==> Ensuring .env exists (run wildlife/install.sh to populate keys)"
if [[ ! -f "${API_DIR}/.env" ]]; then
  sudo -u "${OWNER}" cp "${API_DIR}/.env.example" "${API_DIR}/.env"
  chmod 600 "${API_DIR}/.env"
fi

echo "==> Installing systemd unit"
cp "${REPO_DIR}/deploy/lokaApps.service" /etc/systemd/system/lokaApps.service
systemctl daemon-reload
systemctl enable lokaApps.service
systemctl restart lokaApps.service

echo "==> Enabling Apache proxy modules"
a2enmod proxy proxy_http >/dev/null

echo
echo "Add to your loka.place <VirtualHost> blocks (80 and 443):"
echo "    Include ${REPO_DIR}/deploy/lokaApps.conf"
echo "Then: apachectl configtest && systemctl reload apache2"
echo

sleep 1
if curl -fsS "http://127.0.0.1:81/healthz" >/dev/null; then
  echo "OK — Node API up on :81"
else
  echo "WARN — healthz failed; check: journalctl -u lokaApps -n 50"
  exit 1
fi

echo "Next: run ./wildlife/install.sh to configure the wildlife widget keys."
