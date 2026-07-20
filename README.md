# ArbiShield — arbishield.app

Admin estável: **mesmo visual (HTML) + mesmo banco (Supabase)**. Rotas nginx e workers consolidados.

## Estabilizar a VPS (um comando)

Na VPS como **root**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

O script:
- atualiza admin HTML e workers (`:3098`, `:3099`)
- **restaura `/app`** (SPA `index.html` + assets)
- reativa `/_serverFn` (:3101) se o shim existir na VPS
- sobe Next para painel geral (use `SKIP_NEXT=1` para pular)
- verifica Supabase e roda health checks

## Rotas

| URL | Função |
|-----|--------|
| **`/app`** | App usuario (SPA) |
| **`/admin`** | Hub admin |
| **`/arbishield/admin`** | Painel geral |
| `/admin/matches` | Gestão de Jogos |
| `/admin/desafios` | Gestão de Desafios |
| `/auth` | Login |

Doc: [`deploy/vps-supabase/ADMIN-STABLE.md`](deploy/vps-supabase/ADMIN-STABLE.md)

## Restaurar versão inicial (SPA /app)

Se páginas sumiram após estabilização:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-restore-initial-frontend.sh)
```

Detalhes: [`deploy/vps-supabase/RESTORE-VPS.md`](deploy/vps-supabase/RESTORE-VPS.md)

## Desenvolvimento local

```bash
npm install && cp .env.example .env.local && npm run dev
```

## Supabase VPS

[`deploy/vps-supabase/MIGRATE.md`](deploy/vps-supabase/MIGRATE.md)
