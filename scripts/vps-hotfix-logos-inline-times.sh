#!/usr/bin/env bash
# Logos em linha (proporcionais) só em:
#   - Admin Jogos (lista)
#   - Proteger Aposta (usuário)
# Card Desafio permanece com logos grandes empilhadas (layout original).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-logos-inline-times.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-a2136b2339d079e82e6b64c0882ab53546cdcaf7}"
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

log "1/1 UI — v2.css + proteger + desafio (revertido) + admin-jogos"
for f in v2.css app-proteger.html app-desafio.html admin-jogos.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q '\.term-match-teams' "$WEB/v2.css" || die "v2.css sem .term-match-teams (Proteger)"
grep -q '\.term-team-logo' "$WEB/v2.css" || die "v2.css sem .term-team-logo (Proteger)"
grep -q 'flex-direction: column' "$WEB/v2.css" || die "v2.css sem column no Desafio"
grep -q 'width: 72px' "$WEB/v2.css" || die "v2.css sem logo 72px no Desafio"
grep -q 'width="72"' "$WEB/app-desafio.html" || die "app-desafio não restaurado para 72px"
grep -q 'row-teams-with-logos' "$WEB/admin-jogos.html" || die "admin-jogos sem logos inline"
grep -q 'width: 22px' "$WEB/admin-jogos.html" || die "admin-jogos sem tamanho proporcional das logos"

log "OK — Desafio original; Proteger + Admin Jogos com logos em linha. Hard refresh."
