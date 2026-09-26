#!/usr/bin/env bash
# One-off: re-commit the multispecies atlas's respondents layer so its card
# labels become whole questions. Run from any machine that can reach the host:
#
#   ./deploy/recommit-multispecies-labels.sh
#
# Needs 75dc74f (a replace keeps the layer's credits) deployed first, or the
# rebuild would stop naming whose outlines these are. Backs up, reopens and
# commits the SAME layer id (nothing is re-joined; all placements stay), then
# checks the result and restores the backup if any check fails. The admin
# token is read on the server and never printed.
set -euo pipefail
HOST="${DEPLOY_HOST:-root@rarebooksocietyofindia.org}"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'bash -s' <<'REMOTE'
set -euo pipefail
REPO=/home/mithun/loka.place/lokaApps
SLUG=multispecies-landscape-assessment-2026
LAYER=where-the-respondents-work
D=$REPO/atlas/datasets/$SLUG
API=http://127.0.0.1:8181/api/atlas
BK=/root/msla-before-$(date +%Y%m%d-%H%M%S)
TOKEN=$(grep -E '^ATLAS_ADMIN_TOKEN=' "$REPO/api/.env" | head -1 | cut -d= -f2- | tr -d "\"'")
[ -n "$TOKEN" ] || { echo "no admin token on the server; stopping, nothing changed"; exit 1; }
GJ=$(node -e 'const m=require(process.argv[1]);const l=(m.layers||[]).find(x=>x.id===process.argv[2]);process.stdout.write(l&&l.source?String(l.source).split("/").pop():"")' "$D/manifest.local.json" "$LAYER")
[ -n "$GJ" ] || { echo "layer $LAYER not found in manifest.local.json; stopping, nothing changed"; exit 1; }
mkdir -p "$BK"; cp "$D/manifest.local.json" "$D/$GJ" "$BK/"
echo "backed up to $BK ($GJ)"
restore() { cp "$BK/manifest.local.json" "$D/"; cp "$BK/$GJ" "$D/"; chown mithun:mithun "$D/manifest.local.json" "$D/$GJ"; echo "RESTORED from $BK — atlas is as it was"; }

R=$(curl -s -X POST "$API/layers/reopen" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d "{\"dataset\":\"$SLUG\",\"layerId\":\"$LAYER\"}")
IMP=$(printf '%s' "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).importId||"")}catch(e){}})')
[ -n "$IMP" ] || { echo "reopen gave no importId; stopping, nothing changed:"; printf '%s\n' "$R" | head -c 400; exit 1; }
C=$(curl -s -X POST "$API/layers/commit" -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d "{\"importId\":\"$IMP\",\"dataset\":\"$SLUG\"}")
echo "commit: $(printf '%s' "$C" | head -c 200)"
rm -rf "$D--draft-"* 2>/dev/null || true

node - "$D" "$LAYER" "$BK/$GJ" <<'JS' || { restore; exit 1; }
const fs = require('fs'), path = require('path');
const [D, id, before] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(path.join(D, 'manifest.local.json'), 'utf8'));
const l = (m.layers || []).find(x => x.id === id);
const fail = (w) => { console.error('CHECK FAILED: ' + w); process.exit(1); };
if (!l) fail('layer gone from manifest');
const labels = ((l.popup && l.popup.fields) || []).map(f => f.label || '');
console.log('labels:', labels);
if (!labels.some(s => /\?$/.test(s))) fail('no whole-question label');
if (labels.some(s => /\(if a$/.test(s))) fail('a label is still cut mid-word');
const cr = l.credits || [];
console.log('credits:', cr.map(c => c.name || c.label || c).join(' | '));
if (cr.length < 3) fail('credits dropped (' + cr.length + ')');
if (!l.attribution) fail('attribution dropped');
if (l.centreMarks !== true) fail('centreMarks lost');
const gj = JSON.parse(fs.readFileSync(path.join(D, String(l.source).split('/').pop()), 'utf8'));
const old = JSON.parse(fs.readFileSync(before, 'utf8'));
const names = (g) => g.features.map(f => JSON.stringify(f.properties && (f.properties.name || f.properties.Name || f.properties.title) || '')).sort().join();
console.log('features:', gj.features.length, 'before:', old.features.length);
if (gj.features.length !== old.features.length) fail('feature count changed');
if (names(gj) !== names(old)) fail('names changed');
console.log('ALL CHECKS PASSED');
JS
chown -R mithun:mithun "$D"
echo "backup kept at $BK"
REMOTE
