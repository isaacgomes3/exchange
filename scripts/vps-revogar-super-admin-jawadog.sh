#!/usr/bin/env bash
# Revoga is_super_admin / bloqueia perfil jawadog + lista policies.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-revogar-super-admin-jawadog.sh")
#
# Só inspecionar (sem alterar):
#   DRY=1 bash <(curl -fsSL "...")
set -euo pipefail

UID_TARGET="${USER_ID:-3b7e5b99-83f3-45f7-a390-855ffb2b8109}"
DRY="${DRY:-0}"
DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB" ]] || { echo "ERRO: container postgres não encontrado"; exit 1; }

psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "════════════════════════════════════════════════════════════════════════"
echo "REVOGAR · is_super_admin + status · ${UID_TARGET}"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "==> Estado atual"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status,
       balance_cents, desafio_balance_cents, updated_at
FROM public.profiles
WHERE id = '${UID_TARGET}'::uuid;
"

echo
echo "==> Policies profiles / user_roles"
psql_db -c "
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename IN ('profiles', 'user_roles')
ORDER BY tablename, policyname;
"

echo
echo "==> Grants UPDATE em profiles (coluna is_super_admin)"
psql_db -c "
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'is_super_admin'
ORDER BY grantee, privilege_type;
" || true

if [[ "$DRY" == "1" ]]; then
  echo
  echo "DRY=1 — nenhuma alteração."
  exit 0
fi

echo
echo "==> Aplicando: is_super_admin=false, account_status=blocked"
psql_db -c "
UPDATE public.profiles
SET is_super_admin = false,
    account_status = 'blocked',
    updated_at = now()
WHERE id = '${UID_TARGET}'::uuid;

SELECT id, full_name, is_super_admin, account_status, updated_at
FROM public.profiles
WHERE id = '${UID_TARGET}'::uuid;
"

echo
echo "==> Roles restantes"
psql_db -c "
SELECT * FROM public.user_roles WHERE user_id = '${UID_TARGET}'::uuid;
"

echo
echo "OK — super_admin revogado + perfil blocked."
echo "Auth ban (se já rodou BAN=1) continua válido."
