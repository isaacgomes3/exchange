#!/usr/bin/env bash
# Desafio Extrato: mostra odd, valor da entrada e ganho em cada linha do histórico.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-extrato-odd-ganho-f9cb/scripts/vps-hotfix-desafio-extrato-odd-ganho.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-extrato-odd-ganho-f9cb}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
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

log "1/2 UI — app-desafio.html (extrato: odd + valor + ganho)"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-extrato-odd-v1' "$tmp_html" || die "UI sem marker desafio-extrato-odd-v1"
grep -q 'gain is-profit' "$tmp_html" || die "UI sem coluna de ganho"
grep -q 'Odd ' "$tmp_html" || die "UI sem rótulo Odd"
grep -q 'arbi_odd,home_odd' "$tmp_html" || die "fallback sem select de odd"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-dz-extrato-odd-$(date +%s)" 2>/dev/null || true
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

log "2/2 shim — desafio-history com odd da entrada"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'listMyDesafioHistory' "$tmp_shim" || die "shim sem listMyDesafioHistory"
grep -q 'arbi_odd,home_odd,casa_odd,away_odd' "$tmp_shim" || die "shim sem select de odds no histórico"
grep -q 'const odd = Number.isFinite(oddRaw)' "$tmp_shim" || die "shim sem campo odd na entrada"

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
rm -f "$tmp_shim"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true

log "OK — Extrato do Desafio: Odd · Valor · Ganho · Status"
echo "  Abra /app-desafio.html → Histórico → Ctrl+Shift+R"
echo "  marker: desafio-extrato-odd-v1"
