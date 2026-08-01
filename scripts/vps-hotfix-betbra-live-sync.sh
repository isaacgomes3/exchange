#!/usr/bin/env bash
# Sync placar/tempo BetBra (inplay) -> matches ArbiShield.
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
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

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
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

log "1/3 lib + prelive (sync inplay)"
install_lib "scripts/lib/betbra-inplay-sync.mjs"
if ! grep -q 'DO_NOT_CHANGE_PROTECTION_FLOW' "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" 2>/dev/null; then
  install_lib "scripts/lib/protection-flow-contract.mjs"
fi

tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
rm -f "$tmp_pre"

grep -q 'betbra-inplay-sync' "$PRELIVE_DST" || die "prelive sem sync inplay"
grep -q 'match-live-sync' "$PRELIVE_DST" || die "prelive sem endpoint match-live-sync"
grep -q 'score_sync_enabled: true' "$PRELIVE_DST" || die "prelive sem score_sync_enabled true"
grep -q 'BETBRA_INPLAY_SYNC_VERSION' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib betbra-inplay-sync ausente"

log "2/3 UI"
publish_web "deploy/vps-supabase/static/v2/admin-jogos.html"
publish_web "deploy/vps-supabase/static/v2/app-proteger.html"
grep -qE 'matchLiveInfo|admin-jogos-betbra-live-sync|admin-jogos-sem-fila-default' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem live sync UI"
grep -q 'metadata.live' "$WEB/app-proteger.html" || die "app-proteger sem metadata.live"

log "3/3 restart servico + nginx"
for svc in \
  arbishield-prelive-events.service \
  arbishield-prelive-events-teste.service \
  arbishield-serverfn-shim.service \
  arbishield-serverfn-shim-teste.service; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}"; then
    systemctl restart "$svc" || true
    log "restart $svc"
  fi
done
sleep 2

patched=0
while IFS= read -r -d '' conf; do
  if grep -q 'api/arbishield/matches' "$conf" 2>/dev/null \
    && ! grep -q 'api/arbishield/match-live-sync' "$conf" 2>/dev/null; then
    cp -a "$conf" "${conf}.bak-live-sync-$(date +%s)" || true
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

kick_ok=0
for url in \
  "http://127.0.0.1:3098/api/arbishield/match-live-sync" \
  "http://127.0.0.1:3198/api/arbishield/match-live-sync"; do
  if curl -fsS -m 15 -X POST "$url" \
    -H "Content-Type: application/json" -d "{}" >/tmp/arbishield-live-sync-kick.json 2>/dev/null; then
    log "sync kick OK via $url"
    head -c 240 /tmp/arbishield-live-sync-kick.json; echo
    kick_ok=1
    break
  fi
done
if [[ "$kick_ok" -ne 1 ]]; then
  log "aviso: kick sync falhou - confira: systemctl status arbishield-prelive-events"
fi

health_ok=0
for url in "http://127.0.0.1:3098/health" "http://127.0.0.1:3198/health"; do
  H="$(curl -fsS -m 5 "$url" 2>/dev/null || true)"
  if echo "$H" | grep -q "inplaySync"; then
    log "health OK ($url): inplaySync presente"
    echo "$H" | head -c 300; echo
    health_ok=1
    break
  fi
done
if [[ "$health_ok" -ne 1 ]]; then
  log "aviso: /health ainda sem inplaySync"
fi

log "OK - Ctrl+Shift+R em admin-jogos e app-proteger"
