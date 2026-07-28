#!/usr/bin/env bash
# Gestão de Usuários: todas as carteiras + Acessar Conta (Espelho).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-users-carteiras-espelho-723d/scripts/vps-hotfix-admin-users-carteiras-espelho.sh")
set -euo pipefail

DEFAULT_REF="cursor/admin-users-carteiras-espelho-723d"
FALLBACK_REFS=(
  "9e410d44167375d30e3948cf0f0838a005848873"
  "fcd8d07da04d055024039449800a11cdaaf22af4"
)
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

refs=()
if [[ -n "${ARBISHIELD_REF:-}" ]]; then
  refs+=("$ARBISHIELD_REF")
fi
refs+=("$DEFAULT_REF")
for r in "${FALLBACK_REFS[@]}"; do
  refs+=("$r")
done

dl() {
  local rel="$1"
  local dest="$2"
  local ref url code
  for ref in "${refs[@]}"; do
    url="https://raw.githubusercontent.com/isaacgomes3/exchange/${ref}/${rel}?v=${BUST}"
    code="$(curl -fsSL --retry 3 --retry-all-errors --retry-delay 2 -w "%{http_code}" -o "$dest" "$url" || true)"
    if [[ "$code" == "200" ]] && [[ -s "$dest" ]]; then
      log "  ok $rel (ref ${ref})"
      return 0
    fi
    rm -f "$dest"
    echo "  falha $rel ref=${ref} http=${code:-000} url=${url}" >&2
  done
  die "não foi possível baixar $rel (404 em todos os refs)"
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
