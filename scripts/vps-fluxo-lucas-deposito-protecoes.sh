#!/usr/bin/env bash
# Fluxo Lucas — depósito R$ 300 + 2 proteções (saldo incorreto)
#
# Relatório:
#   FIX=0 bash <(curl ...)
# Corrigir (Reembolso → Real do crédito Exchange indevido):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-fluxo-lucas-deposito-protecoes.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
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

OUT="$SCRIPTS_DIR/vps-fluxo-lucas-deposito-protecoes.mjs"
log "baixar fluxo (ref=$REF FIX=$FIX)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-fluxo-lucas-deposito-protecoes.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/scripts/vps-fluxo-lucas-deposito-protecoes.mjs?t=$(date +%s%N)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-fluxo-lucas-deposito-protecoes-v1' "$OUT" || die "script inválido"
chmod 0644 "$OUT"

export FIX
export USER_ID="${USER_ID:-1210f201-1227-48c7-8336-334942dca7d6}"
export EXPECTED_DEPOSIT_CENTS="${EXPECTED_DEPOSIT_CENTS:-30000}"
node "$OUT"
