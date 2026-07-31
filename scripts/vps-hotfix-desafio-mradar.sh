#!/usr/bin/env bash
# Integra radar de movimento (mradar) no Desafio: API + nginx + UI.
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-desafio-mradar.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

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
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install_lib() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  for dest in \
    "$SCRIPTS_DIR/lib/$name" \
    "$SHIM_DIR/lib/$name" \
    "$SHIM_DIR/scripts/lib/$name"; do
    mkdir -p "$(dirname "$dest")"
    cp -f "$tmp" "$dest"
    chmod 0644 "$dest"
    echo "  OK $dest"
  done
  rm -f "$tmp"
}

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
  grep -qE 'desafio-mradar-v2|desafio-live-pack-v[12]|desafio-ft-result-v[12]' "$tmp" \
    || die "UI sem marker de desafio/radar"
  grep -q 'data-radar' "$tmp" || die "UI sem bloco data-radar"
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  chmod 0644 "$WEB/$name"
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $WEB/$name ($(wc -c < "$WEB/$name" | tr -d ' ') bytes)"
}

log "1/4 lib + prelive (eventsRadar v3+)"
install_lib "scripts/lib/betbra-events-radar.mjs"
# Aceita v2/v3/... (evita falha quando o script cacheado pede v2 e a lib já é v3)
grep -qE 'betbra-events-radar-v[0-9]+' "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  || die "lib sem marker betbra-events-radar-v*"
grep -q 'eventIdSportRadar' "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  || die "lib sem suporte SportRadar (baixe de novo o hotfix)"

tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'desafio-mradar' "$tmp_pre" || die "prelive sem desafio-mradar"
grep -q 'resolveMradarForEventId' "$tmp_pre" || die "prelive sem resolve"
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

log "2/4 UI app-desafio.html"
publish_web "deploy/vps-supabase/static/v2/app-desafio.html"

log "3/4 nginx — rotas mradar"
patched=0
while IFS= read -r -d '' conf; do
  if grep -q 'api/arbishield/match-live-sync' "$conf" 2>/dev/null \
    && ! grep -q 'api/arbishield/desafio-mradar' "$conf" 2>/dev/null; then
    cp -a "$conf" "${conf}.bak-dz-mradar-$(date +%s)" || true
    CONF_PATH="$conf" python3 - <<'PY'
from pathlib import Path
import os
p = Path(os.environ["CONF_PATH"])
t = p.read_text(encoding="utf-8", errors="replace")
needle = "location = /api/arbishield/match-score-sync"
idx = t.find(needle)
if idx < 0:
    needle = "location = /api/arbishield/match-live-sync"
    idx = t.find(needle)
if idx < 0:
    raise SystemExit(0)
# end of that location block
i = t.find("{", idx)
depth = 0
j = i
while j < len(t):
    if t[j] == "{":
        depth += 1
    elif t[j] == "}":
        depth -= 1
        if depth == 0:
            j += 1
            break
    j += 1
block = """

    # Radar de movimento Soft2Bet (eventsRadar -> mradar)
    location = /api/arbishield/betbra-events-radar {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }
    location = /api/arbishield/betbra-movimento {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }
    location = /api/arbishield/desafio-mradar {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }
"""
p.write_text(t[:j] + block + t[j:], encoding="utf-8")
print("  patched", p)
PY
    patched=$((patched + 1))
  fi
done < <(find /etc/nginx -type f \( -name "*.conf" -o -name "*arbishield*" \) -print0 2>/dev/null || true)

if [[ "$patched" -gt 0 ]]; then
  nginx -t && systemctl reload nginx || log "aviso: nginx reload falhou"
else
  log "nginx: rota ja presente ou conf nao encontrada"
fi

log "4/4 restart prelive"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  systemctl restart arbishield-matches.service 2>/dev/null || \
  log "aviso: reinicie o prelive manualmente"
sleep 2

code=$(curl -sS -o /tmp/dz-mradar.json -w '%{http_code}' --max-time 20 \
  "http://127.0.0.1:3098/api/arbishield/betbra-events-radar" 2>/dev/null || echo 000)
echo "  local events-radar → HTTP $code"
head -c 300 /tmp/dz-mradar.json 2>/dev/null; echo
[[ "$code" == "200" || "$code" == "502" ]] || die "endpoint local falhou (code=$code)"

curl -sS -o /tmp/dz-mradar-pub.json -w "public desafio-mradar HTTP %{http_code}\n" --max-time 20 \
  "https://arbishield.app/api/arbishield/desafio-mradar" || true
head -c 200 /tmp/dz-mradar-pub.json 2>/dev/null; echo

# smoke lookup (Degerfors ou qualquer eventId do feed)
curl -sS -o /tmp/dz-mradar-lookup.json -w "lookup HTTP %{http_code}\n" --max-time 25 \
  "http://127.0.0.1:3098/api/arbishield/desafio-mradar?force=1&eventId=33842537216900023&link=https://betbra.bet.br/b/exchange/sport/soccer/event/33842537216900023" \
  || true
head -c 400 /tmp/dz-mradar-lookup.json 2>/dev/null; echo
if grep -q '"found":true' /tmp/dz-mradar-lookup.json 2>/dev/null; then
  log "lookup OK (found=true)"
else
  log "aviso: lookup found!=true — confira feed eventsRadar"
fi

log "OK. Abra /app-desafio.html (Ctrl+Shift+R) e toque em «Radar do jogo» num card ao vivo."
log "Marker: desafio-live-pack-v1 (ou mradar-v2) / betbra-events-radar-v3+"
