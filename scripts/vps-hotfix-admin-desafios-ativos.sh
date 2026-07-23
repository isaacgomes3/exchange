#!/usr/bin/env bash
# Admin Desafios: filtro Ativos só com etapas em aberto (não polui com encerrados).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-desafios-ativos.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-64bdde9}"
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

log "1/1 UI — admin-desafios filtro Ativos limpo"
dl "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

grep -q 'isDesafioActiveOpen' "$WEB/admin-desafios.html" || die "admin-desafios sem filtro Ativos limpo"
grep -q 'data-f="closed"' "$WEB/admin-desafios.html" || die "admin-desafios sem aba Encerrados"
grep -q '__desafioFilter = "active"' "$WEB/admin-desafios.html" || die "admin-desafios não abre em Ativos"

log "OK — hard refresh em /admin-desafios.html (abre em Ativos, sem finalizados)"
