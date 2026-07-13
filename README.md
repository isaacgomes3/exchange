# Exchange Live

Painel de alertas para jogos ao vivo da exchange de apostas.

## Funcionalidades

- **Jogos ao vivo** — tabela em tempo real com placar, odds (back/lay), volume e status
- **Alertas automáticos** — gols, movimentação de odds, volume alto, mercado suspenso
- **Streaming SSE** — atualizações em tempo real via Server-Sent Events
- **Regras configuráveis** — ative/desative regras de alerta pelo painel

## Como rodar

```bash
npm install
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

## Arquitetura

```
src/
├── app/
│   ├── api/
│   │   ├── live/games/    # GET jogos ao vivo
│   │   ├── live/stream/   # SSE tempo real
│   │   └── alerts/        # Alertas e regras
│   └── page.tsx           # Painel principal
├── components/panel/        # UI do painel
├── hooks/useLiveStream.ts # Hook SSE client-side
├── lib/
│   ├── exchange/          # Store + simulador (mock)
│   └── alerts/            # Engine de alertas
└── types/exchange.ts      # Tipos
```

## Integração com exchange real

O simulador em `src/lib/exchange/store.ts` pode ser substituído por um cliente da API da exchange (Betfair, Matchbook, etc.). Mantenha a interface `LiveGame` e o fluxo de `evaluateGameUpdate` para reutilizar o painel e as regras de alerta.

## Regras de alerta padrão

| Regra | Descrição |
|-------|-----------|
| Gol marcado | Alerta quando o placar muda |
| Movimento de odds > 10% | Alerta em variações significativas |
| Volume alto (> £300k) | Alerta quando o volume ultrapassa o limite |
| Odds acima de 5.0 | Alerta quando odds atingem valor alto |
