#!/usr/bin/env bash
# Publica ArbiShield v2 como HTML estático (NÃO depende do Next).
# Corrige tela preta: /v2 deixava de cair no SPA index.html.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-enable-v2.sh?v=9")
#
# Se o auto-detect falhar:
#   NGINX_SITE=/etc/nginx/conf.d/arbishield-cutover.conf bash <(curl -fsSL ".../vps-enable-v2.sh?v=9")
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

log "1/3 — baixar páginas v2 estáticas (nativo, sem SPA)"
for f in \
  admin-academia.html \
  admin-affiliates.html \
  admin-approvals.html \
  admin-banners.html \
  admin-betting-houses.html \
  admin-blacklist.html \
  admin-communication-lab.html \
  admin-contestations.html \
  admin-desafio-sugestoes.html \
  admin-desafios.html \
  admin-expenses.html \
  admin-geo.html \
  admin-investigation.html \
  admin-jogos.html \
  admin-logs.html \
  admin-manual-deposits.html \
  admin-marketing-team.html \
  admin-monitoring-protections.html \
  admin-monitoring.html \
  admin-onboarding.html \
  admin-partners-distribution.html \
  admin-partners.html \
  admin-performance.html \
  admin-permissoes.html \
  admin-proofs.html \
  admin-refunds.html \
  admin-risk.html \
  admin-saques.html \
  admin-settings.html \
  admin-settlements-audit.html \
  admin-siem.html \
  admin-signup-attempts.html \
  admin-support-ai.html \
  admin-support.html \
  admin-technical-audit.html \
  admin-transactions.html \
  admin-treasury.html \
  admin-users.html \
  admin-whatsapp.html \
  admin.html \
  app-afiliados.html \
  app-academia.html \
  app-academia-video.html \
  app-baixar-app.html \
  app-carteira.html \
  app-config.html \
  app-desafio.html \
  app-partners.html \
  app-perfil.html \
  app-protecoes.html \
  app-proteger.html \
  app-suporte.html \
  app.html \
  auth.html \
  em-breve.html \
  index.html \
  v2-pages.js \
  v2-shell.js \
  v2-deposit.js \
  v2-financeiro.js \
  v2-provedor.js \
  v2-afiliados.js \
  v2.css \
  v2.js \
  brand/logo.png \
  brand/logo@2x.png \
  brand/icon.png \
  brand/icon-64.png \
  brand/icon-128.png \
  brand/favicon-192.png \
  brand/favicon-512.png \
  brand/stadium-hero.jpg \
  brand/stadium-hero-sm.jpg \
  brand/dashboard-preview.jpg
do
  mkdir -p "$WEB/v2/$(dirname "$f")"
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
  die "nginx site não encontrado — rode: NGINX_SITE=/caminho/do.conf bash <(curl -fsSL \"$RAW/scripts/vps-enable-v2.sh?v=9\")"
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

v2_block = f"""
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

cut = """
    # Corta SPA legado → v2 nativo
    location = /admin { return 302 /v2/admin.html; }
    location = /adm { return 302 /v2/admin.html; }
    location = /admin/login { return 302 /v2/auth.html; }
    location = /admin/matches { return 302 /v2/admin-jogos.html; }
    location = /admin/desafios { return 302 /v2/admin-desafios.html; }
    location = /admin/users { return 302 /v2/admin-users.html; }
    location = /admin/transactions { return 302 /v2/admin-transactions.html; }
    location = /admin/saques { return 302 /v2/admin-saques.html; }
    location = /admin/manual-deposits { return 302 /v2/admin-manual-deposits.html; }
    location = /admin/refunds { return 302 /v2/admin-refunds.html; }
    location = /admin/treasury { return 302 /v2/admin-treasury.html; }
    location = /admin/partners-distribution { return 302 /v2/admin-partners-distribution.html; }
    location = /admin/expenses { return 302 /v2/admin-expenses.html; }
    location = /admin/partners { return 302 /v2/admin-partners.html; }
    location = /admin/affiliates { return 302 /v2/admin-affiliates.html; }
    location = /admin/contestations { return 302 /v2/admin-contestations.html; }
    location = /admin/approvals { return 302 /v2/admin-approvals.html; }
    location = /admin/proofs { return 302 /v2/admin-proofs.html; }
    location = /admin/investigation { return 302 /v2/admin-investigation.html; }
    location = /admin/risk { return 302 /v2/admin-risk.html; }
    location = /admin/blacklist { return 302 /v2/admin-blacklist.html; }
    location = /admin/geo { return 302 /v2/admin-geo.html; }
    location = /admin/signup-attempts { return 302 /v2/admin-signup-attempts.html; }
    location = /admin/whatsapp { return 302 /v2/admin-whatsapp.html; }
    location = /admin/communication-lab { return 302 /v2/admin-communication-lab.html; }
    location = /admin/banners { return 302 /v2/admin-banners.html; }
    location = /admin/onboarding { return 302 /v2/admin-onboarding.html; }
    location = /admin/academia { return 302 /v2/admin-academia.html; }
    location = /admin/support { return 302 /v2/admin-support.html; }
    location = /admin/support-ai { return 302 /v2/admin-support-ai.html; }
    location = /admin/settings { return 302 /v2/admin-settings.html; }
    location = /admin/betting-houses { return 302 /v2/admin-betting-houses.html; }
    location = /admin/permissoes { return 302 /v2/admin-permissoes.html; }
    location = /admin/marketing-team { return 302 /v2/admin-marketing-team.html; }
    location = /admin/logs { return 302 /v2/admin-logs.html; }
    location = /admin/settlements-audit { return 302 /v2/admin-settlements-audit.html; }
    location = /admin/technical-audit { return 302 /v2/admin-technical-audit.html; }
    location = /admin/performance { return 302 /v2/admin-performance.html; }
    location = /admin/siem { return 302 /v2/admin-siem.html; }
    location = /admin/monitoring { return 302 /v2/admin-monitoring.html; }
    location = /admin/monitoring-protections { return 302 /v2/admin-monitoring-protections.html; }
    location ^~ /admin/ { return 302 /v2/admin.html; }
    location = /app { return 302 /v2/app.html; }
    location = /app/proteger { return 302 /v2/app-proteger.html; }
    location = /app/protecoes { return 302 /v2/app-protecoes.html; }
    location = /app/desafio { return 302 /v2/app-desafio.html; }
    location = /app/carteira { return 302 /v2/app-carteira.html; }
    location = /app/suporte { return 302 /v2/app-suporte.html; }
    location = /app/afiliados { return 302 /v2/app-afiliados.html; }
    location = /app/partners { return 302 /v2/app-partners.html; }
    location = /app/baixar-app { return 302 /v2/app-baixar-app.html; }
    location = /app/perfil { return 302 /v2/app-perfil.html; }
    location = /app/configuracoes { return 302 /v2/app-config.html; }
    location ^~ /app/ { return 302 /v2/app.html; }
    location ^~ /m { return 302 /v2/app.html; }
    location = /auth { return 302 /v2/auth.html; }
