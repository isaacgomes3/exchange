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
| Deploy/API | `deploy-surface-contract-v1` | football-teams, fee_upfront bloqueado, path shim |

---

## Páginas críticas (layout)

- `app-proteger.html` — stake_lock + teto 50% + 1 op/evento
- `app-protecoes.html` — cancel / comissão
- `app-carteira.html` — Saldo Reembolso (nunca “Saldo Dedução”)
- `admin-jogos.html` — settle + busca logos (`football-teams`)

## Runtime (VPS)

```bash
bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-check-pos-deploy-v10.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
```

Exige health `:3098`/`:3101` com `protection-runtime-stake-lock-v10` +
`stake_lock_v1`, e (opcional) billing_model de proteções novas + metas UI no disco.
