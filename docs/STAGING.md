# Ambiente de teste (localhost — sem DNS)

Acesso prático, **sem subdomínio / sem DNS**.

### Forma recomendada (localhost no seu PC)

No PowerShell do **seu computador** (não na VPS):

```bash
ssh -L 8090:127.0.0.1:8090 root@IP_DA_VPS
```

Deixe o SSH aberto e no Chrome:

```
http://127.0.0.1:8090/admin-jogos.html
```

### Alternativa (IP direto)

```
http://IP_DA_VPS:8090/admin-jogos.html
```

Só funciona se a porta **8090** estiver liberada no **Firewall da Hostinger**.

> `127.0.0.1` no Chrome **sem túnel SSH** = seu PC, não a VPS → `ERR_CONNECTION_REFUSED`.

Produção (`https://arbishield.app`) **não é alterada**.

## Isolamento

| Item | Produção | Teste |
|------|----------|-------|
| UI | `:80/:443` → `/var/www/arbishield/v2` | **`:8090`** → `/var/www/arbishield-teste/v2` |
| Prelive | `:3098` | `:3198` |
| Shim | `:3101` | `:3201` |

## 1) Habilitar / consertar (VPS root)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-fix-teste-localhost.sh?v=1")
```

O script imprime o IP e o comando do túnel SSH.

## 2) Publicar alteração só no teste

```bash
ARBISHIELD_REF=cursor/reconectar-betbra-api-3cf9 \
  bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
```

## 3) Depois → produção

Só quando validar no `:8090`, rode o hotfix/deploy de produção.

## Atenção

O teste usa o **mesmo Supabase** (`:8000`). Código/UI isolados; settle/depósito ainda mexem no banco real.
