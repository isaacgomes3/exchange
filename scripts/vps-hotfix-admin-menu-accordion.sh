#!/usr/bin/env bash
# Publica menu admin em accordion (só seções; clique abre itens).
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-menu-accordion.sh?ref=cursor/admin-menu-accordion-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/admin-menu-accordion-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB"

download() {
  local rel="$1" out="$2"
  local t; t="$(date +%s%N)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 3 "$RAW/$rel?v=$BUST&t=$t" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

echo "==> admin menu accordion ($REF)"
tmp_js="$(mktemp)"
tmp_css="$(mktemp)"
download "deploy/vps-supabase/static/v2/v2-shell.js" "$tmp_js"
download "deploy/vps-supabase/static/v2/v2.css" "$tmp_css"
grep -q 'v2-nav-accordion-btn' "$tmp_js" || die "shell sem accordion"
grep -q 'bindAdminNavAccordion' "$tmp_js" || die "shell sem bindAdminNavAccordion"
grep -q 'v2-nav-group-items' "$tmp_css" || die "css sem accordion"

cp -f "$tmp_js" "$WEB/v2-shell.js"
cp -f "$tmp_css" "$WEB/v2.css"
chmod 0644 "$WEB/v2-shell.js" "$WEB/v2.css"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
rm -f "$tmp_js" "$tmp_css"

# cache-bust nas páginas admin que apontam shell/css
n=0
while IFS= read -r -d '' f; do
  sed -i \
    -e "s|/v2-shell\\.js?v=[^\"']*|/v2-shell.js?v=admin-accordion-$BUST|g" \
    -e "s|/v2-shell\\.js\"|/v2-shell.js?v=admin-accordion-$BUST\"|g" \
    -e "s|/v2\\.css?v=[^\"']*|/v2.css?v=admin-accordion-$BUST|g" \
    -e "s|/v2\\.css\"|/v2.css?v=admin-accordion-$BUST\"|g" \
    "$f" 2>/dev/null || true
  n=$((n + 1))
done < <(find "$WEB" "$WEB_ROOT" -maxdepth 2 -type f -name 'admin*.html' -print0 2>/dev/null || true)

echo "OK — menu accordion publicado ($n HTMLs com bust)"
echo "  Abra qualquer /admin-*.html com Ctrl+Shift+R"
echo "  Visível: Operação · Financeiro · Usuários · Compliance · Conteúdo · Suporte · Sistema · Avançado"
echo "  Clique na seção para expandir os itens"
