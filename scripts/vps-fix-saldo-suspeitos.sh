#!/usr/bin/env bash
# Corrige saldos dos 4 suspeitos (só debita quem está acima do sugerido).
#
# Relatório:
#   bash /tmp/fix-suspeitos.sh
# Aplicar:
#   FIX=1 bash /tmp/fix-suspeitos.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-carlos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"

echo "==> baixar correção suspeitos"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-saldo-suspeitos.mjs" \
  -o "$SCRIPTS_DIR/vps-fix-saldo-suspeitos.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-fix-saldo-suspeitos.mjs"
grep -q 'clawback_injecao_saldo_auditoria' "$SCRIPTS_DIR/vps-fix-saldo-suspeitos.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FIX
echo "==> FIX=$FIX"
node "$SCRIPTS_DIR/vps-fix-saldo-suspeitos.mjs"
