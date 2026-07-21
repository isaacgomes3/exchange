#!/usr/bin/env bash
# Hotfix: restaurar catálogo de mercados no Lançar Evento Manual
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/restaurar-catalogo-mercados-723d/scripts/vps-hotfix-catalogo-mercados.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/restaurar-catalogo-mercados-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "Catálogo de mercados + Admin Jogos"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/market-catalog.js" -o "$WEB/market-catalog.js"
chmod 0644 "$WEB/market-catalog.js"
cp -f "$WEB/market-catalog.js" "$WEB_ROOT/market-catalog.js"

curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html"

curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
chmod 0644 "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true

grep -q 'Bancar — escolha do catálogo' "$WEB/admin-jogos.html" || \
  grep -q 'escolha do catálogo' "$WEB/admin-jogos.html" || die "HTML sem select do catálogo"
grep -q 'ARBISHIELD_MARKET_CATALOG\|market-catalog.js' "$WEB/admin-jogos.html" || die "HTML sem market-catalog.js"
grep -q 'data-set-type="BACK"' "$WEB/admin-jogos.html" || die "HTML sem botão BACK"
grep -q 'Resultado da Partida\|Lay Casa' "$WEB/market-catalog.js" || die "catálogo incompleto"

echo
echo "OK — catálogo de mercados restaurado"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Em cada mercado: LAY/BACK + select “Bancar — escolha do catálogo…”"
