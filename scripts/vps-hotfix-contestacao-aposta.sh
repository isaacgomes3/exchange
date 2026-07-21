#!/usr/bin/env bash
# Hotfix: Contestação de Aposta completa (cliente + ADM + shim)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/contestacao-aposta-completa-723d/scripts/vps-hotfix-contestacao-aposta.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/contestacao-aposta-completa-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR"

log "Shim :3101 (contestação submit/list/approve/reject + plain JSON)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'CONTESTATION_SUBMIT\|submitContestation\|x-arbishield-plain' \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem handlers de contestação"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "UI cliente + admin"
for f in app-protecoes.html admin-contestations.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

grep -q 'Contestar proteção\|Em Contestação\|_serverFn/' "$WEB/app-protecoes.html" || die "app-protecoes sem fallback serverFn"
grep -q 'Contestações de Apostas\|_serverFn/' "$WEB/admin-contestations.html" || die "admin-contestations incompleto"
grep -q 'Contestações de Apostas\|pending-count' "$WEB/v2-shell.js" || die "v2-shell sem badge de contestações"

# nginx: forçar location prefix para /api/arbishield/contestations → :3101
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app \
         /opt/arbishield/deploy/vps-supabase/nginx-arbishield.app.conf; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done

if [[ -n "$NGINX_CONF" ]]; then
  log "Nginx: $NGINX_CONF"
  python3 - <<'PY' "$NGINX_CONF"
import sys
path = sys.argv[1]
text = open(path).read()
changed = False

# 1) Estender regex antiga se existir
old = "affiliate-withdraw|protection-close|protection-cancel|match-settle)"
new = "affiliate-withdraw|protection-close|protection-cancel|match-settle|contestations|contestations/submit|contestations/approve|contestations/reject|contestations/pending-count)"
if old in text and "contestations/submit" not in text:
    text = text.replace(old, new, 1)
    changed = True
    print("regex api/arbishield ampliada")

# 2) Sempre garantir location ^~ /api/arbishield/contestations
block = """
    # Contestacoes → shim :3101
    location ^~ /api/arbishield/contestations {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
if "location ^~ /api/arbishield/contestations" not in text and "location /api/arbishield/contestations" not in text:
    anchor = "location ^~ /_serverFn/"
    if anchor in text:
        text = text.replace(anchor, block + "\n    " + anchor, 1)
        changed = True
        print("location ^~ /api/arbishield/contestations inserida")
    else:
        # fallback: antes do fechamento do server
        idx = text.rfind("}")
        if idx > 0:
            text = text[:idx] + block + "\n" + text[idx:]
            changed = True
            print("location contestations inserida no fim do server")

if changed:
    open(path, "w").write(text)
    print("nginx atualizado")
else:
    print("nginx já contém rotas de contestação")
PY
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || true
    log "nginx reload ok"
  else
    echo "AVISO: nginx -t falhou — confira $NGINX_CONF" >&2
  fi
else
  echo "AVISO: nginx conf não encontrada; cliente usará fallback /_serverFn/" >&2
fi

# Sanity check local
log "Sanity check shim"
if curl -fsS -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:3101/_serverFn/2a6aef91a48eaa19a2fd107fe580b1c6edf54fd10f1962c1d5d3e40f5c38d120" \
  -H "Content-Type: application/json" -H "x-arbishield-plain: 1" -d '{}' | grep -qE '200|400'; then
  echo "  shim responde em :3101"
else
  echo "AVISO: shim :3101 sem resposta esperada" >&2
fi

echo
echo "OK — Contestação de Aposta (v4)"
echo "  Cliente: https://arbishield.app/app-protecoes.html"
echo "  Admin:   https://arbishield.app/admin-contestations.html"
echo "  Admin lista direto de protections status=review_odd (igual legado)"
echo "  Ctrl+F5 nas páginas"
