#!/usr/bin/env bash
# Habilita AMBIENTE DE TESTE isolado da produção (arbishield.app).
#
# O que cria:
#   - UI:     /var/www/arbishield-teste/v2
#   - código: /opt/arbishield-teste/scripts
#   - prelive :3198  (unit arbishield-prelive-events-teste)
#   - shim    :3201  (unit arbishield-serverfn-shim-teste)
#   - nginx:  teste.arbishield.app
#
# NÃO toca em /var/www/arbishield nem nos workers :3098/:3101.
#
# Pré-requisito DNS:
#   A  teste.arbishield.app  →  IP da VPS
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/a21da36d9e4fc196d68e2fad70fef994803fb670/scripts/vps-enable-teste.sh?v=1")
#
# Depois publique uma branch/SHA no teste:
#   ARBISHIELD_REF=<sha> bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-a21da36d9e4fc196d68e2fad70fef994803fb670}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_TESTE_WEB:-/var/www/arbishield-teste}"
WEB="$WEB_ROOT/v2"
CODE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"
SCRIPTS_DIR="$CODE_DIR/scripts"
NGINX_AVAIL="${ARBISHIELD_TESTE_NGINX:-/etc/nginx/sites-available/teste.arbishield.app}"
NGINX_ENABLED="/etc/nginx/sites-enabled/teste.arbishield.app"
DOMAIN="${ARBISHIELD_TESTE_DOMAIN:-teste.arbishield.app}"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }

need curl
need nginx
need systemctl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

mkdir -p "$WEB" "$WEB/brand" "$WEB_ROOT/assets" "$SCRIPTS_DIR" "$CODE_DIR"

log "1/6 — baixar nginx + units + scripts (ref=$REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/nginx-teste.arbishield.app.conf" -o "$NGINX_AVAIL"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/arbishield-prelive-events-teste.service" \
  -o /etc/systemd/system/arbishield-prelive-events-teste.service
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/arbishield-serverfn-shim-teste.service" \
  -o /etc/systemd/system/arbishield-serverfn-shim-teste.service
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-enable-teste.sh" -o "$SCRIPTS_DIR/vps-enable-teste.sh"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-deploy-teste.sh" -o "$SCRIPTS_DIR/vps-deploy-teste.sh"
chmod 0755 "$SCRIPTS_DIR/vps-enable-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh"

grep -q 'teste.arbishield.app' "$NGINX_AVAIL" || die "nginx teste inválido"
grep -q '3198' "$NGINX_AVAIL" || die "nginx teste sem :3198"
grep -q '3201' "$NGINX_AVAIL" || die "nginx teste sem :3201"
! grep -q 'default_server' "$NGINX_AVAIL" || die "nginx teste não pode ser default_server"

log "2/6 — publicar UI + workers no ambiente teste"
ARBISHIELD_REF="$REF" ARBISHIELD_BRANCH="$BRANCH" \
  bash "$SCRIPTS_DIR/vps-deploy-teste.sh"

install_nginx_conf() {
  local src="$1"
  if [[ -d /etc/nginx/sites-enabled ]]; then
    cp -f "$src" "$NGINX_AVAIL"
    ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"
  elif [[ -d /etc/nginx/conf.d ]]; then
    cp -f "$src" /etc/nginx/conf.d/teste.arbishield.app.conf
  else
    die "nginx sites-enabled/conf.d não encontrado"
  fi
}

log "3/6 — habilitar nginx do teste"
FULL_CONF="$(mktemp)"
HTTP_CONF="$(mktemp)"
curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/nginx-teste.arbishield.app.conf" -o "$FULL_CONF"
curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/nginx-teste.arbishield.app.http-only.conf" -o "$HTTP_CONF" \
  || cp -f "$FULL_CONF" "$HTTP_CONF"

if [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
  install_nginx_conf "$FULL_CONF"
else
  warn "sem certificado SSL — subindo HTTP-only até o certbot"
  install_nginx_conf "$HTTP_CONF"
fi
nginx -t || die "nginx -t falhou"
systemctl reload nginx

log "4/6 — TLS (certbot) se DNS já aponta"
if command -v certbot >/dev/null 2>&1; then
  if [[ ! -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
    if getent hosts "$DOMAIN" >/dev/null 2>&1; then
      certbot certonly --webroot -w "$WEB_ROOT" -d "$DOMAIN" --non-interactive --agree-tos \
        --register-unsafely-without-email \
        || certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
          --register-unsafely-without-email --redirect \
        || warn "certbot falhou — rode depois: certbot --nginx -d $DOMAIN"
      if [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
        install_nginx_conf "$FULL_CONF"
        nginx -t && systemctl reload nginx || warn "reload nginx pós-certbot"
      fi
    else
      warn "DNS de $DOMAIN ainda não resolve — configure o A record e rode certbot"
    fi
  else
    log "certificado já existe para $DOMAIN"
  fi
else
  warn "certbot não instalado — HTTPS fica para depois"
fi
rm -f "$FULL_CONF" "$HTTP_CONF"

log "5/6 — systemd teste"
systemctl daemon-reload
systemctl enable arbishield-prelive-events-teste.service
systemctl enable arbishield-serverfn-shim-teste.service
systemctl restart arbishield-prelive-events-teste.service
systemctl restart arbishield-serverfn-shim-teste.service
sleep 1

log "6/6 — smoke (não mexe na produção)"
curl -fsS --max-time 5 "http://127.0.0.1:3198/health" | head -c 300 || warn "health :3198 falhou"
echo
curl -fsS --max-time 5 "http://127.0.0.1:3201/health" | head -c 300 || warn "health :3201 falhou"
echo
# Produção intacta?
curl -fsS --max-time 5 "http://127.0.0.1:3098/health" >/dev/null \
  && log "produção :3098 ainda responde (ok)" \
  || warn "produção :3098 sem health (verifique se já estava assim)"

echo
echo "OK — ambiente de TESTE habilitado"
echo "  URL:     https://$DOMAIN/"
echo "  Admin:   https://$DOMAIN/admin-jogos.html"
echo "  Deploy:  ARBISHIELD_REF=<sha> bash $SCRIPTS_DIR/vps-deploy-teste.sh"
echo
echo "ATENÇÃO: por padrão o teste usa o MESMO Supabase da produção (:8000)."
echo "  → UI/código ficam isolados; settle/depósito no teste alteram o banco real."
echo "  → Use com cuidado. Produção: https://arbishield.app"
