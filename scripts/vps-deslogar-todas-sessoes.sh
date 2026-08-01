#!/usr/bin/env bash
# Desloga TODAS as sessões de um usuário Auth (invalida refresh tokens / sessions).
# Tokens de acesso (JWT) já emitidos podem valer até expirar (~1h); sem refresh
# nenhuma página consegue renovar a sessão.
#
# Na VPS (root):
#   EMAIL='isaacgomes3@gmail.com' bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-deslogar-todas-sessoes.sh?ref=main&t=$(date +%s)")
#
# Opcional — também troca a senha (recomendado se houve acesso indevido):
#   NEW_PASSWORD='SenhaNovaForte' EMAIL='isaacgomes3@gmail.com' bash <(curl ...)
set -euo pipefail

EMAIL="${EMAIL:-isaacgomes3@gmail.com}"
NEW_PASSWORD="${NEW_PASSWORD:-}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v docker >/dev/null || die "docker"
command -v python3 >/dev/null || die "python3"

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
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-logout.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

EMAIL_SQL="${EMAIL//\'/\'\'}"
log "localizar usuário $EMAIL"
# Não usar UID — no bash é variável readonly (builtin)
AUTH_UID="$(
  psql_db -At <<SQL
SELECT id::text FROM auth.users WHERE lower(email)=lower('${EMAIL_SQL}') LIMIT 1;
SQL
)"
[[ -n "$AUTH_UID" ]] || die "usuário não encontrado: $EMAIL"
log "user_id=$AUTH_UID"

log "apagar refresh tokens / sessions no banco"
psql_db <<SQL
DO \$\$
DECLARE
  uid uuid := '${AUTH_UID}'::uuid;
  n_rt int := 0;
  n_sess int := 0;
BEGIN
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = \$1' USING uid;
    GET DIAGNOSTICS n_rt = ROW_COUNT;
    RAISE NOTICE 'refresh_tokens removidos: %', n_rt;
  END IF;

  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'DELETE FROM auth.sessions WHERE user_id = \$1' USING uid;
    GET DIAGNOSTICS n_sess = ROW_COUNT;
    RAISE NOTICE 'sessions removidas: %', n_sess;
  END IF;

  -- GoTrue antigo às vezes guarda só em refresh_tokens com coluna session_id
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.refresh_tokens WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = \$1)' USING uid;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- coluna/tabela pode não existir
    END;
  END IF;
END
\$\$;

-- confirma contagem residual
SELECT
  (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = '${AUTH_UID}'::uuid) AS refresh_restantes,
  CASE WHEN to_regclass('auth.sessions') IS NOT NULL
    THEN (SELECT count(*) FROM auth.sessions WHERE user_id = '${AUTH_UID}'::uuid)
    ELSE 0
  END AS sessions_restantes;
SQL

# Ban curto via Admin API (reforço: GoTrue rejeita tokens do usuário banido)
if [[ -n "$SERVICE_KEY" && -n "$SUPABASE_URL" ]]; then
  log "ban curto 8s via Auth Admin (derruba sessões em memória)"
  export SUPABASE_URL SERVICE_KEY AUTH_UID NEW_PASSWORD EMAIL
  python3 <<'PY'
import json, os, time, urllib.request, urllib.error

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_KEY"]
uid = os.environ["AUTH_UID"]
new_password = os.environ.get("NEW_PASSWORD") or ""

def put(body):
    data = json.dumps(body).encode()
    r = urllib.request.Request(
        f"{url}/auth/v1/admin/users/{uid}",
        data=data,
        method="PUT",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]

if new_password.strip():
    if len(new_password) < 8:
        raise SystemExit("NEW_PASSWORD deve ter >= 8 caracteres")
    st, raw = put({"password": new_password, "email_confirm": True})
    print(f"senha atualizada: HTTP {st}")

st, raw = put({"ban_duration": "8s"})
print(f"ban 8s: HTTP {st} {raw[:120]}")
time.sleep(9)
st, raw = put({"ban_duration": "none"})
print(f"unban: HTTP {st} {raw[:120]}")
PY
fi

echo
echo "OK — todas as sessões de $EMAIL foram invalidadas."
echo "Em qualquer PC/navegador ainda aberto: a página deve cair no login ao atualizar"
echo "(ou no máximo quando o JWT curto expirar, ~1h, sem conseguir renovar)."
echo
echo "No SEU PC: abra https://arbishield.app/auth.html e entre de novo."
if [[ -z "${NEW_PASSWORD}" ]]; then
  echo "Dica: rode de novo com NEW_PASSWORD='...' se ainda não trocou a senha."
fi
