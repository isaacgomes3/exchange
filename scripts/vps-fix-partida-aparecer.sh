#!/usr/bin/env bash
# Repara a(s) partida(s) recém-lançada(s) para aparecer em Proteger Aposta.
# - is_published=true, status=open
# - release_minutes_before=0 (libera na hora do lançamento)
# - liquidez > 0
set -euo pipefail

for f in \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env
do
  [[ -f "$f" ]] || continue
  KEY_LINE=$(grep -E '^(ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)=' "$f" | tail -1 || true)
  URL_LINE=$(grep -E '^(ARBISHIELD_SUPABASE_URL|SUPABASE_URL|API_EXTERNAL_URL)=' "$f" | tail -1 || true)
  [[ -n "${KEY_LINE:-}" ]] && export SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${KEY_LINE#*=}}"
  [[ -n "${URL_LINE:-}" ]] && export SUPABASE_URL="${SUPABASE_URL:-${URL_LINE#*=}}"
done
KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
URL="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}"
URL="${URL%/}"
KEY="${KEY%\"}"; KEY="${KEY#\"}"; KEY="${KEY%\'}"; KEY="${KEY#\'}"
URL="${URL%\"}"; URL="${URL#\"}"
[[ -n "$KEY" ]] || { echo "ERRO: SERVICE_ROLE_KEY ausente"; exit 1; }

export SERVICE_ROLE_KEY="$KEY"
export SUPABASE_URL="$URL"

python3 - <<'PY'
import json, os, urllib.request, urllib.error
from datetime import datetime, timezone

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SERVICE_ROLE_KEY"]
LIVE_MS = 9000 * 1000

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        f"{url}{path}",
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:400]}")

_, rows = req(
    "GET",
    "/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,markets,max_protection_cents,used_protection_cents,metadata&order=starts_at.desc&limit=30",
)
now = datetime.now(timezone.utc).timestamp() * 1000
fixed = 0

def why(m):
    reasons = []
    if m.get("is_published") is not True:
        reasons.append("não publicado")
    if m.get("deleted_at"):
        reasons.append("deleted")
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    try:
        rel = float(meta.get("release_minutes_before") or 0)
    except Exception:
        rel = 0
    start = None
    try:
        start = datetime.fromisoformat(str(m.get("starts_at")).replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        reasons.append("starts_at inválido")
        start = None
    if start is not None and rel > 0 and now < start - rel * 60000:
        reasons.append(f"trava release {int(rel)}min (ainda não liberou)")
    st = str(m.get("status_v2") or m.get("status") or "open").lower()
    if st in ("finished", "closed", "cancelled", "settled", "finalizado", "void"):
        reasons.append(f"status={st}")
    maxc = int(m.get("max_protection_cents") or 0)
    used = int(m.get("used_protection_cents") or 0)
    if not (maxc > 0 and used < maxc):
        reasons.append(f"sem liquidez max={maxc} used={used}")
    if start is not None and start + LIVE_MS <= now:
        reasons.append("fora da janela (+2h30)")
    return reasons, rel, start

print("==> Últimas partidas / diagnóstico")
for m in rows or []:
    reasons, rel, start = why(m)
    mark = "OCULTA" if reasons else "VISÍVEL"
    print(f"  [{mark}] {m.get('home_team')} × {m.get('away_team')}  id={m.get('id')}")
    print(f"         pub={m.get('is_published')} rel={rel} max={m.get('max_protection_cents')} starts={m.get('starts_at')}")
    if reasons:
        print(f"         motivos: {'; '.join(reasons)}")

# Repara as 5 mais recentes admin_manual / não visíveis
print("\n==> Reparando (publicar + release 0 + open + liq)")
for m in (rows or [])[:8]:
    reasons, rel, start = why(m)
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    # só repara se parece lançamento recente/manual ou está oculta
    src = str(meta.get("source") or "")
    if reasons or src in ("admin_manual", "manual") or meta.get("sandbox_test"):
        markets = m.get("markets") if isinstance(m.get("markets"), list) else []
        maxc = int(m.get("max_protection_cents") or 0)
        if maxc <= 0 and markets:
            maxc = sum(int(x.get("liquidity") or 0) for x in markets)
        if maxc <= 0:
            maxc = 200000  # R$ 2.000
            if not markets:
                markets = [{
                    "id": None,
                    "name": "Mercado principal",
                    "odd": 1.1,
                    "liquidity": maxc,
                    "used_liquidity": 0,
                    "market_type": "BACK",
                }]
        meta = {
            **meta,
            "source": meta.get("source") or "admin_manual",
            "release_minutes_before": 0,
        }
        body = {
            "is_published": True,
            "deleted_at": None,
            "status": "open",
            "status_v2": "open",
            "max_protection_cents": maxc,
            "used_protection_cents": 0,
            "markets": markets,
            "metadata": meta,
        }
        try:
            code, _ = req("PATCH", f"/rest/v1/matches?id=eq.{m['id']}", body)
        except SystemExit as e:
            # retry sem deleted_at
            body.pop("deleted_at", None)
            code, _ = req("PATCH", f"/rest/v1/matches?id=eq.{m['id']}", body)
        fixed += 1
        print(f"  OK fix {m.get('id')} → {m.get('home_team')} × {m.get('away_team')}")

print(f"\nOK — {fixed} partida(s) ajustada(s)")
print("Abrir: https://arbishield.app/app-proteger.html  (Ctrl+Shift+R)")
PY
