#!/usr/bin/env bash
# Hardening admin (pós-incidente jawadog / Admin Probe):
#  1) user_roles: INSERT/UPDATE/DELETE só VPS/service_role (JWT não promove)
#  2) profiles: grants apertados (sem is_super_admin / saldos / affiliate no client)
#  3) allowlist de e-mail no shim + v2.js
#  4) invalida sessões dos 4 admins (força novo login) + contas banidas
#  5) remove roles admin fora da allowlist
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-hotfix-admin-hardening.sh")
#
# Sem forçar re-login dos admins:
#   SKIP_RELOGIN=1 bash <(curl ...)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-adm-jawadog-3e4b}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="admin-hard-v1"
SKIP_RELOGIN="${SKIP_RELOGIN:-0}"

ALLOWED_EMAILS=(
  "isaacgomes3@gmail.com"
  "financeiro@arbishield.com"
  "carlos@arbishield.com"
  "icaro@arbishield.com"
)

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
need docker
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

DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB" ]] || die "container postgres não encontrado"
psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

# ─── 1) SQL hardening ───────────────────────────────────────────────
log "aplicando SQL admin_hardening_vps_only"
SQL_TMP="$(mktemp)"
fetch "supabase/migrations/20260731_admin_hardening_vps_only.sql" "$SQL_TMP"
grep -q 'user_roles_admin_insert' "$SQL_TMP" || die "SQL inválido"
psql_db -f "$SQL_TMP"
rm -f "$SQL_TMP"

log "policies user_roles (mutação autenticada deve sumir)"
psql_db -c "
SELECT policyname, cmd FROM pg_policies
WHERE tablename='user_roles' ORDER BY policyname;
"

log "grants is_super_admin (anon/authenticated só SELECT/REFERENCES)"
psql_db -c "
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema='public' AND table_name='profiles'
  AND column_name='is_super_admin'
  AND grantee IN ('anon','authenticated')
ORDER BY 1,2;
"

# ─── 2) Remove roles admin fora da allowlist ─────────────────────────
log "removendo roles admin fora da allowlist"
ALLOW_SQL="$(printf "'%s'," "${ALLOWED_EMAILS[@]}" | sed 's/,$//')"
psql_db -c "
DELETE FROM public.user_roles ur
USING auth.users u
WHERE ur.user_id = u.id
  AND ur.role::text IN ('admin', 'master_admin')
  AND lower(u.email) NOT IN (${ALLOW_SQL});

SELECT u.email::text, ur.role::text
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role::text IN ('admin','master_admin')
ORDER BY u.email;
"

log "is_super_admin fora da allowlist → false (bypass trigger)"
psql_db <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles p
SET is_super_admin = false, updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND p.is_super_admin IS TRUE
  AND lower(u.email) NOT IN (${ALLOW_SQL});
RESET session_replication_role;
COMMIT;

SELECT p.full_name, u.email::text, p.is_super_admin, p.account_status
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE p.is_super_admin IS TRUE
ORDER BY u.email;
SQL

# ─── 3) Invalidar sessões ───────────────────────────────────────────
if [[ "$SKIP_RELOGIN" != "1" ]]; then
  log "invalidando refresh tokens / sessions (admins allowlist + banidos)"
  psql_db <<SQL
DO \$\$
BEGIN
  -- Contas banidas / incidente + força re-login dos 4 admins
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens
    WHERE user_id IN (
      SELECT id FROM auth.users
      WHERE lower(email) IN (
        'jawadog871@kierko.com',
        'admin.probe.1784500869@arbishield.local',
        ${ALLOW_SQL}
      )
      OR banned_until IS NOT NULL
    );
  END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions
    WHERE user_id IN (
      SELECT id FROM auth.users
      WHERE lower(email) IN (
        'jawadog871@kierko.com',
        'admin.probe.1784500869@arbishield.local',
        ${ALLOW_SQL}
      )
      OR banned_until IS NOT NULL
    );
  END IF;
END \$\$;
SQL
  log "admins precisam fazer login de novo"
else
  log "SKIP_RELOGIN=1 — sessões dos admins preservadas"
fi

# ─── 4) Deploy v2.js + shim ─────────────────────────────────────────
log "deploy v2.js (allowlist + blocked emails)"
fetch "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'admin-email-allowlist-v1' "$WEB/v2.js" || die "v2.js sem allowlist"

# bust cache em páginas admin principais
for f in "$WEB"/*.html "$WEB_ROOT"/admin*.html; do
  [[ -f "$f" ]] || continue
  sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" "$f" 2>/dev/null || true
done

EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'admin-email-allowlist-v1' "$SHIM_PATH" || die "shim sem allowlist"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# ─── 5) Script promover (VPS only) ──────────────────────────────────
fetch "scripts/vps-promover-admin.sh" "$SCRIPTS_DIR/vps-promover-admin.sh"
chmod 0755 "$SCRIPTS_DIR/vps-promover-admin.sh"

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "OK — hardening admin aplicado"
echo "  • Promover admin: só VPS → $SCRIPTS_DIR/vps-promover-admin.sh"
echo "  • Allowlist API/UI: isaac / financeiro / carlos / icaro"
echo "  • Admins: façam login de novo (sessões invalidadas)"
echo "  • Ctrl+F5 nas páginas /admin-*.html"
echo "════════════════════════════════════════════════════════════════════════"
