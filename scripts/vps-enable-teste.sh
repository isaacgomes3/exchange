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
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/SHA/scripts/vps-enable-teste.sh?v=2")
#
# Depois publique uma branch/SHA no teste:
#   ARBISHIELD_REF=<sha> bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-cursor/ambiente-teste-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_TESTE_WEB:-/var/www/arbishield-teste}"
WEB="$WEB_ROOT/v2"
CODE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"
SCRIPTS_DIR="$CODE_DIR/scripts"
DOMAIN="${ARBISHIELD_TESTE_DOMAIN:-teste.arbishield.app}"
TMP_DIR=""

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }

cleanup() { [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR" || true; }
trap cleanup EXIT

need curl
need nginx
need systemctl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

mkdir -p "$WEB" "$WEB/brand" "$WEB_ROOT/assets" "$SCRIPTS_DIR" "$CODE_DIR" \
  /etc/systemd/system

# Detecta layout nginx (muitas VPS ArbiShield usam só conf.d)
resolve_nginx_target() {
  if [[ -n "${ARBISHIELD_TESTE_NGINX:-}" ]]; then
    echo "$ARBISHIELD_TESTE_NGINX"
    return
  fi
  if [[ -d /etc/nginx/sites-available ]]; then
    echo "/etc/nginx/sites-available/teste.arbishield.app"
    return
  fi
  if [[ -d /etc/nginx/conf.d ]]; then
    echo "/etc/nginx/conf.d/teste.arbishield.app.conf"
    return
  fi
  die "nginx: nem sites-available nem conf.d existem"
}

NGINX_TARGET="$(resolve_nginx_target)"
log "nginx target: $NGINX_TARGET"
mkdir -p "$(dirname "$NGINX_TARGET")"

fetch() {
  local rel="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/$rel" -o "$dest" \
    || die "falha ao baixar $rel → $dest"
  [[ -s "$dest" ]] || die "arquivo vazio: $dest"
}

log "1/6 — baixar nginx + units + scripts (ref=$REF)"
TMP_DIR="$(mktemp -d /tmp/arbishield-teste-enable.XXXXXX)"

fetch "deploy/vps-supabase/nginx-teste.arbishield.app.conf" \
  "$TMP_DIR/nginx-full.conf"
fetch "deploy/vps-supabase/nginx-teste.arbishield.app.http-only.conf" \
  "$TMP_DIR/nginx-http.conf"
fetch "deploy/vps-supabase/arbishield-prelive-events-teste.service" \
  /etc/systemd/system/arbishield-prelive-events-teste.service
fetch "deploy/vps-supabase/arbishield-serverfn-shim-teste.service" \
  /etc/systemd/system/arbishield-serverfn-shim-teste.service
fetch "scripts/vps-enable-teste.sh" "$SCRIPTS_DIR/vps-enable-teste.sh"
fetch "scripts/vps-deploy-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh"
chmod 0755 "$SCRIPTS_DIR/vps-enable-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh"

grep -q 'teste.arbishield.app' "$TMP_DIR/nginx-full.conf" || die "nginx teste inválido"
grep -q '3198' "$TMP_DIR/nginx-full.conf" || die "nginx teste sem :3198"
grep -q '3201' "$TMP_DIR/nginx-full.conf" || die "nginx teste sem :3201"
! grep -q 'default_server' "$TMP_DIR/nginx-full.conf" || die "nginx teste não pode ser default_server"
[[ -f "$SCRIPTS_DIR/vps-deploy-teste.sh" ]] || die "vps-deploy-teste.sh não baixou"

log "2/6 — publicar UI + workers no ambiente teste"
ARBISHIELD_REF="$REF" ARBISHIELD_BRANCH="$BRANCH" \
  bash "$SCRIPTS_DIR/vps-deploy-teste.sh"

install_nginx_conf() {
  local src="$1"
  cp -f "$src" "$NGINX_TARGET"
  if [[ -d /etc/nginx/sites-enabled ]] && [[ "$NGINX_TARGET" == /etc/nginx/sites-available/* ]]; then
    ln -sfn "$NGINX_TARGET" /etc/nginx/sites-enabled/teste.arbishield.app
  fi
  log "nginx instalado em $NGINX_TARGET"
}

log "3/6 — habilitar nginx do teste"
if [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
  install_nginx_conf "$TMP_DIR/nginx-full.conf"
else
  warn "sem certificado SSL — subindo HTTP-only até o certbot"
  install_nginx_conf "$TMP_DIR/nginx-http.conf"
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
        install_nginx_conf "$TMP_DIR/nginx-full.conf"
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
curl -fsS --max-time 5 "http://127.0.0.1:3098/health" >/dev/null \
  && log "produção :3098 ainda responde (ok)" \
  || warn "produção :3098 sem health (verifique se já estava assim)"

echo
echo "OK — ambiente de TESTE habilitado"
echo "  URL:     https://$DOMAIN/  (ou http:// se SSL pendente)"
echo "  Admin:   https://$DOMAIN/admin-jogos.html"
echo "  Deploy:  ARBISHIELD_REF=<sha> bash $SCRIPTS_DIR/vps-deploy-teste.sh"
echo "  Nginx:   $NGINX_TARGET"
echo
echo "ATENÇÃO: por padrão o teste usa o MESMO Supabase da produção (:8000)."
echo "  → UI/código ficam isolados; settle/depósito no teste alteram o banco real."
echo "  → Use com cuidado. Produção: https://arbishield.app"
