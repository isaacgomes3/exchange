# Fluxo de Proteção — TRAVADO

**Status:** LOCKED  
**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v11`
**Modelo ativo:** `fee_upfront_v1`
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Espelho:** `AGENTS.md`
**CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Política de alteração

Este fluxo só pode mudar com **solicitação explícita** do dono do produto. Toda mudança exige bump do contrato, sincronização desta documentação e testes verdes.

## Fluxo ativo v11

1. A entrada continua limitada a **uma proteção por evento** e só pode ocorrer **antes do kickoff**.
2. Responsabilidade LAY ou stake BACK pode ser no máximo **50% do Apostador restante** no momento da criação.
3. A ativação cobra **somente a taxa ArbiShield**. Não debita nem trava stake e não aumenta `locked_balance_cents`.
4. Taxa: `lucro bruto − 1,5% da cobertura`. A comissão Exchange de 4,5% não é subtraída da taxa; ela pode ser armazenada como informação.
   - LAY R$1.000 @10: lucro R$111,11 − usuário R$15,00 = taxa **R$96,11**.
   - LAY R$1.000 @32: lucro R$32,26 − usuário R$15,00 = taxa **R$17,26**.
5. Vitória ArbiShield: status `pending_refund`, exige comprovante e não gera crédito automático. O settle retorna `{ deferredProof: true, credited: 0, refunded: 0, eligibleRefundCents }`.
6. Vitória Exchange: status `won_exchange`, crédito zero; a taxa já foi cobrada e não há stake a devolver.
7. Empate Anula / void: devolve **somente a taxa** ao Saldo Reembolso (`deduction_balance_cents`).
8. Cancelamento: devolve **somente a taxa**, por `cancelRefundCents`.

Markers v11:

- `fee-upfront-ativo-v11`
- `arbishield-exige-comprovante-v11`
- `fee-lucro-menos-1_5-v11`
- guarda preservada: `cancel-fee-upfront-nao-devolve-stake-v6`

## Compatibilidade histórica `stake_lock_v1`

Linhas explicitamente marcadas com `billing_model: "stake_lock_v1"`, `stake_lock: true` ou source `stake_lock` mantêm o settle anterior:

- ArbiShield: crédito automático do stake ao Saldo Reembolso, destrava e usa status `lost_exchange`;
- Exchange: crédito Reembolso zero, destrava/devolve stake e cobra a dedução histórica `lucro − 4,5% − 1,5%`;
- void/cancel: destravam e devolvem stake.

Os helpers históricos de odd canônica e heal Exchange permanecem ativos para essas linhas (`settlement-odd-canonico-v10`, `settle-exchange-heal-incompleto-v10`).
