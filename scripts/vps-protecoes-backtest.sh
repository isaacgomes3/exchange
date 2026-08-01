#!/usr/bin/env bash
# Backtest (só leitura) da sugestão de outcome contra proteções já liquidadas.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-protecoes-backtest.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-ops")
#
# Saída 2 = erro sistemático (todas invertidas) → não liquidar pela sugestão.
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
fetch "scripts/vps-protecoes-backtest.mjs" "$WORK/vps-protecoes-backtest.mjs"
fetch "scripts/lib/desafio-settle-suggest.mjs" "$WORK/lib/desafio-settle-suggest.mjs"

exec node "$WORK/vps-protecoes-backtest.mjs" "$@"
