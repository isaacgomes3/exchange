#!/usr/bin/env bash
# Exclui conta Auth (GoTrue) e libera o e-mail para novo cadastro.
# Limpa FKs (ex.: affiliate_stats → profiles) antes do DELETE no Auth.
#
# Na VPS (root):
#   EMAIL='danilomc1@live.com' CONFIRM=EXCLUIR \
#     bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#       "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-excluir-usuario-auth.sh?ref=main&t=$(date +%s)")
#
# Ou local na VPS:
#   EMAIL='danilomc1@live.com' CONFIRM=EXCLUIR bash /opt/arbishield/scripts/vps-excluir-usuario-auth.sh
set -euo pipefail

EMAIL="${EMAIL:-}"
CONFIRM="${CONFIRM:-}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"
KEEP_PROFILE="${KEEP_PROFILE:-0}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }

[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
[[ -n "$EMAIL" ]] || die "defina EMAIL='usuario@dominio.com'"
[[ "$CONFIRM" == "EXCLUIR" ]] || die "defina CONFIRM=EXCLUIR para confirmar a exclusão permanente"
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
      ARBISHIELD_*|SUPABASE_*|SERVICE_*|API_EXTERNAL_URL|JWT_*) export "$k=$v" ;;
    esac
  done < "$f"
}

load_env "$ENV_FILE" || load_env /opt/arbishield/.env || true
SUPABASE_URL="$(printf '%s' "${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}" | sed 's:/*$::')"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente em $ENV_FILE"
[[ -n "$SUPABASE_URL" ]] || die "SUPABASE_URL ausente"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-del-user.err; then
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

log "resumo da conta"
psql_db <<SQL
SELECT id, email, created_at, last_sign_in_at, email_confirmed_at
FROM auth.users
WHERE id = '${AUTH_UID}'::uuid;
SELECT id, full_name, balance_cents, locked_balance_cents, deduction_balance_cents
FROM public.profiles
WHERE id = '${AUTH_UID}'::uuid;
SQL

export SUPABASE_URL SERVICE_KEY EMAIL KEEP_PROFILE AUTH_UID DB_CONTAINER
log "limpar FKs que apontam para profiles/user e excluir Auth"

python3 <<'PY'
import json, os, subprocess, urllib.request, urllib.error

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_KEY"]
email = os.environ["EMAIL"].strip().lower()
uid = os.environ["AUTH_UID"].strip()
keep_profile = os.environ.get("KEEP_PROFILE", "0") == "1"
db = os.environ["DB_CONTAINER"]

def psql(sql, tuples_only=False):
    def run(user):
        cmd = [
            "docker", "exec", "-i", db,
            "psql", "-U", user, "-d", "postgres",
            "-v", "ON_ERROR_STOP=1",
        ]
        if tuples_only:
            cmd.append("-At")
        return subprocess.check_output(cmd, input=sql, text=True)

    try:
        return run("postgres")
    except subprocess.CalledProcessError:
        return run("supabase_admin")

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        url + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=45) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except Exception:
            payload = {"error": raw[:400]}
        raise RuntimeError(f"HTTP {e.code} {path}: {payload}")

email_sql = email.replace("'", "''")

# 1) Apaga linhas que referenciam public.profiles(id) (resolve 23503 affiliate_stats etc.)
fk_sql = f"""
SELECT format(
  'DELETE FROM %s WHERE %I = %L::uuid;',
  c.conrelid::regclass::text,
  a.attname,
  '{uid}'
)
FROM pg_constraint c
JOIN pg_attribute a
  ON a.attrelid = c.conrelid
 AND a.attnum = c.conkey[1]
 AND NOT a.attisdropped
WHERE c.contype = 'f'
  AND c.confrelid = 'public.profiles'::regclass
  AND array_length(c.conkey, 1) = 1
ORDER BY 1;
"""
print("==> FKs → public.profiles")
deletes = [ln.strip() for ln in psql(fk_sql, tuples_only=True).splitlines() if ln.strip()]
for d in deletes:
    print(d)
    print(psql(d).strip() or "DELETE ok")

