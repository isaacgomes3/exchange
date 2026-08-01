#!/usr/bin/env bash
# ⛔ SUPERSEDED — redireciona para force odd32 (R$ 9.051,71).
set -euo pipefail
echo "⛔ reparar-carlos-stake-nao-voltou (alvo 897641) supersedido → 9.051,71"
REF="${ARBISHIELD_REF:-main}"
BUST="$(date +%s)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
curl -fsSL "$RAW/scripts/vps-force-carlos-905171.sh?v=$BUST" -o /tmp/force-905171.sh
exec bash /tmp/force-905171.sh
