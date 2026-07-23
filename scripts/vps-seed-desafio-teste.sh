#!/usr/bin/env bash
# Cria desafio de teste COM liquidez e horário futuro (não vem “ao vivo”).
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-seed-desafio-teste.sh?v=6")
set -euo pipefail

echo "==> seed-desafio-teste v6 (liquidez + kickoff futuro)"
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
        headers={"Content-Type": "application/json", "Accept": "application/json"},
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
# 12h no futuro + release 24h → entrada liberada agora, sem virar ao vivo
kickoff = (datetime.now(timezone.utc) + timedelta(hours=12)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
stamp = datetime.now(timezone.utc).strftime("%H:%M")
home_logo = "https://r2.thesportsdb.com/images/media/team/badge/yvwvtr1420652851.png"
away_logo = "https://r2.thesportsdb.com/images/media/team/badge/vyyvwt1420653033.png"
match_label = "Botafogo x Santos"

body = {
    "title": match_label,
    "subtitle": f"Teste liquidez · {stamp} UTC",
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
            "liquidity_cents": 5000000,
            "display_liquidity_cents": 5000000,
            "external_bet_link": "https://www.bet365.com/",
            "starts_at": kickoff,
            "release_minutes_before": 1440,
            "status": "pending",
            "is_published": True,
        }
    ],
}

code, data = http("POST", "/api/arbishield/desafios", body)
d = (data or {}).get("desafio") or {}
steps = d.get("desafio_steps") or []
print(f"==> HTTP {code}  #{d.get('number')} {d.get('title')}")
if not steps:
    raise SystemExit("ERRO: sem etapas")
s = steps[0]
print(f"==> liquidez R$ {int(s.get('liquidity_cents') or 0)/100:.2f}")
print(f"==> kickoff {s.get('starts_at')}  release {s.get('release_minutes_before')} min")
print("OK — Ctrl+F5 em /app-desafio.html")
print("Para apostar, credite saldo Desafio (carteira R$ 0 bloqueia o teste):")
print("  EMAIL=seu@email.com REAIS=500 bash <(curl -fsSL \"https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-credit-desafio-teste.sh?v=1\")")
PY
