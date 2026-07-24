#!/usr/bin/env bash
# Lançar Evento Manual: remove seletor Tipo; mercado só com autocomplete
# (LAY/BACK inferido pelo nome, igual Lançar Desafio).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-evento-manual-sem-tipo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-3ddfb24d3855b2d1d82efe5fd514f5d1732f9b92}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/1 UI — admin-jogos (mercado sem seletor Tipo)"
dl "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

grep -q 'inferMarketType' "$WEB/admin-jogos.html" || die "admin-jogos sem inferMarketType"
grep -q 'bindMarketNamePicker\|market-suggest' "$WEB/admin-jogos.html" || die "admin-jogos sem autocomplete"
grep -q 'Digite para sugerir' "$WEB/admin-jogos.html" || die "admin-jogos sem placeholder de autocomplete"
# Seletor Tipo removido do card de mercado
if grep -q 'data-f="market_type"' "$WEB/admin-jogos.html"; then
  die "admin-jogos ainda tem seletor market_type no DOM"
fi

log "OK — Evento Manual alinhado ao Desafio (só autocomplete). Hard refresh (Ctrl+Shift+R)."
