#!/usr/bin/env bash
# Auditoria fluxo — Pedro Iuri Teixeira dos Santos (id~24037bdf)
# Mesma linha Lucas/Augusto: PERDEU com crédito no Reembolso, fee faltante, bucket errado.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-audit-fluxo-pedro.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR/lib"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

fetch() {
  local path="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$dest" \
    || [[ ! -s "$dest" ]]; then
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      -H "Cache-Control: no-cache" \
      "$RAW/${path}?t=$(date +%s%N)" -o "$dest"
  fi
  [[ -s "$dest" ]] || die "download vazio: $path"
}

log "1/2 auditoria genérica (ref=$REF)"
fetch "scripts/vps-audit-fluxo-cliente.mjs" "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs"
fetch "scripts/lib/protection-flow-contract.mjs" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
grep -q 'vps-audit-fluxo-cliente-v1' "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs" || die "audit inválido"

export NAME="${NAME:-Pedro Iuri Teixeira dos Santos}"
export ID_PREFIX="${ID_PREFIX:-24037bdf}"
node "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs"

log "2/2 rastreio settles Exchange/Arbi (Pedro)"
fetch "scripts/vps-rastreia-settle-exchange-pedro.mjs" "$SCRIPTS_DIR/vps-rastreia-settle-exchange-pedro.mjs"
grep -q 'vps-rastreia-settle-exchange-pedro-v1' "$SCRIPTS_DIR/vps-rastreia-settle-exchange-pedro.mjs" || die "rastreia inválido"
node "$SCRIPTS_DIR/vps-rastreia-settle-exchange-pedro.mjs"
