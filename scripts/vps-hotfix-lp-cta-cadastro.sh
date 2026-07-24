#!/usr/bin/env bash
# Landing: CTA "Criar conta gratuitamente" → /cadastro.html
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-lp-cta-cadastro.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-6c0d50aeb37c1cf7d13970ee486119244926e7b9}"
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

log "1/3 UI — index.html (CTA → /cadastro.html)"
dl "deploy/vps-supabase/static/v2/index.html" "$WEB/index.html"
chmod 0644 "$WEB/index.html"
cp -f "$WEB/index.html" "$WEB_ROOT/index.html"
grep -q 'Criar conta gratuitamente' "$WEB/index.html" || die "CTA não encontrado"
grep -q 'href="/cadastro.html"' "$WEB/index.html" || die "CTA sem /cadastro.html"

log "2/3 UI — cadastro.html"
dl "deploy/vps-supabase/static/v2/cadastro.html" "$WEB/cadastro.html"
chmod 0644 "$WEB/cadastro.html"
cp -f "$WEB/cadastro.html" "$WEB_ROOT/cadastro.html"
grep -q 'id="fullName"' "$WEB/cadastro.html" || die "cadastro.html sem nome"

log "3/3 UI — auth.html (redirect signup → cadastro)"
dl "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html"

log "OK — CTA vai para /cadastro.html. Hard refresh na home."
