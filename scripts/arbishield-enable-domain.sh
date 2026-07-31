#!/usr/bin/env bash
# Ativa https://arbishield.app na VPS (após DNS A apontar para este servidor).
set -euo pipefail

DOMAIN="${DOMAIN:-arbishield.app}"
WWW="www.${DOMAIN}"
EMAIL="${CERTBOT_EMAIL:-isaacgomes3@gmail.com}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
EXPECTED_IP="${EXPECTED_IP:-195.200.6.206}"

echo "==> Checando DNS de $DOMAIN"
RESOLVED="$(dig +short "$DOMAIN" A | tail -1 || true)"
echo "    $DOMAIN → ${RESOLVED:-<vazio>}"
if [[ "$RESOLVED" != "$EXPECTED_IP" ]]; then
  cat <<EOF
DNS ainda não aponta para $EXPECTED_IP.

No painel DNS:
  Tipo A | Nome @   | Valor $EXPECTED_IP
  Tipo A | Nome www | Valor $EXPECTED_IP
EOF
  exit 1
fi

echo "==> Nginx produção"
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

echo "==> Atualizar .env do Supabase"
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
            f"{url}/**,{url},http://localhost:3000/**"
        )
    else:
        lines.append(line)
p.write_text("\n".join(lines) + "\n")
print("env ->", url)
PY

ANON="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
docker compose up -d auth
sleep 4

curl -sS -o /dev/null -w "frontend:%{http_code}\n" "$PUBLIC_URL/admin/matches"
curl -sS -o /dev/null -w "auth:%{http_code}\n" -H "apikey: $ANON" "$PUBLIC_URL/auth/v1/health"

echo ""
echo "OK: $PUBLIC_URL"
