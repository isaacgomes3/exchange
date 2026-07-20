#!/usr/bin/env bash
# Emergência 502 — /admin/desafios (sem git, só curl)
# Uso na VPS como root:
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-emergency-fix-502.sh)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"

mkdir -p "$SCRIPTS_DIR" "$WEB"

echo "==> Baixando worker + nginx + HTML (sem alterar visual)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
curl -fsSL "$RAW/deploy/vps-supabase/static/admin-desafios-vps.html" -o "$WEB/admin-desafios-vps.html"

if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
  curl -fsSL "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" -o "$NGINX_CONF"
else
  curl -fsSL "$RAW/deploy/vps-supabase/nginx-cutover.conf" -o "$NGINX_CONF"
fi

# Remove blocos mortos em qualquer conf extra
for f in /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/* 2>/dev/null; do
  [[ -f "$f" ]] || continue
  if grep -q '_serverFn\|127.0.0.1:3101' "$f" 2>/dev/null; then
    echo "    limpando $f"
    python3 - "$f" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text()
t = re.sub(r"\n\s*location \^~ /_serverFn/ \{.*?\n\s*\}\n", "\n", t, flags=re.DOTALL)
t = re.sub(r"proxy_pass http://127\.0\.0\.1:3101;", "proxy_pass http://127.0.0.1:3098;", t)
p.write_text(t)
PY
  fi
done

cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield admin API :3098
After=network.target
[Service]
Type=simple
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
EnvironmentFile=-/opt/arbishield/.arbishield-odds-sync.env
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-prelive-events.mjs --serve
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl disable --now arbishield-serverfn-shim.service 2>/dev/null || true
systemctl enable arbishield-prelive-events.service
systemctl restart arbishield-prelive-events.service

nginx -t
systemctl reload nginx

sleep 2
echo "==> Diagnóstico"
echo -n "3098 health: "
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3098/health || echo FAIL
echo -n "desafios API: "
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3098/api/arbishield/desafios || echo FAIL
echo -n "via HTTPS: "
curl -sS -o /dev/null -w "%{http_code}\n" https://arbishield.app/api/arbishield/desafios || echo FAIL

echo
echo "Se ainda 502, envie: journalctl -u arbishield-prelive-events -n 30 --no-pager"
echo "Recarregue: https://arbishield.app/admin/desafios"
