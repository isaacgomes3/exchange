#!/usr/bin/env bash
# Oculta a aba Academia (seção Aprenda) no menu do usuário.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ocultar-academia-9c21/scripts/vps-hotfix-ocultar-academia.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/ocultar-academia-9c21}"
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

log "1/1 UI — v2-shell.js (ocultar Academia no menu do usuario)"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/v2-shell.js" "$tmp"
grep -q 'ocultar-academia-v1' "$tmp" || die "sem marker ocultar-academia-v1"
! grep -q 'title: "Aprenda"' "$tmp" || die "secao Aprenda ainda presente"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-ocultar-academia-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'v2-shell.js' -print0 2>/dev/null || true)

for f in "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" "$WEB_ROOT/sandbox/v2-shell.js"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp"

log "OK — Ctrl+Shift+R no app. Aba Academia / Aprenda oculta no menu do usuario."
echo "  https://arbishield.app/app.html"
