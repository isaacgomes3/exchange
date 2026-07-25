#!/usr/bin/env bash
# Hotfix: religa catálogo/API BetBra no worker :3098
# v3: autocomplete manual com mercados/odd LAY|BACK + link BetBra
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/BRANCH_OR_SHA/scripts/vps-hotfix-reconectar-betbra-api.sh?v=3")
#
# Se a VPS estiver fora do Brasil e a BetBra bloquear (Cloudflare),
# configure proxy em /opt/arbishield/.arbishield-odds-sync.env:
#   FULLTBET_USE_OUTBOUND_PROXY=1
#   FULLTBET_PROXY=http://user:pass@host:port
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/reconectar-betbra-api-3cf9}"
REF="${ARBISHIELD_REF:-cursor/reconectar-betbra-api-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
PRELIVE_DIR="${ARBISHIELD_PRELIVE_DIR:-/opt/arbishield}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
ENV_FILE="${ARBISHIELD_ODDS_ENV:-/opt/arbishield/.arbishield-odds-sync.env}"
MARKER="betbra-api-v3"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR" "$WEB" "$WEB_ROOT"

log "Prelive :3098 ($MARKER) ref=$REF"
PRELIVE_DST="$PRELIVE_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true

grep -q "$MARKER" "$PRELIVE_DST" || die "prelive sem $MARKER"
grep -q 'async function listPreliveEventsForDay' "$PRELIVE_DST" \
  || die "prelive sem listPreliveEventsForDay"
grep -q 'async function createMatchFromMarket' "$PRELIVE_DST" \
  || die "prelive sem createMatchFromMarket"
grep -q 'async function createManualMatch' "$PRELIVE_DST" \
  || die "prelive sem createManualMatch (manual deve continuar)"
grep -q 'MANUAL_EXTERNAL_ID_CONFLICT' "$PRELIVE_DST" \
  || die "prelive sem guarda anti-mistura manual×BetBra"
grep -q 'function runnerOddsDetail' "$PRELIVE_DST" \
  || die "prelive sem runnerOddsDetail (LAY/BACK no autocomplete manual)"
grep -q 'layOdd' "$PRELIVE_DST" \
  || die "prelive sem layOdd no payload de mercados"
! grep -q 'Catálogo BetBra removido' "$PRELIVE_DST" \
  || die "prelive ainda retorna 410 do catálogo"

# Garante env BetBra (não sobrescreve se já existir)
if [[ -f "$ENV_FILE" ]]; then
  log "env BetBra em $ENV_FILE"
  ensure_env() {
    local k="$1" v="$2"
    if ! grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
      echo "${k}=${v}" >> "$ENV_FILE"
      log "  + $k"
    fi
  }
  ensure_env "MEXCHANGE_API_BASE_URL" "https://mexchange-api.betbra.bet.br/api"
  ensure_env "EXCHANGE_SITE_ORIGIN" "https://betbra.bet.br"
  ensure_env "MEXCHANGE_REFERER" "https://mexchange.betbra.bet.br/"
  ensure_env "MEXCHANGE_BOT_USER_AGENT" "BOT/SOFTWARE;ArbiShield;1.0"
  ensure_env "MEXCHANGE_BIAB_LANGUAGE" "PT_BR"
  ensure_env "FULLTBET_SOCCER_SPORT_ID" "15"
else
  log "AVISO: $ENV_FILE não existe — BetBra usará defaults do script"
fi

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
sleep 1

log "UI admin-jogos.html (lista plataforma + catálogo BetBra separados)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" \
  -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'preliveLiquidityBrl' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem campo de liquidez BetBra"
grep -q '/api/arbishield/prelive-events' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem chamada prelive-events"
grep -q 'function renderPlatformList' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem renderPlatformList (lista de manuais/plataforma)"
grep -q 'function matchBucket' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem matchBucket"
grep -q 'badge manual' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem badge Manual"
grep -q 'não misture' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem aviso de não misturar"
grep -q 'manBetbraSearch' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem autocomplete BetBra no lançamento manual"
grep -q 'manExternalBetLink' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem campo de link do mercado"

log "health"
BODY="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
echo "$BODY" | grep -q "$MARKER" || die "health sem $MARKER: $BODY"

log "smoke prelive-events"
CODE="$(curl -sS -o /tmp/prelive-smoke.json -w '%{http_code}' --max-time 45 \
  http://127.0.0.1:3098/api/arbishield/prelive-events || echo 000)"
echo "  HTTP $CODE"
if [[ "$CODE" != "200" ]]; then
  head -c 400 /tmp/prelive-smoke.json 2>/dev/null || true
  echo
  die "prelive-events HTTP $CODE (se Cloudflare/geo, configure FULLTBET_PROXY)"
fi
python3 - <<'PY'
import json
d=json.load(open("/tmp/prelive-smoke.json"))
items=d.get("items") or d.get("events") or []
print(f"  ok={d.get('ok')} itens={len(items) if isinstance(items,list) else '?'}")
if isinstance(items, list) and items:
    e=items[0]
    print("  exemplo:", e.get("homeTeam") or e.get("home_team"), "x", e.get("awayTeam") or e.get("away_team"))
PY

echo
echo "OK — BetBra + autocomplete manual ($MARKER)"
echo "  https://arbishield.app/v2/admin-jogos.html  → Lançar evento manual (Ctrl+F5)"
echo "  Busque na BetBra, escolha LAY/BACK — salva como evento MANUAL."
