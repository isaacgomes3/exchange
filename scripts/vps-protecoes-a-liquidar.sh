#!/usr/bin/env bash
# Relatório (só leitura) das proteções abertas e do outcome sugerido por partida.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-protecoes-a-liquidar.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-ops")
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
fetch "scripts/vps-protecoes-a-liquidar.mjs" "$WORK/vps-protecoes-a-liquidar.mjs"
fetch "scripts/lib/desafio-settle-suggest.mjs" "$WORK/lib/desafio-settle-suggest.mjs"

exec node "$WORK/vps-protecoes-a-liquidar.mjs" "$@"
