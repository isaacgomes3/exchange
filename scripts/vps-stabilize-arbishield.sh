#!/usr/bin/env bash
# Estabilização completa arbishield.app — visual + banco intactos.
# Corrige nginx morto (:3101/:3000), sobe workers :3098/:3099, desliga legado.
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
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs"

if command -v git >/dev/null 2>&1; then
  if [[ -d "$APP_DIR/.git" ]]; then
    git -C "$APP_DIR" fetch origin "$BRANCH" 2>/dev/null || true
    git -C "$APP_DIR" checkout "$BRANCH" 2>/dev/null || true
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH" 2>/dev/null || true
  else
    git clone --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR" 2>/dev/null || warn "git clone falhou — usando só curl"
  fi
fi

log "HTML admin (visual inalterado)"
for pair in \
  "deploy/vps-supabase/static/admin-jogos-vps.html:$WEB/admin-jogos-vps.html" \
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
download "deploy/vps-supabase/static/desafio-sugestoes-inject.js" "$WEB/assets/desafio-sugestoes-inject.js" || true

log "Arquivando SPA antigo (evita rotas corrompidas)"
if [[ -f "$WEB/index.html" && ! -f "$WEB/index.html.bak-stabilize" ]]; then
  mv "$WEB/index.html" "$WEB/index.html.bak-stabilize"
  warn "index.html antigo → index.html.bak-stabilize"
fi

log "Nginx limpo (admin → :3098/:3099/:8000)"
if [[ -f /etc/letsencrypt/live/arbishield.app/fullchain.pem ]]; then
  download "deploy/vps-supabase/nginx-arbishield.app.conf" "$NGINX_CONF"
else
  download "deploy/vps-supabase/nginx-cutover.conf" "$NGINX_CONF"
fi

python3 <<'PY'
import re
from pathlib import Path

def clean(text: str) -> str:
    text = re.sub(r"\n\s*location \^~ /_serverFn/ \{.*?\n\s*\}\n", "\n", text, flags=re.DOTALL)
    text = re.sub(r"proxy_pass http://127\.0\.0\.1:3101;", "proxy_pass http://127.0.0.1:3098;", text)
    text = re.sub(
        r"location /api/arbishield/ \{[^}]*proxy_pass http://127\.0\.0\.1:3000;[^}]*\}",
        "",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"location /arbishield \{[^}]*proxy_pass http://127\.0\.0\.1:3000;[^}]*\}",
        "",
        text,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"location /_next/ \{[^}]*proxy_pass http://127\.0\.0\.1:3000;[^}]*\}",
        "",
        text,
        flags=re.DOTALL,
    )
    return text

for p in list(Path("/etc/nginx/conf.d").glob("*.conf")) + list(Path("/etc/nginx/sites-enabled").glob("*")):
    if not p.is_file():
        continue
    t = p.read_text(errors="ignore")
    if "_serverFn" in t or ":3101" in t or ("arbishield" in t.lower() and ":3000" in t):
        p.write_text(clean(t))
        print("limpo:", p)
PY

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

log "Desligando serviços legados"
for svc in arbishield-serverfn-shim arbishield-next; do
  systemctl disable --now "$svc.service" 2>/dev/null || true
done

log "systemd workers :3098 / :3099"
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
check "HTTPS admin jogos" "https://arbishield.app/admin/matches"
check "HTTPS admin desafios" "https://arbishield.app/admin/desafios"

echo
if [[ "$FAIL" -ne 0 ]]; then
  warn "Alguns checks falharam."
  echo "Logs: journalctl -u arbishield-prelive-events -n 50 --no-pager"
  echo "      journalctl -u arbishield-desafio-suggestions -n 30 --no-pager"
  exit 1
fi

echo "OK — arbishield.app estabilizado"
echo "  Gestão de Jogos:    https://arbishield.app/admin/matches"
echo "  Gestão de Desafios: https://arbishield.app/admin/desafios"
echo "  Login:              https://arbishield.app/auth"
