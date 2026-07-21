#!/usr/bin/env bash
# Deploy cirúrgico: criar proteção v2 (UI + API :3098 + nginx).
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-protections.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need nginx
need systemctl

mkdir -p "$WEB/v2" "$SCRIPTS_DIR"

log "1/3 — UI v2"
for f in app-proteger.html app-protecoes.html v2.css; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/v2/$f"
  chmod 0644 "$WEB/v2/$f"
  echo "  ok $f"
done

log "2/3 — worker :3098 (POST /api/arbishield/protections)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  echo "  prelive reiniciado"
else
  echo "  AVISO: serviço arbishield-prelive-events inativo"
fi

log "3/3 — nginx location protections"
NGINX_MAIN="$(
  for c in \
    /etc/nginx/conf.d/arbishield-cutover.conf \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield
  do
    [[ -f "$c" ]] && echo "$c" && break
  done
)"
[[ -n "${NGINX_MAIN:-}" ]] || die "nginx principal não encontrado"
if ! grep -q 'api/arbishield/protections' "$NGINX_MAIN"; then
  curl -fsSL "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" -o "$NGINX_MAIN"
  echo "  nginx principal atualizado"
else
  echo "  nginx já tem location protections"
fi
nginx -t
systemctl reload nginx

echo
echo "OK — proteções v2"
echo "  UI:  https://arbishield.app/app-proteger.html"
echo "  API: POST /api/arbishield/protections"
