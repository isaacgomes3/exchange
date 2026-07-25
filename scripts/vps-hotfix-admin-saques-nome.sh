#!/usr/bin/env bash
# Publica nome do cliente/usuário em Saques, Transações e Reembolsos.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-admin-saques-nome.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

echo "==> hotfix admin — nome do cliente (saques + transações + reembolsos) ($(date -Is))"

publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-admin-nome-$(date +%s)" 2>/dev/null || true
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

publish deploy/vps-supabase/static/v2/v2-pages.js
publish deploy/vps-supabase/static/v2/admin-saques.html
publish deploy/vps-supabase/static/v2/admin-transactions.html
publish deploy/vps-supabase/static/v2/admin-refunds.html

if curl -fsS -m 8 "https://arbishield.app/v2-pages.js" 2>/dev/null | grep -q 'enrichUserNames'; then
  echo "  smoke v2-pages.js → OK"
else
  echo "  AVISO: v2-pages.js público ainda sem enrichUserNames (cache/path?)"
fi

echo
echo "OK — Ctrl+Shift+R em:"
echo "  https://arbishield.app/admin-saques.html"
echo "  https://arbishield.app/admin-transactions.html"
echo "  https://arbishield.app/admin-refunds.html"
