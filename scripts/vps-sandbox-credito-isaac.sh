#!/usr/bin/env bash
# Credita isaacgomes3@gmail.com para testes (DEMO + desafio = R$ 1.000 cada)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-sandbox-credito-isaac.sh?v=1")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/ambiente-teste-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DST="$SCRIPTS_DIR/vps-sandbox-credito-isaac.mjs"

mkdir -p "$SCRIPTS_DIR"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-sandbox-credito-isaac.mjs" -o "$DST"
chmod 0755 "$DST"

echo "==> Relatório"
node "$DST"
echo
echo "==> Aplicando FIX=1 (DEMO + desafio)"
FIX=1 node "$DST"

echo
echo "Teste UI: https://arbishield.app/sandbox/app-proteger.html"
echo "Em Proteger, use saldo DEMO."
