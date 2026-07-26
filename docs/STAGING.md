# Sandbox de teste (simples)

**URL:** https://arbishield.app/sandbox/admin-jogos.html  

Sem DNS. Sem porta. Sem firewall. Sem túnel SSH.  
A produção (`https://arbishield.app/…`) continua igual.

## 1) Ligar (uma vez na VPS)

```bash
bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-enable-sandbox.sh?v=1")
```

## 2) Atualizar o sandbox com uma branch

```bash
ARBISHIELD_REF=cursor/reconectar-betbra-api-3cf9 \
  bash /opt/arbishield/scripts/vps-deploy-sandbox.sh
```

## 3) Abrir no Chrome

https://arbishield.app/sandbox/admin-jogos.html  

Faixa laranja **SANDBOX** = não é a produção.

## Atenção

O sandbox usa as **mesmas APIs/banco** da produção. Serve para validar UI/fluxo; settle/depósito ainda mexem no dado real.
