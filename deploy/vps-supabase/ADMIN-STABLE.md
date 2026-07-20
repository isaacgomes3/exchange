# Admin estável — arbishield.app

Visual e banco **intactos**.

## Estrutura

| URL | Função |
|-----|--------|
| **`/admin`** | Hub — menu de tudo |
| **`/arbishield/admin`** | Painel geral (usuários, depósitos, tickets) |
| **`/admin/matches`** | Gestão de jogos (rápido, :3098) |
| **`/admin/desafios`** | Gestão de desafios (rápido, :3098) |

## Estabilizar na VPS

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

Só HTML rápido (sem build Next): `SKIP_NEXT=1 bash ...`
