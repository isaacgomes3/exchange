#!/usr/bin/env bash
# Realinha Senilvo 003d5bc9 → Exchange (não cancel / não void)
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-realinhar-senilvo-exchange-003d5bc9.sh?$(date +%s)")
#   FIX=1 bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
mkdir -p "$SCRIPTS_DIR"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

tmp="$(mktemp)"
download_repo_file "scripts/vps-realinhar-senilvo-exchange-003d5bc9.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-realinhar-senilvo-exchange-003d5bc9.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-realinhar-senilvo-exchange-003d5bc9.mjs"
rm -f "$tmp"

log "executar FIX=$FIX"
cd "$SCRIPTS_DIR"
FIX="$FIX" node ./vps-realinhar-senilvo-exchange-003d5bc9.mjs
