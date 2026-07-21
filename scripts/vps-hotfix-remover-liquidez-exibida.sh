#!/usr/bin/env bash
# Hotfix: remove Liquidez exibida do Lançar Evento Manual
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/remover-liquidez-exibida-723d/scripts/vps-hotfix-remover-liquidez-exibida.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/remover-liquidez-exibida-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "Admin Jogos (sem Liquidez exibida)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html"
curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
chmod 0644 "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true

grep -q 'Liquidez exibida' "$WEB/admin-jogos.html" && die "HTML ainda tem Liquidez exibida"
grep -q 'Liquidez real' "$WEB/admin-jogos.html" || die "HTML sem Liquidez real"
grep -q 'Bancar\|escolha do catálogo\|ARBISHIELD_MARKET_CATALOG' "$WEB/admin-jogos.html" || die "HTML sem catálogo"

echo
echo "OK — Liquidez exibida removida do lançamento manual"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
