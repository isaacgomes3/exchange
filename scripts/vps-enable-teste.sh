#!/usr/bin/env bash
# Ambiente de TESTE prático — SEM DNS / SEM subdomínio.
#
# Acesso:
#   http://127.0.0.1:8090/admin-jogos.html
#   http://IP_DA_VPS:8090/admin-jogos.html
#
# Isolado da produção (arbishield.app nas portas 80/443).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-enable-teste.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_TESTE_WEB:-/var/www/arbishield-teste}"
WEB="$WEB_ROOT/v2"
CODE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"
SCRIPTS_DIR="$CODE_DIR/scripts"
PORT="${ARBISHIELD_TESTE_PORT:-8090}"
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

resolve_nginx_target() {
  if [[ -n "${ARBISHIELD_TESTE_NGINX:-}" ]]; then
    echo "$ARBISHIELD_TESTE_NGINX"
    return
  fi
  if [[ -d /etc/nginx/conf.d ]]; then
    echo "/etc/nginx/conf.d/arbishield-teste-localhost.conf"
    return
  fi
  if [[ -d /etc/nginx/sites-available ]]; then
    echo "/etc/nginx/sites-available/arbishield-teste-localhost"
    return
  fi
  die "nginx: nem conf.d nem sites-available"
}

NGINX_TARGET="$(resolve_nginx_target)"
mkdir -p "$(dirname "$NGINX_TARGET")"

fetch() {
  local rel="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/$rel" -o "$dest" \
    || die "falha ao baixar $rel → $dest"
  [[ -s "$dest" ]] || die "arquivo vazio: $dest"
}

log "1/5 — baixar conf localhost:$PORT + units + scripts (ref=$REF)"
TMP_DIR="$(mktemp -d /tmp/arbishield-teste-enable.XXXXXX)"

fetch "deploy/vps-supabase/nginx-teste-localhost.conf" "$TMP_DIR/nginx.conf"
# Porta configurável
sed -i "s/listen 8090;/listen ${PORT};/g; s/listen \\[::\\]:8090;/listen [::]:${PORT};/g" \
  "$TMP_DIR/nginx.conf"

fetch "deploy/vps-supabase/arbishield-prelive-events-teste.service" \
  /etc/systemd/system/arbishield-prelive-events-teste.service
fetch "deploy/vps-supabase/arbishield-serverfn-shim-teste.service" \
  /etc/systemd/system/arbishield-serverfn-shim-teste.service
fetch "scripts/vps-enable-teste.sh" "$SCRIPTS_DIR/vps-enable-teste.sh"
fetch "scripts/vps-deploy-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh"
chmod 0755 "$SCRIPTS_DIR/vps-enable-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh"

grep -q "listen ${PORT}" "$TMP_DIR/nginx.conf" || die "nginx sem listen $PORT"
grep -q '3198' "$TMP_DIR/nginx.conf" || die "nginx sem :3198"
grep -q 'arbishield-teste/v2' "$TMP_DIR/nginx.conf" || die "nginx sem root teste"

log "2/5 — publicar UI + workers no ambiente teste"
ARBISHIELD_REF="$REF" ARBISHIELD_BRANCH="$BRANCH" \
  bash "$SCRIPTS_DIR/vps-deploy-teste.sh"

log "3/5 — nginx localhost:$PORT (sem DNS)"
cp -f "$TMP_DIR/nginx.conf" "$NGINX_TARGET"
if [[ -d /etc/nginx/sites-enabled ]] && [[ "$NGINX_TARGET" == /etc/nginx/sites-available/* ]]; then
  ln -sfn "$NGINX_TARGET" /etc/nginx/sites-enabled/arbishield-teste-localhost
fi
# Remove conf antiga de subdomínio se atrapalhar (opcional, não remove produção)
rm -f /etc/nginx/conf.d/teste.arbishield.app.conf 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/teste.arbishield.app 2>/dev/null || true

nginx -t || die "nginx -t falhou"
systemctl reload nginx
log "nginx: $NGINX_TARGET"

log "4/5 — firewall porta $PORT (se houver)"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi 'active'; then
  ufw allow "${PORT}/tcp" comment 'ArbiShield teste localhost' || warn "ufw allow $PORT falhou"
elif command -v firewall-cmd >/dev/null 2>&1; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" 2>/dev/null || true
  firewall-cmd --reload 2>/dev/null || true
fi

log "5/5 — systemd + smoke"
systemctl daemon-reload
systemctl enable arbishield-prelive-events-teste.service
systemctl enable arbishield-serverfn-shim-teste.service
systemctl restart arbishield-prelive-events-teste.service
systemctl restart arbishield-serverfn-shim-teste.service
sleep 1

curl -fsS --max-time 5 "http://127.0.0.1:3198/health" | head -c 200 || warn "health :3198 falhou"
echo
curl -fsS --max-time 5 "http://127.0.0.1:3201/health" | head -c 200 || warn "health :3201 falhou"
echo
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/admin-jogos.html" || echo 000)"
[[ "$CODE" == "200" || "$CODE" == "304" ]] \
  && log "UI http://127.0.0.1:${PORT}/admin-jogos.html → HTTP $CODE" \
  || warn "UI :${PORT} HTTP $CODE"

PUB_IP="$(curl -4 -fsS --max-time 4 ifconfig.me 2>/dev/null || true)"
[[ -z "$PUB_IP" ]] && PUB_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo
echo "OK — TESTE no ar (produção NÃO foi alterada)"
echo "  Local:   http://127.0.0.1:${PORT}/admin-jogos.html"
if [[ -n "$PUB_IP" ]]; then
  echo "  Externo: http://${PUB_IP}:${PORT}/admin-jogos.html"
fi
echo "  Deploy:  ARBISHIELD_REF=<branch> bash $SCRIPTS_DIR/vps-deploy-teste.sh"
echo
echo "Sem DNS. Sem subdomínio. Só abrir a porta ${PORT}."
echo "ATENÇÃO: mesmo Supabase da produção — cuidado com settle/pagamentos."
