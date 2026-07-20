# ArbiShield · Desafio (só VPS)

App enxuto. **Sem Supabase. Sem Lovable.** Sobe do GitHub para a VPS Hostinger.

## Caminhos ativos (resto cortado)

| Caminho | Função |
|---|---|
| `/desafio-sugestoes` | UI Sugestão de Desafio + IA |
| `/api/desafio/puxar` | Puxa jogos 24h e analisa |

`/` e `/desafio-sugestoes.html` → redirecionam para `/desafio-sugestoes`.  
Qualquer outra rota (`/admin`, `/app`, `/auth`, `/functions`, etc.) → **404**.

## Local

```bash
npm install
cp .env.example .env.local
# OPENAI_API_KEY=...   (opcional; sem chave usa heurística)
npm run dev
```

Abra `http://localhost:3000/desafio-sugestoes`.

## Deploy na VPS (GitHub → Docker + Nginx)

Na VPS Hostinger:

```bash
# 1) Código
git clone https://github.com/isaacgomes3/exchange.git
cd exchange
git checkout cursor/desafio-ia-analise-638f   # ou main após merge
git pull

# 2) Pare o site antigo (Supabase / Lovable / admin completo)
#    Desative o server block nginx antigo que apontava para o stack completo.

# 3) Suba só o Desafio
export OPENAI_API_KEY='sua-chave'   # cole na VPS, não no chat
chmod +x deploy/vps-deploy.sh
./deploy/vps-deploy.sh

# 4) Nginx só com estes caminhos
sudo cp deploy/nginx-arbishield-desafio.conf /etc/nginx/sites-available/arbishield-desafio
sudo ln -sf /etc/nginx/sites-available/arbishield-desafio /etc/nginx/sites-enabled/
# remova/desative o site antigo: sudo rm /etc/nginx/sites-enabled/SITE-ANTIGO
sudo nginx -t && sudo systemctl reload nginx
```

Depois: `https://arbishield.app/desafio-sugestoes`

## Regra de negócio

1. **Lista:** jogos das **próximas 24h**
2. **Lançamento:** só nos **últimos 30 min** antes do kickoff (período máximo em que aparece para ser lançado)

## Por que às vezes aparecia 0 jogos?

A página antiga usava **PRÉ-LIVE = 30 min** como janela de busca + fallback “restante do dia” (UTC). De madrugada isso zerava a lista.

**Correção:** buscar 24h e só **liberar o botão de lançar** quando faltar ≤30 min.

Patch VPS: `deploy/desafio-sugestoes.html` + `./deploy/patch-desafio-24h.sh /caminho/do/site`

## O que NÃO entra neste deploy

- Supabase (auth, rest, edge functions)
- Lovable
- `/admin`, `/app`, `/auth`, dashboard e o restante do sistema antigo
