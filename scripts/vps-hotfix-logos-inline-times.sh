#!/usr/bin/env bash
# Logos em linha ao lado do nome do time (Proteger + Desafio),
# tamanho proporcional à fonte (não empilhadas/gigantes).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-logos-inline-times.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-75d58e956828751564e6ee16a759d9900ffcc734}"
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

log "1/1 UI — v2.css + app-proteger + app-desafio (logos inline)"
for f in v2.css app-proteger.html app-desafio.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q '\.term-match-teams' "$WEB/v2.css" || die "v2.css sem .term-match-teams"
grep -q '\.term-team-logo' "$WEB/v2.css" || die "v2.css sem .term-team-logo"
grep -q 'flex-direction: row' "$WEB/v2.css" || die "v2.css sem logos em row"
grep -q 'max-width: 26px' "$WEB/v2.css" || die "v2.css sem logo proporcional desafio"
grep -q 'width="26"' "$WEB/app-desafio.html" || die "app-desafio ainda com logo 72px"
grep -q 'term-team-logo' "$WEB/app-proteger.html" || die "app-proteger sem term-team-logo"

log "OK — logos ao lado do nome. Hard refresh (Ctrl+Shift+R)."
