<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v3`  
**Modelo padrão:** `lock_fee_after_v1`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Regra para agentes / PRs

**NÃO alterar** o fluxo de proteção (criar, travar stake, debitar dedução, liquidar, cancelar, buckets de saldo) **sem solicitação explícita do usuário/dono do produto** nesta conversa ou issue.

Arquivos cobertos (lista mínima):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs` (create/settle/cancel)
- `scripts/arbishield-serverfn-shim.mjs` (settle/cancel/saque dedução)
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html` (textos/settle), `v2-financeiro.js` (Saldo Reembolso)

Se um pedido tangenciar esses arquivos por outro motivo (hotfix de JS, Encerrado por, etc.), **preserve** as regras abaixo; não “aproveite” para mudar crédito/dedução.

## Regras de produto travadas (lock_fee_after_v1)

1. **Ativação:** trava o **stake/responsabilidade** em `locked_balance_cents` (sai da carteira REAL ou DEMO). **Não** cobra a dedução ainda.
2. **LAY** = responsabilidade; **BACK** = stake. Nunca lançar LAY+BACK no mesmo evento de teste.
3. **Após o resultado — cobrança:** cobra só a **dedução ArbiShield** (= lucro bruto − 1,5% da cobertura) da carteira REAL ou DEMO (quando Bateu ArbiShield).
4. **Bateu ArbiShield:** libera o stake travado e credita em `deduction_balance_cents` (UI: **Saldo Reembolso**); em seguida cobra a dedução da REAL/DEMO.
5. **Bateu Exchange:** não devolve o stake (fica com a plataforma). Não cobra dedução extra.
6. **Empate Anula / void:** libera o stake travado → Saldo Reembolso. Não cobra dedução.
7. **Cancelar proteção:** estorna o stake travado à carteira de origem (REAL/DEMO).
8. Proteções antigas `fee_upfront_v1` continuam com as regras antigas no settle (compatibilidade).

Alterar qualquer item acima exige pedido explícito + atualização dos testes do contrato.
<!-- END:protection-flow-lock -->
