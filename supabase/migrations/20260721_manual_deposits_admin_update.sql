-- Admin precisa UPDATE em manual_deposits (aprovar/rejeitar pelo cliente ou fallback).
-- Sem isso, só o dono do depósito consegue PATCH via JWT — ADM falha com "Update sem efeito (RLS)".

drop policy if exists "Admins can update all deposits" on public.manual_deposits;
create policy "Admins can update all deposits"
  on public.manual_deposits
  for update
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

-- Leitura admin (idempotente) — listagem do painel
drop policy if exists "Admins can select all deposits" on public.manual_deposits;
create policy "Admins can select all deposits"
  on public.manual_deposits
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_super_admin is true
    )
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.role::text in ('admin', 'master_admin')
    )
  );
