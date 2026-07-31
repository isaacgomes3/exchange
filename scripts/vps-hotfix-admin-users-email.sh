#!/usr/bin/env bash
# Usuários: e-mail (auth.users) + botão Saldo (ajuste financeiro).
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

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI admin-users (e-mail + Saldo)"
dl "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -q 'admin-users-email-saldo-v1' "$WEB/admin-users.html" || die "HTML sem marker email-saldo"
grep -q 'data-saldo' "$WEB/admin-users.html" || die "HTML sem botão Saldo"
grep -q 'adjust-balance' "$WEB/admin-users.html" || die "HTML sem adjust-balance"
grep -q 'FN_ADMIN_LIST_USERS\|enrichEmails' "$WEB/admin-users.html" || die "HTML sem enrich e-mail"

log "2/3 shim (e-mail + adjustAdminBalance)"
TMP="$(mktemp)"
dl "scripts/arbishield-serverfn-shim.mjs" "$TMP"
grep -q 'adjustAdminBalance' "$TMP" || die "shim sem adjustAdminBalance"
grep -q '/api/arbishield/adjust-balance' "$TMP" || die "shim sem rota adjust-balance"
grep -q 'admin-users-email-v1\|/api/arbishield/admin-users' "$TMP" || die "shim sem admin-users"

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
        elif "location = /api/arbishield/match-settle" in t:
            # append after first match-settle block end is hard; prepend before serverFn-ish
            t = t.replace("location / {", block + "\n    location / {", 1)
            changed = True
    # regex list: add adjust-balance if missing
    if "|adjust-balance|" not in t and "adjust-balance|" not in t and "adjust-balance)$" not in t:
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
echo "  Ctrl+Shift+R em /admin/users"
echo "  Saldo só aparece para allowlist Financeiro (isaac / financeiro@)"
echo "  Marker: admin-users-email-saldo-v1"
