#!/usr/bin/env bash
# Só desafios de HOJE (#54–#59) + refaz entradas canceladas.
# Remove de novo os de ontem (#50–#53) que voltaram por engano.
#
# Simulação:
#   bash scripts/vps-restaurar-desafios-hoje-e-entradas.sh
# Aplicar:
#   FIX=1 bash scripts/vps-restaurar-desafios-hoje-e-entradas.sh
#
# One-liner VPS:
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/restaurar-so-hoje-entradas-3e4b/scripts/vps-restaurar-desafios-hoje-e-entradas.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/restaurar-so-hoje-entradas-3e4b}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"
FORCE_DEBIT="${FORCE_DEBIT:-0}"
SHIFT_MINUTES="${SHIFT_MINUTES:-90}"

mkdir -p "$SCRIPTS_DIR"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-restaurar-desafios-hoje-e-entradas.mjs"
DEST="$SCRIPTS_DIR/vps-restaurar-desafios-hoje-e-entradas.mjs"
curl -fsSL "$RAW" -o "$DEST"
chmod 0755 "$DEST"

export FIX FORCE_DEBIT SHIFT_MINUTES
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}"
node "$DEST"
