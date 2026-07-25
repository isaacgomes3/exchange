#!/usr/bin/env bash
# Restaura a API de logo dos times em PRODUÇÃO:
#   GET /api/arbishield/football-teams?q=Flamengo
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-restaurar-api-logo-times.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
# SHA pin evita cache stale do raw.githubusercontent
SHA="${ARBISHIELD_SHA:-78cd0ec}"
RAW_SHA="https://raw.githubusercontent.com/isaacgomes3/exchange"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

PRELIVE=""
for c in \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs
do
  [[ -f "$c" ]] && PRELIVE="$c" && break
done
[[ -n "$PRELIVE" ]] || die "prelive não encontrado em /opt/arbishield"

# Descobre SHA mais recente da branch (fallback pin)
LATEST="$(curl -fsS "https://api.github.com/repos/isaacgomes3/exchange/commits/${REF}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha','')[:12])" 2>/dev/null || true)"
[[ -n "$LATEST" ]] && SHA="$LATEST"

BK="/opt/arbishield/backups/logo-api-$TS"
mkdir -p "$BK"
cp -a "$PRELIVE" "$BK/"
log "Backup → $BK"
log "Baixando prelive @ $SHA"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW_SHA/${SHA}/scripts/arbishield-prelive-events.mjs?v=$TS" \
  -o "$PRELIVE"
chmod 0755 "$PRELIVE"
grep -q 'searchFootballTeams' "$PRELIVE" || die "arquivo sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$PRELIVE" || die "arquivo sem rota football-teams"
grep -q 'fee_upfront_v1\|isFeeUpfrontProtection' "$PRELIVE" || die "arquivo perdeu fee_upfront"

cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$PRELIVE" /opt/arbishield/arbishield-prelive-events.mjs 2>/dev/null || true

# UI admin com fallback browser
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
if [[ -d "$WEB" ]]; then
  curl -fsSL --retry 3 \
    "$RAW_SHA/${SHA}/deploy/vps-supabase/static/v2/admin-jogos.html?v=$TS" \
    -o "$WEB/admin-jogos.html" || true
  curl -fsSL --retry 3 \
    "$RAW_SHA/${SHA}/deploy/vps-supabase/static/v2/v2.js?v=$TS" \
    -o "$WEB/v2.js" || true
  cp -f "$WEB/admin-jogos.html" /var/www/arbishield/admin-jogos.html 2>/dev/null || true
fi

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  die "falha ao reiniciar prelive"
sleep 1

BODY="$(curl -fsS --max-time 12 "http://127.0.0.1:3098/api/arbishield/football-teams?q=Flamengo" || true)"
echo "$BODY" | grep -q '"ok":true' || die "API ainda falhou: $BODY"
echo "$BODY" | grep -qi 'Flamengo' || die "API sem Flamengo: $BODY"
log "OK — logo API no ar"
echo "  Teste: digite Flamengo em Admin → Lançar evento"
echo "  Health: $(curl -fsS http://127.0.0.1:3098/health 2>/dev/null || true)"
