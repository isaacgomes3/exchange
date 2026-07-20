# Admin estável — arbishield.app

**Visual e banco intactos.** Só infraestrutura confiável.

## Estabilizar (VPS, root)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

## Arquitetura

| Porta | Serviço |
|-------|---------|
| 8000 | Supabase Kong |
| 3098 | Jogos, desafios, pré-live |
| 3099 | Sugestões desafio BetBra |

**Desligados no admin:** shim `:3101`, Next `:3000` (opcional depois).

## URLs

- https://arbishield.app/admin/matches
- https://arbishield.app/admin/desafios
- https://arbishield.app/auth

## Se falhar

```bash
journalctl -u arbishield-prelive-events -n 50 --no-pager
curl -sS http://127.0.0.1:3098/health
curl -sS http://127.0.0.1:8000/auth/v1/health
```
