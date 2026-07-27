# Fluxo de Proteção — TRAVADO

**Status:** LOCKED  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v8`  
**Modelo:** `stake_lock_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Espelho em:** `AGENTS.md` (bloco `<!-- BEGIN:protection-flow-lock -->`)  
**CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

---

## Política de alteração

Este fluxo **só pode ser alterado** com **solicitação explícita** do dono do produto (nesta conversa, issue ou PR com pedido claro).

Sem esse pedido, agentes e PRs **não devem**:

- mudar regras de ativação, settle, cancel, buckets de saldo;
- reintroduzir `fee_upfront` como modelo vigente;
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

### 3. Ganhou na Exchange (pedido explícito v7)

- Outcome: `exchange` → status `won_exchange`
- **R$ 0** no Saldo Reembolso (não credita)
- **Destrava e DEVOLVE** o stake à origem (Apostador / Demo / Investidor)
- **Cobra a dedução ArbiShield** (`lucro − 4,5% − 1,5%`)
- **Cobra comissão Exchange 4,5%** sobre o lucro bruto da aposta

### 3b. Lucro LAY para fees (pedido explícito v8)

- Lucro = **responsabilidade / odd** (não `/(odd−1)`)
- Ex.: R$1000 @10 → lucro R$100
  - Cliente (1,5% da resp.): **R$15,00**
  - Exchange (4,5% do lucro): **R$4,50**
  - ArbiShield: **R$80,50**
- Marker: `lay-lucro-responsabilidade-sobre-odd-v8`

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
EXCHANGE → R$ 0 Reembolso · destrava e devolve · cobra dedução + comissão 4,5%
EMPATE   → destrava e devolve à origem
CANCELAR → destrava e devolve à origem
```

**Saldo Reembolso** = `profiles.deduction_balance_cents`  
**Marker settle Exchange:** `settle-exchange-devolve-cobra-v7`
