# ArbiShield — arbishield.app

Repositório **único** do produto [https://arbishield.app](https://arbishield.app): admin operacional, APIs BetBra, Supabase self-hosted na VPS.

Não há código nem deploy para outros domínios (ex.: `.com`). Tudo aponta para **arbishield.app**.

## O que roda em produção

| Rota | Função |
|------|--------|
| `/admin/matches` | Gestão de Jogos — catálogo pré-live BetBra, mercados, novo evento |
| `/admin/desafios` | Gestão de Desafios |
| `/admin/login`, `/auth` | Login estável (HTML + Supabase Auth) |
| `/api/arbishield/prelive-events` | API pré-live (porta 3098) |
| `/api/arbishield/matches` | Criar/atualizar eventos (porta 3098) |
| `/api/arbishield/*` | Demais APIs (Next.js, porta 3000) |
| `/auth/v1`, `/rest/v1`, … | Supabase Kong (porta 8000) |
| `/arbishield` | Painel operacional Next (dashboard admin) |

A home `/` redireciona para `/admin/matches`.

## Deploy na VPS

Clone em `/opt/arbishield/app` (branch `main` ou feature):

```bash
# Gestão de Jogos + pré-live
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/main/scripts/vps-deploy-jogos-prelive.sh)

# Next.js + APIs admin
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/main/scripts/vps-deploy-next-admin.sh)
```

Variáveis Supabase vêm de `/opt/arbishield/deploy/vps-supabase/.env`.

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL=https://arbishield.app + ANON_KEY
npm run dev
```

- Next: http://localhost:3000  
- Admin HTML em produção: use a VPS ou copie `deploy/vps-supabase/static/*.html` para testes.

## Supabase na VPS

Guia completo: [`deploy/vps-supabase/MIGRATE.md`](deploy/vps-supabase/MIGRATE.md)

```bash
cd deploy/vps-supabase && ./setup.sh
docker compose up -d
```

## Sync de cotações BetBra

```bash
npm run arbishield:sync-odds
# ou POST /api/arbishield/odds-sync no Next
```

## Estrutura

```
src/app/api/arbishield/     # APIs Next
src/lib/arbishield/         # Lógica de negócio
src/lib/betbra/             # Cliente BetBra (pré-live, odds)
deploy/vps-supabase/        # Docker Supabase + nginx
deploy/vps-supabase/static/ # Admin HTML servido pelo nginx
scripts/                    # Deploy VPS e workers Node
```
