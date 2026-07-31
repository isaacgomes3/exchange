#!/usr/bin/env bash
# Promove (ou revoga) admin APENAS via VPS / SERVICE_ROLE + SQL.
# Não há endpoint público para isso.
#
#   EMAIL=carlos@arbishield.com bash <(curl -fsSL ".../vps-promover-admin.sh")
#   EMAIL=... REVOKE=1 bash <(curl ...)
set -euo pipefail

EMAIL="$(echo "${EMAIL:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
REVOKE="${REVOKE:-0}"
[[ -n "$EMAIL" ]] || { echo "ERRO: informe EMAIL=..."; exit 1; }

for f in /opt/arbishield/deploy/vps-supabase/.env /opt/arbishield/.env; do
  [[ -f "$f" ]] || continue
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|ARBISHIELD_SUPABASE_URL|API_EXTERNAL_URL)=' "$f" | sed 's/\r$//')
  set +a
done
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
SUPABASE_URL="$(echo "${ARBISHIELD_SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}" | sed 's:/*$::')"
DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1)"
[[ -n "$SERVICE_KEY" && -n "$DB" ]] || { echo "ERRO: SERVICE_KEY/DB"; exit 1; }

psql_db() {
  docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" \
    || docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

UID_TARGET="$(
  curl -fsS -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=200" \
  | python3 -c '
import json,sys
email=sys.argv[1]
users=json.load(sys.stdin).get("users") or []
hit=next((u for u in users if str(u.get("email") or "").lower()==email), None)
print(hit["id"] if hit else "")
' "$EMAIL"
)"
[[ -n "$UID_TARGET" ]] || { echo "ERRO: auth sem email=$EMAIL"; exit 1; }
echo "==> user $EMAIL → $UID_TARGET"

if [[ "$REVOKE" == "1" ]]; then
  psql_db -c "
DELETE FROM public.user_roles
WHERE user_id = '${UID_TARGET}'::uuid AND role::text IN ('admin','master_admin');
"
  echo "OK — roles admin removidas (is_super_admin NÃO alterado)."
else
  psql_db -c "
INSERT INTO public.user_roles (user_id, role)
SELECT '${UID_TARGET}'::uuid, 'admin'::public.app_role
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = '${UID_TARGET}'::uuid AND role::text = 'admin'
);
"
  echo "OK — role admin concedida. Lembre: e-mail precisa estar na allowlist do shim/v2.js."
fi

psql_db -c "
SELECT ur.role, u.email::text
FROM public.user_roles ur
JOIN auth.users u ON u.id = ur.user_id
WHERE ur.role::text IN ('admin','master_admin')
ORDER BY u.email;
"
