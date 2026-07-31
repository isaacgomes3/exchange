#!/usr/bin/env bash
# Lista jogos do dia (kickoff BRT) — roda na VPS.
#
#   bash scripts/vps-listar-jogos-dia.sh
#   DATE=2026-07-31 bash scripts/vps-listar-jogos-dia.sh
#   ONLY_PUBLISHED=1 DATE=2026-07-31 bash scripts/vps-listar-jogos-dia.sh
#
# One-liner:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/listar-jogos-hoje-3e4b/scripts/vps-listar-jogos-dia.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/listar-jogos-hoje-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DATE="${DATE:-}"
ONLY_PUBLISHED="${ONLY_PUBLISHED:-0}"
INCLUDE_DELETED="${INCLUDE_DELETED:-0}"
JSON="${JSON:-0}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-listar-jogos-dia.mjs"
DEST="$SCRIPTS_DIR/vps-listar-jogos-dia.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export DATE ONLY_PUBLISHED INCLUDE_DELETED JSON
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
