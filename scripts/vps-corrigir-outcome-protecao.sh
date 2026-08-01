#!/usr/bin/env bash
# Corrige o outcome de UMA proteção liquidada errado. Dry-run por padrão.
#
# Na VPS (root):
#   ID=<uuid> DE=arbishield PARA=exchange bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-corrigir-outcome-protecao.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-ops")
#
# Acrescente -- --apply no fim para executar de verdade.
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
API="https://api.github.com/repos/${ARBISHIELD_REPO:-isaacgomes3/exchange}/contents"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fetch() {
  curl -fsSL --retry 4 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-ops" \
    "$API/$1?ref=${REF}&t=$(date +%s%N)" -o "$2"
  [[ -s "$2" ]] || { echo "ERRO: download vazio: $1" >&2; exit 1; }
}

mkdir -p "$WORK/lib"
fetch "scripts/vps-corrigir-outcome-protecao.mjs" "$WORK/vps-corrigir-outcome-protecao.mjs"
fetch "scripts/lib/protection-flow-contract.mjs" "$WORK/lib/protection-flow-contract.mjs"

exec node "$WORK/vps-corrigir-outcome-protecao.mjs" "$@"
