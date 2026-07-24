#!/usr/bin/env bash
# Proteger Aposta: no mobile mostra mercado + todas as infos do evento.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-proteger-mobile-mercado.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-07fc278ceffebbc02c27e40c7a2e58ceac32dc5c}"
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

log "1/2 UI — v2.css (card mobile com mercado)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'content: "Mercado"' "$WEB/v2.css" || die "css sem label Mercado no mobile"
grep -q 'max-width: 960px' "$WEB/v2.css" || die "css sem breakpoint 960px do card"
grep -q 'term-col-market' "$WEB/v2.css" || die "css sem term-col-market"

log "2/2 UI — app-proteger.html (cache-bust CSS)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'proteger-mobile-mercado' "$WEB/app-proteger.html" || die "proteger sem cache-bust mobile"
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "regressão: odd readonly"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "regressão: logos"
grep -q 'liqLeft(m) <= 0' "$WEB/app-proteger.html" || die "regressão: filtro liquidez"

log "OK — Ctrl+F5 em Proteger (mobile). Mercado e liquidez devem aparecer no card."
echo "  Teste: https://arbishield.app/app-proteger.html"
