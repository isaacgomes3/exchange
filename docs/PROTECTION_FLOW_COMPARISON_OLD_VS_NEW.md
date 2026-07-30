# Modelos de proteção — histórico (OBSOLETO)

**Status:** documento histórico apenas.

A **única fonte de verdade** é:

- Versão: `protection-flow-contract-v10`
- Modelo: `stake_lock_v1`
- Arquivos: `scripts/lib/protection-flow-contract.mjs` · `docs/PROTECTION_FLOW_LOCKED.md` · `AGENTS.md`

Pedido explícito (2026-07-30): **qualquer outra versão pode ser excluída**.

## Modelos obsoletos (não usar / não reintroduzir)

| Modelo | Motivo |
|--------|--------|
| `fee_upfront_v1` | Cobrava fee na ativação; Exchange = R$ 0 sem devolver stake |
| `lock_fee_after_v1` | Intermediário; substituído pelo v10 |
| `locked_margin_v2` | Variante paralela; não é vigente |
| `FLUXO_PROTECAO_V1` / `fluxo-protecao-v1` | Scaffold paralelo; não é vigente |
| contracts `v1`–`v9` como “vigente” | Superados pelo v10 |

Compatibilidade de `fee_upfront` no settle/cancel existe **somente** para linhas antigas no banco.

Ver fluxo completo em `docs/PROTECTION_FLOW_LOCKED.md`.
