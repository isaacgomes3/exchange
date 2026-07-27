#!/usr/bin/env bash
# ⛔ SUPERSEDED — redireciona para R$ 9.051,71 (Sport×Cuiabá odd 32).
# Não force mais 8.976,41 (fee odd 10 errada neste bilhete).
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-force-carlos-905171.sh?$(date +%s)" -o /tmp/force-905171.sh
#   bash /tmp/force-905171.sh
set -euo pipefail

echo "⛔ 897641 supersedido → redirecionando para force 9.051,71 (odd 32)"
REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="$(date +%s)"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
curl -fsSL "$RAW/scripts/vps-force-carlos-905171.sh?v=$BUST" -o /tmp/force-905171.sh
exec bash /tmp/force-905171.sh
