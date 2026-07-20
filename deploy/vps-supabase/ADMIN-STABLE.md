# Admin estável — arbishield.app
#
# Princípio: **mesmo visual (HTML VPS) + mesmo banco (Supabase Docker)**.
# Só consolidamos rotas nginx e workers Node — sem migrar UI nem schema.
#
# ## Rotas (produção)
#
# | URL | Entrega | Backend |
# |-----|---------|---------|
# | `/admin/matches` | admin-jogos-vps.html | — |
# | `/admin/desafios` | admin-desafios-vps.html | — |
# | `/admin/login`, `/auth` | HTML login | Auth → Kong :8000 |
# | `/api/arbishield/prelive-events` | JSON | Node :3098 |
# | `/api/arbishield/matches` | JSON | Node :3098 |
# | `/api/arbishield/desafios` | JSON | Node :3098 (Supabase REST) |
# | `/api/arbishield/desafio-suggestions` | JSON | Node :3099 |
# | `/auth/v1`, `/rest/v1`, … | Supabase | Kong :8000 |
#
# **Não depende** de Next (:3000) nem shim (:3101) para o admin operacional.
#
# ## Deploy (VPS, root)
#
# Emergência 502:
#
# ```bash
# bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-emergency-fix-502.sh)
# ```
#
# Deploy completo:
#
# ```bash
# bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-deploy-arbishield-admin.sh)
# ```
#
# ## Verificação
#
# ```bash
# curl -sS http://127.0.0.1:3098/health
# curl -sS http://127.0.0.1:3098/api/arbishield/desafios | head -c 120
# curl -sS http://127.0.0.1:3098/api/arbishield/prelive-events | head -c 120
# systemctl status arbishield-prelive-events arbishield-desafio-suggestions
# ```
#
# ## Próxima fase (opcional, depois)
#
# Migrar HTML → páginas Next **copiando o mesmo CSS/markup** (visual idêntico).
# Banco e tabelas permanecem os mesmos.
