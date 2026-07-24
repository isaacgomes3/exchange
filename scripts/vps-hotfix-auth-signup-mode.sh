#!/usr/bin/env bash
# Publica auth.html completo (abas Entrar / Criar conta + ?mode=signup).
# Em produção havia uma versão só-login que ignorava mode=signup.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-auth-signup-mode.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-41701e66e31b6cf37a93ff9890b13814e72dfabc}"
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

log "1/2 UI — auth.html (cadastro + mode=signup)"
dl "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html"

grep -q 'data-mode="signup"' "$WEB/auth.html" || die "auth.html sem aba Criar conta"
grep -q 'mode === "signup"' "$WEB/auth.html" || die "auth.html sem suporte a mode=signup"
grep -q 'Criar conta' "$WEB/auth.html" || die "auth.html sem texto Criar conta"

log "2/2 UI — index.html (CTA → ?mode=signup)"
dl "deploy/vps-supabase/static/v2/index.html" "$WEB/index.html"
chmod 0644 "$WEB/index.html"
cp -f "$WEB/index.html" "$WEB_ROOT/index.html"
grep -q 'href="/auth.html?mode=signup"' "$WEB/index.html" || die "CTA sem mode=signup"

log "OK — /auth.html?mode=signup abre o formulário de cadastro. Hard refresh (Ctrl+F5)."
echo "  Teste: https://arbishield.app/auth.html?mode=signup"
