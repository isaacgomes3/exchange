#!/usr/bin/env bash
# Senilvo — creditar R$ 6,01 (taxa debitada em dobro: 188,37 → 194,38)
#
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/3e4b496/scripts/vps-fix-senilvo-taxa-duplicada.sh")
set -euo pipefail
REF="${ARBISHIELD_REF:-3e4b496}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
DST="$SCRIPTS_DIR/vps-fix-senilvo-taxa-duplicada.mjs"

echo "==> baixar correção Senilvo taxa duplicada ref=$REF"
rm -f "$DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-senilvo-taxa-duplicada.mjs?v=$BUST" -o "$DST"
BYTES=$(wc -c < "$DST" | tr -d ' ')
[[ "$BYTES" -gt 500 ]] || { echo "ERRO: script vazio ($BYTES)"; exit 1; }
grep -q 'vps-fix-senilvo-taxa-duplicada-v1' "$DST" || { echo "ERRO: script inválido"; exit 1; }
chmod 0644 "$DST"

export FIX TARGET_REAL_CENTS="${TARGET_REAL_CENTS:-19438}" CREDIT_CENTS="${CREDIT_CENTS:-601}" ID_PREFIX=8839add0
node "$DST"
