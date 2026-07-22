#!/usr/bin/env bash
# Cronologia do saldo — Luiz Paulo — 15/07 → hoje
#
# Na VPS:
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-luiz-723d/scripts/vps-saldo-cronologia.sh" \
#     -o /tmp/cronologia.sh
#   bash /tmp/cronologia.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-luiz-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FROM="${FROM:-2026-07-15}"
TO="${TO:-}"
NAME="${NAME:-LUIZ PAULO GOMES SILVA DA ORA}"
ID_PREFIX="${ID_PREFIX:-b6eb155d}"
EMAIL="${EMAIL:-}"
USER_ID="${USER_ID:-}"

echo "==> baixar cronologia"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-saldo-cronologia.mjs" \
  -o "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
grep -q 'Cronologia do saldo' "$SCRIPTS_DIR/vps-saldo-cronologia.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FROM TO NAME ID_PREFIX EMAIL USER_ID
echo "==> cronologia ${FROM} → ${TO:-agora}"
if [[ -n "$USER_ID" ]]; then
  USER_ID="$USER_ID" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
elif [[ -n "$EMAIL" ]]; then
  EMAIL="$EMAIL" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
else
  if ! ID_PREFIX="$ID_PREFIX" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"; then
    NAME="$NAME" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-cronologia.mjs"
  fi
fi
