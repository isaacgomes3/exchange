# Migrar ArbiShield: Supabase Cloud → VPS

Este guia move o backend do projeto **wknyfxikmmvjzpbevlid** para uma VPS com **Supabase self-hosted (Docker)** — mantém Auth, PostgREST, Storage e RLS.

## O que você precisa

| Item | Onde |
|------|------|
| VPS (Ubuntu 22.04+, 4 GB RAM mín., 8 GB recomendado) | Seu provedor |
| Domínio/API (ex.: `https://api.arbishield.app`) | DNS A → IP da VPS |
| Connection string do Cloud | Dashboard → Database → URI |
| Secret key atual | Já usada no app |

## Visão geral

```
1) Subir Supabase Docker na VPS
2) Exportar Cloud (pg_dump + storage)
3) Importar na VPS
4) Apontar arbishield.app / .env para a nova URL
5) (Opcional) desligar o projeto Cloud
```

---

## 1. Preparar a VPS

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git curl
sudo usermod -aG docker $USER   # relogue depois
```

Clone este repo (ou copie a pasta `deploy/vps-supabase`):

```bash
sudo mkdir -p /opt/arbishield && sudo chown $USER:$USER /opt/arbishield
cd /opt/arbishield
# copie deploy/vps-supabase para cá, ou:
# git clone <seu-repo> . && cd deploy/vps-supabase
```

## 2. Gerar secrets e subir o stack

```bash
cd /opt/arbishield/deploy/vps-supabase   # ou o path onde está o compose
./setup.sh
```

Edite `.env` (gerado a partir de `.env.example`):

```env
# URL pública da API na VPS
API_EXTERNAL_URL=https://api.arbishield.app
SITE_URL=https://arbishield.app
ADDITIONAL_REDIRECT_URLS=https://arbishield.app/**,http://localhost:5173/**

# Gere senhas fortes (setup.sh ajuda)
POSTGRES_PASSWORD=...
JWT_SECRET=...          # se mudar JWT, as keys anon/service mudam — atualize o app
ANON_KEY=...
SERVICE_ROLE_KEY=...
```

Subir:

```bash
docker compose up -d
# opcional com nginx do compose:
# docker compose -f docker-compose.yml -f docker-compose.nginx.yml up -d
```

Confira:

```bash
docker compose ps
curl -sS "$API_EXTERNAL_URL/auth/v1/health"
```

## 3. DNS + TLS

Crie registro **A**: `api.arbishield.app` → IP da VPS.

Nginx (host) exemplo:

```nginx
server {
  server_name api.arbishield.app;
  location / {
    proxy_pass http://127.0.0.1:8000;  # Kong default do compose
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

```bash
sudo certbot --nginx -d api.arbishield.app
```

### Troubleshooting Hostinger: Realtime `connection refused` em `db:5432`

Na Hostinger o `/etc/resolv.conf` costuma ter `search localhost hstgr.cloud`. Isso faz o hostname curto `db` virar `db.localhost` → `::1`, e o Realtime (Erlang) falha ao ligar ao Postgres.

O `docker-compose.yml` deste pacote já define `dns_search: ["."]` nos serviços. Se ainda falhar:

```bash
# Confirme a resolução dentro do container
docker compose exec realtime getent hosts db
# Deve mostrar 172.x.x.x — NÃO ::1

# Recrie o Realtime após puxar o compose atualizado
docker compose up -d --force-recreate realtime
```

## 4. Exportar o Cloud (no seu PC ou neste ambiente)

No [Dashboard → Database](https://supabase.com/dashboard/project/wknyfxikmmvjzpbevlid/settings/database) copie a **senha do banco** (Database password) ou a URI.

Região deste projeto: **`aws-1-us-east-2`**.

```bash
# Opção A — só a senha
export DB_PASSWORD='sua-senha-do-dashboard'
export SUPABASE_URL='https://wknyfxikmmvjzpbevlid.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='sb_secret_...'   # ou service_role JWT

./scripts/supabase-export-cloud.sh
```

```bash
# Opção B — URI completa (session mode :5432 para pg_dump)
export DATABASE_URL='postgresql://postgres.wknyfxikmmvjzpbevlid:SENHA@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require'
export SUPABASE_URL='https://wknyfxikmmvjzpbevlid.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='sb_secret_...'

./scripts/supabase-export-cloud.sh
```

> **Nota:** o Cloud está em Postgres 17. Se o `pg_dump` local for 16, rode o dump na VPS (container `db` já tem 17.6).

Gera `supabase-export/db.dump` (+ storage se a key estiver ok).

### Status da migração (VPS `195.200.6.206`)

Já feito: dump Cloud → restore na VPS, storage, Auth/REST OK, frontend self-hosted na VPS (sem Lovable).

- App HTTP: http://195.200.6.206/
- Para `https://arbishield.app`: mude o DNS na Hostinger e rode `arbishield-enable-domain.sh`

Envie para a VPS:

```bash
rsync -avz supabase-export/ user@VPS_IP:/opt/arbishield/supabase-export/
```

## 5. Importar na VPS

```bash
cd /opt/arbishield
./scripts/supabase-import-vps.sh
```

Se o Storage não subir automático:

```bash
cd deploy/vps-supabase
docker compose cp ../../supabase-export/storage/objects/. storage:/var/lib/storage/
docker compose restart storage
```

## 6. Cutover — só VPS (sem Lovable)

Frontend + API na Hostinger VPS. Lovable não entra no fluxo.

### Agora (IP)

- App: http://195.200.6.206/
- Login admin: `isaacgomes3@gmail.com`

### Domínio `https://arbishield.app`

1. **Hostinger hPanel** → Domínios → `arbishield.app` → DNS:

| Tipo | Nome | Valor | TTL |
|------|------|-------|-----|
| A | `@` | `195.200.6.206` | 300 |
| A | `www` | `195.200.6.206` | 300 |

Apague A/CNAME antigos para `185.158.133.1` (CDN/Lovable).

2. Na VPS:

```bash
bash /opt/arbishield/scripts/arbishield-enable-domain.sh
```

Emite Let's Encrypt, atualiza Auth e re-patcha o frontend para `https://arbishield.app`.

## 7. Checklist pós-migração

- [ ] Login com `isaacgomes3@gmail.com`
- [ ] Contagem de `profiles` / `protections` igual ao Cloud
- [ ] Upload de arquivo (Storage)
- [ ] Contas bloqueadas continuam bloqueadas
- [ ] Só então pause/delete o projeto no Supabase Cloud

## Comandos úteis

```bash
# logs
docker compose -f deploy/vps-supabase/docker-compose.yml logs -f auth rest db

# backup na VPS
docker compose exec -T db pg_dump -U postgres -Fc > backup-$(date +%F).dump
```

## Observações

- Self-host exige manutenção (updates Docker, backups, disco).
- Se preferir **só Postgres** sem Auth/Storage do Supabase, o esforço de reescrever o app é bem maior — este caminho é o recomendado.
- Sem `DATABASE_URL` do Cloud não dá para dump completo via API REST (DDL/auth schema).
