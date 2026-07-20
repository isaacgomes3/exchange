# ArbiShield — arbishield.app

## Sistema novo (v2) + backup

Branch: `cursor/arbishield-v2-backup-723d`

### 1) Backup na VPS

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-backup-full.sh?v=1")
```

Schema + espelho visual → GitHub. Dados → só `/opt/arbishield/backups`.

### 2) Ativar `/v2` (Next :3000)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=1")
```

| Rota | Função |
|------|--------|
| `/v2` | Landing |
| `/v2/auth` | Login |
| `/v2/app` | Membro |
| `/v2/admin` | Hub admin |
| `/v2/admin/users` | Usuários (leve) |
| `/v2/admin/jogos` | Pré-live BetBra |

Docs: [`docs/BACKUP-E-V2.md`](docs/BACKUP-E-V2.md) · [`backup/README.md`](backup/README.md)

---

## Estabilizar legado (SPA)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

| URL | Função |
|-----|--------|
| `/app` | App usuario (SPA) |
| `/admin` | Hub admin SPA |
| `/admin/matches` | Jogos VPS |
| `/auth` | Login VPS |

## Desenvolvimento local

```bash
npm install && cp .env.example .env.local && npm run dev
# http://localhost:3000/v2
```

## Supabase VPS

[`deploy/vps-supabase/MIGRATE.md`](deploy/vps-supabase/MIGRATE.md)
