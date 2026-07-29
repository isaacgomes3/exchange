#!/usr/bin/env bash
# Crédito manual Luiz Paulo — R$ 110 — "ajuste de saldo apos auditoria"
#
#   curl ... -o /tmp/credito-luiz.sh
#   bash /tmp/credito-luiz.sh          # dry-run
#   FIX=1 bash /tmp/credito-luiz.sh    # aplicar
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-carlos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
AMOUNT_CENTS="${AMOUNT_CENTS:-11000}"
REASON="${REASON:-ajuste de saldo apos auditoria}"
ID_PREFIX="${ID_PREFIX:-b6eb155d}"

echo "==> baixar crédito manual Luiz"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-credito-manual-luiz.mjs" \
  -o "$SCRIPTS_DIR/vps-credito-manual-luiz.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-credito-manual-luiz.mjs"
grep -q 'ajuste de saldo apos auditoria' "$SCRIPTS_DIR/vps-credito-manual-luiz.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FIX AMOUNT_CENTS REASON ID_PREFIX
node "$SCRIPTS_DIR/vps-credito-manual-luiz.mjs"
