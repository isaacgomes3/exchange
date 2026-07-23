#!/usr/bin/env bash
# Garante admin financeiro: financeiro@arbishield.com + isaacgomes3@gmail.com
#
# No sistema NÃO existe role "só Financeiro" — admin vê o bloco Financeiro
# (e o restante do painel admin).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-ensure-financeiro-admin.sh?v=1")
#
# Senha inicial (só se a conta for criada agora):
#   FINANCEIRO_PASSWORD='SuaSenhaForte' bash <(curl ...?v=1)
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

# --- carrega SERVICE_ROLE (mesmo padrão dos hotfixes) ---
load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local k="${BASH_REMATCH[2]}"
      local v="${BASH_REMATCH[3]}"
      v="${v%\"}" ; v="${v#\"}"
      v="${v%\'}" ; v="${v#\'}"
      case "$k" in
        ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|ARBISHIELD_SUPABASE_URL|API_EXTERNAL_URL|SUPABASE_PUBLIC_URL|ANON_KEY|SUPABASE_ANON_KEY)
          if [[ -z "${!k:-}" ]]; then export "$k=$v"; fi
          ;;
      esac
    fi
  done < "$f"
}

for f in \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env \
  /opt/arbishield/.arbishield-odds-sync.env \
  /var/www/arbishield/.env
do
  load_env_file "$f"
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
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" \
    || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

auth_get_user_id() {
  local email="$1"
  curl -fsS \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    "$SUPABASE_URL/auth/v1/admin/users?page=1&per_page=200" \
    | python3 -c '
import json,sys
email=sys.argv[1].lower().strip()
data=json.load(sys.stdin)
users=data.get("users") if isinstance(data, dict) else data
for u in users or []:
  if str(u.get("email") or "").lower()==email:
    print(u.get("id") or "")
    break
' "$email" 2>/dev/null || true
}

auth_create_user() {
  local email="$1" password="$2" name="$3"
  curl -fsS -X POST \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    "$SUPABASE_URL/auth/v1/admin/users" \
    -d "$(python3 - <<PY
import json
print(json.dumps({
  "email": "$email",
  "password": """$password""",
  "email_confirm": True,
  "user_metadata": {"full_name": """$name"""},
}))
PY
)" | python3 -c 'import json,sys; u=json.load(sys.stdin); print(u.get("id") or "")'
}

grant_admin() {
  local uid="$1" email="$2" name="$3"
  [[ -n "$uid" ]] || die "uid vazio para $email"
  psql_db <<SQL
-- perfil
INSERT INTO public.profiles (id, full_name, account_status, is_super_admin, created_at, updated_at)
VALUES (
  '$uid'::uuid,
  COALESCE(NULLIF('$name',''), 'Admin'),
  'active',
  false,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET account_status = 'active',
    updated_at = now(),
    full_name = COALESCE(NULLIF(public.profiles.full_name,''), EXCLUDED.full_name);

-- role admin (Financeiro + painel admin)
INSERT INTO public.user_roles (user_id, role)
SELECT '$uid'::uuid, 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles
  WHERE user_id = '$uid'::uuid AND role IN ('admin', 'master_admin')
);

-- garante não banido no Auth
UPDATE auth.users
SET banned_until = NULL,
    updated_at = now()
WHERE id = '$uid'::uuid;
SQL
  log "admin OK → $email ($uid)"
}

ensure_user_admin() {
  local email="$1" name="$2" create_if_missing="$3"
  log "verificando $email"
  local uid
  uid="$(auth_get_user_id "$email")"
  if [[ -z "$uid" ]]; then
    # fallback SQL (Auth Admin list pode paginar)
    uid="$(
      echo "SELECT id::text FROM auth.users WHERE lower(email)=lower('$email') LIMIT 1;" \
        | psql_db -At 2>/dev/null | head -1 || true
    )"
  fi

  if [[ -z "$uid" ]]; then
    if [[ "$create_if_missing" != "1" ]]; then
      die "conta $email não existe e create_if_missing=0"
    fi
    local pass="$FINANCEIRO_PASSWORD"
    if [[ -z "$pass" ]]; then
      pass="$(python3 - <<'PY'
import secrets,string
alphabet=string.ascii_letters+string.digits
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
    log "criando usuário $email"
    uid="$(auth_create_user "$email" "$pass" "$name")"
    [[ -n "$uid" ]] || die "falha ao criar $email via Auth Admin"
  fi

  grant_admin "$uid" "$email" "$name"
}

# Isaac: só promove (não cria senha nova)
ensure_user_admin "$EMAIL_ISAAC" "Isaac Gomes" 0 || {
  log "aviso: $EMAIL_ISAAC não encontrado — pulando criação"
}

# Financeiro: cria se não existir
ensure_user_admin "$EMAIL_FINANCEIRO" "$FINANCEIRO_NAME" 1

log "lista final de admins (financeiro + isaac)"
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

log "OK — login admin: https://arbishield.app/admin/login"
log "  financeiro@arbishield.com  (admin → menu Financeiro)"
log "  isaacgomes3@gmail.com      (já existente / promovido)"
