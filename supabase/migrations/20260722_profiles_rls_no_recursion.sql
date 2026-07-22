-- Corrige: infinite recursion detected in policy for relation "profiles"
-- Causa típica: policy em profiles faz SELECT em profiles (is_super_admin).
-- Solução: helper SECURITY DEFINER com row_security=off + policies sem self-join.

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
  return exists (
    select 1 from public.profiles p
    where p.id = uid and p.is_super_admin is true
  )
  or exists (
    select 1 from public.user_roles ur
    where ur.user_id = uid
      and ur.role in ('admin', 'master_admin')
  );
end;
$$;

revoke all on function public.is_super_admin_uid(uuid) from public;
grant execute on function public.is_super_admin_uid(uuid) to authenticated, anon, service_role;

-- RPCs do perfil: nunca disparam RLS (evita recursão no UPDATE)
create or replace function public.update_own_profile(
  p_full_name text default null,
  p_phone text default null,
  p_location text default null,
  p_cpf text default null,
  p_pix_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  uid uuid := auth.uid();
  cur record;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select full_name, phone, location, cpf, pix_key
    into cur
  from public.profiles
  where id = uid
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  update public.profiles set
    full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
    phone = case when p_phone is null then phone else nullif(trim(p_phone), '') end,
    location = case when p_location is null then location else nullif(trim(p_location), '') end,
    cpf = case
      when cur.cpf is not null and length(regexp_replace(cur.cpf, '\D', '', 'g')) = 11 then cur.cpf
      when p_cpf is null then cpf
      else nullif(regexp_replace(p_cpf, '\D', '', 'g'), '')
    end,
    pix_key = case
      when cur.pix_key is not null and length(trim(cur.pix_key)) > 0 then cur.pix_key
      when p_pix_key is null then pix_key
      else nullif(trim(p_pix_key), '')
    end,
    updated_at = now()
  where id = uid;
end;
$$;

create or replace function public.update_own_pix_bank(
  p_pix_bank text,
  p_pix_account text,
  p_pix_account_holder text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  update public.profiles set
    pix_bank = nullif(trim(p_pix_bank), ''),
    pix_account = nullif(trim(p_pix_account), ''),
    pix_account_holder = nullif(trim(p_pix_account_holder), ''),
    updated_at = now()
  where id = uid;
end;
$$;

create or replace function public.set_own_pix_priority(p_type text)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  uid uuid := auth.uid();
  t text := lower(trim(coalesce(p_type, '')));
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if t not in ('cpf', 'email', 'phone') then
    raise exception 'invalid pix priority';
  end if;
  update public.profiles set
    pix_priority_type = t,
    updated_at = now()
  where id = uid;
end;
$$;

grant execute on function public.update_own_profile(text, text, text, text, text) to authenticated;
grant execute on function public.update_own_pix_bank(text, text, text) to authenticated;
grant execute on function public.set_own_pix_priority(text) to authenticated;

-- Policies em profiles: remove as que fazem SELECT em profiles (recursão)
do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', r.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;

-- Leitura: próprio perfil OU admin (via helper sem RLS)
create policy profiles_select_own_or_admin
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin_uid(auth.uid())
  );

-- Update: próprio perfil (campos sensíveis protegidos nas RPCs) OU admin
create policy profiles_update_own_or_admin
  on public.profiles for update to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin_uid(auth.uid())
  )
  with check (
    id = auth.uid()
    or public.is_super_admin_uid(auth.uid())
  );

-- Insert: só o próprio id (signup)
create policy profiles_insert_own
  on public.profiles for insert to authenticated
  with check (id = auth.uid());
