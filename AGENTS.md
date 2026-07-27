<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Status:** LOCKED — alterar **somente** com solicitação explícita do dono do produto  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v11`
**Modelo vigente:** `fee_upfront_v1`
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Doc espelho:** `docs/PROTECTION_FLOW_LOCKED.md`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Regra para agentes / PRs

**NÃO alterar** o fluxo de proteção (criar, cobrar taxa, liquidar, cancelar, comprovante, buckets de saldo, teto 50%, 1 op/evento, bloqueio pós-kickoff) **sem solicitação explícita do usuário/dono do produto** nesta conversa ou issue.

Se o pedido não for explícito: **não mexer**. Mudança permitida exige bump de versão + sync `AGENTS.md` + `docs/PROTECTION_FLOW_LOCKED.md` + testes.

Arquivos cobertos (lista mínima):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs` (create/settle/cancel)
- `scripts/arbishield-serverfn-shim.mjs` (settle/cancel/saque)
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html`, `v2-financeiro.js`
- `docs/PROTECTION_FLOW_LOCKED.md`

## Regras de produto vigentes (`fee_upfront_v1`)

1. **Ativação:** cobra **somente a taxa ArbiShield** e **não trava o stake** (`locked_balance_cents` não muda). A responsabilidade/stake continua limitada a **50% do saldo Apostador restante naquele momento** (`maxStakeLockCents(disponível)`). Como a taxa reduz o disponível, em eventos seguintes o teto é recalculado sucessivamente sobre o saldo atual — **50% do que sobrou**.
2. **Uma operação por evento:** o cliente só pode ter **uma** proteção por jogo (`user` + `match`). Proteção cancelada/estornada não conta (pode tentar de novo).
3. **Sem entrada após o início:** não aceita ativação se `now >= starts_at` (kickoff). Grade e API recusam jogos já iniciados.
4. **LAY** = responsabilidade; **BACK** = stake.
5. **Fórmula da taxa na criação:** lucro bruto menos **somente** o lucro do usuário (1,5% da cobertura). Não subtrair a comissão Exchange 4,5%, que pode ser armazenada apenas como informação. LAY R$1000@10: `111,11 − 15,00 = 96,11`; LAY R$1000@32: `32,26 − 15,00 = 17,26`. Marker: `fee-lucro-menos-1_5-v11`.
6. **Ganhou na ArbiShield** (`outcome: arbishield` → `pending_refund`): exige comprovante (`arbishield-exige-comprovante-v11`) e **não credita automaticamente**. O settle retorna o valor elegível para o fluxo posterior de comprovantes.
7. **Ganhou na Exchange** (`outcome: exchange` → `won_exchange`): crédito **R$ 0**; a taxa já foi cobrada; não há stake travado para destravar ou devolver.
8. **Empate Anula / void:** devolve **somente a taxa** ao Saldo Reembolso (`deduction_balance_cents`).
9. **Cancelar proteção:** devolve **somente a taxa** (`cancel-fee-upfront-nao-devolve-stake-v6`).
10. Linhas históricas explicitamente `stake_lock_v1` mantêm o comportamento antigo: ArbiShield credita stake e usa `lost_exchange`; Exchange destrava/devolve e cobra a dedução antiga (`lucro − 4,5% − 1,5%`); void/cancel devolvem stake. Os helpers de odd canônica e heal continuam para essas linhas.

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
