#!/usr/bin/env bash
# Hotfix 502 em /admin/desafios — aponta API para :3098 (prelive, já no ar).
# Uso na VPS (root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-hotfix-desafios-502.sh)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"
BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"

mkdir -p "$SCRIPTS_DIR" "$WEB" "$(dirname "$APP_DIR")"

echo "==> Baixando worker pré-live + admin desafios"
curl -fsSL "$BASE/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
curl -fsSL "$BASE/deploy/vps-supabase/static/admin-desafios-vps.html" -o "$WEB/admin-desafios-vps.html"

echo "==> Nginx: desafios → :3098 (não :3101 nem :3000)"
if [[ -f "$NGINX_CONF" ]]; then
  sed -i \
    -e 's|location = /api/arbishield/desafios {[^}]*proxy_pass http://127.0.0.1:3101|location = /api/arbishield/desafios {\n        proxy_pass http://127.0.0.1:3098|g' \
    -e 's|proxy_pass http://127.0.0.1:3101;|proxy_pass http://127.0.0.1:3098;|g' \
    "$NGINX_CONF" || true
  sed -i 's|/api/arbishield/desafios.*3099|/api/arbishield/desafios → 3098|g' "$NGINX_CONF" || true
  python3 - "$NGINX_CONF" <<'PY'
from pathlib import Path
import re
p = Path(__import__("sys").argv[1])
text = p.read_text()
block = """    location = /api/arbishield/desafios {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }

"""
if "location = /api/arbishield/desafios" not in text:
    text = text.replace(
        "    location /api/arbishield/prelive-events {",
        block + "    location /api/arbishield/prelive-events {",
        1,
    )
else:
    text = re.sub(
        r"location = /api/arbishield/desafios \{[^}]+\}",
        block.strip(),
        text,
        count=1,
        flags=re.DOTALL,
    )
text = re.sub(r"\n\s*location \^~ /_serverFn/ \{[^}]+\}\n", "\n", text, flags=re.DOTALL)
text = re.sub(
    r"\n\s*location = /api/arbishield/desafios \{[^}]*3101[^}]+\}\n",
    "\n",
    text,
    flags=re.DOTALL,
)
p.write_text(text)
print("nginx patched")
PY
fi

if [[ ! -f /etc/systemd/system/arbishield-prelive-events.service ]]; then
  cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield prelive + desafios API
After=network.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-prelive-events.mjs --serve
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
fi

systemctl daemon-reload
systemctl enable arbishield-prelive-events.service
systemctl restart arbishield-prelive-events.service
systemctl disable --now arbishield-serverfn-shim.service 2>/dev/null || true

nginx -t
systemctl reload nginx

sleep 1
echo "==> Teste"
curl -fsS "http://127.0.0.1:3098/health"
echo
curl -fsS "http://127.0.0.1:3098/api/arbishield/desafios" | head -c 160
echo
echo "OK — recarregue https://arbishield.app/admin/desafios"
