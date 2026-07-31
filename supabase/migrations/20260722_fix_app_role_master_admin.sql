-- Fix: invalid input value for enum app_role: "master_admin"
-- Dashboard ADM quebra ao SELECT em profiles (policy chama is_super_admin_uid
-- com ur.role IN ('admin','master_admin') e o enum não tinha master_admin).
-- Valores observados em produção: admin, user, marketing.

-- 1) Inclui master_admin no enum (idempotente)
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

-- 2) Helper: compara role como text (não depende do cast do enum)
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

-- 3) Policies inline com IN (enum): recria usando o helper (sem cast quebrado)
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

-- Storage policies (banners / deposit-proofs / bet-proofs)
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
