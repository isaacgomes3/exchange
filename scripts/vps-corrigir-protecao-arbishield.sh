#!/usr/bin/env bash
# Corrige proteção marcada como Perdeu (exchange) quando bateu ArbiShield.
# Caso: Fratria Varna × Marek · proteção 5df3ae87…
#
# Dry-run:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/corrigir-protecao-fratria-8f4a/scripts/vps-corrigir-protecao-arbishield.sh?$(date +%s)")
#
# Aplicar crédito:
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/corrigir-protecao-fratria-8f4a/scripts/vps-corrigir-protecao-arbishield.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/corrigir-protecao-fratria-8f4a}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR" "$SCRIPTS_DIR/lib"

PROTECTION_ID="${PROTECTION_ID:-5df3ae87}"
MATCH="${MATCH:-Fratria}"
USER_PREFIX="${USER_PREFIX:-8b2cd8a3}"
FIX="${FIX:-0}"

echo "==> baixar corretor proteção ArbiShield (ref=$REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-corrigir-protecao-arbishield.mjs?t=$(date +%s)" \
  -o "$SCRIPTS_DIR/vps-corrigir-protecao-arbishield.mjs"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/lib/protection-flow-contract.mjs?t=$(date +%s)" \
  -o "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-corrigir-protecao-arbishield.mjs" \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
grep -q 'vps-corrigir-protecao-arbishield-v1' "$SCRIPTS_DIR/vps-corrigir-protecao-arbishield.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export PROTECTION_ID MATCH USER_PREFIX FIX
node "$SCRIPTS_DIR/vps-corrigir-protecao-arbishield.mjs"
