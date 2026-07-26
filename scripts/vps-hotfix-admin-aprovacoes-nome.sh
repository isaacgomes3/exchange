#!/usr/bin/env bash
# Publica nome do cliente + carteira (Apostador/Provedor/Desafio) na Gestão de Aprovações.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/aprovacoes-nome-cliente-8f4a/scripts/vps-hotfix-admin-aprovacoes-nome.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/aprovacoes-nome-cliente-8f4a}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

echo "==> hotfix admin aprovações — nome + carteira ($(date -Is))"

publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-aprovacoes-nome-$(date +%s)" 2>/dev/null || true
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

publish deploy/vps-supabase/static/v2/v2.css
publish deploy/vps-supabase/static/v2/v2-pages.js
publish deploy/vps-supabase/static/v2/admin-approvals.html

html="$(curl -fsS -m 8 "https://arbishield.app/admin-approvals.html" 2>/dev/null || true)"
if echo "$html" | grep -q 'carteiraLabel' && echo "$html" | grep -q 'font-weight: 800' && echo "$html" | grep -q 'user_name", "id"'; then
  echo "  smoke admin-approvals.html → OK (nome antes do id + carteira + negrito)"
else
  echo "  AVISO: admin-approvals.html público ainda desatualizado (cache/path?)"
  echo "$html" | tr '\n' ' ' | head -c 240; echo
fi

echo
echo "OK — Ctrl+Shift+R (hard refresh) em https://arbishield.app/admin-approvals.html"
