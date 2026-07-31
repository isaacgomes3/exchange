#!/usr/bin/env bash
# Auditoria: qual admin cancelou/excluiu desafio hoje + IP
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/auditoria-cancel-adm-ip-3e4b/scripts/vps-auditoria-cancel-adm-hoje.sh")
#   DATE=2026-07-31 bash <(curl ...)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/auditoria-cancel-adm-ip-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DATE="${DATE:-}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-auditoria-cancel-adm-hoje.mjs"
DEST="$SCRIPTS_DIR/vps-auditoria-cancel-adm-hoje.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export DATE
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
