#!/usr/bin/env bash
# Correção lote — 3 suspeitos (Leandro, Carlos Roberto, João Paulo)
#
# FIX=0 bash <(curl ...)   # relatório
# FIX=1 bash <(curl ...)   # aplica
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"
mkdir -p "$SCRIPTS_DIR"
OUT="$SCRIPTS_DIR/vps-correcao-reembolso-suspeitos-lote.mjs"
if ! curl -fsSL --retry 5 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-correcao-reembolso-suspeitos-lote.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 "$RAW/scripts/vps-correcao-reembolso-suspeitos-lote.mjs?t=$(date +%s%N)" -o "$OUT"
fi
grep -q 'vps-correcao-reembolso-suspeitos-lote-v1' "$OUT" || { echo "ERRO script"; exit 1; }
export FIX
node "$OUT"
