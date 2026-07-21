#!/usr/bin/env bash
# Hotfix: Minhas Proteções — Detalhes + Cancelar + Contestar (visão cliente)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/minhas-protecoes-evento-723d/scripts/vps-hotfix-minhas-protecoes-evento.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/minhas-protecoes-evento-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR"

log "UI Gestão de Proteções (cancelar + contestar)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html" -o "$WEB/app-protecoes.html"
chmod 0644 "$WEB/app-protecoes.html"
cp -f "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" 2>/dev/null || true

grep -q 'Protocolo de Auditoria' "$WEB/app-protecoes.html" || die "HTML sem painel Detalhes"
grep -q 'Cancelar Ancoragem' "$WEB/app-protecoes.html" || die "HTML sem Cancelar Ancoragem"
grep -q 'Contestação de Odd' "$WEB/app-protecoes.html" || die "HTML sem Contestação"
if grep -q 'market_category' "$WEB/app-protecoes.html"; then
  die "HTML ainda referencia market_category no select"
fi

log "Shim :3101 (cancel user + odd-contestation)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'USER_CANCEL_PROTECTION\|createOddContestation' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || \
  die "shim sem cancel/contest cliente"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Nginx odd-contestation"
for conf in \
  /etc/nginx/sites-enabled/arbishield.app.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app.conf
do
  [[ -f "$conf" ]] || continue
  if grep -q 'protection-cancel' "$conf" && ! grep -q 'odd-contestation' "$conf"; then
    sed -i 's/protection-cancel)/protection-cancel|odd-contestation)/g' "$conf" || true
    echo "  patched $conf"
  fi
done
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo
echo "OK — Cliente: Detalhes + Cancelar + Contestar"
echo "  https://arbishield.app/app-protecoes.html  (Ctrl+F5 → Detalhes)"
