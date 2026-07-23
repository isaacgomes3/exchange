#!/usr/bin/env bash
# Bloqueia contas Jefferson no Auth + remove roles admin + remove bypass SPA.
#
# Na VPS (como root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-ban-jefferson-emails.sh?v=1")
#
# NÃO cole SQL puro no bash — este script roda via psql no container.
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need docker

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

# --- 1) Ban no Postgres (Auth) ---
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

SQL="$(cat <<'SQL'
BEGIN;

UPDATE auth.users u
SET banned_until = '2099-12-31 00:00:00+00',
    updated_at = now()
WHERE lower(u.email) IN (
  'jefferson@arbishield.com',
  'jefferson@arbishield',
  'jeffersonboulevard@gmail.com',
  'jeffersojeffersonboulevard@gmail.com'
);

UPDATE public.profiles p
SET is_super_admin = false,
    account_status = 'banned',
    updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) IN (
    'jefferson@arbishield.com',
    'jefferson@arbishield',
    'jeffersonboulevard@gmail.com',
    'jeffersojeffersonboulevard@gmail.com'
  );

DELETE FROM public.user_roles ur
USING auth.users u
WHERE ur.user_id = u.id
  AND lower(u.email) IN (
    'jefferson@arbishield.com',
    'jefferson@arbishield',
    'jeffersonboulevard@gmail.com',
    'jeffersojeffersonboulevard@gmail.com'
  );

COMMIT;

SELECT u.email, u.banned_until, p.is_super_admin, p.account_status
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE lower(u.email) IN (
  'jefferson@arbishield.com',
  'jefferson@arbishield',
  'jeffersonboulevard@gmail.com',
  'jeffersojeffersonboulevard@gmail.com'
)
ORDER BY u.email;
SQL
)"

log "banindo emails no Postgres ($DB_CONTAINER)"
if ! echo "$SQL" | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1; then
  log "tentando com supabase_admin…"
  echo "$SQL" | docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
    || die "falha ao aplicar ban no Postgres"
fi

# Sessões (best-effort, fora da txn principal)
log "encerrando sessões (best-effort)"
SESS_SQL="$(cat <<'SQL'
DO $$
BEGIN
  DELETE FROM auth.sessions s
  USING auth.users u
  WHERE s.user_id = u.id
    AND lower(u.email) IN (
      'jefferson@arbishield.com',
      'jefferson@arbishield',
      'jeffersonboulevard@gmail.com',
      'jeffersojeffersonboulevard@gmail.com'
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'sessions skip: %', SQLERRM;
END $$;

DO $$
BEGIN
  DELETE FROM auth.refresh_tokens rt
  USING auth.users u
  WHERE rt.user_id::text = u.id::text
    AND lower(u.email) IN (
      'jefferson@arbishield.com',
      'jefferson@arbishield',
      'jeffersonboulevard@gmail.com',
      'jeffersojeffersonboulevard@gmail.com'
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'refresh_tokens skip: %', SQLERRM;
END $$;
SQL
)"
echo "$SESS_SQL" | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres >/dev/null 2>&1 \
  || echo "$SESS_SQL" | docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres >/dev/null 2>&1 \
  || log "aviso: não foi possível limpar sessions (ok se schema diferir)"

# --- 2) Arquivos de bloqueio no site ---
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"
log "deploy blocked-emails.js + logins + v2.js + shim"
fetch "deploy/vps-supabase/static/blocked-emails.js" "$WEB_ROOT/blocked-emails.js"
chmod 0644 "$WEB_ROOT/blocked-emails.js"
cp -f "$WEB_ROOT/blocked-emails.js" "$WEB/blocked-emails.js" 2>/dev/null || true

fetch "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'jefferson@arbishield.com' "$WEB/v2.js" || die "v2.js sem lista de bloqueio"

fetch "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html" 2>/dev/null || true

fetch "deploy/vps-supabase/static/auth-vps.html" "$WEB_ROOT/auth-vps.html" || true
fetch "deploy/vps-supabase/static/admin-login-vps.html" "$WEB_ROOT/admin-login-vps.html" || true
chmod 0644 "$WEB_ROOT/auth-vps.html" "$WEB_ROOT/admin-login-vps.html" 2>/dev/null || true

# Shim
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'BLOCKED_EMAILS' "$SHIM_PATH" || die "shim sem BLOCKED_EMAILS"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# --- 3) Remove bypass no SPA (assets) ---
log "removendo bypass Jefferson nos assets SPA"
python3 - <<'PY'
from pathlib import Path
import re
roots = [Path("/var/www/arbishield"), Path("/var/www/arbishield/v2"), Path("/var/www/legado")]
old = 'b0e=new Set(["jefferson@arbishield.com","jefferson@arbishield","jeffersonboulevard@gmail.com","jeffersojeffersonboulevard@gmail.com"])'
new = 'b0e=new Set([])'
old2 = 'function AL(e){return e?b0e.has(e.toLowerCase()):!1}'
new2 = 'function AL(e){return!1}'
n = 0
for root in roots:
    if not root.exists():
        continue
    for p in root.rglob("main-*.js"):
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        t2 = t
        if old in t2:
            t2 = t2.replace(old, new)
        # fallback genérico
        t2 = re.sub(
            r'b0e=new Set\(\[[^\]]*jefferson[^\]]*\]\)',
            'b0e=new Set([])',
            t2,
        )
        if old2 in t2:
            t2 = t2.replace(old2, new2)
        if t2 != t:
            p.write_text(t2, encoding="utf-8")
            print(f"  patched {p}")
            n += 1
print(f"arquivos SPA patchados: {n}")
PY

log "OK — contas Jefferson banidas no Auth + bloqueio no login/API"
log "Teste: tente logar com jefferson@arbishield.com (deve falhar)"
