#!/usr/bin/env bash
set -euo pipefail
REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
BRANCH="${ARBISHIELD_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"
echo "==> clone $BRANCH -> $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
fi
mkdir -p "$SCRIPTS_DIR" "$WEB"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-desafios-vps.html" "$WEB/admin-desafios-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-login-vps.html" "$WEB/admin-login-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/auth-vps.html" "$WEB/auth-vps.html"
install -m 0755 "$APP_DIR/scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf ]]; then
  if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
    install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
  else
    install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
  fi
fi
cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield prelive BetBra
After=network.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-prelive-events.mjs --serve
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable arbishield-prelive-events.service
systemctl restart arbishield-prelive-events.service
nginx -t && systemctl reload nginx
echo OK https://arbishield.app/admin/matches
