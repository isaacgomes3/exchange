#!/usr/bin/env bash
# Desafio: campo "Entrar com" inicia vazio (editavel), sem preencher R$ padrao.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-entrada-vazia-9c21/scripts/vps-hotfix-desafio-entrada-vazia.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-entrada-vazia-9c21}"
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

log "1/1 UI — app-desafio.html (Entrar com inicia vazio)"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp"
grep -q 'desafio-entrada-vazia-v1' "$tmp" || die "sem marker desafio-entrada-vazia-v1"
grep -q 'placeholder="0,00"' "$tmp" || die "sem placeholder no input de stake"
grep -q 'stakeInputValue' "$tmp" || die "sem stakeInputValue"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-desafio-entrada-vazia-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)

for f in "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" "$WEB_ROOT/sandbox/app-desafio.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp"

log "OK — Ctrl+Shift+R em Desafio. Campo Entrar com inicia vazio."
echo "  https://arbishield.app/app-desafio.html"
