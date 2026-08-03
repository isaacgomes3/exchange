#!/usr/bin/env bash
# Relatório CLI (Node + SERVICE_ROLE): desafios cancelados + clientes + saldo antes.
#
# Preferir o SQL puro (não precisa de .env):
#   bash scripts/vps-relatorio-desafios-cancelados-ontem.sh
#
# Este wrapper baixa o .mjs e roda com DATE (BRT):
#   DATE=2026-07-31 bash scripts/vps-relatorio-desafios-cancelados.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/relatorio-desafios-cancelados-ontem-4759}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DATE="${DATE:-}"
DAYS="${DAYS:-1}"
JSON="${JSON:-0}"
ONLY_WITH_CLIENTS="${ONLY_WITH_CLIENTS:-1}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-relatorio-desafios-cancelados.mjs"
DEST="$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export DATE DAYS JSON ONLY_WITH_CLIENTS
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
