<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Status:** LOCKED — alterar **somente** com solicitação explícita do dono do produto  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v7`  
**Modelo vigente:** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Doc espelho:** `docs/PROTECTION_FLOW_LOCKED.md`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Regra para agentes / PRs

**NÃO alterar** o fluxo de proteção (criar, travar stake, liquidar, cancelar, buckets de saldo, teto 50%, 1 op/evento, bloqueio pós-kickoff) **sem solicitação explícita do usuário/dono do produto** nesta conversa ou issue.

Se o pedido não for explícito: **não mexer**. Mudança permitida exige bump de versão + sync `AGENTS.md` + `docs/PROTECTION_FLOW_LOCKED.md` + testes.

Arquivos cobertos (lista mínima):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs` (create/settle/cancel)
- `scripts/arbishield-serverfn-shim.mjs` (settle/cancel/saque)
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html`, `v2-financeiro.js`
- `docs/PROTECTION_FLOW_LOCKED.md`

## Regras de produto vigentes (`stake_lock_v1`)

1. **Ativação:** **trava o stake** (`locked_balance_cents`). Em **cada** evento o usuário pode apostar **no máximo 50% do saldo Apostador restante naquele momento** (`maxStakeLockCents(disponível)`). Após travar, o disponível cai; no próximo evento o teto é de novo **50% do que sobrou**, e assim sucessivamente (ex.: R$ 1000 → máx R$ 500; após usar R$ 500 resta R$ 500 → máx R$ 250). Não cobra dedução na entrada.
2. **Uma operação por evento:** o cliente só pode ter **uma** proteção por jogo (`user` + `match`). Proteção cancelada/estornada não conta (pode tentar de novo).
3. **Sem entrada após o início:** não aceita ativação se `now >= starts_at` (kickoff). Grade e API recusam jogos já iniciados.
4. **LAY** = responsabilidade; **BACK** = stake.
5. **Ganhou na ArbiShield** (`outcome: arbishield` → `lost_exchange`): **credita o stake** no Saldo Reembolso (`deduction_balance_cents`) e **destrava**.
6. **Ganhou na Exchange** (`outcome: exchange` → `won_exchange`): **R$ 0** (não credita Reembolso); **destrava e devolve** o stake à origem; **cobra dedução ArbiShield** + **comissão Exchange 4,5% do lucro**.
7. **Empate Anula / void:** **destrava o stake** (devolve à origem — Real/Demo/Investidor).
8. **Cancelar proteção:** **destrava o stake** (devolve à origem).

Alterar qualquer item acima exige pedido explícito + atualização dos testes do contrato.
<!-- END:protection-flow-lock -->

<!-- BEGIN:profiles-schema-lock -->
# Schema `profiles` — sem coluna `email`

**Marker:** `profiles-sem-coluna-email-v1`  
**Fato:** a tabela `profiles` **não** tem `email` (fica em `auth.users`).  
**Erro clássico:** `column profiles.email does not exist` (42703) — quebra scripts de repair/hotfix antes de qualquer PATCH.

**Regras:**
- Nunca `select=...email` nem `email=eq.` em `/rest/v1/profiles`.
- Nunca embed `profiles(...,email)`.
- Buscar usuário por `id`, `full_name` + saldo, ou `auth/v1/admin/users` (email).
- Helpers: `scripts/lib/profiles-schema.mjs` · teste: `scripts/profiles-schema.test.mjs` (incluído em `npm test`).
<!-- END:profiles-schema-lock -->
