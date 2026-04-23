#!/usr/bin/env bash
# Wildlife widget installer — sets the GEMINI_API_KEY used by the wildlife
# API handler, then reloads the pm2-managed Node service.
#
# Usage (interactive):
#   sudo ./wildlife/install.sh
# Or non-interactive:
#   sudo GEMINI_API_KEY=xxx ./wildlife/install.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_DIR}/api/.env"
OWNER="${OWNER:-mithun}"
PORT="${LOKA_PORT:-8181}"

if [[ $EUID -ne 0 ]]; then
  echo "Must be run as root (sudo)." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Run ./deploy/install.sh first." >&2
  exit 1
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  read -r -s -p "Enter GEMINI_API_KEY: " GEMINI_API_KEY
  echo
fi
if [[ -z "${GEMINI_API_KEY}" ]]; then
  echo "GEMINI_API_KEY is empty." >&2
  exit 1
fi

echo "==> Updating ${ENV_FILE}"
if grep -q '^GEMINI_API_KEY=' "${ENV_FILE}"; then
  sed -i "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=${GEMINI_API_KEY}|" "${ENV_FILE}"
else
  echo "GEMINI_API_KEY=${GEMINI_API_KEY}" >> "${ENV_FILE}"
fi
chmod 600 "${ENV_FILE}"
chown "${OWNER}:${OWNER}" "${ENV_FILE}"

echo "==> Reloading lokaApps via pm2"
sudo -u "${OWNER}" pm2 reload lokaApps --update-env

sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null; then
  echo "OK — wildlife widget ready at https://loka.place/lokaApps/wildlife/"
else
  echo "WARN — service not healthy; check: sudo -u ${OWNER} pm2 logs lokaApps --lines 50" >&2
  exit 1
fi
