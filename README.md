# ArbiShield — arbishield.app

## Sistema novo (principal) + SPA legado (subdomínio)

Branch: `cursor/arbishield-v2-backup-723d`

### Cutover (obrigatório)

1. DNS Hostinger: registro **A** `legado` → mesmo IP da VPS.
2. Na VPS (root):

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-cutover-main-v2.sh?v=4")
```

| Host | Site |
|------|------|
| `https://arbishield.app` | **Sistema novo** |
| `https://legado.arbishield.app` | SPA antigo (temporário) |

Rotas no principal: `/`, `/auth.html`, `/app.html`, `/admin.html`, `/admin-jogos.html`, …

### Backup na VPS

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-backup-full.sh?v=1")
```

Docs: [`docs/BACKUP-E-V2.md`](docs/BACKUP-E-V2.md) · [`backup/README.md`](backup/README.md)

---

## Desenvolvimento local

```bash
npm install && cp .env.example .env.local && npm run dev
```
