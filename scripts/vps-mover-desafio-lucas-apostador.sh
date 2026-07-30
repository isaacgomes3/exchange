#!/usr/bin/env bash
# Transfere Desafio → Apostador (Real) — Lucas Gonçalves dos Santos — R$ 150
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-mover-desafio-lucas-apostador.sh?ref=cursor/xfer-desafio-lucas-apostador-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
#
# Só relatório: FIX=0 bash ...
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/xfer-desafio-lucas-apostador-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-1}"
NAME="${NAME:-Lucas Gonçalves dos Santos}"
ID_PREFIX="${ID_PREFIX:-1210f201}"
AMOUNT_CENTS="${AMOUNT_CENTS:-15000}"
REASON="${REASON:-admin: transferir Desafio → Apostador (Lucas Gonçalves dos Santos)}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-mover-desafio-para-apostador.mjs"
log "baixar script (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-mover-desafio-para-apostador.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/scripts/vps-mover-desafio-para-apostador.mjs?t=$(date +%s%N)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-mover-desafio-para-apostador-v1' "$OUT" || die "script inválido (marker)"
chmod 0644 "$OUT"

export FIX NAME ID_PREFIX AMOUNT_CENTS REASON
log "executar FIX=$FIX NAME=$NAME ID_PREFIX=$ID_PREFIX AMOUNT=$AMOUNT_CENTS"
node "$OUT"
