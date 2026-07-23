#!/usr/bin/env bash
# Garante admin financeiro: financeiro@arbishield.com + isaacgomes3@gmail.com
#
# Role admin sozinha NÃO basta para o menu Financeiro. A allowlist de e-mails
# (frontend v2.js / finance-admins.js + shim) libera só:
#   - isaacgomes3@gmail.com
#   - financeiro@arbishield.com
# Demais admins (ex.: icaro@ / carlos@) continuam na Operação, sem Financeiro.
#
# Após criar/promover, aplique o hotfix de ACL:
#   bash <(curl -fsSL ".../scripts/vps-hotfix-finance-acl.sh?v=1")
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-ensure-financeiro-admin.sh?v=2")
#
# Senha inicial (opcional; se omitida e a conta for criada, gera uma aleatória):
#   FINANCEIRO_PASSWORD='SuaSenhaForte' bash <(curl ...?v=2)
set -euo pipefail

EMAIL_FINANCEIRO="${EMAIL_FINANCEIRO:-financeiro@arbishield.com}"
EMAIL_ISAAC="${EMAIL_ISAAC:-isaacgomes3@gmail.com}"
FINANCEIRO_PASSWORD="${FINANCEIRO_PASSWORD:-}"
FINANCEIRO_NAME="${FINANCEIRO_NAME:-Financeiro ArbiShield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need docker
need python3

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  eval "$(
    python3 - "$f" <<'PY'
import shlex, sys
path = sys.argv[1]
keys = {
  "ARBISHIELD_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ARBISHIELD_SUPABASE_URL",
  "API_EXTERNAL_URL",
  "SUPABASE_PUBLIC_URL",
}
text = open(path, "rb").read().decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
out = []
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    if k not in keys:
        continue
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    out.append(f"export {k}={shlex.quote(v)}")
print("\n".join(out))
PY
  )"
}

for f in \
  "${ENV_FILE:-}" \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env \
  /opt/arbishield/.arbishield-odds-sync.env \
  /var/www/arbishield/.env
do
  [[ -n "${f:-}" ]] || continue
  load_env_file "$f" 2>/dev/null || true
done

SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
SUPABASE_URL="$(
  echo "${ARBISHIELD_SUPABASE_URL:-${API_EXTERNAL_URL:-${SUPABASE_PUBLIC_URL:-http://127.0.0.1:8000}}}" \
    | sed 's:/*$::'
)"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY não encontrada (confira /opt/arbishield/deploy/vps-supabase/.env)"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-fin.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

sql_user_id() {
  local email="$1"
  python3 - "$email" <<'PY' | psql_db -At 2>/dev/null | head -1 || true
import sys
email = sys.argv[1].replace("'", "''")
print(f"SELECT id::text FROM auth.users WHERE lower(email)=lower('{email}') LIMIT 1;")
PY
}

auth_create_user() {
  local email="$1" password="$2" name="$3"
  FIN_EMAIL="$email" FIN_PASS="$password" FIN_NAME="$name" \
  SERVICE_KEY="$SERVICE_KEY" SUPABASE_URL="$SUPABASE_URL" \
  python3 <<'PY'
import json, os, urllib.request
url = os.environ["SUPABASE_URL"].rstrip("/") + "/auth/v1/admin/users"
key = os.environ["SERVICE_KEY"]
body = json.dumps({
  "email": os.environ["FIN_EMAIL"],
  "password": os.environ["FIN_PASS"],
  "email_confirm": True,
  "user_metadata": {"full_name": os.environ["FIN_NAME"]},
}).encode()
req = urllib.request.Request(
  url, data=body, method="POST",
  headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
  },
)
with urllib.request.urlopen(req, timeout=30) as res:
  data = json.load(res)
print(data.get("id") or "")
PY
}

grant_admin() {
  local uid="$1" email="$2" name="$3"
  [[ -n "$uid" ]] || die "uid vazio para $email"
  local email_sql name_sql
  email_sql="${email//\'/\'\'}"
  name_sql="${name//\'/\'\'}"
  psql_db <<SQL
INSERT INTO public.profiles (id, full_name, account_status, is_super_admin, created_at, updated_at)
VALUES (
  '${uid}'::uuid,
  COALESCE(NULLIF('${name_sql}',''), 'Admin'),
  'active',
  false,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET account_status = 'active',
    updated_at = now(),
    full_name = COALESCE(NULLIF(public.profiles.full_name,''), EXCLUDED.full_name);

INSERT INTO public.user_roles (user_id, role)
SELECT '${uid}'::uuid, 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = '${uid}'::uuid AND role IN ('admin', 'master_admin')
);

UPDATE auth.users
SET banned_until = NULL,
    updated_at = now()
WHERE id = '${uid}'::uuid;
SQL
  log "admin OK → $email ($uid)"
}

ensure_user_admin() {
  local email="$1" name="$2" create_if_missing="$3"
  log "verificando $email"
  local uid
  uid="$(sql_user_id "$email")"

  if [[ -z "$uid" ]]; then
    if [[ "$create_if_missing" != "1" ]]; then
      log "aviso: $email não existe — não criando"
      return 1
    fi
    local pass="$FINANCEIRO_PASSWORD"
    if [[ -z "$pass" ]]; then
      pass="$(python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits
print("Fin@" + "".join(secrets.choice(alphabet) for _ in range(12)) + "!")
PY
)"
      echo
      echo "======================================================"
      echo " CONTA CRIADA — guarde a senha inicial:"
      echo "  email: $email"
      echo "  senha: $pass"
      echo "======================================================"
      echo
    fi
    log "criando usuário $email via Auth Admin"
    uid="$(auth_create_user "$email" "$pass" "$name" || true)"
    [[ -n "$uid" ]] || die "falha ao criar $email"
  fi

  grant_admin "$uid" "$email" "$name"
  return 0
}

ensure_user_admin "$EMAIL_ISAAC" "Isaac Gomes" 0 || true
ensure_user_admin "$EMAIL_FINANCEIRO" "$FINANCEIRO_NAME" 1

log "admins atuais (inclui financeiro + isaac)"
psql_db <<'SQL'
SELECT u.email, p.full_name, p.is_super_admin, p.account_status,
       array_agg(DISTINCT ur.role) FILTER (WHERE ur.role IS NOT NULL) AS roles
FROM auth.users u
JOIN public.profiles p ON p.id = u.id
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
WHERE lower(u.email) IN ('financeiro@arbishield.com', 'isaacgomes3@gmail.com')
   OR p.is_super_admin IS TRUE
   OR ur.role IN ('admin', 'master_admin')
GROUP BY u.email, p.full_name, p.is_super_admin, p.account_status
ORDER BY u.email;
SQL

log "OK — login: https://arbishield.app/admin/login"
log "  financeiro@arbishield.com  → admin + allowlist Financeiro"
log "  isaacgomes3@gmail.com      → admin + allowlist Financeiro"
log "Obs.: icaro@ / carlos@ e outros admins NÃO entram em Financeiro (hotfix finance-acl)."
log "Aplique: bash <(curl -fsSL \".../scripts/vps-hotfix-finance-acl.sh?v=1\")"
