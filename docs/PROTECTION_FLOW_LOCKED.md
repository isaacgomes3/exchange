# Fluxo de Proteção — TRAVADO

**Status:** LOCKED  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v10` — **ÚNICA fonte de verdade**  
**Modelo:** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Espelho em:** `AGENTS.md` (bloco `<!-- BEGIN:protection-flow-lock -->`)  
**CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

**Pedido explícito (2026-07-30):** v10 é a fonte de verdade. Qualquer outra
versão pode ser excluída. Modelos obsoletos (não usar / não reintroduzir):

- `fee_upfront_v1`
- `lock_fee_after_v1`
- `locked_margin_v2`
- `FLUXO_PROTECAO_V1` / `fluxo-protecao-v1`
- contracts `v1`–`v9` tratados como vigentes

Compatibilidade residual de `fee_upfront` no código existe **somente** para
settle/cancel de linhas antigas no banco — nunca para novas proteções.

## Anti-regressão runtime

| Controle | Marker / script |
|---|---|
| Health fail-hard | `protection-runtime-stake-lock-v10` + `createProtectionModel=stake_lock_v1` → 503 se fee_upfront |
| Bloqueio deploy fee_upfront | `vps-atualizar-protecao-fee-upfront-prod.sh` (só `ALLOW_FEE_UPFRONT_DEPLOY=1`) |
| Check pós-deploy | `vps-check-pos-deploy-v10.sh` / `.mjs` (health + billing_model) |
| Hotfix create | `vps-hotfix-create-stake-lock-v6.sh` → branch `protecao-v10-fonte-verdade-501d` |
| Restaurar logos | `vps-restaurar-api-logo-times.sh` exige stake_lock (não republica fee_upfront) |

---

## Política de alteração

Este fluxo **só pode ser alterado** com **solicitação explícita** do dono do produto (nesta conversa, issue ou PR com pedido claro).

Sem esse pedido, agentes e PRs **não devem**:

- mudar regras de ativação, settle, cancel, buckets de saldo;
- reintroduzir `fee_upfront`, `lock_fee_after`, `locked_margin` ou `FLUXO_PROTECAO_V1` como modelo vigente;
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

### 3. Ganhou na Exchange (pedido explícito v9/v10)

- Outcome: `exchange` → status `won_exchange`
- **R$ 0** no Saldo Reembolso (não credita)
- **Destrava e DEVOLVE** o stake à origem (Apostador / Demo / Investidor)
- **Cobra SÓ a dedução ArbiShield** da **odd canônica** (`lucro − 4,5% − 1,5%`)
- **NÃO** debita comissão Exchange de novo na carteira (já líquida na dedução)
- Ex. LAY R$1000 @10: `8.067,52 + 1.000 − 91,11 = 8.976,41`
- Ex. LAY R$1000 @32: `8.067,52 + 1.000 − 15,81 = 9.051,71`
- Marker: `settle-exchange-cobra-so-deducao-v9`
- **Heal v10:** `won_exchange` com tx R$0 / sem `stake_returned` / fee incompleta **reprocessa** (não trata como já creditado). Marker: `settle-exchange-heal-incompleto-v10`
- **Odd canônica:** `approved_odd` > `calculations.marketOdd` > `metadata.market_odd` > `row.odd`. Marker: `settlement-odd-canonico-v10`
- Contestation approve **sempre** sincroniza `metadata.market_odd` com a odd aprovada
- Scripts de reparo com alvo fixo `897641` / fee `9111` estão **bloqueados** por padrão (exigem `ALLOW_ODD10_TARGET=1`)

### 3b. Lucro LAY para fees

- Lucro = **responsabilidade / (odd − 1)** (back equivalente)
- Ex.: R$1000 @10 → lucro R$111,11
  - Exchange (4,5% do lucro): **R$5,00** (só no cálculo)
  - Cliente (1,5% da resp.): **R$15,00**
  - ArbiShield (cobrado): **R$91,11**
- Ex.: R$1000 @32 → lucro R$32,26 → ArbiShield **R$15,81**
- Marker: `lay-lucro-back-equiv-v9`

### 4. Empate Anula / void

- **Destrava o stake** e **devolve à origem** (Real / Demo / Investidor)
- **Não** vai para Reembolso
- **Não** cobra dedução

### 5. Cancelar

- **Destrava o stake** e **devolve à origem**
- **Não** cobra dedução

---

## Resumo

```
ATIVAR   → só antes do kickoff · 1 op/evento · trava stake · máx 50% do restante
ARBI     → stake → Saldo Reembolso + destrava
EXCHANGE → R$ 0 Reembolso · destrava e devolve · cobra só dedução da odd canônica
           (@10 → −91,11 · @32 → −15,81) · heal incompleto (v10)
EMPATE   → destrava e devolve à origem
CANCELAR → destrava e devolve à origem
```

**Saldo Reembolso** = `profiles.deduction_balance_cents`  
**Marker settle Exchange:** `settle-exchange-cobra-so-deducao-v9`  
**Marker heal incompleto:** `settle-exchange-heal-incompleto-v10`  
**Marker odd canônica:** `settlement-odd-canonico-v10`
