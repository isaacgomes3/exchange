#!/usr/bin/env bash
# Auditoria do dia — eventos, lucro (dedução), saldo empresa inicial/atual
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/auditoria-dia-lucro-3cf9/scripts/vps-auditoria-dia.sh?v=2")
#
# Dia específico:
#   DAY=2026-07-24 bash <(curl -fsSL "...")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/auditoria-dia-lucro-3cf9}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DAY="${DAY:-}"
JSON_OUT="${JSON_OUT:-/tmp/auditoria-dia-${DAY:-hoje}.json}"

mkdir -p "$SCRIPTS_DIR"

echo "==> baixar vps-auditoria-dia.mjs ($REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-auditoria-dia.mjs" \
  -o "$SCRIPTS_DIR/vps-auditoria-dia.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-auditoria-dia.mjs"
grep -q 'AUDITORIA DO DIA' "$SCRIPTS_DIR/vps-auditoria-dia.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export DAY JSON_OUT
echo "==> rodando auditoria${DAY:+ do dia $DAY}"
node "$SCRIPTS_DIR/vps-auditoria-dia.mjs"
echo
echo "JSON salvo em: $JSON_OUT"
