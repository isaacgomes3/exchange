#!/usr/bin/env bash
# Diagnóstico: para qual carteira foi a internal_transfer (ex.: Pedro R$ 255,51).
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-diag-internal-transfer.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
TX_ID="${TX_ID:-9fcb1d29-ddf1-44cd-bf7d-f8c0a25b33a6}"
AMOUNT_CENTS="${AMOUNT_CENTS:-25551}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"

mkdir -p "$SCRIPTS_DIR"
tmp="$(mktemp)"
if ! curl -fsSL --retry 5 \
  -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-diag-internal-transfer.mjs?ref=${REF}&t=$(date +%s%N)" -o "$tmp"; then
  curl -fsSL "$RAW/scripts/vps-diag-internal-transfer.mjs?t=$(date +%s%N)" -o "$tmp"
fi
cp -f "$tmp" "$SCRIPTS_DIR/vps-diag-internal-transfer.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-diag-internal-transfer.mjs"
rm -f "$tmp"

export TX_ID AMOUNT_CENTS
cd /opt/arbishield 2>/dev/null || cd "$SCRIPTS_DIR/.." || true
node "$SCRIPTS_DIR/vps-diag-internal-transfer.mjs"
