-- Admin hardening: promoção só via VPS/SERVICE_ROLE;
-- aperta grants de profiles; impede is_super_admin no INSERT.

-- 1) user_roles: remove mutações via JWT autenticado
drop policy if exists user_roles_admin_insert on public.user_roles;
drop policy if exists user_roles_admin_update on public.user_roles;
drop policy if exists user_roles_admin_delete on public.user_roles;

revoke insert, update, delete on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

-- 2) profiles: sem INSERT/UPDATE amplos; só colunas de cadastro/perfil
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

do $$
declare
  cols_insert text;
  cols_update text;
  safe_insert text[] := array[
    'id', 'full_name', 'created_at', 'updated_at', 'cpf', 'phone', 'location',
    'pix_key', 'pix_priority_type', 'avatar_url', 'onboarding_completed',
    'tos_accepted_at', 'tos_version', 'referral_code', 'referred_by',
    'signup_source', 'signup_source_data', 'welcome_video_seen_at'
  ];
  safe_update text[] := array[
    'full_name', 'updated_at', 'phone', 'location', 'avatar_url',
    'onboarding_completed', 'welcome_video_seen_at', 'pix_priority_type'
  ];
begin
  select string_agg(quote_ident(c), ', ')
  into cols_insert
  from unnest(safe_insert) as c
  where exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass
      and a.attname = c and a.attnum > 0 and not a.attisdropped
  );

  select string_agg(quote_ident(c), ', ')
  into cols_update
  from unnest(safe_update) as c
  where exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.profiles'::regclass
      and a.attname = c and a.attnum > 0 and not a.attisdropped
  );

  if cols_insert is null or cols_update is null then
    raise exception 'colunas seguras profiles ausentes';
  end if;

  execute format('grant insert (%s) on public.profiles to authenticated', cols_insert);
  execute format('grant update (%s) on public.profiles to authenticated', cols_update);
  grant select on public.profiles to anon, authenticated;
end $$;

-- 3) Trigger: nunca aceitar is_super_admin / balances no INSERT de cliente
create or replace function public.profiles_block_super_admin_self_promote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user not in ('postgres', 'supabase_admin')
       and coalesce(auth.role(), '') is distinct from 'service_role' then
      new.is_super_admin := false;
      new.is_affiliate := false;
      if new.account_status is null or new.account_status = '' then
        new.account_status := 'active';
      end if;
      -- zera campos financeiros se alguém tentar injetar no signup
      new.balance_cents := 0;
      new.desafio_balance_cents := 0;
      new.reusable_balance_cents := 0;
      new.investor_balance_cents := 0;
      new.demo_balance_cents := 0;
      new.pending_balance_cents := 0;
      new.deduction_balance_cents := 0;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.is_super_admin is distinct from old.is_super_admin then
      if current_user not in ('postgres', 'supabase_admin', 'supabase_auth_admin')
         and coalesce(auth.role(), '') is distinct from 'service_role'
         and session_user not in ('postgres', 'supabase_admin') then
        raise exception 'is_super_admin só pode ser alterado via VPS/service_role';
      end if;
    end if;
    if old.account_status in ('blocked', 'suspended')
       and new.account_status = 'active'
       and auth.uid() is not null
       and auth.uid() = new.id
       and current_user not in ('postgres', 'supabase_admin')
       and coalesce(auth.role(), '') is distinct from 'service_role' then
      raise exception 'conta bloqueada não pode se reativar';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_block_super_admin on public.profiles;
create trigger trg_profiles_block_super_admin
  before insert or update on public.profiles
  for each row
  execute procedure public.profiles_block_super_admin_self_promote();

notify pgrst, 'reload schema';
