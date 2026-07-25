#!/usr/bin/env bash
# Lança evento de teste no sandbox (publicado, odd 1.10)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-sandbox-lancar-evento-teste.sh?v=1")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
DST_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}/scripts"
mkdir -p "$DST_DIR"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-sandbox-lancar-evento-teste.mjs" \
  -o "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"
chmod 0755 "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"
node "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"
