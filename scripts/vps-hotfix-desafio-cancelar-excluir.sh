#!/usr/bin/env bash
# Hotfix: Excluir / Cancelar desafio no ADM com devolução de saldo
#
# - Cancelar · devolver saldo: estorna entradas pendentes na carteira Desafio
# - Excluir: soft-delete só se não houver cliente com entrada ativa
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-cancelar-desafio-3cf9/scripts/vps-hotfix-desafio-cancelar-excluir.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-cancelar-desafio-3cf9}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="desafio-cancel-2"
NGINX_MAIN="${ARBISHIELD_NGINX_CONF:-/etc/nginx/sites-available/arbishield.app}"

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
grep -q 'data-cancel-desafio' "$WEB/admin-desafios.html" || die "admin-desafios sem Cancelar"
grep -q 'data-delete-desafio' "$WEB/admin-desafios.html" || die "admin-desafios sem Excluir"
sed -i -E \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

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
grep -q 'async function cancelDesafio' "$SHIM_PATH" || die "shim sem cancelDesafio"
grep -q 'desafio-delete' "$SHIM_PATH" || die "shim sem rota desafio-delete"
grep -q 'cancelDesafioParticipation' "$SHIM_PATH" || die "shim sem cancelDesafioParticipation"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# Nginx — garante proxy das novas rotas
if [[ -f "$NGINX_MAIN" ]]; then
  log "nginx $NGINX_MAIN"
  if ! grep -q 'desafio-delete' "$NGINX_MAIN"; then
    python3 - "$NGINX_MAIN" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
old = "desafio-participations|"
new = "desafio-participations|desafio-delete|desafio-cancel|desafio-pending-counts|"
if old in t and "desafio-delete" not in t:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("patched nginx location")
else:
    print("nginx já ok ou padrão diferente")
PY
    nginx -t && systemctl reload nginx || true
  else
    log "nginx já inclui desafio-delete"
  fi
else
  log "nginx conf não encontrado em $NGINX_MAIN (ok se já proxyar /api/arbishield/*)"
fi

log "Smoke rotas"
for path in desafio-delete desafio-cancel desafio-pending-counts; do
  code="$(curl -sS -o /tmp/desafio-smoke.json -w '%{http_code}' -X POST "http://127.0.0.1:3101/api/arbishield/${path}" -H 'Content-Type: application/json' -d '{}' || true)"
  echo "  ${path} → HTTP ${code} $(head -c 120 /tmp/desafio-smoke.json 2>/dev/null || true)"
done

log "OK — Cancelar/Excluir desafio ativo"
log "  Ctrl+F5 em /admin-desafios.html"
log "  Cancelar · devolver saldo → estorna pendentes na carteira Desafio"
log "  Excluir → só sem clientes ativos"
