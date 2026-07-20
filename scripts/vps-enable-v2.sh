#!/usr/bin/env bash
# Publica ArbiShield v2 como HTML estático (NÃO depende do Next).
# Corrige tela preta: /v2 deixava de cair no SPA index.html.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=2")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
NGINX_SITE="${NGINX_SITE:-}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

command -v curl >/dev/null || die "curl não encontrado"
command -v nginx >/dev/null || die "nginx não encontrado"
command -v python3 >/dev/null || die "python3 não encontrado"

mkdir -p "$WEB/v2"

log "1/3 — baixar páginas v2 estáticas"
for f in index.html auth.html app.html admin.html admin-users.html v2.css v2.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/v2/$f"
  chmod 0644 "$WEB/v2/$f"
  echo "  ok $f"
done

log "2/3 — nginx: /v2 → HTML estático (antes do SPA)"
if [[ -z "$NGINX_SITE" ]]; then
  for c in \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/sites-available/arbishield.app; do
    [[ -f "$c" ]] && NGINX_SITE="$c" && break
  done
fi
[[ -n "${NGINX_SITE:-}" && -f "$NGINX_SITE" ]] || die "nginx site não encontrado — defina NGINX_SITE="

cp -a "$NGINX_SITE" "$NGINX_SITE.bak-v2-$(date +%Y%m%d%H%M%S)"

python3 - "$NGINX_SITE" <<'PY'
import re
from pathlib import Path
import sys

p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")

block = """
    # ArbiShield v2 estático (não cai no SPA / index.html)
    location = /v2 {
        return 302 /v2/;
    }
    location ^~ /v2/ {
        root /var/www/arbishield;
        try_files $uri $uri/ /v2/index.html;
        add_header Cache-Control "no-store";
    }
"""

# Remove blocos /v2 antigos (Next proxy ou estático)
text = re.sub(
    r"\n[ \t]*#[^\n]*v2[^\n]*\n(?:[ \t]*location[^\n]* /v2[^\n]*\{[\s\S]*?\n[ \t]*\}\n)+",
    "\n",
    text,
    flags=re.I,
)
text = re.sub(
    r"\n[ \t]*location[^\n]* /v2[^\n]*\{[\s\S]*?\n[ \t]*\}\n",
    "\n",
    text,
    flags=re.I,
)

if "location / {" in text:
    text = text.replace("location / {", block + "\n    location / {", 1)
elif "location /{" in text:
    text = text.replace("location /{", block + "\n    location /{", 1)
else:
    text = text.rstrip() + "\n" + block + "\n"

p.write_text(text, encoding="utf-8")
print(f"nginx atualizado: {p}")
PY

nginx -t
systemctl reload nginx
log "nginx ok"

log "3/3 — verificação"
code="$(curl -sS -o /tmp/v2check.html -w '%{http_code}' http://127.0.0.1/v2/ || true)"
echo "HTTP $code"
if grep -q 'Sistema novo' /tmp/v2check.html 2>/dev/null; then
  echo "OK — HTML v2 servido (não é o SPA)"
else
  echo "AVISO: resposta não parece v2 — confira nginx" >&2
  head -c 300 /tmp/v2check.html || true
  echo
fi

echo
echo "OK — abra (Ctrl+Shift+R):"
echo "  https://arbishield.app/v2/"
echo "  https://arbishield.app/v2/auth.html"
echo "  https://arbishield.app/v2/admin.html"
