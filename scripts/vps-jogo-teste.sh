#!/usr/bin/env bash
# Cria 1 jogo teste (BACK+LAY @ 1.10) — só curl + python3.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-jogo-teste.sh?$(date +%s)")
set -euo pipefail

for f in \
  "${ENV_FILE:-}" \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env \
  /opt/arbishield-teste/.env
do
  [[ -n "${f:-}" && -f "$f" ]] || continue
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$f" | sed 's/\r$//')
  set +a
done

KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
URL="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}"
URL="${URL%/}"
[[ -n "$KEY" ]] || { echo "ERRO: SERVICE_ROLE_KEY ausente"; exit 1; }

export TEST_ODD="${TEST_ODD:-1.1}"
export TEST_LIQ_CENTS="${TEST_LIQ_CENTS:-500000}"
export TEST_MINUTES_AHEAD="${TEST_MINUTES_AHEAD:-45}"
export TEST_HOME="${TEST_HOME:-ArbiShield Teste A}"
export TEST_AWAY="${TEST_AWAY:-ArbiShield Teste B}"
export SUPABASE_URL="$URL"
export SERVICE_ROLE_KEY="$KEY"

echo "==> Criando jogo teste @ ${TEST_ODD} (kickoff +${TEST_MINUTES_AHEAD} min)"

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
        err = e.read().decode()
        return e.code, err

code, data = post(body)
if code >= 400:
    body.pop("external_id", None)
    print("  aviso:", str(data)[:200], "→ retry sem external_id")
    code, data = post(body)

if code >= 400:
    raise SystemExit(f"ERRO {code}: {data}")

row = data[0] if isinstance(data, list) else data
print("OK id:", row.get("id"))
print("   ", row.get("home_team"), "×", row.get("away_team"))
print("    começa:", row.get("starts_at"))
print("    publicado:", row.get("is_published"))
print()
print("Abrir → https://arbishield.app/sandbox/app-proteger.html")
print("       filtro Todos · buscar ArbiShield Teste · F5")
PY
