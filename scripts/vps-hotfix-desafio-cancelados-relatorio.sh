#!/usr/bin/env bash
# Hotfix: relatório de desafios cancelados (aba Cancelados + API + script CLI)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/relatorio-desafios-cancelados-3e4b/scripts/vps-hotfix-desafio-cancelados-relatorio.sh?v=1")
#
# Depois: Ctrl+F5 em /admin-desafios.html → aba Cancelados (data = ontem BRT)
# CLI: DATE=2026-07-30 bash /opt/arbishield/scripts/vps-relatorio-desafios-cancelados.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/relatorio-desafios-cancelados-3e4b}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="desafio-cancelados-3"
NGINX_MAIN="${ARBISHIELD_NGINX_CONF:-}"
if [[ -z "$NGINX_MAIN" ]]; then
  for c in \
    /etc/nginx/sites-available/arbishield.app \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/conf.d/arbishield.conf; do
    [[ -f "$c" ]] && NGINX_MAIN="$c" && break
  done
  NGINX_MAIN="${NGINX_MAIN:-/etc/nginx/sites-available/arbishield.app}"
fi

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"
RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then return 0; fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "admin-desafios.html"
fetch "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
grep -q 'data-f="cancelled"' "$WEB/admin-desafios.html" || die "admin-desafios sem aba Cancelados"
grep -q 'desafio-cancelled-report' "$WEB/admin-desafios.html" || die "admin-desafios sem fetch do relatório"
sed -i -E \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

log "script CLI relatório"
fetch "scripts/vps-relatorio-desafios-cancelados.mjs" "$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.mjs"
fetch "scripts/vps-relatorio-desafios-cancelados.sh" "$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.sh"
chmod 0755 "$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.mjs" "$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.sh"

# Shim
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'async function listDesafioCancelledReport' "$SHIM_PATH" || die "shim sem listDesafioCancelledReport"
grep -q 'desafio-cancelled-report' "$SHIM_PATH" || die "shim sem rota desafio-cancelled-report"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

if [[ -f "$NGINX_MAIN" ]]; then
  log "nginx $NGINX_MAIN"
  if ! grep -q 'desafio-cancelled-report' "$NGINX_MAIN"; then
    python3 - "$NGINX_MAIN" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
old = "desafio-pending-counts|"
new = "desafio-pending-counts|desafio-cancelled-report|desafio-cancelados-relatorio|"
if old in t and "desafio-cancelled-report" not in t:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("patched nginx location")
else:
    print("nginx já ok ou padrão diferente")
PY
    nginx -t && systemctl reload nginx || true
  else
    log "nginx já inclui desafio-cancelled-report"
  fi
else
  log "nginx conf não encontrado em $NGINX_MAIN"
fi

log "Smoke rota"
code="$(curl -sS -o /tmp/desafio-cancelados-smoke.json -w '%{http_code}' -X POST "http://127.0.0.1:3101/api/arbishield/desafio-cancelled-report" -H 'Content-Type: application/json' -d '{}' || true)"
echo "  desafio-cancelled-report → HTTP ${code} $(head -c 160 /tmp/desafio-cancelados-smoke.json 2>/dev/null || true)"

log "Rodando relatório de ontem (CLI)"
if [[ -f /opt/arbishield/deploy/vps-supabase/.env ]] || [[ -f /opt/arbishield/.env ]]; then
  DATE="${DATE:-}" ONLY_WITH_CLIENTS=1 \
    ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-http://127.0.0.1:8000}" \
    node "$SCRIPTS_DIR/vps-relatorio-desafios-cancelados.mjs" || true
else
  log "sem .env local — pulei CLI automático"
fi

log "OK — Relatório de desafios cancelados"
log "  Ctrl+F5 em /admin-desafios.html → aba Cancelados"
log "  CLI: DATE=YYYY-MM-DD node $SCRIPTS_DIR/vps-relatorio-desafios-cancelados.mjs"
