#!/usr/bin/env bash
# Publica ArbiShield v2 como HTML estático (NÃO depende do Next).
# Corrige tela preta: /v2 deixava de cair no SPA index.html.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=7")
#
# Se o auto-detect falhar:
#   NGINX_SITE=/etc/nginx/conf.d/arbishield-cutover.conf bash <(curl -fsSL ".../vps-enable-v2.sh?v=7")
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

log "1/3 — baixar páginas v2 estáticas (isolado do SPA)"
for f in \
  index.html auth.html app.html em-breve.html \
  admin.html admin-users.html admin-jogos.html admin-desafios.html \
  v2.css v2.js v2-shell.js
do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/v2/$f"
  chmod 0644 "$WEB/v2/$f"
  echo "  ok $f"
done

# Remove pontes antigas para o SPA, se existirem
rm -f "$WEB/v2/admin-modulo.html" "$WEB/v2/app-modulo.html"

find_nginx_site() {
  local c
  for c in \
    "${NGINX_SITE:-}" \
    /etc/nginx/conf.d/arbishield-cutover.conf \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/conf.d/arbishield.conf \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield \
    /etc/nginx/sites-enabled/default \
    /etc/nginx/sites-available/arbishield.app \
    /etc/nginx/sites-available/arbishield
  do
    [[ -n "$c" && -f "$c" ]] || continue
    if grep -Eq 'server_name[[:space:]].*arbishield\.app|root[[:space:]]+/var/www/arbishield' "$c" 2>/dev/null \
      || [[ "$c" == *arbishield* ]]; then
      echo "$c"
      return 0
    fi
  done

  # Busca ampla em conf.d / sites-*
  local hit
  hit="$(grep -RslE 'server_name[[:space:]].*arbishield\.app|/var/www/arbishield' \
    /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null \
    | head -n1 || true)"
  if [[ -n "$hit" && -f "$hit" ]]; then
    echo "$hit"
    return 0
  fi

  # Último recurso: arquivo com location / e root arbishield
  hit="$(grep -Rsl 'root /var/www/arbishield' /etc/nginx 2>/dev/null | head -n1 || true)"
  if [[ -n "$hit" && -f "$hit" ]]; then
    echo "$hit"
    return 0
  fi

  return 1
}

log "2/3 — nginx: /v2 → HTML estático (antes do SPA)"
if [[ -z "$NGINX_SITE" ]]; then
  NGINX_SITE="$(find_nginx_site || true)"
fi

if [[ -z "${NGINX_SITE:-}" || ! -f "$NGINX_SITE" ]]; then
  echo "Candidatos em /etc/nginx:" >&2
  ls -la /etc/nginx/conf.d/ 2>/dev/null || true
  ls -la /etc/nginx/sites-enabled/ 2>/dev/null || true
  die "nginx site não encontrado — rode: NGINX_SITE=/caminho/do.conf bash <(curl -fsSL \"$RAW/scripts/vps-enable-v2.sh?v=6\")"
fi

log "usando nginx: $NGINX_SITE"
cp -a "$NGINX_SITE" "$NGINX_SITE.bak-v2-$(date +%Y%m%d%H%M%S)"

python3 - "$NGINX_SITE" "$WEB" <<'PY'
import re
from pathlib import Path
import sys

p = Path(sys.argv[1])
web = sys.argv[2].rstrip("/")
text = p.read_text(encoding="utf-8", errors="replace")

block = f"""
    # ArbiShield v2 estático (não cai no SPA / index.html)
    location = /v2 {{
        return 302 /v2/;
    }}
    location ^~ /v2/ {{
        root {web};
        try_files $uri $uri/ /v2/index.html;
        add_header Cache-Control "no-store";
    }}
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

# /admin/matches e /admin/desafios → v2
for path, dest in (
    ("/admin/matches", "/v2/admin-jogos.html"),
    ("/admin/desafios", "/v2/admin-desafios.html"),
):
    loc = f"""
    location = {path} {{
        return 302 {dest};
    }}
"""
    text = re.sub(
        rf"\n[ \t]*location = {re.escape(path)} \{{[\s\S]*?\n[ \t]*\}}\n",
        "\n",
        text,
    )
    if "location = /v2" in text or "location ^~ /v2/" in text:
        # inserir imediatamente antes do bloco v2
        marker = "    # ArbiShield v2 estático"
        if marker in text:
            text = text.replace(marker, loc.strip() + "\n\n" + marker, 1)
        else:
            text = text.replace(
                "    location = /v2",
                loc.strip() + "\n\n    location = /v2",
                1,
            )
    elif "location / {" in text:
        text = text.replace("location / {", loc + "\n    location / {", 1)
    else:
        text = text.rstrip() + "\n" + loc + "\n"

p.write_text(text, encoding="utf-8")
print(f"nginx atualizado: {p}")
PY

nginx -t
systemctl reload nginx
log "nginx ok"

log "3/3 — verificação"
code="$(curl -sS -o /tmp/v2check.html -w '%{http_code}' http://127.0.0.1/v2/ || true)"
echo "HTTP $code"
if grep -Eqi 'ArbiShield|Sistema novo|layout do' /tmp/v2check.html 2>/dev/null; then
  echo "OK — HTML v2 servido (não é o SPA)"
else
  echo "AVISO: resposta não parece v2 — confira nginx" >&2
  head -c 300 /tmp/v2check.html || true
  echo
fi

# Confirma arquivos no disco
test -f "$WEB/v2/v2-shell.js" || die "faltou v2-shell.js em $WEB/v2"
test -f "$WEB/v2/admin.html" || die "faltou admin.html"
echo "OK — arquivos em $WEB/v2 ($(ls -1 "$WEB/v2" | wc -l) ficheiros)"

echo
echo "OK — abra (Ctrl+Shift+R):"
echo "  https://arbishield.app/v2/"
echo "  https://arbishield.app/v2/auth.html"
echo "  https://arbishield.app/v2/admin.html"
echo "  https://arbishield.app/v2/admin-jogos.html"
echo "  https://arbishield.app/v2/admin-desafios.html"
echo "  https://arbishield.app/v2/app.html"
