# ArbiShield — arbishield.app

Repositório do produto [https://arbishield.app](https://arbishield.app).

**Admin estável:** mesmo visual (HTML) + mesmo banco (Supabase na VPS). Rotas nginx e workers consolidados — sem shim, sem espelho SPA, sem depender de Next para operação diária.

Documentação: [`deploy/vps-supabase/ADMIN-STABLE.md`](deploy/vps-supabase/ADMIN-STABLE.md)

## Deploy na VPS (um comando)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-deploy-arbishield-admin.sh)
```

Rotas principais:

| URL | Função |
|-----|--------|
| `/admin/matches` | Gestão de Jogos (pré-live BetBra) |
| `/admin/desafios` | Gestão de Desafios |
| `/auth` | Login |
| `/api/arbishield/*` | APIs Node `:3098` / `:3099` |
| `/rest/v1`, `/auth/v1` | Supabase Kong `:8000` |

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Supabase na VPS

[`deploy/vps-supabase/MIGRATE.md`](deploy/vps-supabase/MIGRATE.md)

## Sync cotações BetBra

```bash
npm run arbishield:sync-odds
```
