#!/usr/bin/env bash
# Desafio: detectar fim de jogo (FT) e mostrar V/× nos mercados.
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-desafio-ft-result.sh?$(date +%s)")
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

log "1/3 lib inplay v5 (infer FT)"
install_lib "scripts/lib/betbra-inplay-sync.mjs"
grep -q 'betbra-inplay-sync-v5' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem v5"
grep -q 'inferMatchFinished' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem inferMatchFinished"

log "2/3 prelive-events"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
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

log "3/3 UI app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-ft-result-v1' "$tmp_html" || die "UI sem marker desafio-ft-result-v1"
grep -q 'ageMin >= 105' "$tmp_html" || die "UI sem heurística FT"
cp -f "$tmp_html" "$WEB/app-desafio.html"
cp -f "$tmp_html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html"
while IFS= read -r -d '' f; do
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)
rm -f "$tmp_html"
echo "  OK $WEB/app-desafio.html"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
sleep 2

curl -sS -o /tmp/dz-ft-sync.json -w "match-live-sync HTTP %{http_code}\n" --max-time 30 \
  "http://127.0.0.1:3098/api/arbishield/match-live-sync" || true
head -c 350 /tmp/dz-ft-sync.json; echo

log "OK. Ctrl+Shift+R em /app-desafio.html — marker desafio-ft-result-v1"
log "BTTS 0-1 no FT: NÃO = V, SIM = ×"
