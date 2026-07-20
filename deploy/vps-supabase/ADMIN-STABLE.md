# Admin estável — arbishield.app

**Híbrido:** admin HTML rápido + app usuario SPA (`/app`) + Supabase.

| URL | Entrega |
|-----|---------|
| `/app`, `/` (rotas SPA) | `index.html` + assets |
| `/admin`, `/admin/matches`, `/admin/desafios` | HTML admin VPS |
| `/arbishield/admin` | Painel geral Next |
| `/_serverFn/*` | shim :3101 (se existir na VPS) |
| `/auth/v1`, `/rest/v1` | Supabase Kong |

## Estabilizar

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

Restaura `index.html` se foi arquivado como `.bak-stabilize`.
