#!/usr/bin/env bash
# Publica o sistema v2 (Next) em /v2 no nginx, sem derrubar o SPA legado.
#
# Pré-requisitos na VPS:
#   - Next rodando em 127.0.0.1:3000 (build da branch v2)
#   - Backup já feito (vps-backup-full.sh)
#
# Uso (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=1")
set -euo pipefail

NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/arbishield.app}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

command -v nginx >/dev/null || die "nginx não encontrado"
command -v curl >/dev/null || die "curl não encontrado"

SNIPPET='# ArbiShield v2 (Next) — inserido por vps-enable-v2.sh
    location ^~ /v2 {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }
'

if [[ -f "$NGINX_SITE" ]]; then
  if grep -q 'location ^~ /v2' "$NGINX_SITE"; then
    log "nginx já tem location /v2"
  else
    cp -a "$NGINX_SITE" "$NGINX_SITE.bak-v2-$(date +%Y%m%d%H%M%S)"
    # Insere antes do primeiro "location /" genérico se existir
    python3 - "$NGINX_SITE" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")
snip = """    # ArbiShield v2 (Next) — inserido por vps-enable-v2.sh
    location ^~ /v2 {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

"""
    if "location / {" in text:
        text = text.replace("location / {", snip + "    location / {", 1)
    elif "location /{" in text:
        text = text.replace("location /{", snip + "    location /{", 1)
    else:
        text = text + "\n" + snip
    p.write_text(text, encoding="utf-8")
    print("nginx: location /v2 inserido")
PY
  fi
  nginx -t
  systemctl reload nginx
  log "nginx recarregado"
else
  echo "AVISO: $NGINX_SITE não encontrado — adicione manualmente:" >&2
  echo "$SNIPPET" >&2
fi

log "Health Next"
curl -sS -o /dev/null -w "local /v2 → %{http_code}\n" http://127.0.0.1:3000/v2 || \
  echo "AVISO: Next :3000 não respondeu — faça build/start da branch $BRANCH"

echo
echo "OK — v2 habilitado em paralelo ao SPA"
echo "  https://arbishield.app/v2"
echo "  https://arbishield.app/v2/auth"
echo "  https://arbishield.app/v2/admin"
echo
echo "Build sugerido na VPS:"
echo "  cd $APP_DIR && git fetch && git checkout $BRANCH && git pull"
echo "  npm ci && npm run build && systemctl restart arbishield-next || pm2 restart arbishield"
