<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v6`  
**Modelo vigente:** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Regra para agentes / PRs

**NÃO alterar** o fluxo de proteção (criar, travar stake, liquidar, cancelar, buckets de saldo) **sem solicitação explícita do usuário/dono do produto** nesta conversa ou issue.

Arquivos cobertos (lista mínima):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs` (create/settle/cancel)
- `scripts/arbishield-serverfn-shim.mjs` (settle/cancel/saque)
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html`, `v2-financeiro.js`

## Regras de produto vigentes (`stake_lock_v1`)

1. **Ativação:** **trava o stake** (`locked_balance_cents`). Em **cada** evento o usuário pode apostar **no máximo 50% do saldo Apostador restante naquele momento** (`maxStakeLockCents(disponível)`). Após travar, o disponível cai; no próximo evento o teto é de novo **50% do que sobrou**, e assim sucessivamente (ex.: R$ 1000 → máx R$ 500; após usar R$ 500 resta R$ 500 → máx R$ 250). Não cobra dedução na entrada.
2. **Uma operação por evento:** o cliente só pode ter **uma** proteção por jogo (`user` + `match`). Proteção cancelada/estornada não conta (pode tentar de novo).
3. **Sem entrada após o início:** não aceita ativação se `now >= starts_at` (kickoff). Grade e API recusam jogos já iniciados.
4. **LAY** = responsabilidade; **BACK** = stake.
5. **Ganhou na ArbiShield** (`outcome: arbishield` → `lost_exchange`): **credita o stake** no Saldo Reembolso (`deduction_balance_cents`) e **destrava**.
6. **Ganhou na Exchange** (`outcome: exchange` → `won_exchange`): **R$ 0** (não credita Reembolso); **cobra só a dedução**; **destrava sem devolver**.
7. **Empate Anula / void:** **destrava o stake** (devolve à origem — Real/Demo/Investidor).
8. **Cancelar proteção:** **destrava o stake** (devolve à origem).

Alterar qualquer item acima exige pedido explícito + atualização dos testes do contrato.
<!-- END:protection-flow-lock -->
