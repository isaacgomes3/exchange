# Anti-travamento — arbishield.app

**Objetivo:** parar o site de travar. **Não altera o layout** do admin principal (`/admin` continua no SPA original).

| URL | Entrega |
|-----|---------|
| `/app`, `/`, `/admin` | SPA original + `/_serverFn` → `:3101` |
| `/auth` | Login leve (HTML — evita freeze no SPA) |
| `/admin/matches`, `/admin/desafios` | HTML operacional + APIs `:3098` |
| `/auth/v1`, `/rest/v1` | Supabase Kong |

## Corrigir travamento (VPS root)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

O script:
- Mantém o **layout SPA original** em `/admin` (remove o hub de cards)
- Sobe o **shim serverFn** `:3101` (dados do dashboard/admin)
- Aplica **app-stability.js** (cache corrupto, blur pesado, service worker)
- Aplica **CSR boot** (evita tela preta em `/app`)
- **Não** instala Next por padrão (`SKIP_NEXT=1`)

Se `/app` estiver 404, restaure o frontend antes:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-restore-initial-frontend.sh)
```
