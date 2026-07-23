#!/usr/bin/env bash
# Hotfix: circuito Desafio → provedor + distribuição admin + APIs shim.
#
# Na VPS (root / console Hostinger):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-desafio-provedor.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI: Desafio + Provedor distribuição + admin desafios"
for f in \
  app-desafio.html \
  app-partners.html \
  v2-provedor.js \
  admin-desafios.html \
  admin-partners-distribution.html \
  v2.css \
  v2-shell.js
do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

log "Shim serverFn (settle + partner distribute)"
if [[ -d "$SHIM_DIR" ]]; then
  curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  if systemctl list-unit-files | grep -q arbishield-serverfn-shim; then
    systemctl restart arbishield-serverfn-shim.service || true
  fi
  echo "  ok shim em $SHIM_DIR"
else
  echo "  avisos: $SHIM_DIR não encontrado — reinicie o shim manualmente após copiar o .mjs"
fi

log "Nginx locations (shim APIs)"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield
do
  [[ -f "$conf" ]] || continue
  if grep -q 'desafio-settle' "$conf"; then
    echo "  já ok $conf"
    continue
  fi
  # backup
  cp -a "$conf" "${conf}.bak.desafio-provedor.$(date +%s)" || true
  # tenta inserir após location desafios
  if grep -q 'location = /api/arbishield/desafios' "$conf"; then
    python3 - "$conf" <<'PY'
import sys
path = sys.argv[1]
block = '''
    location ~ ^/api/arbishield/(desafio-register|desafio-settle|desafio-participations|partner-rounds|partner-distribute|transfer-desafio|affiliate-ensure-code|affiliate-withdraw)$ {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
'''
text = open(path).read()
needle = "location = /api/arbishield/desafios"
i = text.find(needle)
if i < 0:
    raise SystemExit(0)
# find end of that location block
j = text.find("}", i)
if j < 0:
    raise SystemExit(0)
# skip to after closing brace of desafios block (brace matching naive: first } after location)
# better: find matching by counting
k = i
depth = 0
end = None
while k < len(text):
    if text[k] == "{":
        depth += 1
    elif text[k] == "}":
        depth -= 1
        if depth == 0:
            end = k + 1
            break
    k += 1
if end is None:
    raise SystemExit(0)
if "desafio-settle" in text:
    raise SystemExit(0)
open(path, "w").write(text[:end] + "\n" + block + text[end:])
print("  patched", path)
PY
  fi
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

grep -q 'desafio-settle\|Bateu ArbiShield' "$WEB/admin-desafios.html" || die "admin-desafios sem settle"
grep -q 'partner-distribute\|Distribuir' "$WEB/admin-partners-distribution.html" || die "distribuição inválida"
grep -q 'desafio-register' "$WEB/app-desafio.html" || die "app-desafio sem register"

echo
echo "OK — circuito Desafio + Provedor"
echo "  Cliente: https://arbishield.app/app-desafio.html"
echo "  Provedor: https://arbishield.app/app-partners.html"
echo "  Admin settle: https://arbishield.app/admin-desafios.html"
echo "  Admin yield: https://arbishield.app/admin-partners-distribution.html"