"""

# remove managed blocks
text = re.sub(
    r"\n[ \t]*#[^\n]*v2[^\n]*\n(?:[ \t]*location[^\n]* /v2[^\n]*\{[\s\S]*?\n[ \t]*\}\n)+",
    "\n",
    text,
    flags=re.I,
)
text = re.sub(r"\n[ \t]*location[^\n]* /v2[^\n]*\{[\s\S]*?\n[ \t]*\}\n", "\n", text, flags=re.I)
text = re.sub(r"\n[ \t]*#[^\n]*Corta SPA[^\n]*\n(?:[ \t]*location[^\n]*\{[\s\S]*?\n[ \t]*\}\n)+", "\n", text)
text = re.sub(r"\n[ \t]*location \^~ /admin/ \{[\s\S]*?\n[ \t]*\}\n", "\n", text)
text = re.sub(r"\n[ \t]*location \^~ /app/ \{[\s\S]*?\n[ \t]*\}\n", "\n", text)
text = re.sub(r"\n[ \t]*location \^~ /m \{[\s\S]*?\n[ \t]*\}\n", "\n", text)

paths = re.findall(r"location = (/[^\s{]+)", cut)
for path in sorted(set(paths), key=len, reverse=True):
    text = re.sub(
        rf"\n[ \t]*location = {re.escape(path)} \{{[\s\S]*?\n[ \t]*\}}\n",
        "\n",
        text,
    )

# also remove old try_files admin/login /auth pages
text = re.sub(
    r"\n[ \t]*location = /admin/login \{[\s\S]*?\n[ \t]*\}\n",
    "\n",
    text,
)
text = re.sub(
    r"\n[ \t]*location = /auth \{[\s\S]*?\n[ \t]*\}\n",
    "\n",
    text,
)

insert = cut + "\n" + v2_block
if "location / {" in text:
    text = text.replace("location / {", insert + "\n    location / {", 1)
elif "location /{" in text:
    text = text.replace("location /{", insert + "\n    location /{", 1)
else:
    text = text.rstrip() + "\n" + insert + "\n"

text = text.replace("try_files $uri $uri/ /index.html;", "try_files $uri $uri/ /v2/index.html;")

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
test -f "$WEB/v2/v2-pages.js" || die "faltou v2-pages.js"
test -f "$WEB/v2/admin-transactions.html" || die "faltou admin-transactions.html"
test -f "$WEB/v2/app-perfil.html" || die "faltou app-perfil.html"
echo "OK — arquivos em $WEB/v2 ($(ls -1 "$WEB/v2" | wc -l) ficheiros)"

echo
echo "OK — SPA cortado. Abra (Ctrl+Shift+R):"
echo "  https://arbishield.app/v2/admin.html"
echo "  https://arbishield.app/v2/admin-transactions.html"
echo "  https://arbishield.app/v2/app.html"
echo "  https://arbishield.app/v2/app-perfil.html"
echo "  ( /admin e /app redirecionam para o v2 )"
