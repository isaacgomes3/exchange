# Exchange Live — BetBra

Painel de alertas para jogos ao vivo da exchange **BetBra** (mexchange), seguindo o mesmo padrão de integração do Arbitrex.

## Funcionalidades

- **API BetBra** — eventos, odds (back/lay) e feed inplay em tempo real
- **Alertas automáticos** — gols, movimentação de odds, volume alto, mercado suspenso
- **Streaming SSE** — painel atualiza sem refresh
- **Deep links** — clique no jogo abre `betbra.bet.br/b/exchange/sport/...`
- **Teste de conectividade** — `GET /api/exchange/connectivity-test`
- **Supabase** — persistência de alertas e regras (`GET /api/supabase/health`)

## Conectar Supabase

Projeto: [wknyfxikmmvjzpbevlid](https://supabase.com/dashboard/project/wknyfxikmmvjzpbevlid)

1. Em **Project Settings → API**, copie a **anon public** key
2. Configure o `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://wknyfxikmmvjzpbevlid.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
# opcional (servidor):
# SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

3. Rode a migration SQL em `supabase/migrations/20260718210000_exchange_alerts.sql` (SQL Editor do dashboard)
4. Teste:

```bash
curl http://localhost:3000/api/supabase/health | jq
```

Detalhes em [`supabase/README.md`](supabase/README.md). Sem a anon key, o painel continua em memória.

## Requisitos BetBra

1. **User-Agent aprovado** no formato `BOT/SOFTWARE;NomeApp;Versao`
2. **IP brasileiro** — fora do BR a API retorna HTML/Cloudflare (403)
3. **Proxy BR** — configure se o servidor não estiver no Brasil

## Ambiente local (usa seu IP brasileiro)

A BetBra bloqueia IPs fora do Brasil. Rode **na sua máquina**:

```bash
npm install
npm run start:local
```

Isso:
1. Garante `.env.local` (Supabase + BetBra) sem apagar keys existentes
2. Sobe o **proxy local** (porta 8787) — requests à BetBra com **seu IP**
3. Sobe o **painel** (porta 3000) — http://localhost:3000

Só preparar o `.env.local`:

```bash
npm run env:local
```

### Só o proxy (terminal separado)

```bash
npm run proxy:local
```

O proxy mostra seu IP na rede. Configure no `.env.local`:

```env
MEXCHANGE_USE_LOCAL_PROXY=1
MEXCHANGE_LOCAL_PROXY_URL=http://127.0.0.1:8787
# ou na rede local: http://192.168.x.x:8787
```

Depois rode `npm run dev` em outro terminal.

## Configuração manual

Copie `.env.example` para `.env.local`:

```bash
cp .env.example .env.local
```

Variáveis principais:

```env
MEXCHANGE_BOT_USER_AGENT=BOT/SOFTWARE;ExchangeLive;1.0
MEXCHANGE_BIAB_LANGUAGE=PT_BR

# Se estiver fora do Brasil:
FULLTBET_USE_OUTBOUND_PROXY=1
FULLTBET_PROXY=http://user:pass@vps-br:port
```

## Como rodar

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Testar conectividade

```bash
curl http://localhost:3000/api/exchange/connectivity-test | jq
```

Ou direto na BetBra:

```bash
UA='BOT/SOFTWARE;ExchangeLive;1.0'
NOW=$(date +%s)
curl -sS \
  -H "Accept: application/json" \
  -H "User-Agent: $UA" \
  -H "Referer: https://mexchange.betbra.bet.br/" \
  -H "Cookie: BIAB_LANGUAGE=PT_BR" \
  "https://mexchange-api.betbra.bet.br/api/events?offset=0&per-page=5&after=$((NOW-7200))&before=$((NOW+86400))&sport-ids=15&sort-by=volume&sort-direction=desc"
```

## Arquitetura

```
src/lib/betbra/
├── client.ts      # HTTP com headers, proxy, rate limit
├── poller.ts      # Poll events + inplay + detalhes
├── mapper.ts      # BetBra → LiveGame
├── config.ts      # Variáveis de ambiente
└── urls.ts        # Deep links

src/lib/exchange/store.ts   # Estado + alertas + SSE
```

## Fluxo de dados

1. `GET /api/events` — lista jogos (futebol=15, tênis=9)
2. `GET /api/events/{id}` — odds detalhadas para jogos ao vivo
3. `GET inplay-info` — placar e minuto
4. Engine de alertas compara com estado anterior
5. SSE envia atualizações ao painel

## Endpoints internos

| Rota | Descrição |
|------|-----------|
| `GET /api/live/games` | Jogos ao vivo |
| `GET /api/live/stream` | SSE tempo real |
| `GET /api/alerts` | Alertas |
| `GET /api/exchange/connectivity-test` | Diagnóstico BetBra |
| `GET /api/supabase/health` | Diagnóstico Supabase |

## Sport IDs

| Esporte | ID |
|---------|-----|
| Futebol | 15 |
| Tênis | 9 |
