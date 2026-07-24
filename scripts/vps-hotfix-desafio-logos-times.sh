#!/usr/bin/env bash
# Logos dos times no Desafio: card + busca + auto-preenchimento ao salvar.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-logos-times.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-20996e7426e4720b98f6411c584638000b0b9fc2}"
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

log "1/3 UI — app-desafio.html (resolve logo por nome do time)"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
grep -q 'resolveTeamLogo' "$WEB/app-desafio.html" || die "app-desafio sem resolveTeamLogo"

log "2/3 UI — v2.js (busca com variantes Odense→Odense BK)"
dl "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'resolveFootballTeamLogo' "$WEB/v2.js" || die "v2.js sem resolveFootballTeamLogo"
grep -q 'Odense BK\|" BK"' "$WEB/v2.js" || die "v2.js sem variantes BK"

log "3/3 UI — admin-desafios.html (preenche logo ao salvar)"
dl "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
grep -q 'fillMissingStepLogos' "$WEB/admin-desafios.html" || die "admin-desafios sem fillMissingStepLogos"

log "OK — logos: hard refresh no Desafio e no Admin. Vejle×Odense já backfilled no DB."
echo "  Teste: https://arbishield.app/app-desafio.html"
