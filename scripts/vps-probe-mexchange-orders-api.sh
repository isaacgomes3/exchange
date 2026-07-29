#!/usr/bin/env bash
# Probe API pública autenticada de trading Mexchange (rodar na VPS / IP BR).
#
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-probe-mexchange-orders-api.sh?ref=cursor/exchange-orders-api-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
#
# Com sessão do cliente:
#   EXCHANGE_SESSION_TOKEN='...' bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/exchange-orders-api-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR" "$SCRIPTS_DIR/lib"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

fetch() {
  local path="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]]
}

log "baixar probe + adapter (ref=$REF)"
fetch "scripts/lib/exchange-orders-adapter.mjs" "$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  || die "adapter"
fetch "scripts/lib/exchange-orders-contract.mjs" "$SCRIPTS_DIR/lib/exchange-orders-contract.mjs" \
  || die "contract"
fetch "scripts/vps-probe-mexchange-orders-api.mjs" "$SCRIPTS_DIR/vps-probe-mexchange-orders-api.mjs" \
  || die "probe"
chmod 0644 "$SCRIPTS_DIR/lib/"*.mjs "$SCRIPTS_DIR/vps-probe-mexchange-orders-api.mjs"
grep -q 'vps-probe-mexchange-orders-api-v1' "$SCRIPTS_DIR/vps-probe-mexchange-orders-api.mjs" \
  || die "probe sem marker"
grep -q 'mexchange-public-trading-api-v1' "$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  || die "adapter sem marker public API"

cd "$SCRIPTS_DIR"
node ./vps-probe-mexchange-orders-api.mjs
