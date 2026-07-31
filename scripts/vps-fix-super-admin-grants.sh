#!/usr/bin/env bash
# Reforça lockdown de is_super_admin (REVOKE table-level + regrant colunas seguras)
# e inspeciona triggers que travam updates.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-fix-super-admin-grants.sh")
set -euo pipefail

DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB" ]] || { echo "ERRO: container postgres não encontrado"; exit 1; }

psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "════════════════════════════════════════════════════════════════════════"
echo "LOCKDOWN GRANTS · is_super_admin"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "==> 1) Definição dos triggers que travam colunas"
psql_db -c "
SELECT p.proname, pg_get_functiondef(p.oid) AS def
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'lock_profile_sensitive_columns',
    'prevent_profile_sensitive_updates',
    'check_profile_update_v1'
  )
ORDER BY p.proname;
"

echo
echo "==> 2) Privilegio TABLE-LEVEL em profiles (antes)"
psql_db -c "
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='profiles'
  AND grantee IN ('anon','authenticated','service_role')
ORDER BY grantee, privilege_type;
"

echo
echo "==> 3) Revogar INSERT/UPDATE amplos e regrant sem colunas sensíveis"
psql_db <<'SQL'
DO $$
DECLARE
  sens text[] := ARRAY[
    'is_super_admin',
    'balance_cents',
    'desafio_balance_cents',
    'reusable_balance_cents',
    'investor_balance_cents',
    'demo_balance_cents',
    'demo_balance_provider_cents',
    'debited_balance_cents',
    'locked_balance_cents',
    'total_profit_cents',
    'account_status'
  ];
  cols_insert text;
  cols_update text;
BEGIN
  REVOKE INSERT, UPDATE ON public.profiles FROM anon, authenticated;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
  INTO cols_insert
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> ALL (sens);

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
  INTO cols_update
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> ALL (sens)
    AND a.attname NOT IN ('id', 'created_at');

  IF cols_insert IS NULL OR cols_update IS NULL THEN
    RAISE EXCEPTION 'falha ao montar lista de colunas seguras';
  END IF;

  EXECUTE format('GRANT INSERT (%s) ON public.profiles TO authenticated', cols_insert);
  EXECUTE format('GRANT UPDATE (%s) ON public.profiles TO authenticated', cols_update);
  GRANT SELECT ON public.profiles TO anon, authenticated;

  RAISE NOTICE 'INSERT cols: %', cols_insert;
  RAISE NOTICE 'UPDATE cols: %', cols_update;
END $$;

-- is_super_admin NÃO deve aparecer para anon/authenticated
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'is_super_admin'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;
SQL

echo
echo "==> 4) Estado jawadog + todos super_admins"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status
FROM public.profiles
WHERE id = '3b7e5b99-83f3-45f7-a390-855ffb2b8109'::uuid
   OR is_super_admin IS TRUE
ORDER BY is_super_admin DESC, full_name;
"

LEFT="$(psql_db -At -c "
SELECT count(*) FROM information_schema.role_column_grants
WHERE table_schema='public' AND table_name='profiles'
  AND column_name='is_super_admin'
  AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('INSERT','UPDATE');
" | tr -d '[:space:]')"

echo
if [[ "$LEFT" == "0" ]]; then
  echo "OK — anon/authenticated sem INSERT/UPDATE em is_super_admin."
else
  echo "ATENÇÃO — ainda há ${LEFT} grant(s) INSERT/UPDATE na coluna. Cole a saída."
  exit 1
fi
