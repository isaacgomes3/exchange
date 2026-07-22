#!/usr/bin/env bash
# Apresentação dos jogos: coluna Mercado, competição no confronto, cores LAY/BACK
#
# Na VPS (root):
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-mercado-lay-back-ui-723d/scripts/vps-hotfix-jogos-mercado-ui.sh" \
#     -o /tmp/hotfix-jogos-ui.sh
#   bash /tmp/hotfix-jogos-ui.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/jogos-mercado-lay-back-ui-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

curl_retry() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$@"
}

echo "==> assets (ref=$REF)"
for f in v2.css app-proteger.html v2-shell.js; do
  curl_retry "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  $f $(wc -c < "$WEB/$f" | tr -d ' ') bytes"
done

grep -q 'term-col-market' "$WEB/app-proteger.html" || { echo "ERRO: sem coluna mercado"; exit 1; }
grep -q 'term-col-comp' "$WEB/app-proteger.html" || { echo "ERRO: sem coluna competição"; exit 1; }
grep -q 'Competição' "$WEB/app-proteger.html" || { echo "ERRO: sem header Competição"; exit 1; }
grep -q 'term-side.lay' "$WEB/v2.css" || { echo "ERRO: CSS sem .term-side.lay"; exit 1; }
grep -q '#f0b8c8' "$WEB/v2.css" || { echo "ERRO: LAY sem rosa pastel"; exit 1; }
grep -q '#a8c8e8' "$WEB/v2.css" || { echo "ERRO: BACK sem azul pastel"; exit 1; }
grep -q 'jogos-mercado-25' "$WEB/app-proteger.html" || { echo "ERRO: cache bust ausente"; exit 1; }

echo "OK — Ctrl+Shift+R em https://arbishield.app/app-proteger.html"
