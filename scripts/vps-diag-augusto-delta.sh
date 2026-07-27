#!/usr/bin/env bash
# Diagnóstico delta Augusto (teórico vs Apostador)
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"
OUT="$SCRIPTS_DIR/vps-diag-augusto-delta.mjs"
if ! curl -fsSL --retry 5 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-diag-augusto-delta.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 "$RAW/scripts/vps-diag-augusto-delta.mjs?t=$(date +%s%N)" -o "$OUT"
fi
grep -q 'vps-diag-augusto-delta-v1' "$OUT" || { echo "ERRO: script inválido"; exit 1; }
export ID_PREFIX="${ID_PREFIX:-8b2cd8a3}"
export NAME="${NAME:-Augusto Luiz Magalhaes Vila Nova}"
node "$OUT"
