-- Storage: comprovantes de depósito + provas de aposta (legado usa deposit-proofs / bet-proofs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'deposit-proofs',
    'deposit-proofs',
    false,
    10485760,
    array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf']
  ),
  (
    'bet-proofs',
    'bet-proofs',
    false,
    10485760,
    array['image/jpeg','image/png','image/webp','image/gif','image/heic','application/pdf']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Políticas deposit-proofs: usuário sob {uid}/… ; admin lê tudo
drop policy if exists deposit_proofs_insert_own on storage.objects;
create policy deposit_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists deposit_proofs_select_own on storage.objects;
create policy deposit_proofs_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'deposit-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_super_admin is true
      )
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role in ('admin', 'master_admin')
      )
    )
  );

drop policy if exists deposit_proofs_update_own on storage.objects;
create policy deposit_proofs_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'deposit-proofs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Políticas bet-proofs (contestação de odd)
drop policy if exists bet_proofs_insert_own on storage.objects;
create policy bet_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bet-proofs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or name like 'contestations/%'
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
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_super_admin is true
      )
      or exists (
        select 1 from public.user_roles ur
        where ur.user_id = auth.uid()
          and ur.role in ('admin', 'master_admin')
      )
    )
  );
