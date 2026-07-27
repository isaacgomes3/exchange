# Fluxo de Proteção — Site Antigo × Atual

Fontes:

| Camada | Onde |
|--------|------|
| **Site antigo (SPA)** | `backup/frontend-mirror/` (espelho de https://arbishield.app · 20/07/2026) · rotas `/app`, `/app/proteger`, `/app/protecoes`, `/app/comprovantes` |
| **Modelo antigo (fee)** | `fee_upfront_v1` — cobrava só a dedução na ativação |
| **Atual** | `/v2` · `stake_lock_v1` · `protection-flow-contract-v10` · `docs/PROTECTION_FLOW_LOCKED.md` |

---

## 1. Visão geral

| Tema | Site antigo (SPA / fee_upfront) | Atual (v2 / stake_lock v10) |
|------|--------------------------------|-----------------------------|
| Onde vive | SPA `/app` (congela) | UI `/v2` + APIs settle/prelive |
| Modelo de cobrança | **Cobra dedução na entrada** (`fee_upfront_v1`) | **Trava o stake** na entrada; dedução só se **PERDEU/Exchange** |
| Stake na ativação | **Não trava** (“Stake não trava”) | **Trava** em Congelado (`locked_balance_cents`) |
| Reembolso se ganhou Arbi | Fluxo com **comprovante** / “Reembolso Elegível” no SPA; no fee_upfront creditava stake (+ dedução no contrato v1) | **Automático**: stake → **Saldo Reembolso** |
| Se ganhou Exchange | Dedução já cobrada fica na plataforma; **R$ 0** a mais | **Devolve stake** + cobra **só** dedução da odd canônica |
| Empate Anula | Quase inexistente no SPA; no fee_upfront devolve só a fee | **Destrava e devolve** o stake à origem |
| Teto de stake | Sem regra 50% no contrato antigo | **Máx. 50%** do Apostador restante (sucessivo) |
| 1 op por jogo | Não travado de forma geral | **1 proteção por evento** (user + match) |
| Pós-kickoff | Bloqueava jogo já iniciado | **Recusa** se `now >= starts_at` |

---

## 2. Ativação (criar proteção)

| Item | Antigo | Atual |
|------|--------|-------|
| Momento | Só antes do início (e às vezes janela “X min antes”) | Só **antes do kickoff** |
| O que sai da carteira | Só a **dedução ArbiShield** | O **stake/responsabilidade inteiro** (vai para Congelado) |
| O que fica travado | Nada do stake | Stake em **Congelado** |
| Texto UI | “Stake (não trava)” · “Cobrado agora (ArbiShield)” | “Stake/Responsabilidade (trava)” · “Proteção ativada · stake travado” |
| Limite | Liquidez do mercado | Liquidez + **50% do Apostador restante** |
| Duplicata no mesmo jogo | Permitida / não bloqueada de forma rígida | **Bloqueada** (1 op/evento) |
| Tx típica | `protection_fee` (−fee) | `protection_lock` (−stake → locked) |

---

## 3. LAY × BACK

| Item | Antigo | Atual |
|------|--------|-------|
| LAY | Responsabilidade (casa) | **Responsabilidade** (igual) |
| BACK | Stake | **Stake** (igual) |
| Conversão LAY→BACK | `odd/(odd−1)` no contrato formal | Igual (`lay-lucro-back-equiv-v9`) |

*Semântica de mercado manteve-se; mudou o encaixe na carteira.*

---

## 4. Carteiras

| Bucket | Antigo | Atual |
|--------|--------|-------|
| Apostador / Real | Fonte do fee (e do disponível) | Fonte do stake travado |
| Congelado | Existia, mas **fee_upfront não usava** para o stake | **Centro do fluxo** na ativação |
| Dedução / Reembolso | “Saldo Dedução”; no SPA muitas vezes via **pedido + comprovante** | **Saldo Reembolso** automático (vitória Arbi); usável / sacável / → Desafio |
| Desafio | Carteira separada | Carteira separada (igual) |
| Comprovantes | Rota `/app/comprovantes` + status “Reembolso Elegível” | Fluxo de reembolso **automático no settle** (sem enviar comprovante para receber o stake) |

Trecho típico do SPA antigo:

> “Reembolso Elegível — Sua proteção foi validada. Envie seu comprovante para solicitar o reembolso.”

---

## 5. Resultados do jogo (settle)

### 5.1 Ganhou na ArbiShield

| | Antigo | Atual |
|--|--------|-------|
| Status | `lost_exchange` / `won_platform` / `pending_refund` (SPA) | `lost_exchange` |
| Carteira | SPA: elegível → pedido de reembolso · fee_upfront: credita stake (+ fee no contrato v1) → Saldo Dedução | Credita **só o stake** no **Saldo Reembolso** + **destrava** |
| Fee | Já cobrada na entrada (fica / ou volta no crédito total do v1) | **Não cobra** nada no settle |

### 5.2 Ganhou na Exchange (PERDEU)

| | Antigo | Atual |
|--|--------|-------|
| Status | `won_exchange` | `won_exchange` |
| Stake | Nunca saiu → nada a devolver | **Destrava e DEVOLVE** à origem |
| Fee | Já cobrada na entrada (permanece) | Cobra **agora** a dedução da **odd canônica** |
| Reembolso | R$ 0 | R$ 0 |
| Comissão 4,5% | No fee_upfront formal **não** entrava na fórmula | Entra no **cálculo** da dedução; **não** debita de novo na carteira |
| Heal | Frágil (tx R$0 podia “fechar” sem devolver) | **Heal v10**: incompleto reprocessa até carteira completa |

### 5.3 Empate Anula

| | Antigo | Atual |
|--|--------|-------|
| Existência | Fraca / tardia | Outcome oficial `void` / Empate Anula |
| Carteira | fee_upfront: devolve **só a dedução** | Devolve **stake** à origem; R$ 0 Reembolso |

### 5.4 Cancelar

| | Antigo | Atual |
|--|--------|-------|
| Estorno | **Só a dedução** (nunca o stake) | **Stake inteiro** de volta à origem |
| Guarda | `cancel-fee-upfront-nao-devolve-stake-v6` | `cancel-stake-lock-devolve-stake-v6` |

---

## 6. Taxas / fórmula

| Item | Antigo (`fee_upfront`) | Atual (`stake_lock` v10) |
|------|------------------------|--------------------------|
| Quando cobra | **Na criação** | **Só no Exchange** |
| Lucro LAY | `resp/(odd−1)` | Igual |
| Fatia cliente | 1,5% da cobertura | 1,5% |
| Fatia Exchange 4,5% | Em geral **0** na fórmula formal v1 | **Subtrai** do lucro na dedução |
| Dedução ArbiShield | `lucro − 1,5%` | `lucro − 4,5% − 1,5%` |
| Ex. LAY 1000 @10 | Fee maior (sem −4,5%) | Fee **R$ 91,11** |
| Ex. LAY 1000 @32 | — | Fee **R$ 15,81** → carteira `+1000 − 15,81` |
| Odd usada | `metadata.market_odd` / row | **Canônica**: `approved_odd` > calc > `market_odd` > `row.odd` |

---

## 7. Admin — encerrar jogo

| Item | Antigo | Atual |
|------|--------|-------|
| Opções | ArbiShield · Casa externa (Exchange) | ArbiShield · Exchange · **Empate Anula** |
| Após liquidar | SPA podia “Reabrir Jogo” | Settle via `/api/arbishield/match-settle` (+ heal se terminal incompleto) |
| Texto Exchange | “Dedução já cobrada na entrada permanece” | “R$ 0 Reembolso · devolve stake · cobra só dedução” |

---

## 8. Contestação de odd

| Item | Antigo | Atual |
|------|--------|-------|
| Cliente | Contestar + print do bilhete → `review_odd` | Igual (até 5 min antes do jogo) |
| Admin | Aprovar / rejeitar | Igual |
| Ao aprovar | Recalcula taxas | Recalcula **e sincroniza** `metadata.market_odd` (anti fee stale) |

---

## 9. Diagrama rápido

```
ANTIGO (fee_upfront / SPA)
  Ativar → paga FEE · stake livre
  Arbi   → (SPA) pede reembolso c/ comprovante  |  (v1) credita stake[+fee]
  Exchange → fee já ficou · nada a devolver
  Cancel → devolve só FEE

ATUAL (stake_lock v10)
  Ativar → TRAVA stake (Congelado) · fee = 0
  Arbi   → stake → Saldo Reembolso · destrava
  Exchange → devolve stake · cobra FEE (odd canônica) · Reembolso 0
  Empate → devolve stake
  Cancel → devolve stake
```

---

## 10. O que NÃO mudou

- Ideia do produto: proteger operação LAY/BACK contra a casa.
- LAY = responsabilidade · BACK = stake.
- Contestação de odd com print.
- Buckets Apostador / Desafio / (Congelado existe nos dois mundos).
- Status `won_exchange` / `lost_exchange` no banco.

## 11. Maior mudança prática (para o cliente)

| Antes | Agora |
|-------|-------|
| Paga a taxa **na hora** e o dinheiro da aposta **não congela** | O valor da aposta **congela**; a taxa só sai se **perder na Exchange** |
| Ganhou Arbi → muitas vezes **enviar comprovante** | Ganhou Arbi → crédito **automático** no Saldo Reembolso |
| Perdeu Exchange → “já paguei a fee” | Perdeu Exchange → **recebe o stake de volta** e paga a fee **agora** |

---

*Documento gerado a partir do espelho `backup/frontend-mirror`, histórico `fee_upfront_v1` e contrato vigente `protection-flow-contract-v10`.*
