# Sistema — Modo Não-Regressão

**Status:** LOCKED  
**Marker:** `DO_NOT_CHANGE_SYSTEM_SURFACE_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `system-non-regression-v1`  
**Espelho:** `AGENTS.md` (`<!-- BEGIN:system-non-regression -->`)  
**CI:** `npm test` (contratos abaixo)

Pedido explícito (2026-07-30): o sistema inteiro (funcionamento, layout e
banco) fica em **modo não-regressão**. Alterações só com solicitação clara
do dono + bump de versão + sync docs/testes.

---

## Camadas

| Camada | Contrato | O que trava |
|---|---|---|
| Proteção (negócio) | `protection-flow-contract-v10` | stake_lock, settle, cancel, fees |
| Layout (UI) | `ui-markers-contract` | metas `arbishield-build`/`features` + textos críticos |
| Carteira | `wallet-buckets-contract-v1` | colunas + label **Saldo Reembolso** |
| Schema DB | `profiles-db-contract-v1` + `profiles-sem-coluna-email-v1` | migrations/RPC; sem `profiles.email` |
| Deploy/API | `deploy-surface-contract-v1` | football-teams, só stake_lock, path shim |
| Admin ops | `admin-ops-contract-v1` | **Lançar saldo** (depósitos) + **Lançar jogos** |
| Admin UI layout | `admin-ui-layout-contract-v1` | **Menu accordion** + **Monitor Desafios cards** |
| Admin session | `admin-session-mode-contract-v1` | **Modo usuário/ADM** + **Espelho de conta** |

Marker admin: `DO_NOT_CHANGE_ADMIN_OPS_WITHOUT_EXPLICIT_REQUEST`  
Marker layout admin: `DO_NOT_CHANGE_ADMIN_UI_LAYOUT_WITHOUT_EXPLICIT_REQUEST`  
Marker session admin: `DO_NOT_CHANGE_ADMIN_SESSION_MODE_WITHOUT_EXPLICIT_REQUEST`

### Admin — Lançar saldo (Depósitos manuais)

- UI: `admin-manual-deposits.html` (`admin-deposits-creditar-v1`)
- Botões: **Confirmar e Creditar** · **Já creditado** (não mexe no saldo)
- API: shim `approveManualDeposit` + `requireFinanceAdmin`
- Buckets: Apostador / Desafio / Provedor conforme `deposit_type`

### Admin — Lançar jogos

- UI: `admin-jogos.html` (`admin-jogos-unpublish-finalizados-v8`)
- Fluxos: BetBra + **Lançar evento manual** → `POST /api/arbishield/matches`
- Padrão: **rascunho**; **Publicar na fila** só se marcado
- Logos: `/api/arbishield/football-teams`; unpublish de finalizados permanece

### Admin — Menu accordion (anti-reversão)

- `v2-shell.js`: `bindAdminNavAccordion`, `v2-nav-accordion-btn`, `accordion: shell === "admin"`
- `v2.css`: estilos `body[data-shell="admin"] .v2-nav-group`
- Só títulos de seção; clique expande; seção ativa começa aberta
- Hotfix: `scripts/vps-hotfix-admin-menu-accordion.sh` (REF = branch v10)

### Admin — Monitor de Desafios (cards)

- UI: `admin-monitoring-desafios.html` (`desafio-monitor-card-layout-v1`)
- Zonas: `mdz-card-top` · `mdz-card-game` · `mdz-card-foot` (+ `mdz-card-markets`)
- Settle: **Bateu Arbi** / **Bateu Casa** / **Empate Anula**
- Proibido reverter para `<table class="mdz">`
- Hotfix: `scripts/vps-hotfix-monitor-desafios-card-layout.sh` (REF = branch v10)

### Modo usuário / Modo ADM (anti-regressão)

- `v2-shell.js` + `v2.css`: `#v2ModeSwitch` / `.v2-mode-switch`
- Shell **admin:** link **Modo usuário** → `/app.html`
- Shell **app:** link **Modo ADM** → `/admin.html` (inicia `hidden`; só `requireAdmin` revela)
- Não remover o switch nem revelar Modo ADM para não-admin

### Espelho de conta (anti-regressão)

- `v2.js`: `impersonated_user_id` / `setImpersonation` / `getEffectiveUserId` / `clearImpersonation`
- `admin-users.html`: botão **Espelho** + **Acessar Conta (Espelho)** → `/app-carteira.html`
- Banner app: **Sair do espelho** → `/admin-users.html`; saldos usam `viewUserId` efetivo
- `app-proteger.html`: `proteger-espelho-readonly-v13` (não ativa proteção em espelho)
- Logout limpa impersonation antes do `signOut`

---

## Páginas críticas (layout)

- `app-proteger.html` — stake_lock + teto 50% + 1 op/evento
- `app-protecoes.html` — cancel / comissão
- `app-carteira.html` — Saldo Reembolso (nunca “Saldo Dedução”)
- `admin-jogos.html` — settle + busca logos + lançar/publicar
- `admin-manual-deposits.html` — creditar saldo (depósitos)
- `admin-monitoring-desafios.html` — cards 3 zonas + settle

## Auditoria de desvio (produção × git)

`npm run audit:prod` — compara cada arquivo servido em produção com o conteúdo de
todas as branches (`scripts/audit-prod-drift.mjs` + lista `scripts/lib/prod-surface.mjs`).
Ignora só o cache-bust `?v=` que os hotfixes reescrevem no servidor. Status por arquivo:

| Status | O que significa |
|---|---|
| `OK` | igual à referência de mainline — publicação confiável |
| `ATRASADO` | no ar está uma branch mais antiga que a mainline |
| `SEM FONTE` | a mainline não tem o arquivo — não existe versão canônica |
| `DESVIO` | o conteúdo no ar **não existe em branch nenhuma** (editado no servidor) |
| `NAO SERVIDO` | nginx devolveu o fallback SPA em vez do arquivo |

`DESVIO` é a causa das regressões: o arquivo publicado não tem commit, então qualquer
hotfix o sobrescreve com a versão da branch dele. Rodar antes e depois de publicar.
Workflow manual: `.github/workflows/audit-prod-drift.yml`.

## Runtime (VPS)

```bash
bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-check-pos-deploy-v10.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
```

Exige health `:3098`/`:3101` com `protection-runtime-stake-lock-v10` +
`stake_lock_v1`, e (opcional) billing_model de proteções novas + metas UI no disco.
