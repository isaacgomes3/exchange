#!/usr/bin/env bash
# Pacote Desafio ao vivo: radar (mradar) + fim de jogo (FT/V×).
# Preferir ESTE comando (evita cache de hotfix antigo pedindo marker v2).
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-live-pack.sh?ref=main" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
export ARBISHIELD_REF="$REF"
export ARBISHIELD_BUST="${ARBISHIELD_BUST:-$(date +%s)}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need bash

download() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "Pragma: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=${ARBISHIELD_BUST}&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

tmp1="$(mktemp)"
tmp2="$(mktemp)"
log "baixando hotfixes mradar + ft-result (via API GitHub, sem cache)"
download "scripts/vps-hotfix-desafio-mradar.sh" "$tmp1"
download "scripts/vps-hotfix-desafio-ft-result.sh" "$tmp2"
grep -qE 'betbra-events-radar-v|eventIdSportRadar' "$tmp1" || die "hotfix mradar desatualizado"
grep -q 'inferMatchFinished\|desafio-ft-result\|ageMin' "$tmp2" || die "hotfix ft desatualizado"

log "=== A) mradar ==="
bash "$tmp1"
log "=== B) ft-result ==="
bash "$tmp2"
rm -f "$tmp1" "$tmp2"

log "OK pacote live. Ctrl+Shift+R em /app-desafio.html"
log "Markers esperados: desafio-live-pack-v1 (ou mradar-v2 + ft-result-v1)"
