#!/usr/bin/env bash
# Mostra e-mail (auth.users) em /admin/users — lista + drawer Conta cliente.
# Usa /_serverFn (já no nginx) + rota /api/arbishield/admin-users.
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
SHIM_CANDIDATES=(
  "${ARBISHIELD_SHIM:-}"
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
  /opt/arbishield/arbishield-serverfn-shim.mjs
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
)

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI admin-users.html"
dl "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -q 'admin-users-email-v3' "$WEB/admin-users.html" || die "HTML sem admin-users-email-v3"
grep -q 'FN_ADMIN_LIST_USERS' "$WEB/admin-users.html" || die "HTML sem FN_ADMIN_LIST_USERS"
grep -q 'enrichEmails' "$WEB/admin-users.html" || die "HTML sem enrichEmails"

log "2/3 shim (todas as cópias conhecidas)"
TMP_SHIM="$(mktemp)"
dl "scripts/arbishield-serverfn-shim.mjs" "$TMP_SHIM"
grep -q 'admin-users-email-v1' "$TMP_SHIM" || die "shim sem marker email"
grep -q 'replyFnOk' "$TMP_SHIM" || die "shim sem replyFnOk"
UPDATED=0
for dest in "${SHIM_CANDIDATES[@]}"; do
  [[ -z "$dest" ]] && continue
  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  cp -f "$TMP_SHIM" "$dest"
  chmod 0644 "$dest"
  log "shim → $dest"
  UPDATED=1
done
[[ "$UPDATED" -eq 1 ]] || die "nenhum destino de shim encontrado"
rm -f "$TMP_SHIM"

log "reiniciar shim systemd"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || \
  systemctl restart arbishield-serverfn.service 2>/dev/null || \
  log "AVISO: serviço systemd do shim não encontrado — reinicie o processo na porta 3101"

sleep 1
if curl -fsS -o /dev/null -w "%{http_code}" http://127.0.0.1:3101/health 2>/dev/null | grep -qE '200|503'; then
  log "shim :3101 respondeu em /health"
else
  log "AVISO: /health em :3101 não respondeu — confira o processo do shim"
fi

log "3/3 nginx — location exact /api/arbishield/admin-users"
NGINX_FILES=(
  /etc/nginx/sites-enabled/arbishield.app.conf
  /etc/nginx/sites-available/arbishield.app.conf
  /etc/nginx/conf.d/arbishield.app.conf
)
PATCHED=0
for conf in "${NGINX_FILES[@]}"; do
  [[ -f "$conf" ]] || continue
  if grep -q 'location = /api/arbishield/admin-users' "$conf"; then
    log "já existe location exact em $conf"
    PATCHED=1
    continue
  fi
  python3 - "$conf" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
block = """
    # Marker: admin-users-email-v1 — profiles + email auth.users
    location = /api/arbishield/admin-users {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
# inserir após match-settle se existir; senão antes de location /_serverFn/
if "location = /api/arbishield/match-settle" in t and "admin-users {" not in t:
    needle = "location = /api/arbishield/match-settle"
    idx = t.find(needle)
    # achar fim do bloco match-settle
    brace = t.find("{", idx)
    depth = 0
    end = brace
    for i, ch in enumerate(t[brace:], brace):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    t = t[:end] + "\n" + block + t[end:]
    p.write_text(t, encoding="utf-8")
    print(f"patched after match-settle: {p}")
elif "location ^~ /_serverFn/" in t and "admin-users {" not in t:
    t = t.replace("location ^~ /_serverFn/", block + "\n    location ^~ /_serverFn/", 1)
    p.write_text(t, encoding="utf-8")
    print(f"patched before _serverFn: {p}")
else:
    print(f"skip/no-op: {p}")
PY
  PATCHED=1
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t
  systemctl reload nginx
  log "nginx reloaded"
else
  log "AVISO: nginx não encontrado no PATH"
fi

echo
echo "OK — e-mail via /_serverFn + /api/arbishield/admin-users"
echo "  Hard refresh obrigatório: Ctrl+Shift+R em https://arbishield.app/admin/users"
echo "  Busque: Leojaime31@hotmail.com"
echo "  Marker UI: admin-users-email-v3"
