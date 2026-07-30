#!/usr/bin/env bash
# Remove fatores MFA incompletos (unverified) de um usuário — libera novo enroll.
# Não apaga fatores já verificados, a menos que FORCE_ALL=1.
#
# Na VPS (root):
#   EMAIL='isaacgomes3@gmail.com' bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-limpar-mfa-pendente.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
#
# Apagar TODOS os fatores (inclusive ativos): FORCE_ALL=1 EMAIL='...' bash <(curl ...)
set -euo pipefail

EMAIL="${EMAIL:-isaacgomes3@gmail.com}"
FORCE_ALL="${FORCE_ALL:-0}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v python3 >/dev/null || die "python3"
command -v docker >/dev/null || die "docker"

load_env() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue
    local k="${line%%=*}" v="${line#*=}"
    k="$(echo "$k" | xargs)"
    case "$k" in
      ARBISHIELD_*|SUPABASE_*|SERVICE_*|API_EXTERNAL_URL) export "$k=$v" ;;
    esac
  done < "$f"
}

load_env "$ENV_FILE" || load_env /opt/arbishield/.env || true
SUPABASE_URL="$(printf '%s' "${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}" | sed 's:/*$::')"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-mfa.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

EMAIL_SQL="${EMAIL//\'/\'\'}"
log "localizar $EMAIL"
AUTH_UID="$(
  psql_db -At <<SQL
SELECT id::text FROM auth.users WHERE lower(email)=lower('${EMAIL_SQL}') LIMIT 1;
SQL
)"
[[ -n "$AUTH_UID" ]] || die "usuário não encontrado: $EMAIL"
log "user_id=$AUTH_UID"

log "fatores atuais"
psql_db <<SQL
SELECT id, friendly_name, factor_type, status, created_at
FROM auth.mfa_factors
WHERE user_id = '${AUTH_UID}'::uuid
ORDER BY created_at;
SQL

if [[ "$FORCE_ALL" == "1" ]]; then
  log "FORCE_ALL=1 — apagar TODOS os fatores MFA"
  psql_db <<SQL
DELETE FROM auth.mfa_challenges WHERE factor_id IN (
  SELECT id FROM auth.mfa_factors WHERE user_id = '${AUTH_UID}'::uuid
);
DELETE FROM auth.mfa_factors WHERE user_id = '${AUTH_UID}'::uuid;
SQL
else
  log "apagar só fatores unverified/pendentes"
  psql_db <<SQL
DELETE FROM auth.mfa_challenges WHERE factor_id IN (
  SELECT id FROM auth.mfa_factors
  WHERE user_id = '${AUTH_UID}'::uuid
    AND lower(coalesce(status,'')) IN ('unverified','pending','')
);
DELETE FROM auth.mfa_factors
WHERE user_id = '${AUTH_UID}'::uuid
  AND lower(coalesce(status,'')) IN ('unverified','pending','');
SQL
fi

log "fatores restantes"
psql_db <<SQL
SELECT id, friendly_name, factor_type, status, created_at
FROM auth.mfa_factors
WHERE user_id = '${AUTH_UID}'::uuid
ORDER BY created_at;
SQL

# republica UI com enroll-v2 se o hotfix MFA já rodou
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
if [[ -d "$WEB" ]]; then
  log "atualizar v2-perfil.js (unenroll pendente)"
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    "$API/deploy/vps-supabase/static/v2/v2-perfil.js?ref=${REF}&t=$(date +%s)" -o "$tmp" \
    && grep -q "mfa-totp-enroll-v2" "$tmp"; then
    install -m 0644 "$tmp" "$WEB/v2-perfil.js"
    install -m 0644 "$tmp" /var/www/arbishield/v2-perfil.js 2>/dev/null || true
    BUST="$(date +%s)"
    sed -i -E "s|/v2-perfil\\.js(\\?[^\"]*)?|/v2-perfil.js?v=mfa2-$BUST|g" \
      "$WEB/app-perfil.html" /var/www/arbishield/app-perfil.html 2>/dev/null || true
    echo "  UI ok (mfa-totp-enroll-v2)"
  else
    echo "  avisos: perfil.js ainda sem enroll-v2 no branch (rode depois do push)"
  fi
  rm -f "$tmp"
fi

echo
echo "OK — MFA pendente limpo para $EMAIL."
echo "No site: hard refresh (Ctrl+Shift+R) → Perfil → Ativar 2FA → escanear QR → código."
