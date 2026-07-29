#!/usr/bin/env bash
# Move R$ 200 reusable → real (João Paulo / Klubi×Haka)
#
#   bash /tmp/mover-reusable.sh
#   FIX=1 bash /tmp/mover-reusable.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/reembolso-joao-paulo-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
NAME="${NAME:-JOÃO PAULO LEITE}"
AMOUNT_CENTS="${AMOUNT_CENTS:-20000}"
PROTECTION_ID="${PROTECTION_ID:-8146fd5c-142d-40a1-96e1-0831ff071fc3}"

echo "==> baixar mover reusable→real"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-mover-reusable-para-real.mjs" \
  -o "$SCRIPTS_DIR/vps-mover-reusable-para-real.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-mover-reusable-para-real.mjs"
grep -q 'Mover reusable' "$SCRIPTS_DIR/vps-mover-reusable-para-real.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FIX NAME AMOUNT_CENTS PROTECTION_ID
node "$SCRIPTS_DIR/vps-mover-reusable-para-real.mjs"
