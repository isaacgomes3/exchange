#!/usr/bin/env bash
# Proteger: grade nao listava jogos atuais (ASC + limit 150 pegava finalizados antigos).
# Tambem alinha createProtection com janela +2h30 pos-kickoff.
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
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

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

log "1/2 UI — app-proteger.html (filtro janela +2h30)"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp_html"
grep -q 'proteger-grade-janela-v8' "$tmp_html" || die "sem marker proteger-grade-janela-v8"
grep -q 'windowStartIso' "$tmp_html" || die "sem windowStartIso"
grep -q 'gte("starts_at"' "$tmp_html" || die "sem gte starts_at"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-grade-janela-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-proteger.html' -print0 2>/dev/null || true)

for f in \
  "$WEB/app-proteger.html" \
  "$WEB_ROOT/app-proteger.html" \
  "$WEB_ROOT/sandbox/app-proteger.html"
do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  if [[ -d "$(dirname "$f")" ]]; then
    cp -f "$tmp_html" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  fi
done
rm -f "$tmp_html"

log "2/2 API — createProtection janela +2h30"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'fora da janela de proteção' "$tmp_pre" || die "prelive sem janela de proteção"
grep -q 'LIVE_WINDOW_MS = 9000' "$tmp_pre" || die "prelive sem LIVE_WINDOW_MS"

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
rm -f "$tmp_pre"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  true

log "OK — Ctrl+Shift+R em /app-proteger.html (ou /v2/app-proteger.html)"
echo "  Celtic/Milan deve aparecer se ainda estiver em +2h30 do kickoff e com liquidez."
