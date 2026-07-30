<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Status:** LOCKED — alterar **somente** com solicitação explícita do dono do produto  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v10` — **ÚNICA fonte de verdade**  
**Modelo vigente:** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Doc espelho:** `docs/PROTECTION_FLOW_LOCKED.md`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

**Pedido explícito (2026-07-30):** v10 é a fonte de verdade. Qualquer outra
versão/modelo de proteção está **obsoleto e pode ser excluído** —
`fee_upfront_v1`, `lock_fee_after_v1`, `locked_margin_v2`, `FLUXO_PROTECAO_V1`,
contracts v1–v9 como “vigente”. Agentes **não** devem basear PRs nesses modelos
nem reintroduzi-los.

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
6. **Ganhou na Exchange** (`outcome: exchange` → `won_exchange`): **R$ 0** (não credita Reembolso); **destrava e devolve** o stake à origem; **cobra só a dedução ArbiShield da odd canônica** (ex. LAY 1000@10 → R$ 91,11 · **1000@32 → R$ 15,81**). A fatia Exchange 4,5% já entra no cálculo da dedução — **não** debita de novo. **Heal:** `won_exchange` com tx zerada/incompleta **reprocessa** até `isExchangeWalletComplete` (marker `settle-exchange-heal-incompleto-v10`). Nunca marcar terminal sem carteira completa; nunca fee hardcoded 91,11 sem odd do bilhete.
7. **Empate Anula / void:** **destrava o stake** (devolve à origem — Real/Demo/Investidor).
8. **Cancelar proteção:** **destrava o stake** (devolve à origem).
9. **LAY lucro (fees):** `resp/(odd−1)` — ex. R$1000 @10 = R$111,11 → fee **91,11** → carteira `8.067,52+1.000−91,11=**8.976,41**`; R$1000 @32 → fee **15,81** → `8.067,52+1.000−15,81=**9.051,71**`. Odd canônica: `approved_odd` > `calculations.marketOdd` > `metadata.market_odd` > `row.odd` (`settlement-odd-canonico-v10`). Marker settle: `settle-exchange-cobra-so-deducao-v9`. Helper anti-duplo: `settlementExchangeCommissionWalletCents()` sempre **0**.

Alterar qualquer item acima exige pedido explícito + atualização dos testes do contrato.

## Anti-regressão runtime (pedido 2026-07-30)

- Health `:3098`/`:3101` deve expor `protectionRuntime=protection-runtime-stake-lock-v10` + `createProtectionModel=stake_lock_v1` (fail-hard → 503 se fee_upfront).
- `scripts/vps-atualizar-protecao-fee-upfront-prod.sh` está **BLOQUEADO** sob v10 (só `ALLOW_FEE_UPFRONT_DEPLOY=1` com pedido explícito).
- Pós-deploy: `scripts/vps-check-pos-deploy-v10.sh` (health + billing_model de proteções novas).
- Hotfix stake_lock / restaurar logos apontam para branch `cursor/protecao-v10-fonte-verdade-501d` (não `protecao-fee-upfront-3cf9`).
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

<!-- BEGIN:system-non-regression -->
# Sistema — MODO NÃO-REGRESSÃO (funcionamento + layout + banco)

**Status:** LOCKED — alterar **somente** com solicitação explícita do dono  
**Marker:** `DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `system-non-regression-v1`  
**Doc:** `docs/SYSTEM_NON_REGRESSION.md`  
**CI:** `npm test` → contratos UI / wallet / deploy / DB + proteção v10

**Pedido explícito (2026-07-30):** travar o sistema inteiro contra regressão
(API, UI, schema). Não reintroduzir `fee_upfront` como vigente, não remover
rotas/logos, não renomear buckets de carteira, não SELECT `profiles.email`.

## Camadas (não remover do CI)

| Camada | Fonte | Teste |
|---|---|---|
| Proteção | `scripts/lib/protection-flow-contract.mjs` | `protection-flow-contract.test.mjs` |
| Layout UI | `scripts/lib/ui-markers-contract.mjs` | `ui-markers-contract.test.mjs` |
| Carteira | `scripts/lib/wallet-buckets-contract.mjs` | `wallet-buckets-contract.test.mjs` |
| Schema DB | `scripts/lib/profiles-db-contract.mjs` + `profiles-schema.mjs` | `profiles-db-contract.test.mjs` + `profiles-schema.test.mjs` |
| Deploy/API | `scripts/lib/deploy-surface-contract.mjs` | `deploy-surface-contract.test.mjs` |

## Regras rápidas

1. **Funcionamento:** create = `stake_lock_v1`; health com `protection-runtime-stake-lock-v10`; settle/cancel conforme v10.
2. **Layout:** páginas críticas mantêm `arbishield-build` / features; carteira mostra **Saldo Reembolso** (nunca “Saldo Dedução”).
3. **Banco:** sem `profiles.email`; colunas wallet (`locked_balance_cents`, `deduction_balance_cents`, …) e RPC `request_saldo_reembolso_withdrawal` permanecem.
4. **Deploy:** `vps-atualizar-protecao-fee-upfront-prod.sh` bloqueado; shim em `/opt/arbishield/scripts/`; rota `/api/arbishield/football-teams` viva.
5. **VPS:** após deploy → `vps-check-pos-deploy-v10.sh` (via API GitHub, não raw cacheado).

Mudança em qualquer item exige pedido explícito + bump + sync AGENTS/docs + testes verdes.
<!-- END:system-non-regression -->
