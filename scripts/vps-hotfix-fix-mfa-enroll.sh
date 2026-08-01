#!/usr/bin/env bash
# Corrige erro no cadastro 2FA:
#  1) limpa fatores pendentes do usuário
#  2) force-recreate GoTrue com MFA TOTP on
#  3) publica perfil enroll-v3 + rota mfa-clear-pending no shim/nginx
#
# Na VPS (root):
#   EMAIL='isaacgomes3@gmail.com' bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-fix-mfa-enroll.sh?ref=main&t=$(date +%s)")
set -euo pipefail

EMAIL="${EMAIL:-isaacgomes3@gmail.com}"
REF="${ARBISHIELD_REF:-main}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR" "$WEB" /var/log/arbishield

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

log "1/5 limpar MFA pendente de $EMAIL (FORCE_ALL se ainda falhar)"
if curl -fsSL --retry 2 -H "Accept: application/vnd.github.raw" \
  "$API/scripts/vps-limpar-mfa-pendente.sh?ref=${REF}&t=$BUST" -o /tmp/limpar-mfa.sh; then
  EMAIL="$EMAIL" FORCE_ALL=1 bash /tmp/limpar-mfa.sh || log "AVISO: limpar MFA falhou"
else
  log "AVISO: não baixou limpar-mfa"
fi

log "2/5 habilitar MFA TOTP + recreate auth"
if curl -fsSL --retry 2 -H "Accept: application/vnd.github.raw" \
  "$API/scripts/vps-hotfix-enable-mfa-totp.sh?ref=${REF}&t=$BUST" -o /tmp/enable-mfa.sh; then
  bash /tmp/enable-mfa.sh || log "AVISO: enable-mfa com avisos"
else
  die "não baixou enable-mfa"
fi

log "3/5 shim (mfa-clear-pending + admin-mfa)"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "mfa-clear-pending-v1"
install -m 0644 "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "4/5 UI enroll-v4 (fix código apagado no confirm) + nginx"
download "deploy/vps-supabase/static/v2/v2-perfil.js" "$WEB/v2-perfil.js" "mfa-totp-enroll-v4"
download "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js" "admin-mfa-required-v1"
download "deploy/vps-supabase/static/v2/app-perfil.html" "$WEB/app-perfil.html" "v2-perfil.js"
for f in v2-perfil.js v2.js app-perfil.html; do
  install -m 0644 "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
sed -i -E "s|/v2-perfil\\.js(\\?[^\"]*)?|/v2-perfil.js?v=mfa3-$BUST|g; s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=mfa3-$BUST|g" \
  "$WEB/app-perfil.html" "$WEB_ROOT/app-perfil.html" 2>/dev/null || true

NGINX_FILE="$(grep -RIlE 'desafio-settle|127\.0\.0\.1:3101' /etc/nginx 2>/dev/null | head -1 || true)"
if [[ -n "$NGINX_FILE" ]]; then
  cp -a "$NGINX_FILE" "${NGINX_FILE}.bak-mfa-clear-$BUST"
  if ! grep -q 'mfa-clear-pending' "$NGINX_FILE"; then
    if grep -q 'auth-logout-sessions' "$NGINX_FILE"; then
      sed -i 's/auth-logout-sessions/auth-logout-sessions|mfa-clear-pending/' "$NGINX_FILE"
    elif grep -q 'auth-logout-others' "$NGINX_FILE"; then
      sed -i 's/auth-logout-others/auth-logout-others|mfa-clear-pending/' "$NGINX_FILE"
    elif grep -q 'desafio-delete' "$NGINX_FILE"; then
      sed -i 's/desafio-delete/desafio-delete|mfa-clear-pending/' "$NGINX_FILE"
    fi
  fi
  nginx -t && systemctl reload nginx
  log "nginx: $NGINX_FILE"
fi

log "4b/5 sincronizar relógio da VPS (NTP) — TOTP depende disso"
timedatectl set-ntp true 2>/dev/null || true
chronyc makestep 2>/dev/null || ntpdate -u pool.ntp.org 2>/dev/null || true
date -u '+  UTC agora: %Y-%m-%d %H:%M:%S'
timedatectl status 2>/dev/null | head -8 || true

log "5/5 checagens"
echo "  MFA env no auth:"
for c in $(docker ps --format '{{.Names}}' | grep -Ei 'auth|gotrue' || true); do
  docker exec "$c" sh -c 'printenv | grep -E "^GOTRUE_MFA_TOTP_|^GOTRUE_MFA_MAX" || echo "(sem GOTRUE_MFA_* — enroll vai falhar)"' 2>/dev/null || true
done
code="$(curl -sS -o /tmp/mfa-clear.json -w '%{http_code}' -m 8 -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:3101/api/arbishield/mfa-clear-pending || echo 000)"
echo "  mfa-clear-pending → HTTP $code (401 sem token = ok)"

echo
echo "OK — agora no PC:"
echo "  1) Hard refresh Ctrl+Shift+R em https://arbishield.app/app-perfil.html"
echo "  2) Ativar 2FA → escanear QR → código 6 dígitos"
echo "Se ainda falhar, copie a mensagem vermelha exata da tela."
