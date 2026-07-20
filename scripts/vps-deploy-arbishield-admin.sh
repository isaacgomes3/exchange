#!/usr/bin/env bash
# Deploy admin estável arbishield.app
# - Mantém HTML visual intacto (copia para /var/www/arbishield)
# - Mantém banco intacto (Supabase Docker :8000, mesmas tabelas REST)
# - Um nginx + dois workers (:3098 admin/jogos, :3099 sugestões)
#
# Uso na VPS (root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-deploy-arbishield-admin.sh)
set -euo pipefail

REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERRO: '$1' não encontrado" >&2
    exit 1
  }
}
need_cmd git
need_cmd node
need_cmd nginx
need_cmd systemctl

echo "==> Código ($BRANCH) → $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")" "$SCRIPTS_DIR" "$WEB"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
fi

STATIC="$APP_DIR/deploy/vps-supabase/static"

echo "==> HTML admin (visual inalterado)"
for f in admin-jogos-vps.html admin-desafios-vps.html admin-login-vps.html auth-vps.html; do
  install -m 0644 "$STATIC/$f" "$WEB/$f"
done
if [[ -f "$STATIC/desafio-sugestoes.html" ]]; then
  install -m 0644 "$STATIC/desafio-sugestoes.html" "$WEB/desafio-sugestoes.html"
fi
if [[ -f "$STATIC/desafio-sugestoes-inject.js" ]]; then
  mkdir -p "$WEB/assets"
  install -m 0644 "$STATIC/desafio-sugestoes-inject.js" "$WEB/assets/desafio-sugestoes-inject.js"
fi

echo "==> Workers Node"
install -m 0755 "$APP_DIR/scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
install -m 0755 "$APP_DIR/scripts/arbishield-desafio-suggestions.mjs" "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs"

echo "==> Nginx (sem Next/shim no admin)"
if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
  install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
else
  install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
fi

echo "==> systemd"
cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield admin API (jogos + desafios + prelive) :3098
After=network.target docker.service
Wants=docker.service

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
Description=ArbiShield sugestões desafio BetBra :3099
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

sleep 2
echo "==> Health"
fail=0
curl -fsS "http://127.0.0.1:3098/health" || fail=1
echo
curl -fsS "http://127.0.0.1:3099/health" || fail=1
echo
curl -fsS "http://127.0.0.1:3098/api/arbishield/desafios" | head -c 80 || fail=1
echo
if [[ "$fail" -ne 0 ]]; then
  echo "AVISO: algum check falhou — journalctl -u arbishield-prelive-events -n 40" >&2
fi

echo
echo "OK — admin estável (visual + DB intactos)"
echo "  https://arbishield.app/admin/matches"
echo "  https://arbishield.app/admin/desafios"
echo "  Doc: $APP_DIR/deploy/vps-supabase/ADMIN-STABLE.md"
