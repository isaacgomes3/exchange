#!/usr/bin/env bash
# Estorno + hotfix UI — Lucas PERDEU creditou Saldo Reembolso indevido
#
# Na VPS (root) — só relatório:
#   FIX=0 bash <(curl ...)
# Aplicar estorno R$ 149 + republic UI:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-estorno-reembolso-lucas-perdeu.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
FIX="${FIX:-1}"
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

# 1) UI hotfix — isFeeUpfront alinhado ao contrato
log "1) hotfix app-protecoes.html (isFeeUpfront)"
TMP="$(mktemp)"
fetch "deploy/vps-supabase/static/v2/app-protecoes.html" "$TMP"
grep -q 'NÃO usar "v2_create_protection\*" genérico' "$TMP" \
  || die "HTML sem marcador do fix isFeeUpfront"
if [[ -d "$WEB_ROOT" ]]; then
  cp -a "$WEB_ROOT/app-protecoes.html" \
    "$WEB_ROOT/app-protecoes.html.bak-lucas-reembolso-$(date +%s)" 2>/dev/null || true
  cp -f "$TMP" "$WEB_ROOT/app-protecoes.html"
  # cache-bust leve se a página referenciar ?v=
  echo "  OK $WEB_ROOT/app-protecoes.html"
else
  echo "  AVISO: $WEB_ROOT ausente — pulei UI"
fi
rm -f "$TMP"

# 2) Estorno
log "2) estorno Saldo Reembolso Lucas"
OUT="$SCRIPTS_DIR/vps-estorno-reembolso-lucas-perdeu.mjs"
fetch "scripts/vps-estorno-reembolso-lucas-perdeu.mjs" "$OUT"
grep -q 'vps-estorno-reembolso-lucas-perdeu-v1' "$OUT" || die "script inválido"
chmod 0644 "$OUT"
export FIX
node "$OUT"

log "concluído FIX=$FIX"
