#!/usr/bin/env bash
# Trava a API de logo na PRODUÇÃO (worker + nginx) pra NÃO sumir no próximo deploy.
#   GET /api/arbishield/football-teams?q=Flamengo
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-restaurar-api-logo-times.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
TS="$(date +%s)"
RAW_SHA="https://raw.githubusercontent.com/isaacgomes3/exchange"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

SHA="$(curl -fsS "https://api.github.com/repos/isaacgomes3/exchange/commits/${REF}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha','')[:40])" 2>/dev/null || true)"
[[ -n "$SHA" ]] || SHA="$REF"
log "ref $REF @ ${SHA:0:12}"

PRELIVE=""
for c in \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs
do
  [[ -f "$c" ]] && PRELIVE="$c" && break
done
[[ -n "$PRELIVE" ]] || die "prelive não encontrado"

BK="/opt/arbishield/backups/logo-api-$TS"
mkdir -p "$BK"
cp -a "$PRELIVE" "$BK/" 2>/dev/null || true

log "1) Worker prelive (rota football-teams + stake_lock_v1)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW_SHA/${SHA}/scripts/arbishield-prelive-events.mjs?v=$TS" \
  -o "$PRELIVE"
chmod 0755 "$PRELIVE"
grep -q 'searchFootballTeams' "$PRELIVE" || die "sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$PRELIVE" || die "sem rota football-teams"
grep -q 'stake_lock_v1' "$PRELIVE" || die "perdeu stake_lock_v1"
grep -q 'protection-runtime-stake-lock-v10\|create-protection-stake-lock-v6' "$PRELIVE" \
  || die "prelive sem marker runtime stake_lock v10"
# Anti-regressão: não republicar fee_upfront como create vigente
if grep -qE 'protection-fee-upfront-v[0-9]+' "$PRELIVE" && \
   ! grep -q 'createProtectionModel: "stake_lock_v1"\|PROTECTION_BILLING_MODEL_CANONICAL' "$PRELIVE"; then
  die "prelive parece fee_upfront vigente — abortado sob v10"
fi
cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$PRELIVE" /opt/arbishield/arbishield-prelive-events.mjs 2>/dev/null || true

log "2) Nginx — location football-teams permanente"
python3 - <<'PY'
from pathlib import Path
block = """
    # Busca de times + logos (Admin) — NÃO remover
    location /api/arbishield/football-teams {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 30s;
    }
"""
candidates = [
    Path("/etc/nginx/sites-available/arbishield.app"),
    Path("/etc/nginx/sites-enabled/arbishield.app"),
    Path("/etc/nginx/conf.d/arbishield.app.conf"),
]
# também qualquer conf que mencione arbishield + prelive-events
for p in list(Path("/etc/nginx").rglob("*.conf")):
    try:
        t = p.read_text(encoding="utf-8", errors="replace")
    except Exception:
        continue
    if "arbishield" in t and "prelive-events" in t:
        candidates.append(p)

seen = set()
patched = 0
for p in candidates:
    rp = str(p.resolve()) if p.exists() else ""
    if not rp or rp in seen or not p.exists():
        continue
    seen.add(rp)
    t = p.read_text(encoding="utf-8", errors="replace")
    if "football-teams" in t:
        print("  nginx ok:", p)
        continue
    if "prelive-events" not in t:
        continue
    # backup
    bak = Path(str(p) + f".bak-logo-{__import__('time').time_ns()}")
    bak.write_text(t, encoding="utf-8")
    i = t.find("location /api/arbishield/prelive-events")
    if i < 0:
        print("  skip (sem prelive loc):", p)
        continue
    j = t.find("}", i)
    if j < 0:
        continue
    t2 = t[: j + 1] + "\n" + block + t[j + 1 :]
    p.write_text(t2, encoding="utf-8")
    print("  nginx PATCH:", p)
    patched += 1
print(f"  nginx patched={patched}")
PY

nginx -t
systemctl reload nginx

log "3) UI Admin (busca logo no browser, sem depender do nginx)"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
mkdir -p "$WEB"
curl -fsSL --retry 3 \
  "$RAW_SHA/${SHA}/deploy/vps-supabase/static/v2/admin-jogos.html?v=$TS" \
  -o "$WEB/admin-jogos.html"
curl -fsSL --retry 3 \
  "$RAW_SHA/${SHA}/deploy/vps-supabase/static/v2/v2.js?v=$TS" \
  -o "$WEB/v2.js"
cp -f "$WEB/admin-jogos.html" /var/www/arbishield/admin-jogos.html 2>/dev/null || true
cp -f "$WEB/v2.js" /var/www/arbishield/v2.js 2>/dev/null || true
grep -q 'searchFootballTeams' "$WEB/v2.js" || die "v2.js sem searchFootballTeams"
grep -q 'ArbiV2.searchFootballTeams\|thesportsdb' "$WEB/admin-jogos.html" \
  || grep -q 'football-teams' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem busca de times"

log "4) Restart worker"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  die "falha restart prelive"
sleep 1

BODY="$(curl -fsS --max-time 12 "http://127.0.0.1:3098/api/arbishield/football-teams?q=Flamengo" || true)"
echo "$BODY" | grep -q '"ok":true' || die "worker falhou: $BODY"
echo "$BODY" | grep -qi 'Flamengo' || die "worker sem Flamengo: $BODY"

PUB="$(curl -fsS --max-time 12 "https://arbishield.app/api/arbishield/football-teams?q=Flamengo" || true)"
echo "$PUB" | grep -q '"ok":true' || die "nginx público falhou: $PUB"

H="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health 2>/dev/null || true)"
echo "$H" | grep -q 'stake_lock_v1' || die "health sem stake_lock_v1: $H"
echo "$H" | grep -qE 'protection-runtime-stake-lock-v10|create-protection-stake-lock-v6' \
  || die "health sem marker stake_lock: $H"
echo "$H" | grep -qE 'protection-fee-upfront-v[0-9]+' && die "REGRESSÃO fee_upfront no health: $H" || true

log "OK — logo API travada (worker + nginx + UI) sob stake_lock_v1"
echo "  Digite Flamengo no Admin → Lançar evento (Ctrl+Shift+R)"
echo "  Health: $H"
