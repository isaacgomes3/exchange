#!/usr/bin/env bash
# Debita carteira Desafio (estorno reembolsos cancelamento 30/07).
#
# Simulação:
#   bash scripts/vps-debitar-desafio-cancelados-ontem.sh
# Aplicar:
#   FIX=1 bash scripts/vps-debitar-desafio-cancelados-ontem.sh
#
# One-liner VPS:
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/debitar-desafio-cancelados-3e4b/scripts/vps-debitar-desafio-cancelados-ontem.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/debitar-desafio-cancelados-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-debitar-desafio-cancelados-ontem.mjs"
DEST="$SCRIPTS_DIR/vps-debitar-desafio-cancelados-ontem.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export FIX
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
