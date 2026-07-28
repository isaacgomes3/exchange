#!/usr/bin/env bash
# Corrige travamentos arbishield.app — layout SPA original intacto.
# Mantém só overrides mínimos: /auth (login leve), /admin/matches, /admin/desafios (APIs).
#
# Uso na VPS (root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/consolidate-arbishield-app-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
REPO="${ARBISHIELD_REPO:-https://github.com/isaacgomes3/exchange.git}"
APP_DIR="${APP_DIR:-/opt/arbishield/app}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env}"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "comando '$1' não encontrado"
}
need curl
need node
need nginx
need systemctl
need python3

mkdir -p "$SCRIPTS_DIR" "$WEB" "$(dirname "$APP_DIR")"

download() {
  curl -fsSL "$RAW/$1" -o "$2"
}

log "Sincronizando código (curl, sem depender de git)"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
download "scripts/arbishield-desafio-suggestions.mjs" "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-fix-csr-boot.py" "$SCRIPTS_DIR/arbishield-fix-csr-boot.py"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-fix-csr-boot.py"

if command -v git >/dev/null 2>&1; then
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch origin "$BRANCH" 2>/dev/null || true
    git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || true
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH" 2>/dev/null || true
  else
    git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR" 2>/dev/null || warn "git clone falhou — usando só curl"
  fi
fi

log "Páginas VPS (desafios/login — jogos usa admin-jogos.html canônico em /v2)"
for pair in \
  "deploy/vps-supabase/static/admin-desafios-vps.html:$WEB/admin-desafios-vps.html" \
  "deploy/vps-supabase/static/admin-login-vps.html:$WEB/admin-login-vps.html" \
  "deploy/vps-supabase/static/auth-vps.html:$WEB/auth-vps.html" \
  "deploy/vps-supabase/static/desafio-sugestoes.html:$WEB/desafio-sugestoes.html"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  download "$src" "$dst"
  chmod 0644 "$dst"
done
mkdir -p "$WEB/assets"
for asset in app-boot-fix.js app-stability.js desafio-sugestoes-inject.js admin-modal-fix.js auth-boot-fix.js; do
  download "deploy/vps-supabase/static/$asset" "$WEB/assets/$asset" || true
done

log "Gestão de Jogos (canônico manualLaunchPanel)"
JOGOS_HELPER="$(mktemp)"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/scripts/arbishield-fetch-admin-jogos.sh" -o "$JOGOS_HELPER" 2>/dev/null || \
  curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/arbishield-fetch-admin-jogos.sh" -o "$JOGOS_HELPER"
# shellcheck source=/dev/null
source "$JOGOS_HELPER"
arbishield_deploy_admin_jogos_html "$WEB" || warn "admin-jogos canônico não publicado"
rm -f "$JOGOS_HELPER"

log "SPA usuario (index.html + /app)"
if [[ -f "$WEB/index.html.bak-stabilize" && ! -f "$WEB/index.html" ]]; then
  mv "$WEB/index.html.bak-stabilize" "$WEB/index.html"
  log "index.html restaurado do backup"
elif [[ ! -f "$WEB/index.html" ]]; then
  warn "index.html ausente em $WEB — /app ficará 404 até restaurar o espelho SPA"
fi

if [[ -f "$WEB/index.html" && -f "$SCRIPTS_DIR/arbishield-fix-csr-boot.py" ]]; then
  log "Patches anti-travamento no SPA (CSR boot + cache corrupto)"
  python3 "$SCRIPTS_DIR/arbishield-fix-csr-boot.py" "$WEB" || warn "CSR boot falhou — SPA pode continuar com hydration antiga"
fi

log "Nginx (SPA /admin original + serverFn :3101)"
if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
  download "deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
else
  download "deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
fi

if [[ -f "$ENV_FILE" ]]; then
  if ! grep -qE '^SERVICE_ROLE_KEY=' "$ENV_FILE"; then
    warn "SERVICE_ROLE_KEY ausente em $ENV_FILE — APIs admin podem falhar"
  fi
else
  warn "Env Supabase não encontrado: $ENV_FILE"
fi

if [[ -d "$COMPOSE_DIR" ]]; then
  log "Supabase Docker"
  (cd "$COMPOSE_DIR" && docker compose ps --status running 2>/dev/null | head -5) || warn "docker compose não respondeu"
  curl -fsS -o /dev/null "http://127.0.0.1:8000/auth/v1/health" || warn "Kong :8000 não responde — suba Supabase: cd $COMPOSE_DIR && docker compose up -d"
