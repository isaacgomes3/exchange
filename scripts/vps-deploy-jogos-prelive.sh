#!/usr/bin/env bash
# Deploy Gestão de Jogos (catálogo pré-live BetBra) na VPS ArbiShield.
# Uso na VPS:
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-jogos-prelive-723d/scripts/vps-deploy-jogos-prelive.sh)
set -euo pipefail

REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-jogos-prelive-723d}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"

SRC="$ROOT"
TMP=""
cleanup() {
  [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> Obtendo código ($BRANCH)"
if [[ -d "$ROOT/.git" ]]; then
  git -C "$ROOT" fetch origin "$BRANCH"
  git -C "$ROOT" checkout "$BRANCH" 2>/dev/null || git -C "$ROOT" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$ROOT" pull --ff-only origin "$BRANCH" || git -C "$ROOT" reset --hard "origin/$BRANCH"
elif [[ -d "$ROOT" ]]; then
  echo "    $ROOT já existe (sem git) — usando clone temporário"
  TMP="$(mktemp -d)"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$TMP"
  SRC="$TMP"
else
  mkdir -p "$(dirname "$ROOT")"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$ROOT"
fi

mkdir -p "$ROOT/scripts" "$WEB"

echo "==> Copiando assets"
install -m 0644 "$SRC/deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
install -m 0755 "$SRC/scripts/arbishield-prelive-events.mjs" "$ROOT/scripts/arbishield-prelive-events.mjs"
install -m 0644 "$SRC/deploy/vps-supabase/static/app-stability.js" "$WEB/app-stability.js"

if [[ -f "$SRC/deploy/vps-supabase/nginx-arbishield.app.conf" ]]; then
  if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
    install -m 0644 "$SRC/deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
  else
    install -m 0644 "$SRC/deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
  fi
fi

echo "==> systemd: prelive-events (3098)"
cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield prelive BetBra catalog
After=network.target

[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=-/opt/arbishield/deploy/vps-supabase/.env
EnvironmentFile=-/opt/arbishield/.arbishield-odds-sync.env
ExecStart=/usr/bin/node $ROOT/scripts/arbishield-prelive-events.mjs --serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable arbishield-prelive-events.service
systemctl restart arbishield-prelive-events.service

echo "==> Testando nginx"
nginx -t
systemctl reload nginx

echo "==> Health"
curl -fsS "http://127.0.0.1:3098/health" || true
echo
echo "OK — /admin/matches · /api/arbishield/prelive-events"
