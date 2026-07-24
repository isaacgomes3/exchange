#!/usr/bin/env bash
# Proteger Aposta: logos ao lado do time + odd bloqueada (readonly).
# Inclui as correções recentes da grade (sem saldo / sem liquidez) para
# evitar que hotfixes antigos sobrescrevam este arquivo e revertam o fix.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-proteger-logos-odd-readonly.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-5d2843cc3f49c86222e2159c89134da067ec41c1}"
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

log "1/2 UI — app-proteger.html (logos + odd readonly + só com liquidez)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "sem odd readonly"
grep -q 'Odd sempre do mercado' "$WEB/app-proteger.html" || die "submit ainda lê odd editável"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "sem logos na lista"
grep -q 'home_logo,away_logo' "$WEB/app-proteger.html" || die "select sem home_logo/away_logo"
grep -q 'liqLeft(m) <= 0' "$WEB/app-proteger.html" || die "regressão: filtro de liquidez"
! grep -q '\["amount", "odd", "balanceType"\]' "$WEB/app-proteger.html" || die "ainda escuta input na odd"

log "2/2 UI — v2.css (logos inline + odd locked)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q '\.term-team-logo' "$WEB/v2.css" || die "css sem .term-team-logo"
grep -q 'term-odd-locked\|#odd\[readonly\]' "$WEB/v2.css" || die "css sem odd locked"
grep -q 'width: max-content' "$WEB/v2.css" || die "css sem logo visitante colada ao texto"

log "OK — Ctrl+F5 em Proteger Aposta. Logos ao lado + odd bloqueada."
echo "  Teste: https://arbishield.app/app-proteger.html"
