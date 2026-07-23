#!/usr/bin/env bash
# Admin: restaurar aprovar/rejeitar em Depósitos (fim do stub USDT read-only)
# e tela Depósitos Desafio com as mesmas ações (crédito em desafio_balance).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-depositos-aprovar.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-REPLACE_SHA}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
NGINX_SRC="deploy/vps-supabase/nginx-arbishield.app.conf"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI — depósitos com Confirmar/Rejeitar + Depósitos Desafio"
for f in admin-manual-deposits.html admin-depositos-desafio.html v2-shell.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q 'Confirmar e Creditar' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits ainda sem botão Confirmar e Creditar"
! grep -q 'ArbiV2Page.mountAdmin' "$WEB/admin-manual-deposits.html" \
  || die "admin-manual-deposits ainda é stub mountAdmin"
grep -q 'Confirmar e Creditar' "$WEB/admin-depositos-desafio.html" \
  || die "admin-depositos-desafio sem Confirmar e Creditar"
grep -q 'deposit_type' "$WEB/admin-depositos-desafio.html" \
  || die "admin-depositos-desafio sem filtro deposit_type"
grep -q 'depositos-desafio' "$WEB/v2-shell.js" \
  || die "v2-shell sem menu Depósitos Desafio"

log "2/3 Shim — approveManualDeposit credita desafio_balance"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'approveManualDeposit' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem approveManualDeposit"
grep -q 'desafio_balance_cents' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desafio_balance_cents"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "3/3 Nginx — rota /admin/depositos-desafio (opcional)"
NGINX_DST=""
for cand in \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield \
  /etc/nginx/sites-enabled/arbishield; do
  if [[ -f "$cand" ]]; then NGINX_DST="$cand"; break; fi
done
if [[ -n "$NGINX_DST" ]]; then
  if ! grep -q 'location = /admin/depositos-desafio' "$NGINX_DST"; then
    if grep -q 'location = /admin/manual-deposits' "$NGINX_DST"; then
      sed -i '/location = \/admin\/manual-deposits/a\    location = /admin/depositos-desafio { return 302 /admin-depositos-desafio.html; }' "$NGINX_DST"
      nginx -t && systemctl reload nginx || true
    fi
  fi
else
  log "nginx conf não encontrada — ignore (HTML em /admin-depositos-desafio.html já basta)"
fi

log "OK — abra /admin-manual-deposits.html (hard refresh) e use Confirmar e Creditar / Rejeitar"
log "Depósitos do app Desafio: /admin-depositos-desafio.html"
