# Ambiente de teste (antes da produção)

URL: `https://teste.arbishield.app`  
Produção: `https://arbishield.app` (não é alterada pelos scripts de teste)

## O que fica isolado

| Item | Produção | Teste |
|------|----------|-------|
| UI | `/var/www/arbishield/v2` | `/var/www/arbishield-teste/v2` |
| Prelive | `:3098` | `:3198` |
| Shim | `:3101` | `:3201` |
| Código | `/opt/arbishield` | `/opt/arbishield-teste` |
| Domínio | `arbishield.app` | `teste.arbishield.app` |

## O que NÃO fica isolado (padrão)

O teste usa o **mesmo Supabase** da produção (`:8000`).  
Código e UI são seguros para experimentar; **settle / depósito / saque no teste mexem no banco real**.

## 1) DNS

Crie um registro:

```
A  teste.arbishield.app  →  <IP da VPS>
```

## 2) Habilitar uma vez

Na VPS (root):

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-enable-teste.sh?v=2")
```

> Se falhar com `curl: (23)`, a VPS não tem `sites-available` — a v2 do script detecta `conf.d` automaticamente.

## 3) Publicar alterações só no teste

```bash
# Ex.: branch com a feature
ARBISHIELD_REF=cursor/reconectar-betbra-api-3cf9 \
  bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh

# Ou um SHA específico
ARBISHIELD_REF=623482b6da8ef7f76595e94d291b28499b2e0193 \
  bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
```

Abra `https://teste.arbishield.app/admin-jogos.html` (Ctrl+F5).  
Faixa laranja “AMBIENTE DE TESTE” confirma que não é produção.

## 4) Só depois → produção

Quando validar no teste, rode o hotfix/deploy **de produção** (scripts `vps-hotfix-*` / paths `/var/www/arbishield`).

## Checagens rápidas

```bash
curl -s http://127.0.0.1:3198/health   # teste
curl -s http://127.0.0.1:3098/health   # produção (não deve ter sido reiniciada pelo deploy-teste)
cat /var/www/arbishield-teste/v2/TESTE_BUILD.json
```
