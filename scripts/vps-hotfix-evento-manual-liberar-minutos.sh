#!/usr/bin/env bash
# Hotfix: opção "Liberar entrada quantos minutos antes" no evento manual
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/d9acaed3f997e3067d1909b19348a150afeb435d/scripts/vps-hotfix-evento-manual-liberar-minutos.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/evento-manual-liberar-minutos-3cf9}"
REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
PRELIVE_DIR="${ARBISHIELD_PRELIVE_DIR:-/opt/arbishield}"
MARKER="manReleaseMinutes"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

log "admin-jogos.html ($REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" \
  -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q "$MARKER" "$WEB/admin-jogos.html" || die "admin-jogos sem $MARKER"
grep -q 'release_minutes_before' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem release_minutes_before"

log "app-proteger.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" \
  -o "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'isEntryReleased' "$WEB/app-proteger.html" || die "app-proteger sem isEntryReleased"

log "prelive :3098"
PRELIVE_DST="$PRELIVE_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
grep -q 'release_minutes_before' "$PRELIVE_DST" || die "prelive sem release_minutes_before"
grep -q 'Entradas liberam' "$PRELIVE_DST" || die "prelive sem gate de liberação"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

echo
echo "OK — liberar entrada (minutos antes) no evento manual"
echo "  https://arbishield.app/v2/admin-jogos.html  → Lançar evento manual"
echo "  Default: 60 minutos antes"
