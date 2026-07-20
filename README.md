# Exchange · Desafio + IA

Área **Sugestão de Desafio** com análise automática ao puxar os jogos.

## O que faz

1. Você clica em **Puxar jogos + IA**
2. O backend busca as partidas (hoje: mock estilo Arbishield / pré-live)
3. Cada jogo é analisado contra os critérios do Desafio:
   - Over/Under 2.5
   - BetBra odd **1.60–1.80**
   - Pré-live **30 min**
4. Retorna veredito: `entrar` | `observar` | `descartar` + confiança + tese + riscos

## IA

- Com `OPENAI_API_KEY` → usa **OpenAI** (`gpt-4.1-mini` por padrão)
- Sem chave → usa **analisador heurístico** local (funciona offline)

## Setup

```bash
npm install
cp .env.example .env.local
# opcional: preencha OPENAI_API_KEY
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## API

`POST /api/desafio/puxar` — puxa jogos e devolve análises.

## Integrar dados reais

Substitua `src/lib/desafio/puxar-jogos.ts` pela chamada à API Arbishield / surebets.
