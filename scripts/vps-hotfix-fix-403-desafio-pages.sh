#!/usr/bin/env bash
# Corrige 403 Forbidden em /app-desafio.html e /admin-desafios.html
#
# Causa típica: hotfixes baixaram os HTML via mktemp (modo 0600) e fizeram
# mv sem chmod 0644 → nginx (www-data) não lê → 403. Outros HTML “inexistentes”
# caem no try_files → index.html (200), por isso só essas duas páginas quebram.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-fix-403-desafio-pages.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
BUST="$(date +%s)"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v curl >/dev/null || die "curl"
mkdir -p "$WEB"

download() {
  local rel="$1" out="$2" needle="${3:-}"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"
      rm -f "$tmp"
      return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"
      rm -f "$tmp"
      return 0
    fi
  fi
  rm -f "$tmp"
  die "nao baixou: $rel"
}

fix_perms() {
  local f="$1"
  [[ -e "$f" ]] || return 0
  if [[ -d "$f" ]]; then
    log "AVISO: $f é diretório (não deveria) — removendo para republicar arquivo"
    rm -rf "$f"
    return 0
  fi
  chmod 0644 "$f" || true
  # dono legível pelo nginx; se www-data existir, garante grupo
  if id www-data >/dev/null 2>&1; then
    chown root:www-data "$f" 2>/dev/null || chown root:root "$f" 2>/dev/null || true
  else
    chown root:root "$f" 2>/dev/null || true
  fi
  # garante percurso até o arquivo
  local d; d="$(dirname "$f")"
  while [[ "$d" == /var/www* || "$d" == /opt/arbishield* ]]; do
    chmod a+rx "$d" 2>/dev/null || true
    [[ "$d" == "/" || "$d" == "/var" || "$d" == "/var/www" ]] && break
    d="$(dirname "$d")"
  done
  ls -la "$f" || true
}

log "diagnóstico atual"
for f in \
  "$WEB/app-desafio.html" \
  "$WEB/admin-desafios.html" \
  "$WEB_ROOT/app-desafio.html" \
  "$WEB_ROOT/admin-desafios.html" \
  "$WEB_ROOT/v2/app-desafio.html" \
  "$WEB_ROOT/v2/admin-desafios.html"
do
  if [[ -e "$f" ]]; then
    echo "  $(ls -lad "$f")"
  else
    echo "  missing: $f"
  fi
done

log "republicar app-desafio.html + admin-desafios.html (modo 0644)"
download "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html" "stepIsFinished"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "data-f=\"active\""

# espelhos comuns
for dest in \
  "$WEB_ROOT/app-desafio.html" \
  "$WEB_ROOT/v2/app-desafio.html"
do
  mkdir -p "$(dirname "$dest")"
  install -m 0644 "$WEB/app-desafio.html" "$dest"
done
for dest in \
  "$WEB_ROOT/admin-desafios.html" \
  "$WEB_ROOT/v2/admin-desafios.html"
do
  mkdir -p "$(dirname "$dest")"
  install -m 0644 "$WEB/admin-desafios.html" "$dest"
done

for f in \
  "$WEB/app-desafio.html" \
  "$WEB/admin-desafios.html" \
  "$WEB_ROOT/app-desafio.html" \
  "$WEB_ROOT/admin-desafios.html" \
  "$WEB_ROOT/v2/app-desafio.html" \
  "$WEB_ROOT/v2/admin-desafios.html"
do
  fix_perms "$f"
done

# cache-bust assets referenciados
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=fix403-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=fix403-$BUST|g" \
  "$WEB/app-desafio.html" "$WEB/admin-desafios.html" \
  "$WEB_ROOT/app-desafio.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html" "$WEB/admin-desafios.html" \
  "$WEB_ROOT/app-desafio.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

# se root do nginx for v2, perms do diretório
chmod 0755 "$WEB" "$WEB_ROOT" 2>/dev/null || true

log "checar HTTP"
ok=1
code="$(curl -sk -o /dev/null -w '%{http_code}' -m 12 -A 'Mozilla/5.0' -H 'Host: arbishield.app' \
  'https://127.0.0.1/app-desafio.html' 2>/dev/null || echo 000)"
echo "  $code  local app-desafio (Host arbishield.app)"
for url in \
  "https://arbishield.app/app-desafio.html" \
  "https://arbishield.app/admin-desafios.html"
do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 12 -A 'Mozilla/5.0' "$url" 2>/dev/null || echo 000)"
  echo "  $code  $url"
  [[ "$code" == "200" ]] || ok=0
done

# fallback: nginx reload se ainda 403 (open_file_cache / perms de pasta)
if [[ "$ok" -ne 1 ]]; then
  log "ainda sem 200 — nginx reload + perms"
  find "$WEB" -maxdepth 1 \( -name 'app-desafio.html' -o -name 'admin-desafios.html' \) -exec chmod 0644 {} \;
  chmod 0755 "$WEB" 2>/dev/null || true
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
  sleep 1
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 12 -A 'Mozilla/5.0' 'https://arbishield.app/app-desafio.html' || echo 000)"
  echo "  retry app-desafio → $code"
  [[ "$code" == "200" ]] || die "ainda 403 — rode: ls -la $WEB/app-desafio.html $WEB/admin-desafios.html && namei -l $WEB/app-desafio.html"
fi

echo
echo "OK — páginas Desafio liberadas (HTTP 200)."
echo "Abra: https://arbishield.app/app-desafio.html"
echo "Admin: https://arbishield.app/admin-desafios.html"
echo "Hard refresh (Ctrl+F5)."
