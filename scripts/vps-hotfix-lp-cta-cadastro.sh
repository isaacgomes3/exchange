#!/usr/bin/env bash
# Landing: CTA "Criar conta gratuitamente" → /auth.html?mode=signup
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-lp-cta-cadastro.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-11a87db5ea7fb6e1615724f986de5defda44f191}"
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

log "1/1 UI — index.html (CTA cadastro)"
dl "deploy/vps-supabase/static/v2/index.html" "$WEB/index.html"
chmod 0644 "$WEB/index.html"
cp -f "$WEB/index.html" "$WEB_ROOT/index.html"

grep -q 'Criar conta gratuitamente' "$WEB/index.html" || die "CTA não encontrado"
grep -q 'href="/auth.html?mode=signup"' "$WEB/index.html" || die "CTA sem mode=signup"
# garante que o botão grande aponta para signup (não só o do header)
grep -q 'lp-btn-lg" href="/auth.html?mode=signup"' "$WEB/index.html" \
  || grep -q 'lp-btn-solid lp-btn-lg" href="/auth.html?mode=signup"' "$WEB/index.html" \
  || die "botão grande ainda sem mode=signup"

log "OK — CTA vai para cadastro. Hard refresh na home."
