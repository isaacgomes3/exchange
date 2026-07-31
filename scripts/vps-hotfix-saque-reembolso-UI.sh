#!/usr/bin/env bash
# Atualiza UI da carteira (saque Saldo Reembolso + Extrato Reembolso).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saque-reembolso-UI.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}" -o "$out"; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/$rel?$(date +%s)" -o "$out"
}

publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-carteira-ui-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  mkdir -p "$WEB_ROOT" "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || echo "  AVISO: nenhum $name em /var/www (copiado em $WEB_ROOT)"
}

echo "==> UI carteira ($(date -Is))"
log "publicar v2-financeiro.js + app-carteira.html"
publish deploy/vps-supabase/static/v2/v2-financeiro.js
publish deploy/vps-supabase/static/v2/app-carteira.html

grep -q 'finFilterReembolso' "$WEB_ROOT/app-carteira.html" \
  || die "app-carteira.html sem Extrato Reembolso"
grep -q 'finFilterReembolso' "$WEB_ROOT/v2-financeiro.js" \
  || die "v2-financeiro.js sem handler Extrato Reembolso"

echo
echo "OK UI — Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
