#!/usr/bin/env bash
# Crédito Saldo Reembolso — DIEGO HENRIQUE BARBOSA DOS SANTOS — R$ 250
#
#   bash <(curl -fsSL ".../scripts/vps-credito-reembolso-diego.sh")
#   (aplica com FIX=1 por padrão)
#   FIX=0 bash ...   # só relatório
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-1}"
AMOUNT_CENTS="${AMOUNT_CENTS:-25000}"
NAME="${NAME:-DIEGO HENRIQUE BARBOSA DOS SANTOS}"
REASON="${REASON:-crédito manual Saldo Reembolso (admin)}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-credito-reembolso-diego.mjs"
log "baixar script (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-credito-reembolso-diego.mjs?ref=${REF}&t=$(date +%s)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/scripts/vps-credito-reembolso-diego.mjs?t=$(date +%s)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-credito-reembolso-diego-v1' "$OUT" || die "script inválido (marker)"
chmod 0644 "$OUT"

# NÃO usar `source` no .env — tem linhas inválidas p/ bash (ex.: "Organization ...").
# O .mjs já faz parse seguro KEY=VALUE.
if [[ -f "$ROOT/deploy/vps-supabase/.env" ]]; then
  export ENV_FILE="$ROOT/deploy/vps-supabase/.env"
elif [[ -f "$ROOT/.env" ]]; then
  export ENV_FILE="$ROOT/.env"
fi

export FIX AMOUNT_CENTS NAME REASON
log "aplicar crédito Saldo Reembolso ($NAME · R$ $(awk "BEGIN{printf \"%.2f\", $AMOUNT_CENTS/100}")) FIX=$FIX"
node "$OUT"