# 2) Tabelas comuns com user_id / profile_id (best-effort, ignora se não existir)
extra_tables = [
    ("public.user_roles", "user_id"),
    ("public.notifications", "user_id"),
    ("public.wallet_transactions", "user_id"),
    ("public.protections", "user_id"),
    ("public.refund_requests", "user_id"),
    ("public.back_refund_requests", "user_id"),
    ("public.withdrawals", "user_id"),
    ("public.manual_deposits", "user_id"),
    ("public.asaas_payments", "user_id"),
    ("public.odd_contestations", "user_id"),
    ("public.back_protections", "user_id"),
    ("public.desafios", "user_id"),
    ("public.desafio_steps", "user_id"),
    ("public.affiliate_stats", "profile_id"),
]
print("==> limpeza best-effort user_id/profile_id")
for table, col in extra_tables:
    sql = f"""
DO $$
BEGIN
  IF to_regclass('{table}') IS NOT NULL THEN
    EXECUTE format('DELETE FROM {table} WHERE {col} = %L::uuid', '{uid}');
  END IF;
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;
"""
    try:
        psql(sql)
        print(f"ok {table}.{col}")
    except Exception as e:
        print(f"(aviso {table}.{col}: {e})")

# 3) Profile (se cascade do Auth falhar depois, já está limpo)
if keep_profile:
    print("KEEP_PROFILE=1 — profile preservado")
else:
    print("==> DELETE profiles")
    print(psql(f"DELETE FROM public.profiles WHERE id = '{uid}'::uuid;").strip() or "ok")

# 4) Auth leftovers + user (SQL é mais confiável que admin API com FKs de app)
print("==> limpar auth.* e auth.users")
auth_sql = f"""
DELETE FROM auth.mfa_challenges
WHERE factor_id IN (SELECT id FROM auth.mfa_factors WHERE user_id = '{uid}'::uuid);
DELETE FROM auth.mfa_factors WHERE user_id = '{uid}'::uuid;
DELETE FROM auth.refresh_tokens WHERE user_id = '{uid}'::uuid;
DELETE FROM auth.sessions WHERE user_id = '{uid}'::uuid;
DELETE FROM auth.identities WHERE user_id = '{uid}'::uuid;
DELETE FROM auth.one_time_tokens WHERE user_id = '{uid}'::uuid;
DELETE FROM auth.users WHERE id = '{uid}'::uuid;
"""
try:
    print(psql(auth_sql))
except Exception as e:
    print(f"(aviso sql auth delete: {e})")
    # Fallback API
    try:
        status, _ = req(
            "DELETE",
            f"/auth/v1/admin/users/{uid}?should_soft_delete=false",
        )
        print(f"DELETE admin/users HTTP {status}")
    except Exception as e2:
        # Último recurso: renomear e-mail para liberar cadastro
        tomb = f"deleted+{uid[:8]}@deleted.invalid"
        print(f"(aviso API delete: {e2})")
        print(f"==> fallback: renomear e-mail para {tomb}")
        psql(
            f"UPDATE auth.users SET email = '{tomb}', "
            f"email_change = NULL, email_change_token_new = '', "
            f"email_change_token_current = '' "
            f"WHERE id = '{uid}'::uuid;"
        )
        psql(
            f"UPDATE auth.identities "
            f"SET identity_data = jsonb_set("
            f"coalesce(identity_data,'{{}}'::jsonb), '{{email}}', to_jsonb('{tomb}'::text), true"
            f"), provider_id = '{tomb}' "
            f"WHERE user_id = '{uid}'::uuid;"
        )

still = psql(
    f"SELECT count(*) FROM auth.users WHERE lower(email)=lower('{email_sql}');",
    tuples_only=True,
).strip()
print(f"auth.users com este e-mail: {still}")
if still not in ("0",):
    raise SystemExit("FALHA: e-mail ainda ocupado em auth.users")

ident = psql(
    f"SELECT count(*) FROM auth.identities "
    f"WHERE lower(coalesce(identity_data->>'email',''))=lower('{email_sql}');",
    tuples_only=True,
).strip()
print(f"auth.identities com este e-mail: {ident}")
if ident not in ("0",):
    raise SystemExit("FALHA: e-mail ainda em auth.identities")

print("OK — e-mail liberado. Pode cadastrar de novo em /cadastro.html")
PY
