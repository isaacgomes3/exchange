#!/usr/bin/env bash
# Responsivo global: shell mobile (cliente+ADM) + grids/tabelas/KPIs
#
# Na VPS (root):
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/responsivo-cliente-adm-723d/scripts/vps-hotfix-responsivo.sh" \
#     -o /tmp/hotfix-resp.sh
#   bash /tmp/hotfix-resp.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/responsivo-cliente-adm-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

curl_retry() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$@"
}

echo "==> assets responsivo (ref=$REF)"
FILES=(
  v2.css
  v2-shell.js
  admin.html
  admin-jogos.html
  admin-monitoring-protections.html
  app-proteger.html
  app-protecoes.html
  app-perfil.html
)
for f in "${FILES[@]}"; do
  curl_retry "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  $f $(wc -c < "$WEB/$f" | tr -d ' ') bytes"
done

grep -q 'Sistema responsivo' "$WEB/v2.css" || { echo "ERRO: v2.css sem bloco responsivo"; exit 1; }
grep -q 'v2-app-balances-bar' "$WEB/v2.css" || { echo "ERRO: CSS sem balances-bar"; exit 1; }
grep -q 'v2-app-balances-bar' "$WEB/v2-shell.js" || { echo "ERRO: shell sem balances-bar"; exit 1; }
grep -q 'repeat(4, minmax(0, 1fr))' "$WEB/v2.css" || { echo "ERRO: saldos mobile sem 4 colunas"; exit 1; }
grep -q 'isMobileShell' "$WEB/v2-shell.js" || { echo "ERRO: shell sem close mobile"; exit 1; }
grep -q 'tpl-stat-row-4' "$WEB/admin.html" || { echo "ERRO: admin.html sem tpl-stat-row-4"; exit 1; }
grep -q 'minmax(min(100%' "$WEB/admin-jogos.html" || { echo "ERRO: admin-jogos sem runners responsivos"; exit 1; }

echo "OK — Ctrl+Shift+R em páginas cliente e ADM"
echo "  Teste mobile: menu hamburger, tabelas com scroll, KPIs empilhando"
