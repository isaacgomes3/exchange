# ArbiShield v2 — backup + sistema novo

## Objetivo

1. **Backup completo** do sistema e banco (schema + espelho visual no GitHub; dados só na VPS).
2. **Sistema novo** (`/v2`) usando **apenas o banco Supabase atual** e o **visual** de https://arbishield.app — sem o SPA legado que congela.

## Backup (VPS)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-backup-full.sh?v=1")
```

Detalhes: [`backup/README.md`](../backup/README.md)

## Sistema novo

| Rota | Função |
|------|--------|
| `/v2` | Landing |
| `/v2/auth` | Login (Auth do mesmo Supabase) |
| `/v2/app` | Área do membro (lê `profiles`) |
| `/v2/admin` | Hub admin leve |
| `/v2/admin/users` | Lista/busca usuários (debounce, sem Realtime) |
| `/v2/admin/jogos` | Pré-live BetBra |

```bash
npm install
cp .env.example .env.local
npm run dev
# http://localhost:3000/v2
```

## Cutover parcial na VPS

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=1")
```

O SPA legado continua em `/app` e `/admin` até a migração completa.
