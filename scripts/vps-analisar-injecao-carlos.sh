#!/usr/bin/env bash
# Re-roda cronologia Carlos com detecção de buracos / sinal corrigido.
#
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-saldo-carlos-723d/scripts/vps-saldo-cronologia-carlos.sh" \
#     -o /tmp/cronologia-carlos.sh
#   bash /tmp/cronologia-carlos.sh 2>&1 | tee /tmp/cronologia-carlos.log
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-saldo-carlos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
export ARBISHIELD_BRANCH="$BRANCH" ARBISHIELD_REF="$REF"
export FROM="${FROM:-2026-07-19}"
export EMAIL="${EMAIL:-carloskku4@gmail.com}"
DIR="$(cd "$(dirname "$0")" && pwd)"
# Prefer local sibling if present; else download via carlos wrapper pattern
if [[ -f "$DIR/vps-saldo-cronologia-carlos.sh" ]]; then
  bash "$DIR/vps-saldo-cronologia-carlos.sh"
else
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}/scripts/vps-saldo-cronologia-carlos.sh" \
    -o /tmp/cronologia-carlos.sh
  bash /tmp/cronologia-carlos.sh
fi
