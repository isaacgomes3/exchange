#!/usr/bin/env bash
# Hotfix: Minhas Proteções — dados do evento (layout legado) sem market_category
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/minhas-protecoes-evento-723d/scripts/vps-hotfix-minhas-protecoes-evento.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/minhas-protecoes-evento-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Gestão de Proteções + painel Detalhes"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html" -o "$WEB/app-protecoes.html"
chmod 0644 "$WEB/app-protecoes.html"
cp -f "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true

grep -q 'Gestão de' "$WEB/app-protecoes.html" || die "HTML sem título Gestão de Proteções"
grep -q 'Protocolo de Auditoria' "$WEB/app-protecoes.html" || die "HTML sem painel Detalhes"
grep -q 'openDetail\|renderDetail' "$WEB/app-protecoes.html" || die "HTML sem openDetail"
grep -q 'Partida / Mercado' "$WEB/app-protecoes.html" || die "HTML sem coluna Partida / Mercado"
grep -q 'Pesquisar partida' "$WEB/app-protecoes.html" || die "HTML sem busca de partida"
if grep -q 'market_category' "$WEB/app-protecoes.html"; then
  die "HTML ainda referencia market_category"
fi

echo
echo "OK — Gestão de Proteções com Detalhes (Protocolo de Auditoria)"
echo "  https://arbishield.app/app-protecoes.html  (Ctrl+F5)"
