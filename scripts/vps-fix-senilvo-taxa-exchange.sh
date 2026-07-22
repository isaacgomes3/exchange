#!/usr/bin/env bash
# Senilvo — debitar taxa Exchange R$ 6,01 que não saiu na liquidação de R$ 200
#
# Relatório:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/8fa9fcd/scripts/vps-fix-senilvo-taxa-exchange.sh")
# Aplicar:
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/8fa9fcd/scripts/vps-fix-senilvo-taxa-exchange.sh")
set -euo pipefail

# Após o push, o README do PR usa o SHA do commit. Fallback: branch com bust.
REF="${ARBISHIELD_REF:-8fa9fcd}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-0}"
FEE_CENTS="${FEE_CENTS:-601}"
STAKE_CENTS="${STAKE_CENTS:-20000}"
FORCE="${FORCE:-0}"
DST="$SCRIPTS_DIR/vps-fix-senilvo-taxa-exchange.mjs"

echo "==> baixar correção Senilvo taxa Exchange ref=$REF"
rm -f "$DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-senilvo-taxa-exchange.mjs?v=$BUST" -o "$DST"
BYTES=$(wc -c < "$DST" | tr -d ' ')
[[ "$BYTES" -gt 1000 ]] || { echo "ERRO: script vazio ($BYTES). Use ARBISHIELD_REF=<sha>"; exit 1; }
grep -q 'vps-fix-senilvo-taxa-exchange-v1' "$DST" || { echo "ERRO: script inválido"; exit 1; }
chmod 0644 "$DST"

export FIX FEE_CENTS STAKE_CENTS FORCE NAME="${NAME:-SENILVO ACRI CARVALHO}"
node "$DST"
