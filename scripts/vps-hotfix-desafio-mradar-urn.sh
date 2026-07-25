#!/usr/bin/env bash
# Radar Desafio: usa URN sr:match:N (evita "widget não encontrado" com id numérico).
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-mradar-urn.sh?ref=cursor/desafio-mradar-urn-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-mradar-urn-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
PRELIVE_PORT="${ARBISHIELD_PRELIVE_PORT:-3098}"
TEST_EVENT="${ARBISHIELD_MRADAR_TEST_EVENT:-33868199054900023}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/4 lib events-radar v4 (URN sr:match)"
tmp_lib="$(mktemp)"
download_repo_file "scripts/lib/betbra-events-radar.mjs" "$tmp_lib"
grep -q 'betbra-events-radar-v4' "$tmp_lib" || die "lib sem marker v4"
grep -q 'sr:match' "$tmp_lib" || die "lib sem URN sr:match"
# pick deve devolver URN, nao so digitos
grep -qE 'normalizeSportRadarMatchId\(hit\.eventIdSportRadar\)' "$tmp_lib" \
  || die "lib sem pick URN (ainda extrai so numero?)"
for dest in \
  "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-events-radar.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
# espelhar em qualquer copia ativa sob /opt
while IFS= read -r -d '' f; do
  cp -f "$tmp_lib" "$f"
  echo "  OK $f"
done < <(find /opt /var/www -type f -name 'betbra-events-radar.mjs' -print0 2>/dev/null || true)
rm -f "$tmp_lib"

log "2/4 prelive (endpoint desafio-mradar)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'desafio-mradar' "$tmp_pre" || die "prelive sem desafio-mradar"
grep -q 'betbra-events-radar' "$tmp_pre" || die "prelive sem import radar"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 UI app-desafio"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_ui"
grep -qE 'desafio-mradar-urn-v1|data-radar-next' "$tmp_ui" || die "UI sem marker mradar-urn"
cp -f "$tmp_ui" "$WEB/app-desafio.html"
cp -f "$tmp_ui" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html"
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"
  chmod 0644 "$f"
done < <(find /var/www -type f -name "app-desafio.html" -print0 2>/dev/null || true)
rm -f "$tmp_ui"

log "4/4 reiniciar prelive :${PRELIVE_PORT}"
restarted=0
for svc in arbishield-prelive-events arbishield-prelive prelive-events arbishield-matches; do
  if systemctl list-unit-files 2>/dev/null | grep -qE "^${svc}\\.service"; then
    systemctl restart "$svc" && restarted=1 && echo "  restarted systemd:$svc" || true
  fi
done
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-prelive-events 2>/dev/null && restarted=1 && echo "  restarted pm2:arbishield-prelive-events" || true
  pm2 restart prelive-events 2>/dev/null && restarted=1 && echo "  restarted pm2:prelive-events" || true
  pm2 restart arbishield-prelive 2>/dev/null && restarted=1 && echo "  restarted pm2:arbishield-prelive" || true
fi
# fallback: matar processo node do prelive para o unit/supervisor subir de novo
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
  restarted=1
  echo "  pkill arbishield-prelive-events.mjs"
  sleep 2
  # se systemd/pm2 nao respawnar, sobe nohup a partir do scripts dir
  if ! curl -fsS --max-time 2 "http://127.0.0.1:${PRELIVE_PORT}/api/arbishield/desafio-mradar?eventId=1" >/dev/null 2>&1; then
    if [[ -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]]; then
      nohup node "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
        >"/var/log/arbishield-prelive-events.log" 2>&1 &
      echo "  nohup node $SCRIPTS_DIR/arbishield-prelive-events.mjs (pid $!)"
      sleep 2
    fi
  fi
fi
[[ "$restarted" -eq 1 ]] || echo "  aviso: nenhum restart automatico — reinicie o node :${PRELIVE_PORT} manualmente"

sleep 2
verify_url="http://127.0.0.1:${PRELIVE_PORT}/api/arbishield/desafio-mradar?force=1&eventId=${TEST_EVENT}"
code=$(curl -sS -o /tmp/desafio_mradar_verify.json -w '%{http_code}' --max-time 25 "$verify_url" 2>/dev/null || echo 000)
echo "  local GET desafio-mradar → HTTP $code"
head -c 500 /tmp/desafio_mradar_verify.json 2>/dev/null; echo
[[ "$code" == "200" ]] || die "endpoint local nao respondeu 200 (code=$code). Reinicie o prelive na porta ${PRELIVE_PORT}."
grep -q 'betbra-events-radar-v4' /tmp/desafio_mradar_verify.json \
  || die "ainda nao e v4 — processo prelive nao carregou a lib nova"
grep -q 'sr%3Amatch%3A\|sr:match:' /tmp/desafio_mradar_verify.json \
  || die "mradarUrl sem URN sr:match"

log "OK radar URN v4 ativo"
log "Marker UI: desafio-mradar-urn-v1 · lib: betbra-events-radar-v4"
log "Publico: curl -sS 'https://arbishield.app/api/arbishield/desafio-mradar?force=1&eventId=${TEST_EVENT}' | head -c 400"
log "Esperado: version=betbra-events-radar-v4 e mradarUrl com id=sr%3Amatch%3A…"
log "Depois: Ctrl+Shift+R em /app-desafio.html"
