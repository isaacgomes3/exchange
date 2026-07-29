#!/usr/bin/env bash
# Investiga saldo do cliente (ex.: Luiz Paulo / id B6EB155D…)
#
# Na VPS (root):
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-luiz-723d/scripts/vps-investigar-saldo-cliente.sh" \
#     -o /tmp/inv-saldo.sh
#   bash /tmp/inv-saldo.sh
#
# Ou com parâmetros:
#   NAME="LUIZ PAULO" bash /tmp/inv-saldo.sh
#   ID_PREFIX=b6eb155d bash /tmp/inv-saldo.sh
#   EMAIL=user@email.com bash /tmp/inv-saldo.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-luiz-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

NAME="${NAME:-LUIZ PAULO GOMES SILVA DA ORA}"
ID_PREFIX="${ID_PREFIX:-b6eb155d}"
EMAIL="${EMAIL:-}"
USER_ID="${USER_ID:-}"

echo "==> baixar diagnóstico"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-diagnose-user-balance.mjs" \
  -o "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
grep -q 'ID_PREFIX\|resolveProfile' "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs" \
  || { echo "ERRO: script antigo"; exit 1; }

echo "==> investigar"
export NAME ID_PREFIX EMAIL USER_ID
if [[ -n "$USER_ID" ]]; then
  USER_ID="$USER_ID" node "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
elif [[ -n "$EMAIL" ]]; then
  EMAIL="$EMAIL" node "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
elif [[ -n "$ID_PREFIX" ]]; then
  # tenta id primeiro; se falhar, tenta nome
  if ! ID_PREFIX="$ID_PREFIX" node "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"; then
    echo "==> fallback por nome"
    NAME="$NAME" node "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
  fi
else
  NAME="$NAME" node "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
fi

echo
echo "Se aparecer OVERCREDIT, corrija com:"
echo "  FIX_OVERCREDIT=1 USER_ID=<uuid> node $SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
