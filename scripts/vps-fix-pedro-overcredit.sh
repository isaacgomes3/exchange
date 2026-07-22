#!/usr/bin/env bash
# Corrige overcredit Pedro: volta real para R$ 6.495,71 (6.245,71 + 250)
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-pedro-iuri-723d/scripts/vps-fix-pedro-overcredit.sh?v=1")
#   FIX=1 bash <(curl -fsSL ".../vps-fix-pedro-overcredit.sh?v=1")
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-reembolso-pedro-iuri-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
TARGET_REAL_CENTS="${TARGET_REAL_CENTS:-649571}"
DST="$SCRIPTS_DIR/vps-fix-pedro-overcredit.mjs"

echo "==> baixar correção overcredit Pedro bust=$BUST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-pedro-overcredit.mjs?v=$BUST" -o "$DST"
chmod 0644 "$DST"
grep -q 'vps-fix-pedro-overcredit-v1' "$DST" || { echo "ERRO: script inválido"; exit 1; }

export FIX TARGET_REAL_CENTS ID_PREFIX=24037bdf
node "$DST"
