-- Clientes precisam ler partidas publicadas na grade Proteger Aposta.
-- Sem esta policy, PostgREST devolve [] para anon/authenticated e a UI fica
-- em "Sem partidas com liquidez" mesmo com jogos na Fila do admin.

grant select on public.matches to anon, authenticated;

drop policy if exists matches_select_published_clients on public.matches;

create policy matches_select_published_clients
on public.matches
for select
to anon, authenticated
using (
  deleted_at is null
  and is_published is true
);

notify pgrst, 'reload schema';
