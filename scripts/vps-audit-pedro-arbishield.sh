#!/usr/bin/env bash
# Auditoria/correção — Pedro Iuri: settlements ArbiShield → saldo REAL
#
# Relatório:
#   bash /tmp/audit-pedro.sh
#
# Mover reusable → saldo real:
#   FIX=1 bash /tmp/audit-pedro.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-reembolso-pedro-iuri-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

NAME="${NAME:-PEDRO IURI TEIXEIRA DOS SANTOS}"
ID_PREFIX="${ID_PREFIX:-24037bdf}"
DAYS="${DAYS:-14}"
FIX="${FIX:-0}"
MOVE_ALL_REUSABLE="${MOVE_ALL_REUSABLE:-1}"
DST="$SCRIPTS_DIR/vps-audit-pedro-arbishield.mjs"

echo "==> baixar auditoria Pedro ArbiShield (saldo sempre real) bust=$BUST"
rm -f "$DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-pedro-arbishield.mjs?v=$BUST" \
  -o "$DST"
chmod 0644 "$DST"
! grep -q 'home_score' "$DST" || { echo "ERRO: script antigo com home_score"; exit 1; }
grep -q 'MOVE_ALL_REUSABLE\|final_score\|sem metadados de partidas' "$DST" \
  || { echo "ERRO: script inválido"; exit 1; }

export NAME ID_PREFIX DAYS FIX MOVE_ALL_REUSABLE
node "$DST"
