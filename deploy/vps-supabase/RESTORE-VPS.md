# Restaurar frontend inicial na VPS

Sim — dá para recuperar a versão que subimos, **desde que exista backup** ou o espelho ainda acessível.

## Opção 1 — Um comando (recomendado)

Na VPS como **root**:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-restore-initial-frontend.sh)
```

O script tenta, nesta ordem:

1. **`/var/www/arbishield/index.html.bak-stabilize`** (backup feito na estabilização)
2. **Tarballs** em `/opt/arbishield/backups/`
3. **Espelho local** `/opt/arbishield/arbishield-local`
4. **Download novo** de `https://arbishield.app` + cutover (último recurso)

Depois roda a estabilização (admin jogos/desafios + nginx híbrido + serverfn).

## Opção 2 — Só o backup manual (mais rápido)

Se o `.bak-stabilize` existir:

```bash
cp -a /var/www/arbishield/index.html.bak-stabilize /var/www/arbishield/index.html
bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/consolidate-arbishield-app-723d/scripts/vps-stabilize-arbishield.sh)
```

## Opção 3 — Backup Hostinger

No hPanel → Backups → restaurar snapshot de **antes da estabilização** (pasta `/var/www/arbishield`).

## O que NÃO muda

- **Banco Supabase** na VPS (Docker) — dados intactos
- **Gestão de Jogos/Desafios** HTML — continuam após estabilize

## Verificar

```bash
ls -la /var/www/arbishield/index.html /var/www/arbishield/assets | head
curl -sS -o /dev/null -w "%{http_code}\n" https://arbishield.app/app
```
