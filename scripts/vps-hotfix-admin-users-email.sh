#!/usr/bin/env bash
# Usuários: e-mail (auth.users) + botão Saldo (ajuste financeiro).
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-users-email.sh?ref=cursor/esqueci-senha-9ff2&t=$(date +%s)")
set -euo pipefail

BRANCH="${ARBISHIELD_REF:-cursor/esqueci-senha-9ff2}"
# Pin opcional: ARBISHIELD_SHA=<commit>
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
BUST="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
need python3
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

log "resolvendo tip de $BRANCH"
if [[ -n "${ARBISHIELD_SHA:-}" ]]; then
  SHA="$ARBISHIELD_SHA"
else
  SHA="$(
    curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}?t=${BUST}" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
  )"
fi
log "tip=$SHA"

RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"
RAW_API="https://api.github.com/repos/isaacgomes3/exchange/contents"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}?t=${BUST}" -o "$dest"; then
    return 0
  fi
  if curl -fsSL "${RAW_GH}/${rel}?t=${BUST}" -o "$dest"; then
    return 0
  fi
  curl -fsSL -H "Accept: application/vnd.github.raw" \
    "${RAW_API}/${rel}?ref=${SHA}&t=${BUST}" -o "$dest"
}

assert_file() {
  local f="$1" pattern="$2" msg="$3"
  if ! grep -qE "$pattern" "$f"; then
    echo "---- head $f ----" >&2
    head -n 20 "$f" >&2 || true
    die "$msg"
  fi
}

log "1/3 UI admin-users (e-mail + Saldo)"
fetch "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
assert_file "$WEB/admin-users.html" 'admin-users-email-saldo-v1|data-saldo' "HTML sem e-mail/saldo (baixe tip=$SHA)"
assert_file "$WEB/admin-users.html" 'adjust-balance' "HTML sem adjust-balance"
assert_file "$WEB/admin-users.html" 'FN_ADMIN_LIST_USERS|enrichEmails' "HTML sem enrich e-mail"
# cache bust local
sed -i -E \
  -e "s|/v2\\.css(\\?[^\"]*)?|/v2.css?v=users-email-saldo-${BUST}|g" \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=users-email-saldo-${BUST}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=users-email-saldo-${BUST}|g" \
  -e "s|/finance-admins\\.js(\\?[^\"]*)?|/finance-admins.js?v=users-email-saldo-${BUST}|g" \
  "$WEB/admin-users.html" || true
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true

log "2/3 shim (e-mail + adjustAdminBalance)"
TMP="$(mktemp)"
fetch "scripts/arbishield-serverfn-shim.mjs" "$TMP"
assert_file "$TMP" 'adjustAdminBalance' "shim sem adjustAdminBalance"
assert_file "$TMP" '/api/arbishield/adjust-balance' "shim sem rota adjust-balance"
assert_file "$TMP" 'admin-users-email-v1|/api/arbishield/admin-users' "shim sem admin-users"

SHIMS=()
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIMS+=("$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)")
fi
SHIMS+=(
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
  /opt/arbishield/arbishield-serverfn-shim.mjs
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
)
for dest in "${SHIMS[@]}"; do
  [[ -n "${dest:-}" ]] || continue
  mkdir -p "$(dirname "$dest")"
  cp -f "$TMP" "$dest"
  chmod 0644 "$dest"
  log "shim → $dest"
done
rm -f "$TMP"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || \
  log "AVISO: reinicie o shim :3101 manualmente"
sleep 1

log "3/3 nginx adjust-balance + admin-users"
python3 - <<'PY'
from pathlib import Path
cands = [
    Path("/etc/nginx/sites-enabled/arbishield.app.conf"),
    Path("/etc/nginx/sites-available/arbishield.app.conf"),
    Path("/etc/nginx/conf.d/arbishield.app.conf"),
    Path("/etc/nginx/conf.d/arbishield-cutover.conf"),
]
block = """
    location = /api/arbishield/adjust-balance {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
    location = /api/arbishield/admin-adjust-balance {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
    location = /api/arbishield/admin-users {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
for p in cands:
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    changed = False
    if "location = /api/arbishield/adjust-balance" not in t:
        if "location ^~ /_serverFn/" in t:
            t = t.replace("location ^~ /_serverFn/", block + "\n    location ^~ /_serverFn/", 1)
            changed = True
        elif "location / {" in t:
            t = t.replace("location / {", block + "\n    location / {", 1)
            changed = True
    if "|adjust-balance|" not in t and "adjust-balance)$" not in t and "adjust-balance|" not in t:
        old = "contestations/pending-count)$"
        new = "contestations/pending-count|admin-users|adjust-balance|admin-adjust-balance)$"
        if old in t:
            t = t.replace(old, new, 1)
            changed = True
    if changed:
        p.write_text(t, encoding="utf-8")
        print("patched", p)
    else:
        print("ok/skip", p)
PY

if command -v nginx >/dev/null 2>&1; then
  nginx -t
  systemctl reload nginx
fi

echo
echo "OK — Usuários com e-mail + botão Saldo"
echo "  tip=$SHA"
echo "  Ctrl+Shift+R em https://arbishield.app/admin/users"
echo "  Saldo só para allowlist Financeiro (isaac / financeiro@)"
echo "  Marker: admin-users-email-saldo-v1"
