#!/usr/bin/env bash
# Auditoria do dia — eventos, lucro (dedução), saldo empresa inicial/atual
# Versão: v3 (retry de schema + fallback via wallet_transactions)
#
# Na VPS (root) — SHA pinado (evita cache da v2):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/090b8ec6271e209059d44b8392f435be52bfb5c7/scripts/vps-auditoria-dia.sh?v=3")
#
# Dia específico:
#   DAY=2026-07-24 bash <(curl -fsSL "...")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/auditoria-dia-lucro-3cf9}"
# SHA pinado por padrão (override com ARBISHIELD_REF=...)
REF="${ARBISHIELD_REF:-090b8ec6271e209059d44b8392f435be52bfb5c7}"
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

if ! grep -q 'AUDITORIA DO DIA' "$SCRIPTS_DIR/vps-auditoria-dia.mjs"; then
  echo "ERRO: script inválido (sem banner AUDITORIA DO DIA)"
  exit 1
fi
if ! grep -qE 'v3|AUDITORIA DO DIA.*v3|auditoria v3' "$SCRIPTS_DIR/vps-auditoria-dia.mjs"; then
  echo "ERRO: script baixado não é v3 (possível cache/raw antigo). Use ARBISHIELD_REF=<sha>"
  exit 1
fi
echo "==> script OK (v3)"

export DAY JSON_OUT
echo "==> rodando auditoria${DAY:+ do dia $DAY}"
node "$SCRIPTS_DIR/vps-auditoria-dia.mjs"
echo
echo "JSON salvo em: $JSON_OUT"
