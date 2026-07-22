#!/usr/bin/env bash
# Política: Bateu ArbiShield SEMPRE credita saldo real + corrige Pedro (R$ 250 reusable)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-pedro-iuri-723d/scripts/vps-hotfix-saldo-sempre-real.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-reembolso-pedro-iuri-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need node
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

MARKER="settle-arbishield-saldo-real-v1"

log "1/3 Prelive + shim — ArbiShield → balance_cents ($MARKER)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q "$MARKER" "$PRELIVE_DST" || die "prelive sem $MARKER"
! grep -q 'wonArbi ? "reusable_balance_cents"' "$PRELIVE_DST" || die "prelive ainda usa reusable"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "2/3 UI Admin Jogos (copy saldo real)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'devolve stake ao saldo real (Apostador) na hora' "$WEB/admin-jogos.html" \
  || die "HTML sem copy saldo real"

log "3/3 Pedro Iuri — mover reusable R\$ 250 → saldo real"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-pedro-arbishield.mjs" \
  -o /opt/arbishield/scripts/vps-audit-pedro-arbishield.mjs
FIX=1 MOVE_ALL_REUSABLE=1 ID_PREFIX=24037bdf DAYS=21 \
  node /opt/arbishield/scripts/vps-audit-pedro-arbishield.mjs

echo
echo "OK — saldo sempre real (liquidações futuras + Pedro corrigido)"
echo "  Ctrl+F5 em /v2/admin-jogos.html"
