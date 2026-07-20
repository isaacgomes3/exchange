#!/usr/bin/env bash
# Cutover: domínio principal = v2 · SPA antigo = legado.arbishield.app
#
# Pré-requisito DNS:
#   A  legado  →  mesmo IP de arbishield.app
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-cutover-main-v2.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
LEGADO_HOST="${LEGADO_HOST:-legado.arbishield.app}"
NGINX_MAIN="${NGINX_MAIN:-}"
NGINX_LEGADO="${NGINX_LEGADO:-/etc/nginx/conf.d/legado.arbishield.app.conf}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need nginx
need python3

mkdir -p "$WEB/v2"

log "1/5 — publicar HTML v2 em $WEB/v2"
FILES=(
  index.html auth.html app.html em-breve.html
  admin.html admin-users.html admin-jogos.html admin-desafios.html
  admin-academia.html admin-affiliates.html admin-approvals.html admin-banners.html
  admin-betting-houses.html admin-blacklist.html admin-communication-lab.html
  admin-contestations.html admin-desafio-sugestoes.html admin-expenses.html
  admin-geo.html admin-investigation.html admin-logs.html admin-manual-deposits.html
  admin-marketing-team.html admin-monitoring-protections.html admin-monitoring.html
  admin-onboarding.html admin-partners-distribution.html admin-partners.html
  admin-performance.html admin-permissoes.html admin-proofs.html admin-refunds.html
  admin-risk.html admin-saques.html admin-settings.html admin-settlements-audit.html
  admin-siem.html admin-signup-attempts.html admin-support-ai.html admin-support.html
  admin-technical-audit.html admin-transactions.html admin-treasury.html admin-whatsapp.html
  app-afiliados.html app-baixar-app.html app-carteira.html app-config.html
  app-desafio.html app-partners.html app-perfil.html app-protecoes.html
  app-proteger.html app-suporte.html
  v2.css v2.js v2-shell.js v2-pages.js
  brand/logo.png brand/logo@2x.png brand/icon.png brand/icon-64.png brand/icon-128.png
  brand/favicon-192.png brand/favicon-512.png
  brand/stadium-hero.jpg brand/stadium-hero-sm.jpg brand/dashboard-preview.jpg
)
for f in "${FILES[@]}"; do
  mkdir -p "$WEB/v2/$(dirname "$f")"
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/v2/$f"
  chmod 0644 "$WEB/v2/$f"
done
echo "  ${#FILES[@]} ficheiros ok"
test -f "$WEB/v2/index.html" || die "index.html v2 em falta"
test -f "$WEB/v2/admin.html" || die "admin.html em falta"
test -f "$WEB/v2/v2-shell.js" || die "v2-shell.js em falta"
test -f "$WEB/v2/brand/logo.png" || die "brand/logo.png em falta"
test -f "$WEB/v2/brand/stadium-hero-sm.jpg" || die "brand/stadium-hero-sm.jpg em falta"

find_main_nginx() {
  local c
  for c in \
    "${NGINX_MAIN:-}" \
    /etc/nginx/conf.d/arbishield-cutover.conf \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield
  do
    [[ -n "$c" && -f "$c" ]] || continue
    echo "$c"
    return 0
  done
  c="$(grep -RslE 'server_name[[:space:]].*arbishield\.app' /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null | head -n1 || true)"
  [[ -n "$c" && -f "$c" ]] && echo "$c" && return 0
  return 1
}

log "2/5 — instalar nginx principal (v2 na raiz)"
NGINX_MAIN="$(find_main_nginx || true)"
[[ -n "${NGINX_MAIN:-}" && -f "$NGINX_MAIN" ]] || die "nginx principal não encontrado — defina NGINX_MAIN="
cp -a "$NGINX_MAIN" "$NGINX_MAIN.bak-cutover-$(date +%Y%m%d%H%M%S)"
curl -fsSL "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" -o "$NGINX_MAIN"
echo "  main → $NGINX_MAIN"

log "3/5 — instalar nginx do subdomínio $LEGADO_HOST"
curl -fsSL "$RAW/deploy/vps-supabase/nginx-legado.arbishield.app.conf" -o "$NGINX_LEGADO"
# permite trocar o hostname se LEGADO_HOST != legado.arbishield.app
if [[ "$LEGADO_HOST" != "legado.arbishield.app" ]]; then
  sed -i "s/legado\.arbishield\.app/$LEGADO_HOST/g" "$NGINX_LEGADO"
