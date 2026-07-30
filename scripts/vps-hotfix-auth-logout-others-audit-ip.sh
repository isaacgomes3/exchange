#!/usr/bin/env bash
# Publica:
#  - shim: IP+UA no delete/cancel + /api/arbishield/auth-logout-others
#  - v2-shell: botão "Encerrar outras sessões"
#  - admin-desafios: mostra IP/UA de exclusão
#  - nginx: rota + X-Real-IP
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-auth-logout-others-audit-ip.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
NGINX_SITE="${ARBISHIELD_NGINX_SITE:-/etc/nginx/sites-available/arbishield.app}"
NGINX_SITE_ALT="/etc/nginx/conf.d/arbishield.app.conf"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v curl >/dev/null || die "curl"
mkdir -p "$SCRIPTS_DIR" "$WEB"

download() {
  local rel="$1" out="$2" needle="${3:-}"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  rm -f "$tmp"
  die "nao baixou: $rel"
}

log "1/4 shim (audit IP + auth-logout-others)"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "delete-audit-admin-name-v1"
grep -q 'delete-audit-ip-ua-v1' "$SHIM_PATH" || die "shim sem delete-audit-ip-ua-v1"
grep -q 'delete-audit-admin-name-v1' "$SHIM_PATH" || die "shim sem delete-audit-admin-name-v1"
install -m 0644 "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "2/4 v2-shell.js + admin-desafios.html"
download "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js" "auth-logout-others-v1"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "Excluído por:"
install -m 0644 "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
install -m 0644 "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
# cache bust em páginas admin comuns
for f in "$WEB"/*.html "$WEB_ROOT"/*.html; do
  [[ -f "$f" ]] || continue
  sed -i -E "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=logout-others-$BUST|g" "$f" 2>/dev/null || true
done
chmod 0644 "$WEB/v2-shell.js" "$WEB/admin-desafios.html" 2>/dev/null || true

log "3/4 nginx (rota + X-Real-IP)"
# procura em todo /etc/nginx (nome do site varia na VPS)
NGINX_FILE=""
for cand in "$NGINX_SITE" "$NGINX_SITE_ALT" \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/conf.d/arbishield.conf
do
  if [[ -f "$cand" ]] && grep -qE 'desafio-delete|desafio-settle|127\.0\.0\.1:3101' "$cand" 2>/dev/null; then
    NGINX_FILE="$cand"
    break
  fi
done
if [[ -z "$NGINX_FILE" ]]; then
  NGINX_FILE="$(grep -RIlE 'desafio-delete|desafio-settle|127\.0\.0\.1:3101' /etc/nginx 2>/dev/null | head -1 || true)"
fi

if [[ -n "$NGINX_FILE" && -f "$NGINX_FILE" ]]; then
  cp -a "$NGINX_FILE" "${NGINX_FILE}.bak-logout-others-$BUST"
  python3 - "$NGINX_FILE" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8", errors="replace").read()
orig = text
for route in ("desafio-restore", "auth-logout-others", "auth-logout-sessions"):
    if route not in text and "desafio-delete" in text:
        text = text.replace("desafio-delete", f"desafio-delete|{route}", 1)
    elif route not in text and "desafio-settle" in text:
        text = text.replace("desafio-settle", f"desafio-settle|{route}", 1)
# X-Real-IP em todo proxy :3101
needle = "proxy_pass http://127.0.0.1:3101;"
inject = (
    "proxy_pass http://127.0.0.1:3101;\n"
    "        proxy_set_header X-Real-IP $remote_addr;\n"
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n"
    "        proxy_set_header X-Forwarded-Proto $scheme;"
)
if "X-Real-IP" not in text and needle in text:
    text = text.replace(needle, inject)
if text != orig:
    open(path, "w", encoding="utf-8").write(text)
    print("nginx: atualizado", path)
else:
    print("nginx: sem mudanças necessárias (já ok ou padrão diferente)")
PY
  nginx -t && systemctl reload nginx
  log "nginx atualizado: $NGINX_FILE"
else
  log "AVISO: conf nginx com :3101/desafio-* não encontrada"
  echo "  Procure com: grep -RIl '3101\\|desafio-settle' /etc/nginx"
  echo "  Depois adicione auth-logout-others na regex do location do shim."
fi

log "4/4 smoke local"
code="$(curl -sS -o /dev/null -w '%{http_code}' -m 8 -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  http://127.0.0.1:3101/api/arbishield/auth-logout-others || echo 000)"
echo "  local auth-logout-others → HTTP $code (401/400 sem token = rota ok)"

echo
echo "OK — hard refresh no admin."
echo "Botão: Encerrar outras sessões (topo direito)."
echo "Delete/cancel/settle gravam e-mail do admin + IP no metadata."
echo "Consultar histórico: bash scripts/vps-quem-apagou-desafios.sh (ou curl do GitHub)."
