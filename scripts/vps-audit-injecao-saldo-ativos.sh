#!/usr/bin/env bash
# Auditoria GLOBAL — clientes ATIVOS com injeção/overcredit (mesmo problema do Carlos)
#
# Na VPS:
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-carlos-723d/scripts/vps-audit-injecao-saldo-ativos.sh" \
#     -o /tmp/audit-ativos.sh
#   bash /tmp/audit-ativos.sh 2>&1 | tee /tmp/audit-injecao-ativos.log
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-carlos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FROM="${FROM:-2026-07-15}"
TO="${TO:-}"
MIN_GAP_REAIS="${MIN_GAP_REAIS:-50}"
MIN_DRIFT_REAIS="${MIN_DRIFT_REAIS:-50}"

echo "==> baixar auditoria ativos"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-audit-injecao-saldo-ativos.mjs" \
  -o "$SCRIPTS_DIR/vps-audit-injecao-saldo-ativos.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-injecao-saldo-ativos.mjs"
grep -q 'Auditoria GLOBAL — injeção' "$SCRIPTS_DIR/vps-audit-injecao-saldo-ativos.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export FROM TO MIN_GAP_REAIS MIN_DRIFT_REAIS
echo "==> varrer ativos ${FROM} → ${TO:-agora}"
node "$SCRIPTS_DIR/vps-audit-injecao-saldo-ativos.mjs"
