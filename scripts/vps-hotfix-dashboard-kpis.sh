#!/usr/bin/env bash
# Hotfix: KPIs do dashboard admin (lucro ≠ depósito, +desafio, caixa real)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/CURSOR_SHA/scripts/vps-hotfix-dashboard-kpis.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/tesouraria-desafio-settle-3cf9}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
NGINX_MAIN="${ARBISHIELD_NGINX_CONF:-/etc/nginx/sites-available/arbishield.app}"
MARKER="dashboard-kpis-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR" "$WEB_ROOT"

log "Shim :3101 ($MARKER) ref=$REF"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" \
  -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q "$MARKER" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem $MARKER"
grep -q 'todayDesafioProfit' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem todayDesafioProfit"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "admin.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin.html" \
  -o "$WEB/admin.html"
chmod 0644 "$WEB/admin.html"
cp -f "$WEB/admin.html" "$WEB_ROOT/admin.html" 2>/dev/null || true
grep -q 'dashboard-kpis-v1' "$WEB/admin.html" || die "admin.html sem marker"
grep -q 'não é depósito' "$WEB/admin.html" || die "admin.html sem copy lucro"

# Nginx: garante proxy dashboard-stats → :3101
if [[ -f "$NGINX_MAIN" ]]; then
  if ! grep -q 'location = /api/arbishield/dashboard-stats' "$NGINX_MAIN"; then
    log "nginx: inserir location dashboard-stats"
    NGINX_MAIN="$NGINX_MAIN" python3 - <<'PY'
import os
path = os.environ["NGINX_MAIN"]
text = open(path, encoding="utf-8").read()
block = """
    # KPIs do admin v2 (tesouraria + lucro proteções/desafio)
    location = /api/arbishield/dashboard-stats {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }
"""
needle = "location = /api/arbishield/dashboard {"
if needle in text and "dashboard-stats" not in text:
    text = text.replace(needle, block + "\n    " + needle.lstrip(), 1)
    open(path, "w", encoding="utf-8").write(text)
    print("inserted")
else:
    print("skip")
PY
    nginx -t && systemctl reload nginx || log "nginx reload falhou — confira manualmente"
  else
    log "nginx já tem dashboard-stats"
  fi
fi

echo
echo "OK — dashboard KPIs ($MARKER)"
echo "  https://arbishield.app/v2/admin.html  (Ctrl+F5)"
echo "  Esperado:"
echo "    Caixa = tesouraria operacional"
echo "    Lucro Real Hoje = proteções liquidadas + desafio (casa) − despesas"
echo "    Depósitos Hoje ≠ Lucro Real Hoje"
