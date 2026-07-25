#!/usr/bin/env bash
# Hotfix: afiliados — código + cadastro com ?ref= (paridade legado)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-afiliados-ref-cadastro-723d/scripts/vps-hotfix-afiliados-ref.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-afiliados-ref-cadastro-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR"

log "Shim :3101 (ensure + apply-referral)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'applyReferralCode\|afiliados-ref-cadastro-v1\|is_affiliate: true' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || \
  die "shim sem apply-referral / is_affiliate"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Auth (signup + ref) + Afiliados UI"
for f in auth.html app-afiliados.html v2-afiliados.js index.html; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

# auth-vps (legado /auth) redireciona signup/ref → auth.html
curl -fsSL "$RAW/deploy/vps-supabase/static/auth-vps.html" -o "$WEB_ROOT/auth-vps.html"
chmod 0644 "$WEB_ROOT/auth-vps.html"
cp -f "$WEB_ROOT/auth-vps.html" "$WEB/auth-vps.html" 2>/dev/null || true

# nginx: preservar ?ref= no redirect /auth → /auth.html
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done
if [[ -n "$NGINX_CONF" ]] && grep -q 'location = /auth' "$NGINX_CONF"; then
  if grep -q 'return 302 /auth.html;' "$NGINX_CONF" && ! grep -q 'auth.html\$is_args\$args' "$NGINX_CONF"; then
    log "Ajustar nginx para preservar query em /auth"
    sed -i 's|return 302 /auth.html;|return 302 /auth.html$is_args$args;|g' "$NGINX_CONF" || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
  fi
fi

grep -q 'mode=signup\|apply-referral\|Criar conta' "$WEB/auth.html" || die "auth.html sem signup"
grep -q '/auth?ref=' "$WEB/v2-afiliados.js" || die "link de afiliado sem /auth?ref="
grep -q 'parseFloat\|replace(",", ".")' "$WEB/v2-afiliados.js" || die "saque sem parse em reais"

echo
echo "OK — Afiliados: código + cadastro com indicação"
echo "  Gerar código: /app-afiliados.html → Gerar meu link"
echo "  Link: https://arbishield.app/auth?ref=CODIGO"
echo "  Cadastro: https://arbishield.app/auth.html?mode=signup&ref=CODIGO"
echo "  Ctrl+F5 nas páginas"
