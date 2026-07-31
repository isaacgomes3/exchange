# Fluxo de Proteção — TRAVADO

**Status:** LOCKED  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Citação:** `NEVER_CITE_OBSOLETE_PROTECTION_MODELS`  
**Versão:** `protection-flow-contract-v10` — **ÚNICA fonte de verdade**  
**Modelo (único):** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Espelho em:** `AGENTS.md` (bloco `<!-- BEGIN:protection-flow-lock -->`)  
**CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

**Pedido explícito (2026-07-31):** ao descrever o fluxo de proteção, citar
**somente** `stake_lock_v1` / contrato v10. **Proibido** nomear, resumir ou
contrastar com qualquer modelo antigo — mesmo como “obsoleto”, “histórico” ou
“legado”. Branches/comentários desatualizados que ainda tragam outros nomes
devem ser **ignorados** na resposta.

**Modo sistema inteiro:** ver também `docs/SYSTEM_NON_REGRESSION.md`
(`system-non-regression-v1`) — layout UI, buckets de carteira, schema e
superfície de deploy.

## Anti-regressão runtime

| Controle | Marker / script |
|---|---|
| Health fail-hard | `protection-runtime-stake-lock-v10` + `createProtectionModel=stake_lock_v1` → 503 se ≠ stake_lock |
| Check pós-deploy | `vps-check-pos-deploy-v10.sh` / `.mjs` (health + billing_model) |
| Hotfix create | `vps-hotfix-create-stake-lock-v6.sh` → branch `protecao-v10-fonte-verdade-501d` |
| Restaurar logos | `vps-restaurar-api-logo-times.sh` exige stake_lock |

---

## Política de alteração

Este fluxo **só pode ser alterado** com **solicitação explícita** do dono do produto (nesta conversa, issue ou PR com pedido claro).

Sem esse pedido, agentes e PRs **não devem**:

- mudar regras de ativação, settle, cancel, buckets de saldo;
- citar ou reintroduzir qualquer modelo que não seja `stake_lock_v1`;
- creditar Saldo Reembolso em vitória Exchange;
- remover o teto de 50%, a regra 1 op/evento ou o bloqueio pós-kickoff.

Qualquer mudança permitida exige:

1. pedido explícito do dono;
2. bump da versão do contrato;
3. atualização de `AGENTS.md` + este doc;
4. atualização dos testes do contrato (CI verde).

Arquivos cobertos (mínimo):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs`
- `scripts/arbishield-serverfn-shim.mjs`
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html`, `v2-financeiro.js`
- `AGENTS.md` · este arquivo

---

## Fluxo vigente (descrição completa)

### 1. Ativação (criar proteção)

1. **Só antes do início do evento** — se `now >= starts_at`, a API e a grade **recusam**.
2. **Uma operação por evento** — o cliente só pode ter **uma** proteção por jogo (`user` + `match`, LAY ou BACK). Proteção **cancelada/estornada** não conta (pode tentar de novo).
3. **Trava o stake** em `locked_balance_cents` (sai do Apostador disponível).
4. **Não cobra dedução** na entrada (a dedução fica calculada/armazenada para o caso Exchange).
5. **Teto:** no máximo **50% do saldo Apostador restante naquele momento**.
6. Em eventos seguintes, o teto **recalcula sobre o que sobrou** (não sobre a banca original).

Exemplo sucessivo:

| Momento | Disponível | Máx. neste evento |
|---|---|---|
| Banca inicial | R$ 1.000 | R$ 500 |
| Após usar R$ 500 | R$ 500 | R$ 250 |
| Após usar R$ 250 | R$ 250 | R$ 125 |

- **LAY** = responsabilidade · **BACK** = stake

### 2. Ganhou na ArbiShield

- Outcome: `arbishield` → status `lost_exchange`
- **Credita o stake** no **Saldo Reembolso** (`deduction_balance_cents`)
- **Destrava** o locked
- **Não** cobra dedução

### 3. Ganhou na Exchange

- Outcome: `exchange` → status `won_exchange`
- **R$ 0** no Saldo Reembolso (não credita)
- **Destrava e DEVOLVE** o stake à origem (Apostador / Demo / Investidor)
- **Cobra só a dedução ArbiShield** da odd canônica do bilhete
- A fatia Exchange 4,5% já entra no cálculo da dedução — **não** debita de novo
- Heal: `won_exchange` com tx zerada/incompleta **reprocessa** até carteira completa

Exemplos LAY:

| Stake | Odd | Fee ArbiShield | Carteira (ex. base 8.067,52) |
|---|---|---|---|
| 1000 | 10 | 91,11 | 8.067,52 + 1.000 − 91,11 = **8.976,41** |
| 1000 | 32 | 15,81 | 8.067,52 + 1.000 − 15,81 = **9.051,71** |

Odd canônica: `approved_odd` > `calculations.marketOdd` > `metadata.market_odd` > `row.odd`.

### 4. Empate Anula / void

- **Destrava** o stake e devolve à origem
- Não credita Reembolso

### 5. Cancelar proteção

- **Destrava** o stake e devolve à origem

---

## Markers (não renomear)

| Marker | Uso |
|---|---|
| `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST` | lock geral |
| `NEVER_CITE_OBSOLETE_PROTECTION_MODELS` | proibição de citar modelos antigos |
| `protection-flow-contract-v10` | versão do contrato |
| `stake_lock_v1` | único billing model |
| `protection-runtime-stake-lock-v10` | health runtime |
| `create-protection-stake-lock-v6` | createProtection |
| `settle-exchange-cobra-so-deducao-v9` | settle Exchange |
| `settle-exchange-heal-incompleto-v10` | heal Exchange |
| `settlement-odd-canonico-v10` | odd do bilhete |
