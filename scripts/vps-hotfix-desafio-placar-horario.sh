#!/usr/bin/env bash
# Desafio: placar + tempo ao vivo (UI v4 + sync BetBra + nginx match-live-sync).
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

log "1/4 lib + prelive + shim"
tmp_lib="$(mktemp)"; tmp_pre="$(mktemp)"; tmp_shim="$(mktemp)"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$tmp_lib"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'betbra-inplay-sync-v4' "$tmp_lib" || die "lib sem v4"
grep -q 'coerceInplayFeed' "$tmp_lib" || die "lib sem coerceInplayFeed"
grep -q 'slimPatch' "$tmp_lib" || die "lib sem slimPatch"
grep -q 'buildDesafioStepInplayPatch' "$tmp_lib" || die "lib sem buildDesafioStepInplayPatch"
grep -q 'loadDesafioStepsForInplaySync' "$tmp_pre" || die "prelive sem loadDesafioStepsForInplaySync"
grep -q 'fetchBetbraEventInplayInfo' "$tmp_pre" || die "prelive sem fallback por eventId"
grep -q 'lastDesafioListLiveSyncMs' "$tmp_pre" || die "prelive sem sync na listagem desafios"
grep -q 'desafioStepEligibleForInplaySync' "$tmp_pre" || die "prelive sem sync desafio"
grep -q 'betbra_event_id' "$tmp_shim" || die "shim sem betbra_event_id em steps"

for dest in \
  "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-inplay-sync.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_lib" "$tmp_pre" "$tmp_shim"

log "2/4 UI app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-placar-horario-v4' "$tmp_html" || die "sem marker desafio-placar-horario-v4"
grep -q 'stepLiveInfo' "$tmp_html" || die "sem stepLiveInfo"
grep -q 'dz-v2-score' "$tmp_html" || die "sem dz-v2-score"
grep -q 'withinMatchWindow' "$tmp_html" || die "sem deteccao ao vivo por horario"
while IFS= read -r -d '' f; do
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)
for f in "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "3/4 nginx match-live-sync"
patched=0
while IFS= read -r -d '' conf; do
  if grep -q 'api/arbishield/matches' "$conf" 2>/dev/null \
    && ! grep -q 'api/arbishield/match-live-sync' "$conf" 2>/dev/null; then
    cp -a "$conf" "${conf}.bak-dz-live-$(date +%s)" || true
    CONF_PATH="$conf" python3 -c '
from pathlib import Path
import os, re
p = Path(os.environ["CONF_PATH"])
t = p.read_text(encoding="utf-8", errors="replace")
block = """location = /api/arbishield/matches {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }

    # Sync placar/tempo BetBra (inplay) - Node :3098
    location = /api/arbishield/match-live-sync {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }
    location = /api/arbishield/match-score-sync {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }"""
m = re.search(r"location = /api/arbishield/matches\s*\{", t)
if not m:
    raise SystemExit(0)
start = m.start()
i = t.find("{", m.end() - 1)
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
p.write_text(t[:start] + block + t[j:], encoding="utf-8")
print("  patched", p)
'
    patched=$((patched + 1))
  fi
done < <(find /etc/nginx -type f \( -name "*.conf" -o -name "*arbishield*" \) -print0 2>/dev/null || true)
if [[ "$patched" -gt 0 ]]; then
  nginx -t && systemctl reload nginx || log "aviso: nginx reload falhou"
else
  log "nginx: rota ja presente ou conf nao encontrada"
fi

log "4/4 restart + kick sync"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true
sleep 2

kick_ok=0
for url in \
  "http://127.0.0.1:3098/api/arbishield/match-live-sync" \
  "http://127.0.0.1:3198/api/arbishield/match-live-sync"; do
  if curl -fsS -m 20 -X POST "$url" \
    -H "Content-Type: application/json" -d "{}" >/tmp/arbishield-dz-live-sync.json 2>/dev/null; then
    log "sync kick OK via $url"
    head -c 360 /tmp/arbishield-dz-live-sync.json; echo
    kick_ok=1
    break
  fi
done
if [[ "$kick_ok" -ne 1 ]]; then
  # fallback GET
  for url in \
    "http://127.0.0.1:3098/api/arbishield/match-live-sync" \
    "http://127.0.0.1:3198/api/arbishield/match-live-sync"; do
    if curl -fsS -m 20 "$url" >/tmp/arbishield-dz-live-sync.json 2>/dev/null; then
      log "sync kick OK (GET) via $url"
      head -c 360 /tmp/arbishield-dz-live-sync.json; echo
      kick_ok=1
      break
    fi
  done
fi
if [[ "$kick_ok" -ne 1 ]]; then
  log "aviso: kick sync falhou - confira: systemctl status arbishield-prelive-events"
fi

# smoke publico (se nginx ja liberou)
curl -sS -o /tmp/dz-public-sync.json -w "public match-live-sync GET HTTP %{http_code}\n" \
  "https://arbishield.app/api/arbishield/match-live-sync" || true
head -c 200 /tmp/dz-public-sync.json 2>/dev/null; echo

log "OK — Ctrl+Shift+R em /app-desafio.html"
echo "  Tempo: Ao vivo · Nm' (mesmo sem BetBra)."
echo "  Placar: aparece apos sync BetBra (link /event/ID no step)."
echo "  Hotfix: bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}/scripts/vps-hotfix-desafio-placar-horario.sh)"
