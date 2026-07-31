#!/usr/bin/env bash
# 1) Força is_super_admin=false na conta jawadog (bypass trigger)
# 2) Trava coluna is_super_admin para anon/authenticated (impede auto-promoção)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-fix-super-admin-lockdown.sh")
set -euo pipefail

UID_TARGET="${USER_ID:-3b7e5b99-83f3-45f7-a390-855ffb2b8109}"
DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB" ]] || { echo "ERRO: container postgres não encontrado"; exit 1; }

psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "════════════════════════════════════════════════════════════════════════"
echo "LOCKDOWN · is_super_admin · target=${UID_TARGET}"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "==> 1) Triggers em profiles"
psql_db -c "
SELECT tgname, tgenabled, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.profiles'::regclass
  AND NOT tgisinternal
ORDER BY tgname;
"

echo
echo "==> 2) Estado ANTES"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status, updated_at
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
"

echo
echo "==> 3) Forçar UPDATE (session_replication_role=replica bypassa triggers)"
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
echo "==> 4) Se ainda true: UPDATE direto desabilitando triggers da tabela"
STILL="$(psql_db -At -c "SELECT is_super_admin::text FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;" | tr -d '[:space:]')"
if [[ "$STILL" == "t" || "$STILL" == "true" ]]; then
  echo "  ainda true — ALTER TABLE DISABLE TRIGGER ALL"
  psql_db <<SQL
BEGIN;
ALTER TABLE public.profiles DISABLE TRIGGER ALL;
UPDATE public.profiles
SET is_super_admin = false,
    account_status = 'blocked',
    updated_at = now()
WHERE id = '${UID_TARGET}'::uuid;
ALTER TABLE public.profiles ENABLE TRIGGER ALL;
COMMIT;

SELECT id, full_name, is_super_admin, account_status, updated_at
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
SQL
fi

echo
echo "==> 5) Lockdown: revoke UPDATE na coluna is_super_admin + trigger de proteção"
psql_db <<'SQL'
-- Ninguém autenticado/anônimo deve gravar is_super_admin
REVOKE UPDATE (is_super_admin) ON public.profiles FROM anon, authenticated;
-- service_role / postgres mantêm (via table owner / superuser)

CREATE OR REPLACE FUNCTION public.profiles_block_super_admin_self_promote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      -- só service_role / postgres / supabase_admin
      IF current_user NOT IN ('postgres', 'supabase_admin', 'supabase_auth_admin')
         AND current_setting('role', true) IS DISTINCT FROM 'service_role'
         AND session_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'is_super_admin só pode ser alterado por service_role/postgres';
      END IF;
    END IF;
    IF NEW.account_status IS DISTINCT FROM OLD.account_status
       AND NEW.account_status IN ('active', 'blocked', 'suspended', 'inactive')
       AND OLD.account_status IS DISTINCT FROM NEW.account_status THEN
      -- permitir mudança de status por service; bloquear self-unblock de blocked→active
      IF OLD.account_status IN ('blocked', 'suspended')
         AND NEW.account_status = 'active'
         AND auth.uid() IS NOT NULL
         AND auth.uid() = NEW.id
         AND current_user NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'conta bloqueada não pode se reativar';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_super_admin IS TRUE THEN
      IF current_user NOT IN ('postgres', 'supabase_admin') THEN
        NEW.is_super_admin := false;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_block_super_admin ON public.profiles;
CREATE TRIGGER trg_profiles_block_super_admin
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_block_super_admin_self_promote();

-- Confirma revoke
SELECT grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'is_super_admin'
ORDER BY grantee, privilege_type;
SQL

echo
echo "==> 6) Estado FINAL da conta"
psql_db -c "
SELECT id, full_name, is_super_admin, account_status, updated_at
FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;
"

echo
echo "==> 7) Quem ainda é is_super_admin=true"
psql_db -c "
SELECT id, full_name, account_status, is_super_admin
FROM public.profiles
WHERE is_super_admin IS TRUE
ORDER BY full_name
LIMIT 50;
"

FINAL="$(psql_db -At -c "SELECT is_super_admin::text || '|' || account_status FROM public.profiles WHERE id = '${UID_TARGET}'::uuid;" | tr -d '[:space:]')"
echo
if [[ "$FINAL" == "f|blocked" || "$FINAL" == "false|blocked" ]]; then
  echo "OK — jawadog: is_super_admin=false + blocked + coluna travada."
else
  echo "ATENÇÃO — estado final inesperado: ${FINAL}"
  echo "Cole a saída completa (especialmente seção 1 triggers)."
  exit 1
fi
