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
| `/v2/admin` | Hub admin leve (contagens) |

Configure `.env.local` com as mesmas chaves de `.env.example` apontando para `https://arbishield.app`.

```bash
npm install
npm run dev
# abra http://localhost:3000/v2
```

## Cutover (depois)

Quando o v2 cobrir as funções críticas, o nginx passa a priorizar Next em `/` e `/app`, mantendo o SPA só como fallback.
