#!/usr/bin/env bash
# Evento Manual: restaura campo "Link da casa de aposta" (external_bet_link).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-evento-manual-link-casa.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-PLACEHOLDER_SHA}"
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

log "1/1 UI — admin-jogos.html (Link da casa de aposta)"
dl "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'id="manBetLink"' "$WEB/admin-jogos.html" || die "sem campo manBetLink"
grep -q 'Link da casa de aposta' "$WEB/admin-jogos.html" || die "sem label Link da casa"
grep -q 'manBetLink.*value.trim\|external_bet_link:.*manBetLink' "$WEB/admin-jogos.html" \
  || die "save não envia external_bet_link do campo"

log "OK — Ctrl+F5 em Gestão de Jogos → Lançar evento manual."
echo "  Teste: https://arbishield.app/admin-jogos.html"
