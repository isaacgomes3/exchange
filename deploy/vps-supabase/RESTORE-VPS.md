# Restaurar frontend + corrigir travamento

## Um comando (VPS root)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-restore-initial-frontend.sh)
```

Recupera o SPA publicado e aplica correções de travamento **sem mudar o layout do admin**.

## Só anti-travamento (SPA já no lugar)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

## O que NÃO muda

- Layout original do SPA (`/admin`, `/app`)
- Banco Supabase na VPS

## Verificar

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://arbishield.app/app
curl -sS -o /dev/null -w "%{http_code}\n" https://arbishield.app/admin
systemctl is-active arbishield-serverfn-shim arbishield-prelive-events
```
