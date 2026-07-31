#!/usr/bin/env bash
# Mostra e-mail (auth.users) em /admin/users — lista + drawer Conta cliente.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-users-email.sh?ref=cursor/esqueci-senha-9ff2&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/esqueci-senha-9ff2}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_PATH="${ARBISHIELD_SHIM:-/opt/arbishield/scripts/arbishield-serverfn-shim.mjs}"
NGINX_CONF="${ARBISHIELD_NGINX_CONF:-/etc/nginx/sites-enabled/arbishield.app.conf}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
need nginx
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI admin-users.html"
dl "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -qE 'admin-users-email-v[12]' "$WEB/admin-users.html" || die "HTML sem admin-users-email marker"
grep -q 'ops-email' "$WEB/admin-users.html" || die "HTML sem ops-email"
grep -q 'enrichEmails' "$WEB/admin-users.html" || die "HTML sem enrichEmails (lista profiles-first)"

log "2/3 shim admin-users + email"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'admin-users-email-v1' "$SHIM_PATH" || die "shim sem marker email"
grep -q '/api/arbishield/admin-users' "$SHIM_PATH" || die "shim sem rota admin-users"

log "reiniciar shim (systemd)"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || \
  systemctl restart arbishield-serverfn.service 2>/dev/null || \
  log "AVISO: reinicie o shim 3101 manualmente se o e-mail não aparecer"

log "3/3 nginx — liberar /api/arbishield/admin-users"
export NGINX_CONF
if [[ -f "$NGINX_CONF" ]]; then
  if ! grep -q 'admin-users' "$NGINX_CONF"; then
    python3 - <<'PY'
from pathlib import Path
import os
p = Path(os.environ["NGINX_CONF"])
t = p.read_text(encoding="utf-8", errors="replace")
old = "contestations/pending-count)$"
new = "contestations/pending-count|admin-users)$"
if old in t and "|admin-users)" not in t and "admin-users)$" not in t:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("nginx: admin-users adicionado ao proxy 3101")
else:
    print("nginx: já ok ou padrão diferente — confira manualmente")
PY
  else
    log "nginx já menciona admin-users"
  fi
  nginx -t
  systemctl reload nginx
else
  # fallback: sites-available / conf do deploy
  for cand in \
    /etc/nginx/sites-available/arbishield.app.conf \
    /opt/arbishield/deploy/vps-supabase/nginx-arbishield.app.conf; do
    if [[ -f "$cand" ]] && grep -q 'admin-users' "$cand"; then
      log "encontrado conf com admin-users: $cand"
    fi
  done
  log "AVISO: $NGINX_CONF não encontrado — copie o nginx do repo e: nginx -t && systemctl reload nginx"
fi

echo
echo "OK — e-mail visível em /admin/users"
echo "  Hard refresh: Ctrl+Shift+R"
echo "  Busque: Leojaime31@hotmail.com"
echo "  Marker: admin-users-email-v1"
