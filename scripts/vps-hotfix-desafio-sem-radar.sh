#!/usr/bin/env bash
# Remove o widget Radar Soft2Bet (quebrado) do Desafio e Proteger.
# Placar/tempo ao vivo permanecem. Não há gráfico de pressão separado na BetBra.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-sem-radar.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
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
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install_html() {
  local rel="$1"
  local name="$2"
  local marker="$3"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  ! grep -qE 'data-radar|dz-radar|term-radar|Radar do jogo' "$tmp" \
    || die "$name ainda contém bloco de radar"
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  chmod 0644 "$WEB/$name"
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $name ($marker)"
}

log "1/2 app-desafio sem radar"
install_html "deploy/vps-supabase/static/v2/app-desafio.html" "app-desafio.html" "desafio-sem-radar-v1"

log "2/2 app-proteger sem radar"
install_html "deploy/vps-supabase/static/v2/app-proteger.html" "app-proteger.html" "proteger-sem-radar-v1"

log "OK. Ctrl+Shift+R em /app-desafio.html e /app-proteger.html"
log "Markers: desafio-sem-radar-v1 · proteger-sem-radar-v1"
log "Placar e minuto ao vivo permanecem; radar Soft2Bet removido."
