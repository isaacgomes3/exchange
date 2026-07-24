#!/usr/bin/env bash
# Gestão de Usuários: todas as carteiras + Acessar Conta (Espelho).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-users-carteiras-espelho.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-REPLACE_SHA}"
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

log "1/1 UI — admin-users + v2.js + v2-shell + v2-financeiro"
for f in admin-users.html v2.js v2-shell.js v2-financeiro.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q 'Acessar Conta (Espelho)' "$WEB/admin-users.html" || die "admin-users sem Espelho"
grep -q 'desafio_balance_cents' "$WEB/admin-users.html" || die "admin-users sem desafio"
grep -q 'investor_balance_cents' "$WEB/admin-users.html" || die "admin-users sem provedor"
grep -q 'setImpersonation' "$WEB/v2.js" || die "v2.js sem setImpersonation"
grep -q 'getEffectiveUserId' "$WEB/v2.js" || die "v2.js sem getEffectiveUserId"
grep -q 'v2ImpersonateBanner\|getEffectiveUserId' "$WEB/v2-shell.js" || die "v2-shell sem espelho"
grep -q 'getEffectiveUserId' "$WEB/v2-financeiro.js" || die "v2-financeiro sem espelho"

log "OK — carteiras + espelho. Hard refresh em /admin-users.html"
