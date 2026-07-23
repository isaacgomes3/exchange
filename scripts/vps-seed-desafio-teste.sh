#!/usr/bin/env bash
# Cria 1 desafio de teste publicado (Flamengo x Palmeiras) para ver o card no app.
#
# Na VPS:
#   ENV_FILE=/opt/arbishield/deploy/vps-supabase/.env bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-seed-desafio-teste.sh?v=2")
set -euo pipefail

echo "==> seed-desafio-teste v2"
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
echo "==> Supabase: $SUPABASE_URL"

python3 - "$SUPABASE_URL" "$SERVICE_KEY" <<'PY'
import json, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

base = sys.argv[1].rstrip("/")
key = sys.argv[2]

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
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read().decode() or "null"
            return json.loads(raw) if raw != "null" else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {path}: {e.read().decode()}") from e

# Logos públicos TheSportsDB (Flamengo / Palmeiras) — badges atuais
home_logo = "https://r2.thesportsdb.com/images/media/team/badge/syptwx1473538074.png"
away_logo = "https://r2.thesportsdb.com/images/media/team/badge/vsqwqp1473538105.png"

# Se já existe Flamengo x Palmeiras ativo, só corrige as logos
existing = req(
    "GET",
    "/rest/v1/desafios?select=id,desafio_steps(id)&title=eq.Flamengo x Palmeiras&deleted_at=is.null&is_active=eq.true&limit=1",
) or []
if existing:
    did = existing[0]["id"]
    steps = existing[0].get("desafio_steps") or []
    print(f"==> já existe ativo: {did} — atualizando logos")
    if steps:
        sid = steps[0]["id"]
        req(
            "PATCH",
            f"/rest/v1/desafio_steps?id=eq.{sid}",
            {
                "home_logo_url": home_logo,
                "away_logo_url": away_logo,
                "home_team": "Flamengo",
                "away_team": "Palmeiras",
                "match_label": "Flamengo x Palmeiras",
            },
        )
        print(f"==> logos atualizadas no jogo {sid}")
    print("OK — Ctrl+F5 em /app-desafio.html")
    raise SystemExit(0)

# Próximo número
rows = req("GET", "/rest/v1/desafios?select=number&order=number.desc&limit=1") or []
nxt = (int(rows[0]["number"]) + 1) if rows and rows[0].get("number") is not None else 1

kickoff = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

casa_odd = 1.85
profit_pct = 10
arbi_odd = round(casa_odd * (1 + profit_pct / 100), 2)

desafio = {
    "number": nxt,
    "title": "Flamengo x Palmeiras",
    "subtitle": "Desafio teste — card visual",
    "total_steps": 5,
    "initial_balance_cents": 20000,
    "is_active": True,
    "status": "active",
    "target_profit_pct": profit_pct,
    "auto_link_matches": True,
    "published_at": now,
    "deleted_at": None,
}

created = req("POST", "/rest/v1/desafios", desafio)
row = created[0] if isinstance(created, list) else created
did = row["id"]
print(f"==> desafio criado: {did}  #{nxt}")

step = {
    "desafio_id": did,
    "step_index": 1,
    "match_label": "Flamengo x Palmeiras",
    "league_name": "Brasileirão Série A",
    "home_team": "Flamengo",
    "away_team": "Palmeiras",
    "home_logo_url": home_logo,
    "away_logo_url": away_logo,
    "market_name": "Mais 2.5 gols na partida",
    "market_name_casa": "Mais 2.5 gols na partida",
    "market_name_arbishield": "Menos 2.5 gols na partida",
    "home_odd": arbi_odd,
    "away_odd": casa_odd,
    "arbi_team_name": "Menos 2.5",
    "arbi_team_logo_url": None,
    "arbi_odd": arbi_odd,
    "casa_team_name": "Mais 2.5",
    "casa_team_logo_url": None,
    "casa_odd": casa_odd,
    "casa_stake_cents": 10000,
    "arbi_commission_pct": 0,
    "casa_commission_pct": 4.5,
    "liquidity_cents": 1500000,
    "display_liquidity_cents": 25000000,
    "external_bet_link": "https://www.bet365.com/",
    "starts_at": kickoff,
    "release_minutes_before": 60,
    "status": "pending",
    "is_published": True,
}
step_out = req("POST", "/rest/v1/desafio_steps", step)
sid = (step_out[0] if isinstance(step_out, list) else step_out)["id"]
print(f"==> jogo criado: {sid}")
print(f"==> odd casa {casa_odd} → arbi {arbi_odd} (lucro {profit_pct}%)")
print(f"==> kickoff UTC: {kickoff}")
print("OK — abra /app-desafio.html (Ctrl+F5) e /admin-desafios.html")
PY
