#!/usr/bin/env bash
# Desafio: botao Cancelar entrada (antes do kickoff) na area Em andamento.
# API ja existe: POST /api/arbishield/desafio-cancel
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-cancelar-entrada-9c21/scripts/vps-hotfix-desafio-cancelar-entrada.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-cancelar-entrada-9c21}"
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

install_named() {
  local name="$1"
  local marker="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "deploy/vps-supabase/static/v2/$name" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-desafio-cancel-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name" "$WEB_ROOT/sandbox/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$tmp"
}

log "1/2 UI — app-desafio.html (Cancelar entrada)"
install_named "app-desafio.html" "desafio-cancelar-entrada-v1"
grep -q 'data-cancel-entrada' "$WEB/app-desafio.html" || die "sem data-cancel-entrada"
grep -q 'desafio-cancel' "$WEB/app-desafio.html" || die "sem fetch desafio-cancel"

log "2/2 UI — v2.css (botao cancel)"
install_named "v2.css" "dz-v2-cta.cancel"
grep -q 'dz-v2-cta.cancel' "$WEB/v2.css" || die "css sem .dz-v2-cta.cancel"

log "OK — Ctrl+Shift+R em Desafio. Em andamento mostra Cancelar entrada antes do kickoff."
echo "  https://arbishield.app/app-desafio.html"
echo "  API: POST /api/arbishield/desafio-cancel (ja no shim)"
