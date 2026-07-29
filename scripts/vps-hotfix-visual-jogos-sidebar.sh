#!/usr/bin/env bash
# Visual unificado: cards de jogos (cliente+ADM) + sidebar ADM = cliente
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/visual-jogos-sidebar-unificado-723d/scripts/vps-hotfix-visual-jogos-sidebar.sh" -o /tmp/hotfix-ui.sh
#   bash /tmp/hotfix-ui.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/visual-jogos-sidebar-unificado-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

echo "==> assets (ref=$REF)"
for f in v2.css v2-shell.js app-proteger.html admin-jogos.html; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  $f $(wc -c < "$WEB/$f" | tr -d ' ') bytes"
done

grep -q '0 14px 34px' "$WEB/v2.css" || { echo "ERRO: v2.css sem sombra dos cards"; exit 1; }
grep -q 'body\[data-shell="admin"\] .v2-sidebar-app' "$WEB/v2.css" || { echo "ERRO: sidebar ADM não unificada"; exit 1; }
grep -q 'v2-sidebar-app' "$WEB/v2-shell.js" || { echo "ERRO: shell sem v2-sidebar-app"; exit 1; }
grep -q 'adminSidebarCollapsed' "$WEB/v2-shell.js" || { echo "ERRO: shell sem collapse ADM"; exit 1; }
grep -q 'box-shadow:' "$WEB/admin-jogos.html" || { echo "ERRO: admin-jogos sem cards"; exit 1; }
grep -q 'term-row' "$WEB/app-proteger.html" || { echo "ERRO: app-proteger sem term-row"; exit 1; }

echo "OK — Ctrl+Shift+R em:"
echo "  https://arbishield.app/app-proteger.html"
echo "  https://arbishield.app/admin-jogos.html"
echo "  (qualquer página ADM para ver a sidebar nova)"
