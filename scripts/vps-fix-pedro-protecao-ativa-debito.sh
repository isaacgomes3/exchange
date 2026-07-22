#!/usr/bin/env bash
# Pedro Iuri — debitar proteção ativa que não saiu do saldo
#
# Relatório:
#   bash <(curl -fsSL ".../vps-fix-pedro-protecao-ativa-debito.sh?v=1")
# Aplicar:
#   FIX=1 bash <(curl -fsSL ".../vps-fix-pedro-protecao-ativa-debito.sh?v=1")
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-pedro-debito-protecao-ativa-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
DST="$SCRIPTS_DIR/vps-fix-pedro-protecao-ativa-debito.mjs"

echo "==> baixar correção débito proteção ativa bust=$BUST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-pedro-protecao-ativa-debito.mjs?v=$BUST" -o "$DST"
chmod 0644 "$DST"
grep -q 'vps-fix-pedro-protecao-ativa-debito-v1' "$DST" \
  || { echo "ERRO: script inválido"; exit 1; }

export FIX ID_PREFIX=24037bdf
node "$DST"
