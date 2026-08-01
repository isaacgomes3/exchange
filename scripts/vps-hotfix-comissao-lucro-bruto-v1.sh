#!/usr/bin/env bash
# Hotfix UI: comissão Exchange = 4,5% do lucro bruto (rótulos claros).
# Marker: proteger-comissao-lucro-bruto-v1
#
# O valor R$225 em LAY@1,10 / resp. R$500 está CORRETO:
#   lucro bruto = resp/(odd−1) = 5.000 → 4,5% = 225
#   fatia 1,5% = 7,50 (da cobertura R$500) — base diferente
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-comissao-lucro-bruto-v1.sh?$(date +%s)" -o /tmp/hf-comissao.sh
#   bash /tmp/hf-comissao.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
STATIC="${ARBISHIELD_STATIC:-/opt/arbishield/deploy/vps-supabase/static/v2}"
MARKER="proteger-comissao-lucro-bruto-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$STATIC"

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

install() {
  local rel="$1" dest="$2" mark="${3:-$MARKER}"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$mark" "$tmp" || die "sem marker $mark em $rel"
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  rm -f "$tmp"
  log "OK $dest"
}

log "1) preview Proteger — lucro bruto + comissão 4,5%"
install "deploy/vps-supabase/static/v2/app-proteger.html" "$STATIC/app-proteger.html"
install "deploy/vps-supabase/static/v2/proteger-preview-fix.js" "$STATIC/proteger-preview-fix.js" "4,5% do lucro bruto"

log "2) bilhete / extrato"
install "deploy/vps-supabase/static/v2/app-protecoes.html" "$STATIC/app-protecoes.html"
install "deploy/vps-supabase/static/v2/v2-pages.js" "$STATIC/v2-pages.js" "4,5% do lucro bruto"

echo
echo "OK — rótulos: Comissão = 4,5% do lucro bruto (não da fatia 1,5%)."
echo "Hard refresh Ctrl+Shift+R em /proteger e /protecoes."
