# Supabase — Exchange Live

## 1. Criar o projeto

Projeto já vinculado: [wknyfxikmmvjzpbevlid](https://supabase.com/dashboard/project/wknyfxikmmvjzpbevlid)

Em **Project Settings → API**, copie:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` (= `https://wknyfxikmmvjzpbevlid.supabase.co`)
- **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** (opcional, só servidor) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Rodar a migration

No SQL Editor do dashboard, cole e execute o conteúdo de:

`supabase/migrations/20260718210000_exchange_alerts.sql`

Ou, com a CLI:

```bash
npx supabase link --project-ref <SEU_PROJECT_REF>
npx supabase db push
```

## 3. Configurar o app

```bash
cp .env.example .env.local
# preencha as variáveis SUPABASE_*
```

## 4. Testar a conexão

```bash
npm run dev
curl http://localhost:3000/api/supabase/health
```

Resposta esperada: `{ "ok": true, ... }`.
