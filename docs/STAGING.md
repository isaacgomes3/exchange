# Ambiente de teste (localhost — sem DNS)

Acesso prático, **sem subdomínio**:

```
http://127.0.0.1:8090/admin-jogos.html
http://IP_DA_VPS:8090/admin-jogos.html
```

Produção (`https://arbishield.app`) **não é alterada**.

## Isolamento

| Item | Produção | Teste |
|------|----------|-------|
| UI | `:80/:443` → `/var/www/arbishield/v2` | **`:8090`** → `/var/www/arbishield-teste/v2` |
| Prelive | `:3098` | `:3198` |
| Shim | `:3101` | `:3201` |

## 1) Habilitar uma vez (VPS root)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-enable-teste.sh?v=3")
```

Abra a URL que o script imprimir (`:8090`). Faixa laranja = teste.

## 2) Publicar alteração só no teste

```bash
ARBISHIELD_REF=cursor/reconectar-betbra-api-3cf9 \
  bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
```

## 3) Depois → produção

Só quando validar no `:8090`, rode o hotfix/deploy de produção.

## Atenção

O teste usa o **mesmo Supabase** (`:8000`). Código/UI isolados; settle/depósito ainda mexem no banco real.
