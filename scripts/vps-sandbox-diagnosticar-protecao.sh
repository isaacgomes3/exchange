#!/usr/bin/env bash
# Diagnostica / cobra dedução faltante de uma proteção no sandbox.
# Uso na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-sandbox-diagnosticar-protecao.sh?v=1") 4dc699ed
#   FIX=1 bash <(curl ... ) 4dc699ed
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
PREFIX="${1:-${PROTECTION_ID:-}}"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
[[ -n "$PREFIX" ]] || die "informe o prefixo da proteção (ex: 4dc699ed)"

mkdir -p "$DIR"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-sandbox-diagnosticar-protecao.mjs" \
  -o "$DIR/vps-sandbox-diagnosticar-protecao.mjs"
chmod 0755 "$DIR/vps-sandbox-diagnosticar-protecao.mjs"

FIX="${FIX:-0}" node "$DIR/vps-sandbox-diagnosticar-protecao.mjs" "$PREFIX"
