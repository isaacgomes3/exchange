-- Banners do carrossel (Gestão de Banners / SPA admin.banners)
create extension if not exists "pgcrypto";

create table if not exists public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  description text,
  cta_label text,
  cta_url text,
  image_url text not null default '',
  badge text,
  variant text not null default 'custom'
    check (variant in ('custom', 'affiliate', 'match', 'desafio')),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists banners_active_sort_idx
  on public.banners (active, sort_order, created_at desc);

alter table public.banners enable row level security;

drop policy if exists banners_public_read on public.banners;
create policy banners_public_read on public.banners
  for select
  to anon, authenticated
  using (active = true);

drop policy if exists banners_admin_all on public.banners;
create policy banners_admin_all on public.banners
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_super_admin is true
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text in ('admin', 'master_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_super_admin is true
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text in ('admin', 'master_admin')
    )
  );

-- Storage bucket para imagens do carrossel
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banners',
  'banners',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists banners_storage_public_read on storage.objects;
create policy banners_storage_public_read on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'banners');

drop policy if exists banners_storage_admin_write on storage.objects;
create policy banners_storage_admin_write on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'banners'
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_super_admin is true
      )
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role::text in ('admin', 'master_admin')
      )
    )
  )
  with check (
    bucket_id = 'banners'
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_super_admin is true
      )
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role::text in ('admin', 'master_admin')
      )
    )
  );

notify pgrst, 'reload schema';