fi

log "Shim SPA (:3101) — backend do TanStack serverFn"
SHIM="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
if [[ -f "$SHIM" ]]; then
  if [[ ! -f /etc/systemd/system/arbishield-serverfn-shim.service ]]; then
    cat > /etc/systemd/system/arbishield-serverfn-shim.service <<EOF
[Unit]
Description=ArbiShield SPA serverFn shim :3101
After=network.target
[Service]
Type=simple
EnvironmentFile=-$ENV_FILE
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SHIM
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  fi
  systemctl daemon-reload
  systemctl enable arbishield-serverfn-shim.service
  systemctl restart arbishield-serverfn-shim.service
else
  die "serverfn-shim ausente — SPA trava sem dados dinâmicos"
fi

log "Workers admin :3098 / :3099"
cat > /etc/systemd/system/arbishield-prelive-events.service <<EOF
[Unit]
Description=ArbiShield admin API (jogos, desafios, prelive) :3098
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
EnvironmentFile=-$ENV_FILE
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
Description=ArbiShield sugestões desafio :3099
After=network.target

[Service]
Type=simple
EnvironmentFile=-$ENV_FILE
EnvironmentFile=-/opt/arbishield/.arbishield-odds-sync.env
Environment=ARBISHIELD_SUPABASE_URL=http://127.0.0.1:8000
ExecStart=/usr/bin/node $SCRIPTS_DIR/arbishield-desafio-suggestions.mjs --serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable arbishield-prelive-events.service arbishield-desafio-suggestions.service
systemctl restart arbishield-prelive-events.service arbishield-desafio-suggestions.service

nginx -t
systemctl reload nginx

if [[ "${SKIP_NEXT:-1}" == "1" ]]; then
  warn "Next desligado (SKIP_NEXT=1) — /admin usa SPA original"
elif command -v npm >/dev/null 2>&1 && [[ -f "$APP_DIR/package.json" ]]; then
  log "Painel geral (Next :3000)"
  if ARBISHIELD_BRANCH="$BRANCH" APP_DIR="$APP_DIR" bash "$APP_DIR/scripts/vps-deploy-next-admin.sh"; then
    log "Next OK — /arbishield/admin"
  else
    warn "Next falhou — hub /admin e jogos/desafios continuam"
  fi
  if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
    download "deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
  else
    download "deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
  fi
  nginx -t && systemctl reload nginx
else
  warn "Next não instalado — /admin continua no SPA original"
fi

sleep 2
log "Verificação"
FAIL=0
check() {
  local name="$1"
  local url="$2"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || echo 000)"
  printf "  %-28s %s\n" "$name" "$code"
  [[ "$code" =~ ^(200|204)$ ]] || FAIL=1
}

check "Kong auth" "http://127.0.0.1:8000/auth/v1/health"
check "Worker :3098 health" "http://127.0.0.1:3098/health"
check "Worker :3099 health" "http://127.0.0.1:3099/health"
check "API desafios" "http://127.0.0.1:3098/api/arbishield/desafios"
check "API prelive" "http://127.0.0.1:3098/api/arbishield/prelive-events"
check "HTTPS desafios" "https://arbishield.app/api/arbishield/desafios"
check "HTTPS admin SPA" "https://arbishield.app/admin"
check "HTTPS app usuario" "https://arbishield.app/app"
check "HTTPS admin jogos" "https://arbishield.app/admin/matches"
check "HTTPS admin desafios" "https://arbishield.app/admin/desafios"

if systemctl is-active --quiet arbishield-next.service 2>/dev/null; then
  code="$(curl -sS -o /dev/null -w '%{http_code}' "https://arbishield.app/arbishield/admin" || echo 000)"
  printf "  %-28s %s\n" "HTTPS painel geral" "$code"
  [[ "$code" =~ ^(200|307|308)$ ]] || warn "Painel geral respondeu $code"
fi

echo
if [[ "$FAIL" -ne 0 ]]; then
  warn "Alguns checks falharam."
  echo "Logs: journalctl -u arbishield-prelive-events -n 50 --no-pager"
  echo "      journalctl -u arbishield-desafio-suggestions -n 30 --no-pager"
  exit 1
fi

echo "OK — arbishield.app (anti-travamento, layout SPA original)"
echo "  App usuario:        https://arbishield.app/app"
echo "  Admin (SPA):        https://arbishield.app/admin"
echo "  Gestão de Jogos:    https://arbishield.app/admin/matches"
echo "  Gestão de Desafios: https://arbishield.app/admin/desafios"
