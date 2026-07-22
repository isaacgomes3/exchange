#!/usr/bin/env bash
# Política: Bateu ArbiShield SEMPRE credita saldo real + corrige Pedro (R$ 250 reusable)
#
# Na VPS (cache-bust):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-pedro-iuri-723d/scripts/vps-hotfix-saldo-sempre-real.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-reembolso-pedro-iuri-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
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
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR" /opt/arbishield/scripts

MARKER="settle-arbishield-saldo-real-v1"
AUDIT_DST="/opt/arbishield/scripts/vps-audit-pedro-arbishield.mjs"

log "1/3 Prelive + shim — ArbiShield → balance_cents ($MARKER)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs?v=$BUST" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q "$MARKER" "$PRELIVE_DST" || die "prelive sem $MARKER"
! grep -q 'wonArbi ? "reusable_balance_cents"' "$PRELIVE_DST" || die "prelive ainda usa reusable"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs?v=$BUST" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "2/3 UI Admin Jogos (copy saldo real)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?v=$BUST" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'devolve stake ao saldo real (Apostador) na hora' "$WEB/admin-jogos.html" \
  || die "HTML sem copy saldo real"

log "3/3 Pedro Iuri — mover reusable R\$ 250 → saldo real"
rm -f "$AUDIT_DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-pedro-arbishield.mjs?v=$BUST" -o "$AUDIT_DST"
chmod 0644 "$AUDIT_DST"
# Garante versão nova (sem home_score)
! grep -q 'home_score' "$AUDIT_DST" || die "script antigo ainda com home_score — limpe cache e rode de novo"
grep -q 'MOVE_ALL_REUSABLE\|final_score\|sem metadados de partidas' "$AUDIT_DST" \
  || die "script de auditoria incompleto"

FIX=1 MOVE_ALL_REUSABLE=1 CREDIT_MISSING=0 ID_PREFIX=24037bdf DAYS=21 \
  node "$AUDIT_DST"

echo
echo "OK — saldo sempre real (liquidações futuras + Pedro corrigido)"
echo "  Ctrl+F5 em /v2/admin-jogos.html"
