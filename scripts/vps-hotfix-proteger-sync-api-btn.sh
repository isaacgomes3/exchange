#!/usr/bin/env bash
# Proteger (cliente): botão Sincronizar API sempre visível (header + empty state).
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

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

log "1/1 UI app-proteger.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp_html"
grep -q 'proteger-sync-api-btn-v10' "$tmp_html" || die "sem marker proteger-sync-api-btn-v10"
grep -q 'btnSyncApiHead' "$tmp_html" || die "sem botão header Sincronizar API"
grep -q 'syncGrade' "$tmp_html" || die "sem syncGrade"
grep -q 'Sincronizar API' "$tmp_html" || die "sem texto Sincronizar API"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-sync-btn-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-proteger.html' -print0 2>/dev/null || true)
for f in "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" "$WEB_ROOT/sandbox/app-proteger.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "OK — Ctrl+Shift+R em /app-proteger.html"
echo "  Botão Sincronizar API no topo + no empty state da grade."
echo "  Hotfix: bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}/scripts/vps-hotfix-proteger-sync-api-btn.sh)"
