#!/usr/bin/env bash
# Habilita subdomínio botshield.arbishield.app (painel isolado).
#
# Pré-requisitos:
#   - DNS A botshield → IP da VPS
#   - nginx + certbot
#
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-enable-botshield.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-painel-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"
NGINX_AVAIL="${NGINX_AVAIL:-/etc/nginx/sites-available/botshield.arbishield.app}"
NGINX_EN="${NGINX_EN:-/etc/nginx/sites-enabled/botshield.arbishield.app}"
CONF_D="${NGINX_CONFD:-/etc/nginx/conf.d/botshield.arbishield.app.conf}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need nginx

fetch() {
  local path="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]]
}

echo "==> vps-enable-botshield.sh ($(date -Is)) ref=$REF"

log "1/4 publicar UI em $WEB_ROOT"
mkdir -p "$WEB_ROOT"
tmpd="$(mktemp -d)"
for f in \
  index.html auth.html bots.html criar.html modelos.html ordens.html integracoes.html \
  conta-betbra.html botshield.css botshield.js botshield-shell.js; do
  fetch "deploy/vps-supabase/static/botshield/$f" "$tmpd/$f" || die "falha $f"
  cp -f "$tmpd/$f" "$WEB_ROOT/$f"
  chmod 0644 "$WEB_ROOT/$f"
  echo "  OK $f"
done
rm -rf "$tmpd"
grep -q 'botshield' "$WEB_ROOT/bots.html" || die "bots.html inválido"
grep -q 'sb-botshield-auth-token' "$WEB_ROOT/botshield.js" || die "storage key ausente"

log "2/4 nginx conf"
HAS_CERT=0
[[ -f /etc/letsencrypt/live/botshield.arbishield.app/fullchain.pem ]] && HAS_CERT=1
tmpc="$(mktemp)"
if [[ "$HAS_CERT" -eq 1 ]]; then
  fetch "deploy/vps-supabase/nginx-botshield.arbishield.app.conf" "$tmpc" || die "nginx ssl conf"
else
  fetch "deploy/vps-supabase/nginx-botshield.arbishield.app.http-only.conf" "$tmpc" \
    || die "nginx http conf"
fi
if [[ -d /etc/nginx/sites-available ]]; then
  cp -f "$tmpc" "$NGINX_AVAIL"
  ln -sfn "$NGINX_AVAIL" "$NGINX_EN"
  echo "  OK $NGINX_EN (ssl=$HAS_CERT)"
else
  cp -f "$tmpc" "$CONF_D"
  echo "  OK $CONF_D (ssl=$HAS_CERT)"
fi
rm -f "$tmpc"

log "3/4 certbot (se necessário)"
if [[ "$HAS_CERT" -eq 0 ]]; then
  nginx -t && (systemctl reload nginx || service nginx reload) || true
  if command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d botshield.arbishield.app --non-interactive --agree-tos \
      --register-unsafely-without-email || \
      certbot certonly --webroot -w /var/www/arbishield -d botshield.arbishield.app \
        --non-interactive --agree-tos --register-unsafely-without-email || \
      echo "  AVISO: certbot falhou — confira DNS A botshield e rode de novo"
    if [[ -f /etc/letsencrypt/live/botshield.arbishield.app/fullchain.pem ]]; then
      tmps="$(mktemp)"
      if fetch "deploy/vps-supabase/nginx-botshield.arbishield.app.conf" "$tmps"; then
        if [[ -d /etc/nginx/sites-available ]]; then
          cp -f "$tmps" "$NGINX_AVAIL"
        else
          cp -f "$tmps" "$CONF_D"
        fi
        echo "  promoveu conf SSL"
      fi
      rm -f "$tmps"
    fi
  else
    echo "  AVISO: certbot ausente — configure SSL manualmente"
  fi
else
  echo "  cert já existe"
fi

log "4/4 nginx test + reload"
nginx -t
systemctl reload nginx || service nginx reload

echo ""
echo "OK — BotShield isolado em https://botshield.arbishield.app"
echo "Não há link no app/admin. Acesso somente por URL direta."
echo "Login: mesma conta ArbiShield."
