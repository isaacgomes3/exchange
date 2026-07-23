#!/usr/bin/env bash
# Credita saldo na carteira Desafio de um e-mail (para testes).
#
# Na VPS:
#   EMAIL=seu@email.com REAIS=500 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-credit-desafio-teste.sh?v=1")
set -euo pipefail

EMAIL="${EMAIL:-}"
REAIS="${REAIS:-500}"
[[ -n "$EMAIL" ]] || { echo "ERRO: informe EMAIL=..."; exit 1; }

ENV_FILE="${ENV_FILE:-/opt/arbishield/deploy/vps-supabase/.env}"
[[ -f "$ENV_FILE" ]] || { echo "ERRO: sem $ENV_FILE"; exit 1; }

eval "$(
  python3 - "$ENV_FILE" <<'PY'
import shlex, sys
keys = {
  "ARBISHIELD_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ARBISHIELD_SUPABASE_URL",
  "API_EXTERNAL_URL",
  "SUPABASE_PUBLIC_URL",
}
text = open(sys.argv[1], "rb").read().decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
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
    v = v.strip()
    if k not in keys:
        continue
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    print(f"export {k}={shlex.quote(v)}")
PY
)"

SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-${API_EXTERNAL_URL:-${SUPABASE_PUBLIC_URL:-http://127.0.0.1:8000}}}"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || { echo "ERRO: SERVICE_ROLE_KEY vazia"; exit 1; }

python3 - "$SUPABASE_URL" "$SERVICE_KEY" "$EMAIL" "$REAIS" <<'PY'
import json, sys, urllib.request, urllib.error
from datetime import datetime, timezone

base, key, email, reais = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3].strip().lower(), float(sys.argv[4])
cents = max(0, int(round(reais * 100)))

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(r, timeout=60) as res:
        raw = res.read().decode() or "null"
        return json.loads(raw) if raw != "null" else None

# Resolve user id
users = req(
    "GET",
    f"/auth/v1/admin/users?page=1&per_page=200",
)
# GoTrue admin list shape varies
uid = None
lst = []
if isinstance(users, dict):
    lst = users.get("users") or []
elif isinstance(users, list):
    lst = users
for u in lst:
    if str(u.get("email") or "").strip().lower() == email:
        uid = u.get("id")
        break
if not uid:
    # fallback: profiles don't have email — try rpc-less scan via auth
    raise SystemExit(f"ERRO: usuário não encontrado para {email}")

prof = req("GET", f"/rest/v1/profiles?select=id,desafio_balance_cents&id=eq.{uid}&limit=1") or []
p = prof[0] if prof else None
if not p:
    raise SystemExit("ERRO: profile não encontrado")
bal = int(p.get("desafio_balance_cents") or 0)
nxt = bal + cents
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
req("PATCH", f"/rest/v1/profiles?id=eq.{uid}", {"desafio_balance_cents": nxt, "updated_at": now})
# Marca depósito PIX desafio APPROVED para passar na regra PIX-only
try:
    req(
        "POST",
        "/rest/v1/manual_deposits",
        {
            "user_id": uid,
            "amount_cents": cents,
            "status": "APPROVED",
            "network": "PIX",
            "deposit_type": "desafio",
            "admin_notes": "crédito teste VPS",
        },
    )
except Exception as ex:
    print("aviso: não criou manual_deposits:", ex)

print(f"OK {email}: desafio_balance {bal} → {nxt} cents ( + R$ {cents/100:.2f} )")
PY
