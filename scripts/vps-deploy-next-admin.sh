#!/usr/bin/env bash
# Fase 1 — sobe o Next.js (admin ArbiShield) na VPS, sem Lovable.
# Corrige o erro comum: /opt/arbishield/exchange ainda não existe.
#
# Uso na VPS (como root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-jogos-prelive-723d/scripts/vps-deploy-next-admin.sh)
#
# Variáveis opcionais:
#   ARBISHIELD_REPO / ARBISHIELD_BRANCH / APP_DIR / PORT
set -euo pipefail

REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-jogos-prelive-723d}"
APP_DIR="${APP_DIR:-/opt/arbishield/exchange}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"
PORT="${PORT:-3000}"
PUBLIC_URL="${PUBLIC_URL:-https://arbishield.app}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERRO: comando '$1' não encontrado. Instale antes de continuar." >&2
    exit 1
  }
}

need_cmd git
need_cmd node
need_cmd npm
need_cmd nginx
need_cmd systemctl

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo "ERRO: Next 16 precisa de Node >= 20 (atual: $(node -v))" >&2
  exit 1
fi

echo "==> App Next em $APP_DIR (branch $BRANCH)"
mkdir -p "$(dirname "$APP_DIR")"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH" || git -C "$APP_DIR" reset --hard "origin/$BRANCH"
elif [[ -d "$APP_DIR" && -f "$APP_DIR/package.json" ]]; then
  echo "    $APP_DIR existe sem .git — mantendo e sincronizando arquivos via clone temporário"
  TMP="$(mktemp -d)"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$TMP"
  rsync -a --delete --exclude node_modules --exclude .next --exclude .env.production "$TMP"/ "$APP_DIR"/
  rm -rf "$TMP"
else
  rm -rf "$APP_DIR"
  git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
fi

pick_env_value() {
  local key="$1"
  local file
  for file in \
    "$APP_DIR/.env.production" \
    "$ROOT/deploy/vps-supabase/.env" \
    "$ROOT/.arbishield-odds-sync.env" \
    "$ROOT/.env" \
    "/opt/arbishield/deploy/vps-supabase/.env"; do
    [[ -f "$file" ]] || continue
    local line
    line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n1 || true)"
    if [[ -n "$line" ]]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  done
  return 1
}

echo "==> Montando .env.production (lê chaves já existentes na VPS)"
ANON_KEY="$(pick_env_value NEXT_PUBLIC_SUPABASE_ANON_KEY || pick_env_value ANON_KEY || true)"
SERVICE_KEY="$(pick_env_value SUPABASE_SERVICE_ROLE_KEY || pick_env_value SERVICE_ROLE_KEY || pick_env_value ARBISHIELD_SERVICE_ROLE_KEY || true)"
SUPA_URL="$(pick_env_value NEXT_PUBLIC_SUPABASE_URL || pick_env_value SUPABASE_URL || pick_env_value ARBISHIELD_SUPABASE_URL || true)"
SUPA_URL="${SUPA_URL:-$PUBLIC_URL}"

if [[ -z "${ANON_KEY:-}" || -z "${SERVICE_KEY:-}" ]]; then
  cat >&2 <<EOF
ERRO: não achei ANON_KEY / SERVICE_ROLE_KEY na VPS.

Procure em:
  $ROOT/deploy/vps-supabase/.env
  $ROOT/.arbishield-odds-sync.env

Depois exporte e rode de novo:
  export NEXT_PUBLIC_SUPABASE_ANON_KEY='...'
  export SUPABASE_SERVICE_ROLE_KEY='...'
  bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/$BRANCH/scripts/vps-deploy-next-admin.sh)
EOF
  exit 1
fi

# Se o usuário exportou no shell, prevalece
ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$ANON_KEY}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$SERVICE_KEY}"
SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL:-$SUPA_URL}"

umask 077
cat > "$APP_DIR/.env.production" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
ARBISHIELD_SUPABASE_URL=$SUPA_URL
ARBISHIELD_SERVICE_ROLE_KEY=$SERVICE_KEY
PORT=$PORT
HOSTNAME=127.0.0.1
EOF
chmod 600 "$APP_DIR/.env.production"
echo "    escrito: $APP_DIR/.env.production"

echo "==> npm ci + build"
cd "$APP_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

echo "==> systemd: arbishield-next ($PORT)"
cat > /etc/systemd/system/arbishield-next.service <<EOF
[Unit]
Description=ArbiShield Next.js admin (sem Lovable)
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=-$APP_DIR/.env.production
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/npm run start -- --port $PORT --hostname 127.0.0.1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Prefer node binary from PATH if npm is under nvm
NPM_BIN="$(command -v npm)"
sed -i "s|^ExecStart=.*|ExecStart=$NPM_BIN run start -- --port $PORT --hostname 127.0.0.1|" /etc/systemd/system/arbishield-next.service

systemctl daemon-reload
systemctl enable arbishield-next.service
systemctl restart arbishield-next.service

echo "==> Nginx: proxy /arbishield e /_next → Next :$PORT"
if [[ -f "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf" ]]; then
  if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
    install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
  else
    install -m 0644 "$APP_DIR/deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
  fi
fi

nginx -t
systemctl reload nginx

echo "==> Health"
sleep 2
curl -fsS "http://127.0.0.1:${PORT}/arbishield" -o /dev/null -w "next /arbishield → %{http_code}\n" || {
  echo "AVISO: Next ainda não respondeu em :$PORT — veja: journalctl -u arbishield-next -n 80 --no-pager" >&2
}
curl -fsS "https://arbishield.app/arbishield" -o /dev/null -w "public /arbishield → %{http_code}\n" || true

echo
echo "OK — painel Next: https://arbishield.app/arbishield"
echo "    APIs Next:    https://arbishield.app/api/arbishield/*"
echo "    (pré-live e matches continuam no serviço :3098)"
echo "    logs:         journalctl -u arbishield-next -f"
