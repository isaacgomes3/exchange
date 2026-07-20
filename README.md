# ArbiShield — arbishield.app

Admin estável: **mesmo visual (HTML) + mesmo banco (Supabase)**. Rotas nginx e workers consolidados.

## Estabilizar a VPS (um comando)

Na VPS como **root**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

O script:
- atualiza HTML admin e workers (`:3098`, `:3099`)
- remove dependência de shim `:3101` e Next `:3000` no admin
- arquiva `index.html` SPA antigo (evita rotas corrompidas)
- verifica Supabase Kong `:8000`
- roda checks HTTP e falha se algo crítico estiver offline

## Rotas

| URL | Função |
|-----|--------|
| **`/admin`** | Hub — menu admin |
| **`/arbishield/admin`** | Painel geral |
| `/admin/matches` | Gestão de Jogos |
| `/admin/desafios` | Gestão de Desafios |
| `/auth` | Login |

Doc: [`deploy/vps-supabase/ADMIN-STABLE.md`](deploy/vps-supabase/ADMIN-STABLE.md)

## Desenvolvimento local

```bash
npm install && cp .env.example .env.local && npm run dev
```

## Supabase VPS

[`deploy/vps-supabase/MIGRATE.md`](deploy/vps-supabase/MIGRATE.md)
