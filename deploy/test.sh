#!/usr/bin/env bash
# End-to-end smoke test for lokaApps.
# Usage:
#   ./deploy/test.sh                      # on the server (hits localhost direct + Apache)
#   BASE=https://loka.place ./deploy/test.sh   # from anywhere (public URL only)
set -u

BASE="${BASE:-https://loka.place}"
PORT="${LOKA_PORT:-8181}"
LOCAL="http://127.0.0.1:${PORT}"
PASS=0
FAIL=0

ok()   { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; echo "        $2"; FAIL=$((FAIL+1)); }

check_http() {
  local name="$1" url="$2" expect="$3" method="${4:-GET}" body="${5:-}"
  local args=(-s -o /tmp/lokaApps-test.body -w '%{http_code}' -X "${method}")
  if [[ -n "${body}" ]]; then
    args+=(-H 'Content-Type: application/json' --data "${body}")
  fi
  local code
  code=$(curl "${args[@]}" "${url}" 2>/dev/null || echo 000)
  if [[ "${code}" == "${expect}" ]]; then
    ok "${name} [${code}]"
  else
    fail "${name} — expected ${expect}, got ${code}" "$(head -c 300 /tmp/lokaApps-test.body)"
  fi
}

check_contains() {
  local name="$1" url="$2" needle="$3"
  local body
  body=$(curl -fsS "${url}" 2>/dev/null || echo '')
  if echo "${body}" | grep -q "${needle}"; then
    ok "${name} contains '${needle}'"
  else
    fail "${name} missing '${needle}'" "$(echo "${body}" | head -c 300)"
  fi
}

echo "== Local (Node direct on ${LOCAL}) =="
if curl -fsS -o /dev/null --max-time 2 "${LOCAL}/healthz" 2>/dev/null; then
  check_http "healthz"          "${LOCAL}/healthz"                 "200"
  check_http "wildlife bad body" "${LOCAL}/api/wildlife"           "400" POST '{}'
  check_http "wildlife 404"     "${LOCAL}/api/does-not-exist"      "404" POST '{}'
else
  echo "  SKIP: local port ${PORT} not reachable (not on server, or pm2 down)"
fi

echo
echo "== Public via Apache (${BASE}) =="
check_http     "landing page"          "${BASE}/lokaApps/"                        "200"
check_contains "landing page"          "${BASE}/lokaApps/"                        "loka apps"
check_http     "wildlife preview"      "${BASE}/lokaApps/wildlife/"               "200"
check_contains "wildlife preview"      "${BASE}/lokaApps/wildlife/"               "habitat-widget-root"
check_http     "wildlife bundle"       "${BASE}/lokaApps/wildlife/habitat.js"     "200"
check_http     "api validation (empty)" "${BASE}/lokaApps/wildlife/api"           "400" POST '{}'
check_http     "api source denied"     "${BASE}/lokaApps/api/server.js"           "403"

echo
echo "== Optional: live wildlife call (uses your GEMINI_API_KEY quota) =="
if [[ "${RUN_LIVE:-0}" == "1" ]]; then
  check_http "wildlife live"   "${BASE}/lokaApps/wildlife/api"   "200" POST '{"location":"Bangalore"}'
  check_contains "wildlife live response has species" "$(cat /tmp/lokaApps-test.body)" "species" \
    2>/dev/null || true
else
  echo "  SKIP: set RUN_LIVE=1 to hit Gemini"
fi

echo
echo "== Summary =="
echo "  passed: ${PASS}"
echo "  failed: ${FAIL}"
rm -f /tmp/lokaApps-test.body
[[ "${FAIL}" -eq 0 ]]
