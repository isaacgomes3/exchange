#!/usr/bin/env bash
# Redefine senha de um usuário Auth (Supabase GoTrue admin API).
# Invalida o uso da senha antiga; a pessoa precisa logar de novo.
#
# Na VPS (root), escolha a NOVA senha e rode:
#   NEW_PASSWORD='SuaSenhaForteAqui' EMAIL='isaacgomes3@gmail.com' \
#     bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#       "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-reset-senha-usuario.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
#
# Ou local na VPS:
#   NEW_PASSWORD='...' EMAIL='isaacgomes3@gmail.com' bash /opt/arbishield/scripts/vps-reset-senha-usuario.sh
set -euo pipefail

EMAIL="${EMAIL:-isaacgomes3@gmail.com}"
NEW_PASSWORD="${NEW_PASSWORD:-}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
[[ -n "$NEW_PASSWORD" ]] || die "defina NEW_PASSWORD='sua_nova_senha'"
[[ "${#NEW_PASSWORD}" -ge 8 ]] || die "NEW_PASSWORD deve ter pelo menos 8 caracteres"
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
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente"
[[ -n "$SUPABASE_URL" ]] || die "SUPABASE_URL ausente"

export SUPABASE_URL SERVICE_KEY EMAIL NEW_PASSWORD
log "redefinir senha de $EMAIL"
python3 <<'PY'
import json, os, urllib.request, urllib.error

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_KEY"]
email = os.environ["EMAIL"].strip().lower()
new_password = os.environ["NEW_PASSWORD"]

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
        with urllib.request.urlopen(r, timeout=30) as res:
            raw = res.read().decode()
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {"error": raw[:400]}
        raise SystemExit(f"HTTP {e.code} {path}: {data}")

# 1) achar usuário
status, listing = req("GET", f"/auth/v1/admin/users?page=1&per_page=200")
users = listing.get("users") if isinstance(listing, dict) else None
if users is None and isinstance(listing, list):
    users = listing
users = users or []
user = next((u for u in users if str(u.get("email") or "").lower() == email), None)

# fallback: varrer páginas
page = 2
while user is None and page <= 20:
    status, listing = req("GET", f"/auth/v1/admin/users?page={page}&per_page=200")
    batch = listing.get("users") if isinstance(listing, dict) else listing
    batch = batch or []
    if not batch:
        break
    user = next((u for u in batch if str(u.get("email") or "").lower() == email), None)
    page += 1

if not user:
    raise SystemExit(f"Usuário não encontrado: {email}")

uid = user["id"]
print(f"user_id: {uid}")
print(f"email:    {user.get('email')}")
print(f"role:     {user.get('role')}")
print(f"last:     {user.get('last_sign_in_at')}")

# 2) atualizar senha
status, updated = req(
    "PUT",
    f"/auth/v1/admin/users/{uid}",
    {
        "password": new_password,
        "email_confirm": True,
    },
)
print(f"senha atualizada (HTTP {status})")

# 3) ban curto + unban para forçar queda de refresh tokens antigos (best-effort)
from datetime import datetime, timedelta, timezone
ban_until = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
try:
    req("PUT", f"/auth/v1/admin/users/{uid}", {"ban_duration": "5s"})
except SystemExit as e:
    print(f"(aviso ban_duration: {e})")
    try:
        req("PUT", f"/auth/v1/admin/users/{uid}", {"banned_until": ban_until})
    except SystemExit as e2:
        print(f"(aviso banned_until: {e2})")

import time
time.sleep(6)
try:
    req("PUT", f"/auth/v1/admin/users/{uid}", {"ban_duration": "none"})
except SystemExit:
    try:
        req("PUT", f"/auth/v1/admin/users/{uid}", {"banned_until": None})
    except SystemExit as e:
        print(f"(aviso unban: {e})")

print("OK — senha redefinida.")
print("Próximos passos:")
print("  1) No navegador: sair do admin / limpar dados de arbishield.app")
print("  2) Login de novo só no SEU PC com a nova senha")
print("  3) Não compartilhe a senha; use conta admin separada por pessoa")
PY
