#!/usr/bin/env bash
# Correção Reembolso Pedro Iuri → Real (padrão Lucas/Augusto)
# FIX=0 relatório | FIX=1 aplica | FORCE_ALL=1 zera todo Reembolso
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"
FORCE_ALL="${FORCE_ALL:-0}"
mkdir -p "$SCRIPTS_DIR"
OUT="$SCRIPTS_DIR/vps-correcao-reembolso-pedro.mjs"
if ! curl -fsSL --retry 5 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-correcao-reembolso-pedro.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 "$RAW/scripts/vps-correcao-reembolso-pedro.mjs?t=$(date +%s%N)" -o "$OUT"
fi
grep -q 'vps-correcao-reembolso-pedro-v1' "$OUT" || { echo "ERRO script"; exit 1; }
export FIX FORCE_ALL ID_PREFIX="${ID_PREFIX:-24037bdf}"
node "$OUT"
