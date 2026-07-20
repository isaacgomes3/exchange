#!/usr/bin/env bash
# Deploy admin ArbiShield (jogos + desafios) na VPS — arbishield.app
# Uso:
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-deploy-jogos-prelive.sh)
set -euo pipefail

REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
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

echo "==> assets HTML + workers"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-desafios-vps.html" "$WEB/admin-desafios-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/admin-login-vps.html" "$WEB/admin-login-vps.html"
install -m 0644 "$APP_DIR/deploy/vps-supabase/static/auth-vps.html" "$WEB/auth-vps.html"
install -m 0755 "$APP_DIR/scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
install -m 0755 "$APP_DIR/scripts/arbishield-desafio-suggestions.mjs" "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs"

if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
  install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
else
  install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
fi

echo "==> systemd: prelive :3098 + desafios :3099"
cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield prelive BetBra
After=network.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
EnvironmentFile=-/opt/arbishield/.arbishield-odds-sync.env
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-prelive-events.mjs --serve
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/arbishield-desafio-suggestions.service <<EOF
[Unit]
Description=ArbiShield desafios API + sugestões BetBra
After=network.target
[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
EnvironmentFile=-/opt/arbishield/.arbishield-odds-sync.env
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-desafio-suggestions.mjs --serve
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl disable --now arbishield-serverfn-shim.service 2>/dev/null || true
systemctl enable arbishield-prelive-events.service arbishield-desafio-suggestions.service
systemctl restart arbishield-prelive-events.service arbishield-desafio-suggestions.service

nginx -t
systemctl reload nginx

sleep 1
echo "==> health"
curl -fsS "http://127.0.0.1:3098/health" || true
echo
curl -fsS "http://127.0.0.1:3099/health" || true
echo
curl -fsS "http://127.0.0.1:3099/api/arbishield/desafios" | head -c 120 || true
echo
echo "OK — https://arbishield.app/admin/matches · /admin/desafios"
