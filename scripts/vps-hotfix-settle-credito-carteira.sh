#!/usr/bin/env bash
# Hotfix: crédito na carteira ao encerrar partida (ArbiShield / Exchange)
#
# Sintoma: ao marcar BATEU ARBISHIELD (ou Exchange), o saldo não aparece
# no Apostador do cliente.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-settle-credito-carteira-723d/scripts/vps-hotfix-settle-credito-carteira.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-settle-credito-carteira-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

log "Prelive :3098 (crédito carteira v1)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'settle-credito-carteira-v1' "$PRELIVE_DST" || die "prelive sem fix settle-credito-carteira-v1"
grep -q 'creditWalletForSettlement' "$PRELIVE_DST" || die "prelive sem creditWalletForSettlement"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "Shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'settle-credito-carteira-v1' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem fix"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI Admin Jogos"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'Reparar crédito carteira\|saldo reutilizável' "$WEB/admin-jogos.html" || die "HTML sem UI de crédito"

echo
echo "OK — Crédito na carteira ao encerrar"
echo "  curl -s http://127.0.0.1:3098/health   # settle-credito-carteira-v1"
echo "  Partidas já encerradas sem crédito: Finalizados → Reparar crédito carteira"
echo "  MJALLBY: escolha de novo BATEU ARBISHIELD (ou Exchange) e Liquidar"
