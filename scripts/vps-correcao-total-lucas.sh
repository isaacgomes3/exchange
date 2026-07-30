#!/usr/bin/env bash
# Correção TOTAL — Lucas Gonçalves (depósito R$ 300 + 2 ops PERDEU)
#
# Relatório:
#   FIX=0 bash <(curl ...)
# Aplicar:
#   FIX=1 bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-correcao-total-lucas.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
FIX="${FIX:-0}"
mkdir -p "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

fetch() {
  local path="$1" out="$2"
  if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    || [[ ! -s "$out" ]]; then
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      -H "Cache-Control: no-cache" \
      "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  fi
  [[ -s "$out" ]] || die "download vazio: $path"
}

# 1) UI — isFeeUpfront alinhado ao contrato
log "1) hotfix app-protecoes.html"
TMP="$(mktemp)"
fetch "deploy/vps-supabase/static/v2/app-protecoes.html" "$TMP"
if grep -q 'NÃO usar "v2_create_protection\*" genérico' "$TMP" && [[ -d "$WEB_ROOT" ]]; then
  cp -a "$WEB_ROOT/app-protecoes.html" \
    "$WEB_ROOT/app-protecoes.html.bak-correcao-total-lucas-$(date +%s)" 2>/dev/null || true
  cp -f "$TMP" "$WEB_ROOT/app-protecoes.html"
  echo "  OK $WEB_ROOT/app-protecoes.html"
else
  echo "  AVISO: HTML sem fix ou web root ausente — pulando UI"
fi
rm -f "$TMP"

# 2) Correção saldo
log "2) correção total saldo Lucas (FIX=$FIX)"
OUT="$SCRIPTS_DIR/vps-correcao-total-lucas.mjs"
fetch "scripts/vps-correcao-total-lucas.mjs" "$OUT"
grep -q 'vps-correcao-total-lucas-v1' "$OUT" || die "script inválido"
chmod 0644 "$OUT"

export FIX
export USER_ID="${USER_ID:-1210f201-1227-48c7-8336-334942dca7d6}"
export TARGET_APOSTADOR_CENTS="${TARGET_APOSTADOR_CENTS:-30035}"
node "$OUT"

log "concluído FIX=$FIX"
