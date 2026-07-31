#!/usr/bin/env bash
# Relatório de entradas 19/07 → hoje (cliente Luiz Paulo / B6EB155D…)
#
# Na VPS:
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-luiz-723d/scripts/vps-saldo-entradas-periodo.sh" \
#     -o /tmp/entradas.sh
#   bash /tmp/entradas.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-luiz-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FROM="${FROM:-2026-07-19}"
TO="${TO:-}"
EMAIL="${EMAIL:-}"
USER_ID="${USER_ID:-}"
# Defaults Luiz Paulo só quando não houver EMAIL/USER_ID
if [[ -n "$EMAIL" || -n "$USER_ID" ]]; then
  NAME="${NAME:-}"
  ID_PREFIX="${ID_PREFIX:-}"
else
  NAME="${NAME:-LUIZ PAULO GOMES SILVA DA ORA}"
  ID_PREFIX="${ID_PREFIX:-b6eb155d}"
fi

BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-adm-jawadog-3e4b}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"

echo "==> baixar script de período (${REF})"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-saldo-entradas-periodo.mjs" \
  -o "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"
grep -q 'Entradas / movimentações' "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FROM TO NAME ID_PREFIX EMAIL USER_ID
echo "==> período ${FROM} → ${TO:-agora}"
if [[ -n "$USER_ID" ]]; then
  echo "==> alvo USER_ID=${USER_ID}"
  USER_ID="$USER_ID" EMAIL= ID_PREFIX= NAME= FROM="$FROM" TO="$TO" \
    node "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"
elif [[ -n "$EMAIL" ]]; then
  echo "==> alvo EMAIL=${EMAIL}"
  EMAIL="$EMAIL" USER_ID= ID_PREFIX= NAME= FROM="$FROM" TO="$TO" \
    node "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"
else
  # tenta id, senão nome
  if ! ID_PREFIX="$ID_PREFIX" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"; then
    NAME="$NAME" FROM="$FROM" TO="$TO" node "$SCRIPTS_DIR/vps-saldo-entradas-periodo.mjs"
  fi
fi
