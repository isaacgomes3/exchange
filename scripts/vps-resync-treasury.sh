#!/usr/bin/env bash
# Resync tesouraria (dry-run ou APPLY=1)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/8c4cdc68174c898f159c7276a721ca920f255a3a/scripts/vps-resync-treasury.sh?v=1")
#   APPLY=1 bash <(curl -fsSL "...")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
APPLY="${APPLY:-}"
FROM="${FROM:-}"

mkdir -p "$SCRIPTS_DIR"
echo "==> baixar vps-resync-treasury.mjs ($REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-resync-treasury.mjs" \
  -o "$SCRIPTS_DIR/vps-resync-treasury.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-resync-treasury.mjs"
grep -q 'RESYNC TESOURARIA' "$SCRIPTS_DIR/vps-resync-treasury.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export APPLY FROM
echo "==> rodando resync${APPLY:+ (APPLY=1)}"
node "$SCRIPTS_DIR/vps-resync-treasury.mjs"
