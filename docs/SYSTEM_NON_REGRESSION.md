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

- UI: `admin-jogos.html` (`admin-jogos-edit-preserva-publicacao-v1`)
- Fluxos: BetBra + **Lançar evento manual** → `POST /api/arbishield/matches`
- Padrão: **rascunho**; **Publicar na fila** só se marcado
- **Editar evento:** só altera dados (times, horário, odd, liquidez ≥ utilizado); **não** muda `is_published` nem esconde do site
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

### Desafio — marcador de mercado no card (anti-regressão)

- UI: `app-desafio.html` (`desafio-dnb-flag-v1`) · `marketDecidedStatus(name, home, away, finished, teams)`
- **Empate Anula / Draw No Bet é aposta no time**, com estorno se der empate:
  V no time que venceu, × no outro, **E** (`is-void`) quando terminou empatado
- Proibido cair no ramo 1X2 `isDraw` — marcava × nos dois lados do card
- Times chegam pelos dois painéis: `marketLineHtml(item.marketArbi|marketCasa, item.liveInfo, teams)`
- **Quadro embaixo do time apostado** (`desafio-painel-lado-time-v1`): `marketTeamSide()` +
  classe `is-swapped` no `.dz-v2-compare` (mandante à esquerda); no mobile de 1 coluna
  a ordem volta ao padrão (ArbiShield primeiro)
- **Logo da casa de aposta** (`desafio-casa-logo-v1`): `casaBrandLogo()` → `/brand/houses/betbra.png`,
  fallback `/brand/houses/casa.svg` (sempre tem logo); não remover os assets
- Teste: `scripts/desafio-market-flag.test.mjs` · Hotfix: `scripts/vps-hotfix-desafio-dnb-flag.sh`

### Desafio em andamento — liquidar, não cancelar (anti-regressão)

- Marker `block-cancel-delete-andamento-v1` · teste `scripts/desafio-ops-guard.test.mjs`
- **Em andamento** = etapa **ao vivo** (kickoff passou e ainda aberta)
- UI `admin-desafios.html`: sem **Cancelar/Excluir** ao vivo; aviso
  «Em andamento · Cancelar/Excluir bloqueados»
- **Isaac/Carlos** (`protect-ops-isaac-carlos-v1`): veem **Cancelar · devolver saldo**
  em rascunho, protegido e **publicado/agendado** (não ao vivo)
- Demais admins: Cancelar só em rascunho não protegido
- Shim `cancelDesafio`: **403** se ao vivo; publicado/agendado só Isaac/Carlos
- Shim `deleteDesafio`: **403** se `is_active` (Excluir nunca em publicado)
- A trava nasceu numa linhagem e faltava na outra; não remover de nenhum dos dois lados.

### Desafio — editar lançado sem retirar (anti-regressão)

- Marker `admin-desafios-edit-preserva-publicacao-v1` · teste `scripts/desafio-edit-preserva.test.mjs`
- UI `admin-desafios.html`: botão **Editar** no card (ativo/publicado); drawer com ids;
  **Salvar alterações** envia `edit_only` + step `id`s
- Edição **não** mexe em `is_active` / `status` / `published_at` (não retira da grade)
- API: `POST /api/arbishield/desafios` com `id` + `steps` → `upsertDesafio`
- Liquidez não pode cair abaixo de `used_liquidity_cents`; etapas encerradas
  preservam `status`

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

## Publicação versionada (`release-artifact-v1`)

Runbook: `docs/RELEASES.md` · publicador: `scripts/vps-publish-release.sh` ·
contrato: `scripts/lib/release-manifest.mjs` · teste: `release-manifest.test.mjs`.

- Um artefato por commit em `releases/<commit>`, com `__manifest.json` (sha256 de
  cada arquivo) e `__version.json` (commit publicado, consultável por HTTP)
- `v2` é **symlink** para a release; troca atômica (`ln -sfn` + `mv -Tf`); `--rollback`
  volta para a anterior pelo `.history`
- **Guarda de regressão:** `decidePublish()` recusa commit `behind` ou `diverged` em
  relação ao que está no ar (código de saída 3); só `--force` passa por cima
- **Checagem de referências:** `missingRefs()` recusa release que cite arquivo que ela
  não carrega (código 5) — publicar assim trocaria arquivo servido por 404.
  `finance-admins.js` e `blocked-emails.js` entram por `RELEASE_EXTRA_FILES`;
  `market-catalog.js` precisa continuar em `static/v2/`
- Cache-bust sai do build (`applyCacheBust()` → commit curto). **Proibido** `sed` de
  `?v=` no HTML publicado e escrita com `find /var/www -name` (atinge backups)

### Allowlist de admin (anti-regressão)

- Marker `admin-email-allowlist-v1` · teste `scripts/admin-allowlist.test.mjs`
- Shim: `currentUserIsAdmin` e `currentUserIsSuperAdmin` checam `ALLOWED_ADMIN_EMAILS`
  **antes** de qualquer consulta ao banco — role no banco não basta
- `v2.js`: `isAdminUser` idem; `BLOCKED_EMAILS` guarda as contas do incidente
- Complementa o 2FA obrigatório (`admin-mfa-required-v1`); **os dois ficam**
- Nasceu de conta que virou super admin e apagou desafios; já se perdeu uma vez ao
  publicar de linhagem que não a tinha. Não remover de nenhum dos dois lados.

## Backend versionado (`shim-release-v1`)

Publicador: `scripts/vps-publish-shim.sh` · diagnóstico: `vps-diag-shim-versao.sh` ·
teste: `shim-release.test.mjs` · runbook: `docs/RELEASES.md`.

- Publica em **`/opt/arbishield/scripts/`** — é o que o `systemd` executa. Cópia na
  raiz ficava mais nova sem estar rodando; o publicador sincroniza as duas
- `.shim-release.json` + campo `release` no `/health` → o commit do backend passa a
  ser consultável
- Guarda contra publicar commit anterior/divergente (código 3), `node --check` antes
  da troca, backup de shim+lib e **rollback automático** se o `/health` não voltar
  com `ok=true` + `createProtectionModel=stake_lock_v1` (código 7)
- **Proibido** voltar a publicar shim copiando arquivo por hotfix

## `main` como fonte única de deploy

- Teste: `scripts/deploy-ref-main.test.mjs` · marker: `ARBISHIELD_REF:-main`
- Todo script de deploy baixa de `main`. **Proibido** default `cursor/<branch>` ou sha
  fixo — 45 scripts apontavam para uma branch de 27/07 e 38 para uma de 25/07, então
  rodar script antigo republicava arquivo antigo
- Publicar sempre `--ref main`; branch serve para revisão, não para deploy
- A auditoria compara produção com `origin/main` por padrão

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
