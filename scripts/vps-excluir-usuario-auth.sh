#!/usr/bin/env bash
# Exclui conta Auth (GoTrue) e libera o e-mail para novo cadastro.
#
# Na VPS (root):
#   EMAIL='danilomc1@live.com' CONFIRM=EXCLUIR \
#     bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#       "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-excluir-usuario-auth.sh?ref=cursor/esqueci-senha-9ff2&t=$(date +%s)")
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

export SUPABASE_URL SERVICE_KEY EMAIL KEEP_PROFILE
log "excluir Auth de $EMAIL (CONFIRM=EXCLUIR)"

python3 <<'PY'
import json, os, urllib.request, urllib.error, urllib.parse, subprocess, shutil

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_KEY"]
email = os.environ["EMAIL"].strip().lower()
keep_profile = os.environ.get("KEEP_PROFILE", "0") == "1"

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
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {"error": raw[:400]}
        raise SystemExit(f"HTTP {e.code} {path}: {data}")

def list_users():
    found = None
    page = 1
    while page <= 40:
        status, listing = req("GET", f"/auth/v1/admin/users?page={page}&per_page=200")
        batch = listing.get("users") if isinstance(listing, dict) else listing
        batch = batch or []
        if not batch:
            break
        for u in batch:
            if str(u.get("email") or "").lower() == email:
                found = u
                break
        if found:
            break
        page += 1
    return found

user = list_users()
if not user:
    raise SystemExit(f"Usuário não encontrado em auth.users: {email}")

uid = user["id"]
print(f"user_id:     {uid}")
print(f"email:       {user.get('email')}")
print(f"created_at:  {user.get('created_at')}")
print(f"last_sign:   {user.get('last_sign_in_at')}")
print(f"confirmed:   {user.get('email_confirmed_at')}")

# Hard delete — libera o e-mail para novo signUp
try:
    status, _ = req(
        "DELETE",
        f"/auth/v1/admin/users/{uid}?should_soft_delete=false",
    )
    print(f"DELETE admin/users (hard) HTTP {status}")
except SystemExit as e:
    print(f"(aviso hard delete: {e})")
    status, _ = req("DELETE", f"/auth/v1/admin/users/{uid}")
    print(f"DELETE admin/users HTTP {status}")

# Confirma que o e-mail sumiu
again = list_users()
if again:
    raise SystemExit(
        f"FALHA: e-mail ainda existe após delete (id={again.get('id')}). "
        "Verifique soft-delete / identities."
    )
print("OK — e-mail liberado em auth.users")

# Best-effort: remove profile do mesmo id (não tem coluna email)
if keep_profile:
    print("KEEP_PROFILE=1 — profile preservado")
else:
    try:
        status, _ = req("DELETE", f"/rest/v1/profiles?id=eq.{uid}")
        print(f"profiles DELETE HTTP {status}")
    except SystemExit as e:
        print(f"(aviso profiles: {e})")

# Best-effort SQL: limpa identities órfãs / soft-delete residual se docker disponível
if shutil.which("docker"):
    try:
        names = subprocess.check_output(
            ["docker", "ps", "--format", "{{.Names}}"], text=True
        )
        db = next(
            (n for n in names.splitlines() if "db" in n or "postgres" in n),
            None,
        )
        if db:
            email_sql = email.replace("'", "''")
            sql = f"""
SELECT count(*) AS still_auth FROM auth.users WHERE lower(email)=lower('{email_sql}');
SELECT count(*) AS still_ident
FROM auth.identities
WHERE lower(coalesce(identity_data->>'email',''))=lower('{email_sql}');
"""
            out = subprocess.check_output(
                [
                    "docker", "exec", "-i", db,
                    "psql", "-U", "postgres", "-d", "postgres", "-At",
                ],
                input=sql,
                text=True,
            )
            print("SQL check:")
            print(out.strip() or "(vazio)")
    except Exception as e:
        print(f"(aviso sql check: {e})")

print("Pronto. O e-mail pode ser usado em /cadastro.html")
PY
