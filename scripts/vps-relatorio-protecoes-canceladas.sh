#!/usr/bin/env bash
# Relatório CLI: jogos/proteções canceladas + estornos (roda na VPS).
#
#   bash scripts/vps-relatorio-protecoes-canceladas.sh
#   DATE=2026-07-30 DAYS=2 bash scripts/vps-relatorio-protecoes-canceladas.sh
#   DATE=2026-07-31 JSON=1 bash scripts/vps-relatorio-protecoes-canceladas.sh
#
# One-liner na VPS (após push):
#   DATE=2026-07-31 DAYS=2 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/relatorio-protecoes-canceladas-3e4b/scripts/vps-relatorio-protecoes-canceladas.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/relatorio-protecoes-canceladas-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DATE="${DATE:-}"
DAYS="${DAYS:-2}"
JSON="${JSON:-0}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-relatorio-protecoes-canceladas.mjs"
DEST="$SCRIPTS_DIR/vps-relatorio-protecoes-canceladas.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export DATE DAYS JSON
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
