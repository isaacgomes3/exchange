#!/usr/bin/env bash
# Hotfix: catálogo de mercados embutido (modo tradicional)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/restaurar-catalogo-mercados-723d/scripts/vps-hotfix-catalogo-mercados.sh?v=2")
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

log "Admin Jogos (catálogo inline + liquidez real/exibida)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html"

curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
chmod 0644 "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true

# Arquivos extras (opcional; HTML já embute o catálogo)
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-market-catalog.js" -o "$WEB/v2-market-catalog.js" 2>/dev/null || true
cp -f "$WEB/v2-market-catalog.js" "$WEB_ROOT/v2-market-catalog.js" 2>/dev/null || true
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/market-catalog.js" -o "$WEB/market-catalog.js" 2>/dev/null || true
cp -f "$WEB/market-catalog.js" "$WEB_ROOT/market-catalog.js" 2>/dev/null || true

grep -q 'ARBISHIELD_MARKET_CATALOG' "$WEB/admin-jogos.html" || die "HTML sem catálogo embutido"
grep -q 'Bancar — escolha do catálogo\|escolha do catálogo' "$WEB/admin-jogos.html" || die "HTML sem select Bancar"
grep -q 'Liquidez exibida' "$WEB/admin-jogos.html" || die "HTML sem Liquidez exibida"
grep -q 'Mais 2.5 gols na partida\|Lay Casa' "$WEB/admin-jogos.html" || die "Catálogo sem opções"

N=$(grep -o 'Lay Casa' "$WEB/admin-jogos.html" | wc -l)
echo "  ok Lay Casa refs=$N"

echo
echo "OK — modo tradicional de mercados"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Nome + catálogo Bancar + Liquidez real + Liquidez exibida"
