#!/usr/bin/env bash
# Hotfix: Minhas Proteções — mostrar dados do evento (não UUID)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/minhas-protecoes-evento-723d/scripts/vps-hotfix-minhas-protecoes-evento.sh?v=1")
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

log "UI Minhas Proteções"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html" -o "$WEB/app-protecoes.html"
chmod 0644 "$WEB/app-protecoes.html"
# Espelho na raiz se existir rota antiga
cp -f "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true

grep -q 'Partida / Mercado' "$WEB/app-protecoes.html" || die "HTML sem coluna Partida / Mercado"
grep -q 'match:matches\|fetchMatchMap' "$WEB/app-protecoes.html" || die "HTML sem join de matches"
grep -q 'Pesquisar partida' "$WEB/app-protecoes.html" || die "HTML sem busca de partida"

echo
echo "OK — Minhas Proteções com dados do evento"
echo "  https://arbishield.app/app-protecoes.html  (Ctrl+F5)"
