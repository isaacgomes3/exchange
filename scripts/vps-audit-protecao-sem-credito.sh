#!/usr/bin/env bash
# Auditoria/correção — proteção encerrada sem crédito (João Paulo / Klubi×Haka)
#
# Relatório:
#   bash /tmp/audit-prot.sh
# Creditar settlement (stake − taxa):
#   FIX=1 bash /tmp/audit-prot.sh
# Estorno integral:
#   FIX=1 FORCE_REFUND=1 bash /tmp/audit-prot.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/reembolso-joao-paulo-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

NAME="${NAME:-JOÃO PAULO LEITE}"
MATCH="${MATCH:-Klubi}"
OUTCOME="${OUTCOME:-exchange}"
FIX="${FIX:-0}"
FORCE_REFUND="${FORCE_REFUND:-0}"

echo "==> baixar auditoria proteção sem crédito"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-protecao-sem-credito.mjs" \
  -o "$SCRIPTS_DIR/vps-audit-protecao-sem-credito.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-protecao-sem-credito.mjs"
grep -q 'ENCERRADA SEM CRÉDITO' "$SCRIPTS_DIR/vps-audit-protecao-sem-credito.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export NAME MATCH OUTCOME FIX FORCE_REFUND
node "$SCRIPTS_DIR/vps-audit-protecao-sem-credito.mjs"
