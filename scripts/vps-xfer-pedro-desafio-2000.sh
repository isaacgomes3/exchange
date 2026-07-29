#!/usr/bin/env bash
# Transferência Pedro Iuri → Desafio R$ 2.000
#   − R$ 450  Saldo Reembolso
#   − R$ 1.550 Saldo Real (jogador)
#   + R$ 2.000 Desafio
#
# Na VPS (aplica com FIX=1 por padrão):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/xfer-pedro-desafio-2000-9c21/scripts/vps-xfer-pedro-desafio-2000.sh")
# Só relatório:
#   FIX=0 bash <(curl -fsSL "...")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/xfer-pedro-desafio-2000-9c21}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"
mkdir -p "$SCRIPTS_DIR"

FIX="${FIX:-1}"
NAME="${NAME:-PEDRO IURI TEIXEIRA DOS SANTOS}"
ID_PREFIX="${ID_PREFIX:-24037bdf}"
REEMBOLSO_CENTS="${REEMBOLSO_CENTS:-45000}"
REAL_CENTS="${REAL_CENTS:-155000}"
REASON="${REASON:-admin: transferir R$450 reembolso + R$1550 jogador → Desafio (Pedro Iuri)}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-xfer-pedro-desafio-2000.mjs"
log "baixar script (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-xfer-pedro-desafio-2000.mjs?ref=${REF}&t=$(date +%s)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/scripts/vps-xfer-pedro-desafio-2000.mjs?t=$(date +%s)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-xfer-pedro-desafio-2000-v1' "$OUT" || die "script inválido (marker)"
chmod 0644 "$OUT"

if [[ -f "$ROOT/deploy/vps-supabase/.env" ]]; then
  export ENV_FILE="$ROOT/deploy/vps-supabase/.env"
elif [[ -f "$ROOT/.env" ]]; then
  export ENV_FILE="$ROOT/.env"
fi

export FIX NAME ID_PREFIX REEMBOLSO_CENTS REAL_CENTS REASON
log "Pedro Iuri · −R\$450 reembolso −R\$1.550 real → +R\$2.000 desafio  FIX=$FIX"
node "$OUT"
