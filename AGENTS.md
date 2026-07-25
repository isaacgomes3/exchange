<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:protection-flow-lock -->
# Fluxo de Proteção — CONTRATO TRAVADO

**Marker:** `DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST`  
**Versão:** `protection-flow-contract-v2`  
**Fonte da verdade:** `scripts/lib/protection-flow-contract.mjs`  
**Testes CI:** `npm test` → `scripts/protection-flow-contract.test.mjs`

## Regra para agentes / PRs

**NÃO alterar** o fluxo de proteção (criar, debitar dedução, liquidar, cancelar, buckets de saldo) **sem solicitação explícita do usuário/dono do produto** nesta conversa ou issue.

Arquivos cobertos (lista mínima):

- `scripts/lib/protection-flow-contract.mjs`
- `scripts/arbishield-prelive-events.mjs` (create/settle/cancel)
- `scripts/arbishield-serverfn-shim.mjs` (settle/cancel/saque dedução)
- `src/lib/arbishield/create-protection.ts`
- UI: `app-proteger.html`, `app-protecoes.html`, `admin-jogos.html` (textos/settle), `v2-financeiro.js` (Saldo Reembolso)

Se um pedido tangenciar esses arquivos por outro motivo (hotfix de JS, Encerrado por, etc.), **preserve** as regras abaixo; não “aproveite” para mudar crédito/dedução.

## Regras de produto travadas (fee_upfront_v1)

1. **Ativação:** cobra só a **dedução ArbiShield** (lucro bruto − 1,5% da cobertura). Não trava o stake/responsabilidade.
2. **LAY** = responsabilidade; **BACK** = stake. Nunca lançar LAY+BACK no mesmo evento de teste.
3. **Bateu ArbiShield:** credita **stake/responsabilidade + dedução** automaticamente em
   `deduction_balance_cents` (UI: **Saldo Reembolso** — usável + sacável), independente
   da carteira usada na ativação (REAL/DEMO só define de onde a dedução foi cobrada).
4. **Bateu Exchange:** não devolve nada (dedução já cobrada na entrada).
5. **Empate Anula / void:** devolve **só a dedução** (Saldo Reembolso). Não é vitória Arbi nem Exchange.
6. **Cancelar proteção:** estorna a dedução (fee_upfront); cliente não precisa solicitar reembolso no caso ArbiShield.
7. Cliente **não** precisa pedir reembolso para ver stake/dedução quando o resultado é ArbiShield — o crédito é imediato.

Alterar qualquer item acima exige pedido explícito + atualização dos testes do contrato.
<!-- END:protection-flow-lock -->
