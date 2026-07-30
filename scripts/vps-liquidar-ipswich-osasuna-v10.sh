#!/usr/bin/env bash
# Liquida Ipswich × Osasuna (LAY 3X1) — placar 1-2 → Exchange v10
#
# Fontes placar: Osasuna.com / BBC / EADT — Ipswich 1-2 Osasuna (29/07/2026)
# LAY 3X1: placar ≠ 3-1 → cliente ganha na casa → Exchange
#   (devolve stake · cobra só dedução · Reembolso R$0)
#
# Dry-run:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-liquidar-ipswich-osasuna-v10.sh?$(date +%s)")
# Aplicar:
#   FIX=1 bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}/scripts/vps-liquidar-eventos-a-liquidar-v10.sh"

log() { echo "==> $*"; }
log "Ipswich×Osasuna LAY 3X1 placar 1-2 → Exchange (v10)"
FIX="${FIX:-0}" EVENT_KEY=ipswich bash <(curl -fsSL "${RAW}?${BUST}")
