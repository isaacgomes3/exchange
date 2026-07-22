#!/usr/bin/env bash
# Auditoria/correção — Pedro Iuri settlements ArbiShield sem reembolso no saldo real
#
# Relatório:
#   bash /tmp/audit-pedro.sh
# Corrigir:
#   FIX=1 bash /tmp/audit-pedro.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-reembolso-pedro-iuri-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

NAME="${NAME:-PEDRO IURI TEIXEIRA DOS SANTOS}"
ID_PREFIX="${ID_PREFIX:-24037bdf}"
DAYS="${DAYS:-14}"
FIX="${FIX:-0}"

echo "==> baixar auditoria Pedro ArbiShield"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-pedro-arbishield.mjs" \
  -o "$SCRIPTS_DIR/vps-audit-pedro-arbishield.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-pedro-arbishield.mjs"
grep -q 'vps-audit-pedro-arbishield' "$SCRIPTS_DIR/vps-audit-pedro-arbishield.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export NAME ID_PREFIX DAYS FIX
node "$SCRIPTS_DIR/vps-audit-pedro-arbishield.mjs"
