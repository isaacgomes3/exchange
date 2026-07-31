#!/usr/bin/env bash
# Investiga jawadog871@kierko.com / 3b7e5b99-… apontado no delete de desafios
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-investigar-adm-jawadog.sh")
#   REVOKE=1 bash <(...)          # tira role admin
#   BAN=1 REVOKE=1 bash <(...)    # tira role + ban Auth
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-adm-jawadog-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
REVOKE="${REVOKE:-0}"
BAN="${BAN:-0}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
DEST="$SCRIPTS_DIR/vps-investigar-adm-jawadog.mjs"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-investigar-adm-jawadog.mjs" -o "$DEST"
chmod 0755 "$DEST"

export REVOKE BAN
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
