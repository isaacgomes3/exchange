#!/usr/bin/env bash
# Desafio: corrige V/x em Empate Anula (DNB) + Mais/Menos 1.5 sem "de".
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-dnb-flag.sh?ref=cursor/desafio-dnb-flag-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-dnb-flag-e85c}"
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

echo "==> vps-hotfix-desafio-dnb-flag.sh ($(date -Is)) ref=$REF"
log "1/1 UI app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"

grep -q 'desafio-dnb-flag-v1' "$tmp_html" || die "sem marker desafio-dnb-flag-v1"
grep -q 'desafio-ou-flag-v1' "$tmp_html" || die "sem marker desafio-ou-flag-v1"
grep -q 'isDnb' "$tmp_html" || die "sem logica isDnb"
grep -q 'namesOverlap' "$tmp_html" || die "sem namesOverlap"
grep -q 'is-void' "$tmp_html" || die "sem estilo void"
grep -q 'String(ou\[1\])' "$tmp_html" || die "sem parse O/U novo (ou[1])"
grep -q 'String(uu\[1\])' "$tmp_html" || die "sem parse O/U novo (uu[1])"
grep -q 'Aceita "mais 1.5"' "$tmp_html" || die "sem comentario O/U mais 1.5"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-dz-dnb-$(date +%s)" 2>/dev/null || true
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

echo "OK — flags DNB + Mais/Menos 1.5 atualizados."
echo "  Abra /app-desafio.html e Ctrl+Shift+R"
echo "  Empate Anula: V/x pelo time | Mais/Menos: bolinha pending ao vivo"
