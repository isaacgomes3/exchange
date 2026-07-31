#!/usr/bin/env bash
# Revoga conta "Admin Probe" (não autorizada):
#   - is_super_admin=false + account_status=blocked (bypass trigger)
#   - remove user_roles admin/master_admin
#   - ban Auth
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-revogar-admin-probe.sh")
set -euo pipefail

UID_TARGET="${USER_ID:-a0f8a309-5bc6-4121-8e64-2b282b181485}"

for f in \
  "${ENV_FILE:-}" \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env
do
  [[ -n "${f:-}" && -f "$f" ]] || continue
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|ARBISHIELD_SUPABASE_URL|SUPABASE_URL|API_EXTERNAL_URL)=' "$f" | sed 's/\r$//')
  set +a
done

SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
SUPABASE_URL="$(echo "${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}" | sed 's:/*$::')"
DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"

[[ -n "$DB" ]] || { echo "ERRO: postgres não encontrado"; exit 1; }
[[ -n "$SERVICE_KEY" ]] || { echo "ERRO: SERVICE_ROLE_KEY ausente"; exit 1; }

psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "════════════════════════════════════════════════════════════════════════"
echo "REVOGAR · Admin Probe · ${UID_TARGET}"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "==> 1) Profile + Auth (antes)"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status, created_at, updated_at
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
"

AUTH_JSON="$(curl -fsS \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  "${SUPABASE_URL}/auth/v1/admin/users/${UID_TARGET}" || true)"
python3 - <<'PY' "$AUTH_JSON"
import json,sys
raw=sys.argv[1] if len(sys.argv)>1 else ""
try:
  u=json.loads(raw or "{}")
except Exception:
  print("  Auth: (falha parse)", raw[:200]); raise SystemExit
print(f"  email: {u.get('email')}")
print(f"  created: {u.get('created_at')}")
print(f"  last_sign_in: {u.get('last_sign_in_at')}")
print(f"  banned_until: {u.get('banned_until')}")
print(f"  user_metadata: {json.dumps(u.get('user_metadata') or {}, ensure_ascii=False)}")
PY

echo
echo "==> 2) user_roles"
psql_db -c "SELECT * FROM public.user_roles WHERE user_id = '${UID_TARGET}'::uuid;"

echo
echo "==> 3) Forçar is_super_admin=false + blocked (bypass triggers)"
psql_db <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.profiles
SET is_super_admin = false,
    account_status = 'blocked',
    updated_at = now()
WHERE id = '${UID_TARGET}'::uuid;
RESET session_replication_role;
COMMIT;

SELECT id, full_name, is_super_admin, account_status, updated_at
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
SQL

echo
echo "==> 4) Remover roles admin"
psql_db -c "
DELETE FROM public.user_roles
WHERE user_id = '${UID_TARGET}'::uuid
  AND role::text IN ('admin', 'master_admin');
SELECT * FROM public.user_roles WHERE user_id = '${UID_TARGET}'::uuid;
"

echo
echo "==> 5) Ban Auth"
curl -fsS -X PUT \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"ban_duration":"876000h"}' \
  "${SUPABASE_URL}/auth/v1/admin/users/${UID_TARGET}" >/tmp/ban-admin-probe.json
python3 - <<'PY'
import json
u=json.load(open("/tmp/ban-admin-probe.json"))
print(f"  ban OK · banned_until={u.get('banned_until')} · email={u.get('email')}")
PY

echo
echo "==> 6) Super-admins restantes"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status
FROM public.profiles
WHERE is_super_admin IS TRUE
ORDER BY full_name;
"

FINAL="$(psql_db -At -c "
SELECT is_super_admin::text || '|' || account_status
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
" | tr -d '[:space:]')"

echo
if [[ "$FINAL" == "f|blocked" || "$FINAL" == "false|blocked" ]]; then
  echo "OK — Admin Probe revogado + blocked + ban Auth."
else
  echo "ATENÇÃO — estado final: ${FINAL}"
  exit 1
fi
