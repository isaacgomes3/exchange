#!/usr/bin/env bash
# Cobra fee faltante Crvena — Lucas (R$ 5,52) → Apostador ~R$ 294,83
#
# Relatório:
#   FIX=0 bash <(curl ...)
# Aplicar:
#   FIX=1 bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-cobra-fee-crvena-lucas.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
FIX="${FIX:-0}"
mkdir -p "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-cobra-fee-crvena-lucas.mjs"
LIB="$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
mkdir -p "$(dirname "$LIB")"

log "baixar scripts (ref=$REF FIX=$FIX)"
for path in scripts/vps-cobra-fee-crvena-lucas.mjs scripts/lib/protection-flow-contract.mjs; do
  dest="$SCRIPTS_DIR/${path#scripts/}"
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
done

grep -q 'vps-cobra-fee-crvena-lucas-v1' "$OUT" || die "script inválido"
chmod 0644 "$OUT" "$LIB"

export FIX
export USER_ID="${USER_ID:-1210f201-1227-48c7-8336-334942dca7d6}"
export FEE_CENTS="${FEE_CENTS:-552}"
export TARGET_APOSTADOR_CENTS="${TARGET_APOSTADOR_CENTS:-29483}"
node "$OUT"
