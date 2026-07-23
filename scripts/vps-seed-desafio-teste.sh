#!/usr/bin/env bash
# Cria (ou repara) um desafio de teste publicado COM jogo na etapa 1.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-seed-desafio-teste.sh?v=4")
set -euo pipefail

echo "==> seed-desafio-teste v4 (cria/repara com etapa)"
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

home_logo = "https://r2.thesportsdb.com/images/media/team/badge/yvwvtr1420652851.png"
away_logo = "https://r2.thesportsdb.com/images/media/team/badge/vyyvwt1420653033.png"
home_team = "Botafogo"
away_team = "Santos"
match_label = f"{home_team} x {away_team}"

casa_odd = 1.90
profit_pct = 5
inv = 1.0 / (1.0 + profit_pct / 100.0)
arbi_odd = round(1.0 / (inv - 1.0 / casa_odd), 3)

kickoff_dt = datetime.now(timezone.utc) + timedelta(hours=3)
kickoff = kickoff_dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
stamp = datetime.now(timezone.utc).strftime("%H:%M")

def build_step(desafio_id):
    # Não enviar colunas que não existem no schema (ex.: used_liquidity_cents)
    return {
        "desafio_id": desafio_id,
        "step_index": 1,
        "match_label": match_label,
        "league_name": "Brasileirão Série A",
        "home_team": home_team,
        "away_team": away_team,
        "home_logo_url": home_logo,
        "away_logo_url": away_logo,
        "market_name": "Vitória do Santos",
        "market_name_casa": "Vitória do Santos",
        "market_name_arbishield": "Dupla chance Botafogo ou Empate",
        "home_odd": arbi_odd,
        "away_odd": casa_odd,
        "arbi_team_name": home_team,
        "arbi_team_logo_url": home_logo,
        "arbi_odd": arbi_odd,
        "casa_team_name": away_team,
        "casa_team_logo_url": away_logo,
        "casa_odd": casa_odd,
        "casa_stake_cents": 21053,
        "arbi_commission_pct": 0,
        "casa_commission_pct": 0,
        "liquidity_cents": 800000,
        "display_liquidity_cents": 800000,
        "external_bet_link": "https://www.bet365.com/",
        "starts_at": kickoff,
        "release_minutes_before": 180,
        "status": "pending",
        "is_published": True,
    }

# 1) Repara desafio ativo sem etapas (ex.: Botafogo órfão da v3)
orphans = req(
    "GET",
    "/rest/v1/desafios?select=id,number,title,desafio_steps(id)&deleted_at=is.null&is_active=eq.true&order=number.desc",
) or []
repaired = False
did = None
for d in orphans:
    steps = d.get("desafio_steps") or []
    if steps:
        continue
    did = d["id"]
    print(f"==> reparando #{d.get('number')} {d.get('title')} ({did}) — sem etapas")
    # Atualiza título para o jogo de teste
    req(
        "PATCH",
        f"/rest/v1/desafios?id=eq.{did}",
        {
            "title": match_label,
            "subtitle": f"Desafio teste · reparado {stamp} UTC",
            "total_steps": 5,
            "target_profit_pct": profit_pct,
            "initial_balance_cents": 20000,
            "updated_at": now,
        },
    )
    step_out = req("POST", "/rest/v1/desafio_steps", build_step(did))
    sid = (step_out[0] if isinstance(step_out, list) else step_out)["id"]
    print(f"==> etapa 1 criada: {sid}")
    repaired = True
    break

if not repaired:
    rows = req("GET", "/rest/v1/desafios?select=number&order=number.desc&limit=1") or []
    nxt = (int(rows[0]["number"]) + 1) if rows and rows[0].get("number") is not None else 1
    desafio = {
        "number": nxt,
        "title": match_label,
        "subtitle": f"Desafio teste · criado {stamp} UTC · etapas avançam por cliente",
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
    print(f"==> desafio criado: {did}  #{nxt}  {match_label}")
    step_out = req("POST", "/rest/v1/desafio_steps", build_step(did))
    sid = (step_out[0] if isinstance(step_out, list) else step_out)["id"]
    print(f"==> etapa 1 criada: {sid}")

# 2) Confirma que a etapa existe
check = req(
    "GET",
    f"/rest/v1/desafios?select=id,number,title,is_active,desafio_steps(id,step_index,status,match_label,starts_at,release_minutes_before)&id=eq.{did}&limit=1",
) or []
if not check or not (check[0].get("desafio_steps") or []):
    raise SystemExit("ERRO: desafio ficou sem etapas após o seed")
steps = check[0]["desafio_steps"]
print(f"==> OK confirmado: #{check[0].get('number')} {check[0].get('title')} — {len(steps)} etapa(s)")
print(f"==> odd casa {casa_odd} → arbi {arbi_odd} (lucro {profit_pct}%)")
print(f"==> kickoff UTC: {kickoff}  (release 180 min → entrada já liberada)")
print("OK — Ctrl+F5 em /app-desafio.html e /admin-desafios.html")
PY