fi
echo "  legado → $NGINX_LEGADO"

log "4/5 — certificado TLS do subdomínio"
if [[ ! -f "/etc/letsencrypt/live/$LEGADO_HOST/fullchain.pem" ]]; then
  log "cert ainda não existe — tentando certbot (DNS A $LEGADO_HOST tem de apontar para esta VPS)"
  if command -v certbot >/dev/null; then
    # conf temporária HTTP-only para ACME se SSL conf falhar no nginx -t
    if ! nginx -t 2>/tmp/nginx-t.err; then
      log "nginx -t falhou (provável SSL legado) — publicando conf HTTP temporária"
      cat > "$NGINX_LEGADO" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $LEGADO_HOST;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/arbishield;
        default_type "text/plain";
    }
    location / { return 200 'legado ACME pending\n'; add_header Content-Type text/plain; }
}
EOF
      nginx -t
      systemctl reload nginx
    fi
    certbot certonly --webroot -w /var/www/arbishield \
      -d "$LEGADO_HOST" \
      --non-interactive --agree-tos \
      --register-unsafely-without-email \
      || log "AVISO: certbot falhou — confira DNS A de $LEGADO_HOST e rode certbot depois"
    # reinstala conf SSL completa
    curl -fsSL "$RAW/deploy/vps-supabase/nginx-legado.arbishield.app.conf" -o "$NGINX_LEGADO"
    if [[ "$LEGADO_HOST" != "legado.arbishield.app" ]]; then
      sed -i "s/legado\.arbishield\.app/$LEGADO_HOST/g" "$NGINX_LEGADO"
    fi
  else
    log "AVISO: certbot não instalado — instale e emita o cert de $LEGADO_HOST"
  fi
fi

if [[ ! -f "/etc/letsencrypt/live/$LEGADO_HOST/fullchain.pem" ]]; then
  log "AVISO: sem cert de $LEGADO_HOST — usando temporariamente o cert de arbishield.app (aviso no browser até emitir o certo)"
  python3 - "$NGINX_LEGADO" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
t = t.replace(
    "/etc/letsencrypt/live/legado.arbishield.app/fullchain.pem",
    "/etc/letsencrypt/live/arbishield.app/fullchain.pem",
).replace(
    "/etc/letsencrypt/live/legado.arbishield.app/privkey.pem",
    "/etc/letsencrypt/live/arbishield.app/privkey.pem",
)
# generic host replace already done; also fix if custom host left broken paths
import re
t = re.sub(
    r"/etc/letsencrypt/live/[^/]+/fullchain\.pem",
    "/etc/letsencrypt/live/arbishield.app/fullchain.pem",
    t,
    count=2,
)
t = re.sub(
    r"/etc/letsencrypt/live/[^/]+/privkey\.pem",
    "/etc/letsencrypt/live/arbishield.app/privkey.pem",
    t,
    count=2,
)
p.write_text(t, encoding="utf-8")
print("fallback cert arbishield.app aplicado em", p)
PY
fi

log "5/5 — nginx -t && reload"
nginx -t
systemctl reload nginx

echo
echo "==== verificação ===="
echo -n "principal / → "; curl -sS -o /tmp/main.html -w "%{http_code}" https://127.0.0.1/ -H "Host: arbishield.app" --insecure || true
echo
grep -Eiq 'ArbiShield|Sistema novo|isolado' /tmp/main.html && echo "OK principal serve v2" || echo "AVISO: confira HTML principal"
echo -n "legado / → "; curl -sS -o /tmp/leg.html -w "%{http_code}" "https://127.0.0.1/" -H "Host: $LEGADO_HOST" --insecure || true
echo
head -c 120 /tmp/leg.html; echo

echo
echo "OK — cutover aplicado"
echo "  Novo (principal): https://arbishield.app/"
echo "  Antigo (SPA):     https://$LEGADO_HOST/"
echo
echo "DNS necessário:"
echo "  A  legado  →  $(curl -fsS ifconfig.me 2>/dev/null || curl -fsS icanhazip.com 2>/dev/null || echo 'IP_DA_VPS')"
echo
echo "Se o cert do legado falhou:"
echo "  certbot --nginx -d $LEGADO_HOST"
