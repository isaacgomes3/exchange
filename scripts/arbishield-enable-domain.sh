#!/usr/bin/env bash
# Ativa https://arbishield.app na VPS (após DNS A apontar para este servidor).
# Uso (na VPS, como root):
#   export VPS_ANON_KEY='...'   # opcional se .env existir
#   export CERTBOT_EMAIL='seu@email.com'
#   bash /opt/arbishield/scripts/arbishield-enable-domain.sh
set -euo pipefail

DOMAIN="${DOMAIN:-arbishield.app}"
WWW="www.${DOMAIN}"
EMAIL="${CERTBOT_EMAIL:-isaacgomes3@gmail.com}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
WWW_ROOT="${ARBISHIELD_WWW:-/var/www/arbishield}"
MIRROR_SRC="${ARBISHIELD_SRC:-/opt/arbishield/arbishield-local}"
EXPECTED_IP="${EXPECTED_IP:-195.200.6.206}"

echo "==> Checando DNS de $DOMAIN"
RESOLVED="$(dig +short "$DOMAIN" A | tail -1 || true)"
echo "    $DOMAIN → ${RESOLVED:-<vazio>}"
if [[ "$RESOLVED" != "$EXPECTED_IP" ]]; then
  cat <<EOF
DNS ainda não aponta para $EXPECTED_IP.

No Hostinger hPanel → Domínios → $DOMAIN → DNS:
  Tipo A | Nome @   | Valor $EXPECTED_IP | TTL 300
  Tipo A | Nome www | Valor $EXPECTED_IP | TTL 300

Remova/desative qualquer registro que aponte para Lovable/CDN (ex.: 185.158.133.1).
Aguarde propagação (pode ser alguns minutos) e rode este script de novo.
EOF
  exit 1
fi

echo "==> Nginx config de produção"
cp -f "$COMPOSE_DIR/nginx-arbishield.app.conf" /etc/nginx/conf.d/arbishield-cutover.conf
nginx -t
systemctl reload nginx

echo "==> Certbot TLS"
if ! command -v certbot >/dev/null 2>&1; then
  dnf install -y certbot python3-certbot-nginx >/tmp/certbot-install.log 2>&1 || \
    yum install -y certbot python3-certbot-nginx >/tmp/certbot-install.log 2>&1
fi
certbot --nginx -d "$DOMAIN" -d "$WWW" \
  --non-interactive --agree-tos -m "$EMAIL" --redirect

PUBLIC_URL="https://${DOMAIN}"

echo "==> Atualizar .env do Supabase (URLs públicas)"
cd "$COMPOSE_DIR"
python3 - "$PUBLIC_URL" <<'PY'
from pathlib import Path
import sys
url = sys.argv[1]
p = Path(".env")
lines = []
for line in p.read_text().splitlines():
    if line.startswith("API_EXTERNAL_URL="):
        lines.append(f"API_EXTERNAL_URL={url}")
    elif line.startswith("SUPABASE_PUBLIC_URL="):
        lines.append(f"SUPABASE_PUBLIC_URL={url}")
    elif line.startswith("SITE_URL="):
        lines.append(f"SITE_URL={url}")
    elif line.startswith("ADDITIONAL_REDIRECT_URLS="):
        lines.append(
            "ADDITIONAL_REDIRECT_URLS="
            f"{url}/**,{url},http://localhost:5173/**,http://localhost:3000/**"
        )
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
print("env ->", url)
PY

echo "==> Repatch frontend com URL HTTPS"
ANON="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
export VPS_ANON_KEY="$ANON"
export API_PUBLIC_URL="$PUBLIC_URL"
export ARBISHIELD_WWW="$WWW_ROOT"
# Prefer mirror on VPS; fallback: keep current www and only re-patch in place
if [[ -d "$MIRROR_SRC/assets" ]]; then
  export ARBISHIELD_SRC="$MIRROR_SRC"
  bash /opt/arbishield/scripts/arbishield-cutover-frontend.sh
else
  python3 - "$WWW_ROOT" "http://195.200.6.206" "$PUBLIC_URL" <<'PY'
from pathlib import Path
import sys
root, old, new = sys.argv[1:4]
n = 0
for p in Path(root).rglob("*"):
    if not p.is_file() or p.suffix.lower() not in {".js", ".html", ".json"}:
        continue
    t = p.read_text(errors="ignore")
    if old not in t:
        continue
    n += t.count(old)
    p.write_text(t.replace(old, new))
print(f"in-place url replace x{n}")
PY
fi

echo "==> Restart Auth"
docker compose up -d auth
sleep 4

echo "==> Smoke"
curl -sS -o /dev/null -w "https_frontend:%{http_code}\n" "$PUBLIC_URL/"
curl -sS -o /dev/null -w "https_auth:%{http_code}\n" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$PUBLIC_URL/auth/v1/health"

echo ""
echo "OK: $PUBLIC_URL no ar na VPS (sem Lovable)."
