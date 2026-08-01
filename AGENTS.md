<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Status:** LOCKED — alterar **somente** com solicitação explícita do dono do produto  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Citação:** `NEVER_CITE_OBSOLETE_PROTECTION_MODELS`  
**Versão:** `protection-flow-contract-v10` — **ÚNICA fonte de verdade**  
**Modelo (único):** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Doc espelho:** `docs/PROTECTION_FLOW_LOCKED.md`  
**Guia operacional:** `docs/FUNCIONAMENTO_DESAFIO_E_PROTECAO.md` (Desafio + proteção + financeiro + admin + APIs)  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

**Pedido explícito (2026-07-31):** ao descrever o fluxo de proteção (resposta,
PR, commit, UI copy, runbook), citar **somente** `stake_lock_v1` / contrato v10.
**Proibido** nomear, resumir ou contrastar com qualquer modelo antigo — mesmo
como “obsoleto”, “histórico” ou “legado”. Se outro nome aparecer em branch
desatualizada ou comentário antigo, **ignorar** e usar só as regras abaixo.

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

## Anti-regressão runtime (pedido 2026-07-30 / 2026-07-31)

- Health `:3098`/`:3101` deve expor `protectionRuntime=protection-runtime-stake-lock-v10` + `createProtectionModel=stake_lock_v1` + `cancelRefundGuard=cancel-legacy-no-stake-overcredit-v10` (fail-hard → 503 se ≠ `stake_lock_v1` **ou** se o JSON citar modelo antigo).
- Superfícies de produto (AGENTS/docs/UI) **nunca** citam nomes de modelos antigos — CI: `scripts/protection-cite-ban.test.mjs`.
- Deploy de modelo antigo permanece **BLOQUEADO** sob v10 (só override explícito do dono).
- Pós-deploy: `scripts/vps-check-pos-deploy-v10.sh` (health + `billing_model=stake_lock_v1` em proteções novas).
- Hotfixes / restaurar logos apontam para branch `cursor/protecao-v10-fonte-verdade-501d`.
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
**Admin ops marker:** `DO_NOT_CHANGE_ADMIN_OPS_WITHOUT_EXPLICIT_REQUEST`  
**Admin UI layout marker:** `DO_NOT_CHANGE_ADMIN_UI_LAYOUT_WITHOUT_EXPLICIT_REQUEST`  
**Admin session marker:** `DO_NOT_CHANGE_ADMIN_SESSION_MODE_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `system-non-regression-v1` · admin `admin-ops-contract-v1` · layout `admin-ui-layout-contract-v1` · session `admin-session-mode-contract-v1`  
**Doc:** `docs/SYSTEM_NON_REGRESSION.md`  
**CI:** `npm test` → contratos UI / wallet / deploy / DB / admin-ops / admin-ui-layout / admin-session-mode + proteção v10

**Pedido explícito (2026-07-30 / 2026-07-31):** travar o sistema inteiro contra
regressão (API, UI, schema). Proteção = só `stake_lock_v1` (nunca citar outro
modelo). Não remover rotas/logos, não renomear buckets de carteira, não SELECT
`profiles.email`. Não reverter menu admin accordion nem cards do Monitor de
Desafios. Não reverter **Modo usuário / Modo ADM** nem **espelho de conta**.

## Camadas (não remover do CI)

| Camada | Fonte | Teste |
|---|---|---|
| Proteção | `scripts/lib/protection-flow-contract.mjs` | `protection-flow-contract.test.mjs` |
| Layout UI | `scripts/lib/ui-markers-contract.mjs` | `ui-markers-contract.test.mjs` |
| Carteira | `scripts/lib/wallet-buckets-contract.mjs` | `wallet-buckets-contract.test.mjs` |
| Schema DB | `scripts/lib/profiles-db-contract.mjs` + `profiles-schema.mjs` | `profiles-db-contract.test.mjs` + `profiles-schema.test.mjs` |
| Deploy/API | `scripts/lib/deploy-surface-contract.mjs` | `deploy-surface-contract.test.mjs` |
| Admin ops | `scripts/lib/admin-ops-contract.mjs` | `admin-ops-contract.test.mjs` |
| Admin UI layout | `scripts/lib/admin-ui-layout-contract.mjs` | `admin-ui-layout-contract.test.mjs` |
| Admin session | `scripts/lib/admin-session-mode-contract.mjs` | `admin-session-mode-contract.test.mjs` |

## Regras rápidas

1. **Funcionamento:** create = `stake_lock_v1`; health com `protection-runtime-stake-lock-v10`; settle/cancel conforme v10.
2. **Layout:** páginas críticas mantêm `arbishield-build` / features; carteira mostra **Saldo Reembolso** (nunca “Saldo Dedução”).
3. **Banco:** sem `profiles.email`; colunas wallet (`locked_balance_cents`, `deduction_balance_cents`, …) e RPC `request_saldo_reembolso_withdrawal` permanecem.
4. **Deploy:** `vps-atualizar-protecao-fee-upfront-prod.sh` bloqueado; shim em `/opt/arbishield/scripts/`; rota `/api/arbishield/football-teams` viva.
5. **Admin — Lançar saldo:** `admin-manual-deposits.html` → `Confirmar e Creditar` / `Já creditado` (sem alterar saldo) via `approveManualDeposit` + finance admin.
6. **Admin — Lançar jogos:** `admin-jogos.html` (`admin-jogos-edit-preserva-publicacao-v1`) → `POST /api/arbishield/matches` (BetBra + manual); padrão rascunho; `Publicar na fila` explícito; unpublish finalizados. **Editar** só altera dados — não publica, não tira da fila e não esconde.
7. **Admin — menu accordion:** `v2-shell.js` + `v2.css` → só títulos; clique abre; `bindAdminNavAccordion` / `v2-nav-accordion-btn`.
8. **Admin — Monitor Desafios cards:** `admin-monitoring-desafios.html` (`desafio-monitor-card-layout-v1`) → zonas `mdz-card-top` / `mdz-card-game` / `mdz-card-foot` + settle Bateu Arbi/Casa/Empate Anula; sem tabela `.mdz` densa.
9. **Modo usuário / Modo ADM:** `v2ModeSwitch` — admin→`/app.html` («Modo usuário»); app→`/admin.html` («Modo ADM», hidden até `requireAdmin`).
10. **Espelho de conta:** `setImpersonation` / `getEffectiveUserId` / banner «Sair do espelho»; entrada em `admin-users` (Espelho); proteger readonly (`proteger-espelho-readonly-v13`).
11. **VPS:** após deploy → `vps-check-pos-deploy-v10.sh` (via API GitHub, não raw cacheado).
11b. **`main` é a fonte única de deploy.** Todo script baixa de `main` (`ARBISHIELD_REF:-main`); **proibido** default `cursor/<branch>` ou sha fixo — era assim que rodar script antigo trazia arquivo antigo de volta. Trabalho novo vai para branch, mas **publica só depois de estar em `main`**. Teste: `deploy-ref-main.test.mjs`.
12. **Antes e depois de publicar:** `npm run audit:prod` (`prod-surface-v1`) compara produção × git. `DESVIO` = arquivo no ar sem commit (editado no servidor) → o próximo hotfix o sobrescreve; `ATRASADO` = publicado de branch antiga. Não publicar em cima de `DESVIO` sem antes trazer o conteúdo para o repo.
13. **Publicar frontend:** `scripts/vps-publish-release.sh --ref <commit>` (`release-artifact-v1`, runbook `docs/RELEASES.md`) — release por commit em `releases/<sha>`, `v2` como symlink, `__version.json` no ar e **guarda que recusa commit anterior/divergente**. Cache-bust vem do build; **proibido** `sed` de `?v=` no servidor e `find /var/www -name` para escrever. Novos hotfixes por arquivo não devem ser criados.
14. **Desafio — marcador de mercado:** `app-desafio.html` (`desafio-dnb-flag-v1`) → **Empate Anula/DNB é aposta no time** (V no vencedor, × no outro, **E** de estorno se empatar); nunca resolver pelo ramo 1X2 `isDraw`. Teste: `desafio-market-flag.test.mjs`.
15. **Desafio — card do cliente:** cada quadro fica **embaixo do time em que aposta** (`desafio-painel-lado-time-v1`, `marketTeamSide` + `is-swapped`; mobile 1 coluna volta ao padrão) e a **casa de aposta sempre mostra logo** (`desafio-casa-logo-v1`, `/brand/houses/`).
16. **Desafio em andamento (ao vivo):** liquida-se (Bateu Arbi/Casa/Empate Anula), **nunca** cancela nem exclui — `block-cancel-delete-andamento-v1`. **Isaac/Carlos** cancelam publicado/agendado (não ao vivo) via `protect-ops-isaac-carlos-v1`. Teste: `desafio-ops-guard.test.mjs`.
16b. **Desafio — editar lançado:** `admin-desafios-edit-preserva-publicacao-v1` — botão **Editar** no card; `edit_only` + step ids; **não** mexe em `is_active`/`status`/`published_at`. Teste: `desafio-edit-preserva.test.mjs`.
16c. **Extrato detalhado:** `extrato-eventos-detalhado-v1` — cliente e admin mostram entradas/saídas de eventos, lucro, deduções, cancelamentos (admin) e toda movimentação. Teste: `extrato-eventos-detalhado.test.mjs`.
17. **Allowlist de admin:** `admin-email-allowlist-v1` — role no banco **não basta**; o e-mail do JWT tem que estar em `ALLOWED_ADMIN_EMAILS` (shim `currentUserIsAdmin`/`currentUserIsSuperAdmin`, **antes** de consultar o banco) e em `v2.js` (`isAdminUser`). Complementa o 2FA obrigatório (`admin-mfa-required-v1`) — os dois ficam. Teste: `admin-allowlist.test.mjs`.
18. **Publicar backend:** `scripts/vps-publish-shim.sh --ref <commit>` (`shim-release-v1`, runbook `docs/RELEASES.md`) — publica **em `/opt/arbishield/scripts/`** (o que o systemd executa), sincroniza as cópias paralelas, grava `.shim-release.json` (o `/health` expõe `release.commit`), tem guarda contra publicar para trás, `node --check` antes da troca e **rollback automático** se o health não voltar saudável. Diagnóstico: `vps-diag-shim-versao.sh`. Não voltar a publicar shim por hotfix de arquivo.

Mudança em qualquer item exige pedido explícito + bump + sync AGENTS/docs + testes verdes.
<!-- END:system-non-regression -->
