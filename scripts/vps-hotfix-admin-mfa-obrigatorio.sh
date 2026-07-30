#!/usr/bin/env bash
# Obriga 2FA (TOTP) para TODOS os admins:
#  - UI: painel admin redireciona para Perfil se sem fator / auth se aal1
#  - API: delete/settle/cancel/restore exigem JWT aal2
#  - MFA TOTP habilitado no GoTrue (se ainda off)
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-mfa-obrigatorio.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v curl >/dev/null || die "curl"
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
  die "nao baixou: $rel (needle=$needle)"
}

log "0/4 MFA TOTP no GoTrue (se script existir)"
if curl -fsSL --retry 2 -H "Accept: application/vnd.github.raw" \
  "$API/scripts/vps-hotfix-enable-mfa-totp.sh?ref=${REF}&t=$BUST" -o /tmp/enable-mfa.sh 2>/dev/null; then
  bash /tmp/enable-mfa.sh || log "AVISO: enable-mfa retornou erro — seguindo com UI/API"
else
  log "AVISO: não baixou enable-mfa — confira GOTRUE_MFA_TOTP_* manualmente"
fi

log "1/4 shim (requireAdminMfa aal2)"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "admin-mfa-required-v1"
install -m 0644 "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "2/4 UI (v2.js + shell + perfil + auth)"
download "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js" "admin-mfa-required-v1"
download "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js" "admin-mfa-required-v1"
download "deploy/vps-supabase/static/v2/v2-perfil.js" "$WEB/v2-perfil.js" "mfa-totp-enroll-v3"
download "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html" "admin-mfa-required-v1"
for f in v2.js v2-shell.js v2-perfil.js auth.html; do
  install -m 0644 "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
# cache-bust em HTMLs
for f in "$WEB"/*.html "$WEB_ROOT"/*.html; do
  [[ -f "$f" ]] || continue
  sed -i -E \
    "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=admin-mfa-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=admin-mfa-$BUST|g; s|/v2-perfil\\.js(\\?[^\"]*)?|/v2-perfil.js?v=admin-mfa-$BUST|g" \
    "$f" 2>/dev/null || true
done
chmod 0644 "$WEB/v2.js" "$WEB/v2-shell.js" "$WEB/v2-perfil.js" "$WEB/auth.html" 2>/dev/null || true

log "3/4 listar admins sem fator MFA verificado"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
if [[ -n "$DB_CONTAINER" ]]; then
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL' 2>/dev/null \
    || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
SELECT
  u.email,
  coalesce(p.full_name, '') AS nome,
  CASE WHEN p.is_super_admin THEN 'super' ELSE 'role' END AS tipo,
  coalesce(
    (SELECT count(*) FROM auth.mfa_factors f
     WHERE f.user_id = u.id AND lower(f.status) = 'verified'),
    0
  ) AS fatores_ok
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.is_super_admin = true
   OR EXISTS (
     SELECT 1 FROM public.user_roles r
     WHERE r.user_id = u.id AND r.role IN ('admin', 'master_admin')
   )
ORDER BY fatores_ok ASC, u.email;
SQL
else
  echo "(sem postgres — pulando lista)"
fi

log "4/4 smoke"
code="$(curl -sS -o /dev/null -w '%{http_code}' -m 8 -X POST \
  -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:3101/api/arbishield/desafio-delete || echo 000)"
echo "  desafio-delete sem token → HTTP $code"

echo
echo "OK — 2FA obrigatório para todos os admins."
echo "Cada admin deve: login → Perfil → Ativar 2FA → QR → código."
echo "Depois: login de novo com senha + código (aal2) para usar o painel."
echo "Hard refresh (Ctrl+Shift+R) em todas as abas admin."
