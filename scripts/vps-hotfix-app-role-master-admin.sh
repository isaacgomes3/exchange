#!/usr/bin/env bash
# Corrige: invalid input value for enum app_role: "master_admin"
# (Dashboard ADM / policies RLS)
#
# SQL embutido — não depende de segundo curl no GitHub (evita Connection reset).
#
# Na VPS (root):
#   curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-app-role-master-admin-723d/scripts/vps-hotfix-app-role-master-admin.sh" \
#     -o /tmp/hotfix-role.sh
#   bash /tmp/hotfix-role.sh
set -euo pipefail
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

log "1/2 — escrever SQL embutido"
SQL_TMP="$(mktemp)"
cat >"$SQL_TMP" <<'SQL'
-- Fix: invalid input value for enum app_role: "master_admin"
do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'app_role'
  ) and not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'app_role'
      and e.enumlabel = 'master_admin'
  ) then
    execute 'alter type public.app_role add value ''master_admin''';
  end if;
end $$;

create or replace function public.is_super_admin_uid(uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if uid is null then
    return false;
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = uid and p.is_super_admin is true
  ) then
    return true;
  end if;
  return exists (
    select 1 from public.user_roles ur
    where ur.user_id = uid
      and ur.role::text in ('admin', 'master_admin')
  );
end;
$$;

revoke all on function public.is_super_admin_uid(uuid) from public;
grant execute on function public.is_super_admin_uid(uuid) to authenticated, anon, service_role;

do $$
begin
  if to_regclass('public.banners') is not null then
    drop policy if exists banners_admin_all on public.banners;
    execute $p$
      create policy banners_admin_all on public.banners
        for all to authenticated
        using (public.is_super_admin_uid(auth.uid()))
        with check (public.is_super_admin_uid(auth.uid()))
    $p$;
  end if;

  if to_regclass('public.manual_deposits') is not null then
    drop policy if exists "Admins can update all deposits" on public.manual_deposits;
    execute $p$
      create policy "Admins can update all deposits"
        on public.manual_deposits for update to authenticated
        using (public.is_super_admin_uid(auth.uid()))
        with check (public.is_super_admin_uid(auth.uid()))
    $p$;

    drop policy if exists "Admins can select all deposits" on public.manual_deposits;
    execute $p$
      create policy "Admins can select all deposits"
        on public.manual_deposits for select to authenticated
        using (
          auth.uid() = user_id
          or public.is_super_admin_uid(auth.uid())
        )
    $p$;
  end if;
end $$;

do $$
begin
  drop policy if exists banners_storage_admin_write on storage.objects;
  create policy banners_storage_admin_write on storage.objects
    for all to authenticated
    using (
      bucket_id = 'banners'
      and public.is_super_admin_uid(auth.uid())
    )
    with check (
      bucket_id = 'banners'
      and public.is_super_admin_uid(auth.uid())
    );

  drop policy if exists deposit_proofs_select_own on storage.objects;
  create policy deposit_proofs_select_own on storage.objects
    for select to authenticated
    using (
      bucket_id = 'deposit-proofs'
      and (
        (storage.foldername(name))[1] = auth.uid()::text
        or public.is_super_admin_uid(auth.uid())
      )
    );

  drop policy if exists bet_proofs_select_own on storage.objects;
  create policy bet_proofs_select_own on storage.objects
    for select to authenticated
    using (
      bucket_id = 'bet-proofs'
      and (
        (storage.foldername(name))[1] = auth.uid()::text
        or name like 'contestations/%'
        or public.is_super_admin_uid(auth.uid())
      )
    );
exception
  when undefined_table then null;
  when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
SQL

grep -q 'is_super_admin_uid' "$SQL_TMP" || die "SQL embutido inválido"
echo "  ok $(wc -c < "$SQL_TMP" | tr -d ' ') bytes"

log "2/2 — aplicar no Postgres"
applied=0
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
    if docker exec -i "$c" psql -U postgres -d postgres < "$SQL_TMP" 2>/tmp/role-sql.err; then
      echo "  SQL ok via $c"
      applied=1
      break
    else
      echo "  falha em $c:" >&2
      cat /tmp/role-sql.err >&2 || true
    fi
  done
  if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
    if (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_TMP"); then
      echo "  SQL ok via docker compose"
      applied=1
    fi
  fi
fi
rm -f "$SQL_TMP"
[[ "$applied" -eq 1 ]] || die "não consegui aplicar SQL no container db"

echo
echo "OK — Ctrl+Shift+R no Dashboard ADM"
echo "  enum app_role + is_super_admin_uid corrigidos"
