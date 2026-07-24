#!/usr/bin/env bash
# Hotfix: religa writers de platform_treasury no shim
#
# - settle desafio (casa win) → credita lucro zebra
# - settle proteção (exchange) → credita fee/cut
# - aprovar depósito → credita entrada de caixa
# - idempotente via admin_audit_logs
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/8c4cdc68174c898f159c7276a721ca920f255a3a/scripts/vps-hotfix-treasury-writers.sh?v=1")
#
# Depois rode o resync (dry-run → APPLY):
#   bash <(curl -fsSL ".../scripts/vps-resync-treasury.sh?v=1")
#   APPLY=1 bash <(curl -fsSL ".../scripts/vps-resync-treasury.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/tesouraria-desafio-settle-3cf9}"
REF="${ARBISHIELD_REF:-8c4cdc68174c898f159c7276a721ca920f255a3a}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
MARKER="treasury-writers-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$SHIM_DIR" "$SCRIPTS_DIR"

log "Shim :3101 ($MARKER) ref=$REF"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" \
  -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
grep -q 'adjustPlatformTreasury' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem adjustPlatformTreasury"
grep -q 'TREASURY_DESAFIO_CASA_WIN' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem TREASURY_DESAFIO_CASA_WIN"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1
curl -fsS "http://127.0.0.1:3101/health" >/dev/null 2>&1 \
  && log "health :3101 OK" \
  || log "health :3101 indisponível (serviço pode usar outro unit — confira systemctl)"

log "Scripts de resync"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-resync-treasury.mjs" \
  -o "$SCRIPTS_DIR/vps-resync-treasury.mjs"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-resync-treasury.sh" \
  -o "$SCRIPTS_DIR/vps-resync-treasury.sh"
chmod 0644 "$SCRIPTS_DIR/vps-resync-treasury.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-resync-treasury.sh"

echo
echo "OK — tesouraria writers ativos ($MARKER)"
echo
echo "1) Dry-run do resync (desde updated_at da tesouraria):"
echo "   node $SCRIPTS_DIR/vps-resync-treasury.mjs"
echo
echo "2) Se os números baterem, aplique:"
echo "   APPLY=1 node $SCRIPTS_DIR/vps-resync-treasury.mjs"
echo
echo "3) Re-rode a auditoria do dia e confira updated_at da tesouraria."
