#!/usr/bin/env bash
# Auditoria — clientes com Saldo Provedor × data de entrada no provedor.
#
# Na VPS:
#   bash <(curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-audit-provedor-entrada.sh?ref=${ARBISHIELD_REF:-main}&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-audit")
#
# Ou com branch de PR (antes do merge):
#   ARBISHIELD_REF=cursor/provedor-entrada-audit-c147 bash <(curl -fsSL ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW_API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

download() {
  local rel="$1"
  local dest="$2"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "${RAW_API}/${rel}?ref=${REF}&t=$(date +%s%N)" \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-audit" \
    -o "$dest"
}

echo "==> baixar vps-audit-provedor-entrada.mjs (ref=${REF})"
download "scripts/vps-audit-provedor-entrada.mjs" \
  "$SCRIPTS_DIR/vps-audit-provedor-entrada.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-provedor-entrada.mjs"
grep -q 'provedor-entrada-audit-v1' "$SCRIPTS_DIR/vps-audit-provedor-entrada.mjs" \
  || { echo "ERRO: script inválido"; exit 1; }

export INCLUDE_ZERO="${INCLUDE_ZERO:-0}"
export JSON="${JSON:-0}"
export MISMATCH_HOURS="${MISMATCH_HOURS:-24}"

echo "==> listar clientes com saldo provedor + data de entrada"
node "$SCRIPTS_DIR/vps-audit-provedor-entrada.mjs" | tee /tmp/provedor-entrada.log
echo ""
echo "Log: /tmp/provedor-entrada.log"
