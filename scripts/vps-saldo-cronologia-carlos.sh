#!/usr/bin/env bash
# Cronologia do saldo — Carlos (carloskku4@gmail.com) — 19/07 → hoje
#
# Na VPS:
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-carlos-723d/scripts/vps-saldo-cronologia-carlos.sh" \
#     -o /tmp/cronologia-carlos.sh
#   bash /tmp/cronologia-carlos.sh 2>&1 | tee /tmp/cronologia-carlos.log
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-carlos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FROM="${FROM:-2026-07-19}"
TO="${TO:-}"
EMAIL="${EMAIL:-carloskku4@gmail.com}"
NAME="${NAME:-}"
ID_PREFIX="${ID_PREFIX:-}"
USER_ID="${USER_ID:-}"

echo "==> baixar cronologia"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-saldo-cronologia.mjs" \
  -o "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
grep -q 'Cronologia do saldo' "$SCRIPTS_DIR/vps-saldo-cronologia.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FROM TO EMAIL NAME ID_PREFIX USER_ID
echo "==> Carlos — cronologia ${FROM} → ${TO:-agora}"
echo "    email: $EMAIL"

if [[ -n "$USER_ID" ]]; then
  USER_ID="$USER_ID" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
elif [[ -n "$EMAIL" ]]; then
  EMAIL="$EMAIL" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
elif [[ -n "$ID_PREFIX" ]]; then
  ID_PREFIX="$ID_PREFIX" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
else
  NAME="${NAME:-CARLOS}" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
fi
