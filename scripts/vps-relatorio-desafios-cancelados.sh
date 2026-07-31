#!/usr/bin/env bash
# Relatório CLI: desafios cancelados + clientes ativos e valores (roda na VPS).
#
#   bash scripts/vps-relatorio-desafios-cancelados.sh
#   DATE=2026-07-30 bash scripts/vps-relatorio-desafios-cancelados.sh
#   DATE=2026-07-30 JSON=1 bash scripts/vps-relatorio-desafios-cancelados.sh
#
# Ou one-liner na VPS (após push):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/relatorio-desafios-cancelados-3e4b/scripts/vps-relatorio-desafios-cancelados.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/relatorio-desafios-cancelados-3e4b}"
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
# Preferir URL local do Kong na VPS
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
