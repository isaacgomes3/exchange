#!/usr/bin/env bash
# Cria 1 jogo teste na PRODUÇÃO (BACK+LAY @ 1.10).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-criar-jogo-prod.sh?$(date +%s)")
set -euo pipefail

# Lê KEY=VAL do .env sem source (evita "Organization: command not found")
read_env_key() {
  local want="$1" file val
  for file in \
    "${ENV_FILE:-}" \
    /opt/arbishield/deploy/vps-supabase/.env \
    /opt/arbishield/.env \
    /opt/arbishield-teste/.env
  do
    [[ -n "${file:-}" && -f "$file" ]] || continue
    val="$(
      grep -E "^${want}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/\r$//' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
    )"
    if [[ -n "${val:-}" ]]; then
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
URL="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-}}}"
[[ -n "$KEY" ]] || KEY="$(read_env_key ARBISHIELD_SERVICE_ROLE_KEY || true)"
[[ -n "$KEY" ]] || KEY="$(read_env_key SERVICE_ROLE_KEY || true)"
[[ -n "$KEY" ]] || KEY="$(read_env_key SUPABASE_SERVICE_ROLE_KEY || true)"
[[ -n "$URL" ]] || URL="$(read_env_key ARBISHIELD_SUPABASE_URL || true)"
[[ -n "$URL" ]] || URL="$(read_env_key SUPABASE_URL || true)"
[[ -n "$URL" ]] || URL="$(read_env_key API_EXTERNAL_URL || true)"
URL="${URL:-http://127.0.0.1:8000}"
URL="${URL%/}"

[[ -n "$KEY" ]] || { echo "ERRO: SERVICE_ROLE_KEY ausente no .env"; exit 1; }

export SERVICE_ROLE_KEY="$KEY"
export SUPABASE_URL="$URL"
export TEST_ODD="${TEST_ODD:-1.1}"
export TEST_LIQ_CENTS="${TEST_LIQ_CENTS:-500000}"
export TEST_MINUTES_AHEAD="${TEST_MINUTES_AHEAD:-45}"
export TEST_HOME="${TEST_HOME:-ArbiShield Teste A}"
export TEST_AWAY="${TEST_AWAY:-ArbiShield Teste B}"

echo "==> Criando jogo teste PRODUÇÃO @ ${TEST_ODD} (kickoff +${TEST_MINUTES_AHEAD} min)"
echo "    supabase: $URL"

python3 - <<'PY'
import json, os, urllib.request, uuid
from datetime import datetime, timedelta, timezone

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_ROLE_KEY"]
odd = float(os.environ["TEST_ODD"])
liq = int(os.environ["TEST_LIQ_CENTS"])
mins = int(os.environ["TEST_MINUTES_AHEAD"])
starts = (datetime.now(timezone.utc) + timedelta(minutes=mins)).strftime("%Y-%m-%dT%H:%M:%SZ")

body = {
    "home_team": os.environ["TEST_HOME"],
    "away_team": os.environ["TEST_AWAY"],
    "league": "SANDBOX · Evento teste",
    "starts_at": starts,
    "status": "open",
    "status_v2": "open",
    "is_published": True,
    "sport_type": "futebol",
    "max_protection_cents": liq,
    "used_protection_cents": 0,
    "protection_odds": {"home": odd, "away": odd},
    "external_id": f"sandbox-test-{int(datetime.now().timestamp())}",
    "metadata": {
        "source": "admin_manual",
        "sandbox_test": True,
        "billing_model_hint": "fee_upfront_v1",
        "release_minutes_before": 0,
    },
    "markets": [
        {
            "id": str(uuid.uuid4()),
            "name": "Back · Teste",
            "odd": odd,
            "liquidity": liq,
            "used_liquidity": 0,
            "market_type": "BACK",
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Lay · Teste",
            "odd": odd,
            "liquidity": liq,
            "used_liquidity": 0,
            "market_type": "LAY",
        },
    ],
}

def post(payload):
    req = urllib.request.Request(
        f"{url}/rest/v1/matches",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

code, data = post(body)
if code >= 400:
    body.pop("external_id", None)
    print("  aviso:", str(data)[:180], "→ retry sem external_id")
    code, data = post(body)

if code >= 400:
    raise SystemExit(f"ERRO {code}: {data}")

row = data[0] if isinstance(data, list) else data
print("OK id:", row.get("id"))
print("   ", row.get("home_team"), "×", row.get("away_team"))
print("    começa:", row.get("starts_at"))
print("    publicado:", row.get("is_published"))
print()
print("Abrir PRODUÇÃO → https://arbishield.app/app-proteger.html")
print("  filtro Todos · buscar ArbiShield Teste · F5")
PY
