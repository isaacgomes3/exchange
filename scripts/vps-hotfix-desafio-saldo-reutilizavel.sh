#!/usr/bin/env bash
# Desafio: retorno da zebra volta ao saldo usável; entradas 2–5 debitam o saldo (sem retenção).
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-saldo-reutilizavel.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/2 Shim — credit zebra no saldo + debitar todas as entradas"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'desafio-saldo-reutilizavel-v1' "$tmp_shim" \
  || die "shim sem marker desafio-saldo-reutilizavel-v1"
grep -q 'debitedFromDesafioBalance' "$tmp_shim" \
  || die "shim sem debit unificado no register"
# Green zebra deve creditar arbishield OU casa (não só casa)
grep -qE 'side === "arbishield" \|\| side === "casa"' "$tmp_shim" \
  || die "shim settle ainda nao credita zebra no saldo usavel"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || \
  pm2 restart serverfn 2>/dev/null || true
fi

log "2/2 UI app-desafio"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_ui"
grep -q 'desafio-saldo-reutilizavel-v1' "$tmp_ui" \
  || die "UI sem marker desafio-saldo-reutilizavel-v1"
cp -f "$tmp_ui" "$WEB/app-desafio.html"
cp -f "$tmp_ui" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html"
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"
  chmod 0644 "$f"
done < <(find /var/www -type f -name "app-desafio.html" -print0 2>/dev/null || true)
rm -f "$tmp_ui"
echo "  OK $WEB/app-desafio.html"

log "OK — green zebra devolve ao saldo Desafio; entradas 2–5 usam saldo usavel"
log "Ctrl+Shift+R em /app-desafio.html · marker: desafio-saldo-reutilizavel-v1"
