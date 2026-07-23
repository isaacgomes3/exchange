# Backup ArbiShield → GitHub

## O que entra no GitHub

| Conteúdo | GitHub? | Motivo |
|----------|---------|--------|
| Schema SQL (`pg_dump --schema-only`) | Sim | Recriar estrutura |
| Lista de tabelas / inventário | Sim | Documentação |
| Espelho do frontend estático (HTML/CSS/JS público) | Sim | Layout/visual |
| Nginx, docker-compose, scripts | Sim | Infra |
| **Dados** (profiles, saldos, auth.users) | **Não** | PII / LGPD |
| **Service role / JWT secrets** | **Não** | Segurança |

Dados completos ficam só na VPS: `/opt/arbishield/backups/`.

## Rodar backup na VPS (root)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-backup-full.sh?v=1")
```

Isso gera:

- `/opt/arbishield/backups/TIMESTAMP/schema.sql` (+ cópia em `backup/schema/` do repo se o git estiver na VPS)
- `/opt/arbishield/backups/TIMESTAMP/data.dump` (local, fora do git)
- espelho de `https://arbishield.app` em `backup/frontend-mirror/`

## Sistema novo (v2)

Rotas Next limpas (sem SPA legado que congela):

| Rota | Função |
|------|--------|
| `/v2` | Landing (visual ArbiShield) |
| `/v2/auth` | Login (Supabase Auth do mesmo banco) |
| `/v2/app` | Área do membro |
| `/v2/admin` | Hub admin |

Usa **o mesmo Supabase** (`NEXT_PUBLIC_SUPABASE_URL=https://arbishield.app`).
