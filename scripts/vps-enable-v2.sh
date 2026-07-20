#!/usr/bin/env bash
# Publica ArbiShield v2 como HTML estático (NÃO depende do Next).
# Corrige a tela preta: /v2 deixava de cair no SPA index.html.
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

mkdir -p "$WEB/v2"

log "1/3 — baixar páginas v2 estáticas"
for f in index.html auth.html app.html admin.html admin-users.html v2.css v2.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/v2/$f"
  chmod 0644 "$WEB/v2/$f"
  echo "  ok $f"
done

log "2/3 — nginx: /v2 → HTML estático (antes do SPA catch-all)"
# Descobre conf
if [[ -z "$NGINX_SITE" ]]; then
  for c in \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/sites-available/arbishield.app; do
    if [[ -f "$c" ]]; then NGINX_SITE="$c"; break; fi
  done
fi
[[ -n "$NGINX_SITE" && -f "$NGINX_SITE" ]] || die "nginx site não encontrado — defina NGINX_SITE="

if grep -q 'location ^~ /v2' "$NGINX_SITE"; then
  log "location /v2 já existe — atualizando bloco"
  python3 - "$NGINX_SITE" <<'PY'
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")
block = """    # ArbiShield v2 estático (não cai no SPA)
    location ^~ /v2/ {
        alias /var/www/arbishield/v2/;
        try_files $uri $uri/ /v2/index.html;
        add_header Cache-Control "no-store";
    }
    location = /v2 {
        return 302 /v2/;
    }
"""
text2, n = re.subn(
    r"\s*# ArbiShield v2[\s\S]*?location \^~ /v2[\s\S]*?\n    \}\n(?:\s*location = /v2[\s\S]*?\n    \}\n)?",
    "\n" + block,
    text,
    count=1,
)
if n == 0:
    # remove any old next proxy block for /v2
    text2 = re.sub(
        r"\s*location \^~ /v2\s*\{[\s\S]*?\n    \}\n",
        "\n" + block,
        text,
        count=1,
    )
    if text2 == text:
        if "location / {" in text:
            text2 = text.replace("location / {", block + "\n    location / {", 1)
        else:
            text2 = text + "\n" + block
p.write_text(text2 if 'text2' in dir() else text, encoding="utf-8")
# fix: ensure write
Path(sys.argv[1]).write_text(text2, encoding="utf-8")
print("nginx atualizado")
PY
else
  cp -a "$NGINX_SITE" "$NGINX_SITE.bak-v2-$(date +%Y%m%d%H%M%S)"
  python3 - "$NGINX_SITE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
text = p.read_text(encoding="utf-8", errors="replace")
block = """    # ArbiShield v2 estático (não cai no SPA)
    location ^~ /v2/ {
        alias /var/www/arbishield/v2/;
        try_files $uri $uri/ /v2/index.html;
        add_header Cache-Control "no-store";
    }
    location = /v2 {
        return 302 /v2/;
    }

"""
if "location / {" in text:
    text = text.replace("location / {", block + "    location / {", 1)
elif "location /{" in text:
    text = text.replace("location /{", block + "    location /{", 1)
else:
    text = text + "\n" + block
p.write_text(text, encoding="utf-8")
print("nginx: /v2 estático inserido")
PY
fi

nginx -t
systemctl reload nginx
log "nginx ok"

log "3/3 — verificação local"
curl -sS -o /dev/null -w "/v2/ → %{http_code}\n" "http://127.0.0.1/v2/" || true
curl -sS "http://127.0.0.1/v2/" | head -c 200 || true
echo

echo "OK — v2 estático no ar"
echo "  https://arbishield.app/v2/"
echo "  https://arbishield.app/v2/auth.html"
echo "  https://arbishield.app/v2/app.html"
echo "  https://arbishield.app/v2/admin.html"
echo
echo "Se ainda abrir tela preta: Ctrl+Shift+R (cache do SPA antigo)"
