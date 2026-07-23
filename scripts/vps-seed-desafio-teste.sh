#!/usr/bin/env bash
# Cria desafio de teste via API do app (mesmo caminho do admin) — sempre com etapa.
#
# Na VPS ou de qualquer máquina:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-seed-desafio-teste.sh?v=5")
#
# Ou só:
#   API=https://arbishield.app bash <(curl ...?v=5)
set -euo pipefail

echo "==> seed-desafio-teste v5 (API /api/arbishield/desafios)"
API="${API:-https://arbishield.app}"
API="${API%/}"

python3 - "$API" <<'PY'
import json, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

api = sys.argv[1].rstrip("/")

def http(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        api + path,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read().decode() or "null"
            return res.status, json.loads(raw) if raw != "null" else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {path}: {e.read().decode()[:600]}") from e

casa_odd = 1.90
profit_pct = 5
inv = 1.0 / (1.0 + profit_pct / 100.0)
arbi_odd = round(1.0 / (inv - 1.0 / casa_odd), 3)
kickoff = (datetime.now(timezone.utc) + timedelta(hours=3)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
stamp = datetime.now(timezone.utc).strftime("%H:%M")

home_logo = "https://r2.thesportsdb.com/images/media/team/badge/yvwvtr1420652851.png"
away_logo = "https://r2.thesportsdb.com/images/media/team/badge/vyyvwt1420653033.png"
match_label = "Botafogo x Santos"

# Desativa ativos órfãos (sem etapas) para não poluir o admin
code, rows = http("GET", "/api/arbishield/desafios")
rows = rows if isinstance(rows, list) else []
for x in rows:
    if x.get("deleted_at"):
        continue
    steps = x.get("desafio_steps") or []
    if x.get("is_active") and not steps:
        print(f"==> desativando órfão #{x.get('number')} {x.get('title')}")
        http(
            "POST",
            "/api/arbishield/desafios",
            {
                "id": x["id"],
                "title": x.get("title") or "Desafio",
                "is_active": False,
                "status": "draft",
                "total_steps": x.get("total_steps") or 5,
                "initial_balance_cents": x.get("initial_balance_cents") or 20000,
                "target_profit_pct": x.get("target_profit_pct") or 5,
                "steps": [],
            },
        )

body = {
    "title": match_label,
    "subtitle": f"Desafio teste · {stamp} UTC",
    "total_steps": 5,
    "initial_balance_cents": 20000,
    "is_active": True,
    "status": "active",
    "target_profit_pct": profit_pct,
    "steps": [
        {
            "step_index": 1,
            "match_label": match_label,
            "league_name": "Brasileirão Série A",
            "home_team": "Botafogo",
            "away_team": "Santos",
            "home_logo_url": home_logo,
            "away_logo_url": away_logo,
            "market_name": "Vitória do Santos",
            "market_name_casa": "Vitória do Santos",
            "market_name_arbishield": "Dupla chance Botafogo ou Empate",
            "home_odd": arbi_odd,
            "away_odd": casa_odd,
            "arbi_team_name": "Botafogo",
            "arbi_team_logo_url": home_logo,
            "arbi_odd": arbi_odd,
            "casa_team_name": "Santos",
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
    ],
}

code, data = http("POST", "/api/arbishield/desafios", body)
d = (data or {}).get("desafio") or data or {}
steps = d.get("desafio_steps") or []
print(f"==> HTTP {code}  #{d.get('number')} {d.get('title')}  active={d.get('is_active')}")
print(f"==> etapas: {len(steps)}")
if not steps:
    raise SystemExit("ERRO: criado sem etapas")
s = steps[0]
print(f"==> etapa 1: {s.get('id')}  status={s.get('status')}  starts={s.get('starts_at')}")
print(f"==> odds casa {casa_odd} / arbi {arbi_odd} (lucro {profit_pct}%)")
print("OK — Ctrl+F5 em https://arbishield.app/app-desafio.html")
PY
