#!/usr/bin/env bash
# Desativa legado.arbishield.app — redireciona 100% para https://arbishield.app
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/excluir-legado-47c1/scripts/vps-hotfix-excluir-legado.sh")
#
# Opcional: arquivar SPA antigo do disco (index.html + assets):
#   ARCHIVE_SPA=1 bash <(curl -fsSL "...")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/excluir-legado-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_LEGADO="${NGINX_LEGADO:-/etc/nginx/conf.d/legado.arbishield.app.conf}"
BACKUP_DIR="${BACKUP_DIR:-/opt/arbishield/backups/legado-retired-$(date +%Y%m%d-%H%M%S)}"
ARCHIVE_SPA="${ARCHIVE_SPA:-0}"
MAIN_HOST="${MAIN_HOST:-https://arbishield.app}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
need nginx
need mkdir

echo
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Excluir / desativar legado.arbishield.app               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo

mkdir -p "$BACKUP_DIR"

log "1/3 Backup nginx legado → $BACKUP_DIR"
if [[ -f "$NGINX_LEGADO" ]]; then
  cp -a "$NGINX_LEGADO" "$BACKUP_DIR/legado.arbishield.app.conf.bak"
  echo "  ok"
else
  echo "  (conf ainda não existia em $NGINX_LEGADO)"
fi

log "2/3 Instalar redirect permanente → $MAIN_HOST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/nginx-legado.arbishield.app.conf?v=$BUST" \
  -o "$NGINX_LEGADO"
chmod 0644 "$NGINX_LEGADO"
grep -q 'legado-retired' "$NGINX_LEGADO" || die "conf sem marker legado-retired"
grep -q 'arbishield.app' "$NGINX_LEGADO" || die "conf sem redirect para arbishield.app"
# Não deve mais servir SPA
! grep -q 'try_files.*/index.html' "$NGINX_LEGADO" || die "conf ainda serve SPA legado"

if [[ ! -f /etc/letsencrypt/live/legado.arbishield.app/fullchain.pem ]]; then
  log "Aviso: certificado SSL legado ausente — publicando só HTTP→HTTPS main"
  cat > "$NGINX_LEGADO" <<EOF
# legado desativado (sem cert SSL local)
server {
    listen 80;
    listen [::]:80;
    server_name legado.arbishield.app;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/arbishield;
        default_type "text/plain";
    }
    location / {
        return 301 ${MAIN_HOST}\$request_uri;
    }
}
EOF
fi

nginx -t || die "nginx -t falhou"
systemctl reload nginx
echo "  nginx reload ok"

if [[ "$ARCHIVE_SPA" == "1" ]]; then
  log "3/3 Arquivar SPA antigo em $WEB (index.html + assets)"
  mkdir -p "$BACKUP_DIR/spa"
  for f in index.html assets admin-login-vps.html admin-jogos-vps.html admin-desafios-vps.html admin-hub-vps.html auth-vps.html; do
    if [[ -e "$WEB/$f" ]]; then
      mv "$WEB/$f" "$BACKUP_DIR/spa/"
      echo "  movido: $f"
    fi
  done
  echo "  (v2 em $WEB/v2 NÃO foi tocado)"
else
  log "3/3 SPA em disco mantido (só nginx redireciona). Para arquivar: ARCHIVE_SPA=1"
fi

echo
echo "OK — legado.arbishield.app desativado."
echo "  Teste: curl -sI https://legado.arbishield.app/ | head -5"
echo "  Esperado: 301 Location: ${MAIN_HOST}/..."
echo "  Use apenas: ${MAIN_HOST}"
echo "  Backup: $BACKUP_DIR"
echo
