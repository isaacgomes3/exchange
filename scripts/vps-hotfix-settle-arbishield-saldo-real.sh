#!/usr/bin/env bash
# OBSOLETO — proteção do zero. Não reinstala lógica antiga.
echo "ABORTADO: logica de protecao antiga excluida (protecao-do-zero)." >&2
echo "Use: scripts/vps-hotfix-protecao-do-zero.sh  (FLUXO_PROTECAO_V1)" >&2
echo "Depois implemente a nova logica em scripts/lib/protection-flow-scaffold.mjs" >&2
exit 1

# --- abaixo: legado (nao executa) ---
# Hotfix: Bateu ArbiShield credita saldo REAL (balance_cents) na hora
#
# Sintoma: ao liquidar "BATEU ARBISHIELD" no ADM, o cliente não via reembolso
# imediato — o crédito ia para reusable_balance_cents.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-settle-arbishield-credito-723d/scripts/vps-hotfix-settle-arbishield-saldo-real.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-settle-arbishield-credito-723d}"
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

MARKER="settle-arbishield-saldo-real-v1"

log "Prelive :3098 ($MARKER)"
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
grep -q 'creditWalletForSettlement' "$PRELIVE_DST" || die "prelive sem creditWalletForSettlement"
# Garante que ArbiShield não grava mais em reusable no settle
! grep -q 'wonArbi ? "reusable_balance_cents"' "$PRELIVE_DST" || die "prelive ainda roteia ArbiShield para reusable"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "Shim :3101 ($MARKER)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
! grep -q 'wonArbi ? "reusable_balance_cents"' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim ainda roteia ArbiShield para reusable"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI Admin Jogos (textos saldo real)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'devolve stake ao saldo real (Apostador) na hora' "$WEB/admin-jogos.html" \
  || die "HTML sem copy de saldo real"
grep -q 'A creditar (saldo real)' "$WEB/admin-jogos.html" \
  || die "HTML sem hint saldo real"

echo
echo "OK — Bateu ArbiShield → balance_cents (reembolso imediato)"
echo "  curl -s http://127.0.0.1:3098/health"
echo "  https://arbishield.app/v2/admin-jogos.html  (Ctrl+F5)"
echo "  Liquidar teste: BATEU ARBISHIELD → cliente deve ver crédito no saldo real"
