#!/usr/bin/env bash
# Hotfix: Contestação de Aposta completa (cliente + ADM + shim)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/contestacao-aposta-completa-723d/scripts/vps-hotfix-contestacao-aposta.sh?v=2")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/contestacao-aposta-completa-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR"

log "Shim :3101 (contestação submit/list/approve/reject)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'CONTESTATION_SUBMIT\|submitContestation\|contestations/submit' \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem handlers de contestação"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI cliente + admin"
for f in app-protecoes.html admin-contestations.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

grep -q 'Contestar proteção\|Em Contestação' "$WEB/app-protecoes.html" || die "app-protecoes sem contestação"
grep -q 'Contestações de Apostas\|contestations/approve' "$WEB/admin-contestations.html" || die "admin-contestations incompleto"
grep -q 'Contestações de Apostas\|pending-count' "$WEB/v2-shell.js" || die "v2-shell sem badge de contestações"

# nginx: liberar rotas de contestação no shim :3101
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done

if [[ -n "$NGINX_CONF" ]]; then
  if grep -q 'api/arbishield/(desafio-register' "$NGINX_CONF"; then
    if ! grep -q 'contestations/submit' "$NGINX_CONF"; then
      log "Atualizar nginx para rotas de contestação"
      python3 - <<'PY' "$NGINX_CONF"
import sys
path = sys.argv[1]
text = open(path).read()
old = "affiliate-withdraw|protection-close|protection-cancel|match-settle)"
new = "affiliate-withdraw|protection-close|protection-cancel|match-settle|contestations|contestations/submit|contestations/approve|contestations/reject|contestations/pending-count)"
if old in text and "contestations/submit" not in text:
    text = text.replace(old, new, 1)
    open(path, "w").write(text)
    print("nginx patched")
else:
    print("nginx já ok ou padrão diferente")
PY
      nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
    fi
  fi
fi

echo
echo "OK — Contestação de Aposta"
echo "  Cliente: https://arbishield.app/app-protecoes.html"
echo "  Admin:   https://arbishield.app/admin-contestations.html"
echo "  SPA legado Contestar Odd agora usa /_serverFn no shim"
echo "  Ctrl+F5 nas páginas"
