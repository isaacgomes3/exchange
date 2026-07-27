#!/usr/bin/env bash
# Hotfix UI Minhas Proteções — remove Competição, odd ao lado do Valor
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-protecoes-odd-valor.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
MARKER="protecoes-col-odd-valor-v3"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

[[ -d "$WEB_ROOT" ]] || die "web root ausente: $WEB_ROOT"

TMP="$(mktemp)"
log "baixar app-protecoes.html (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "Pragma: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/deploy/vps-supabase/static/v2/app-protecoes.html?ref=${REF}&t=$(date +%s%N)" -o "$TMP" \
  || [[ ! -s "$TMP" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html?t=$(date +%s%N)" -o "$TMP"
fi
[[ -s "$TMP" ]] || die "download vazio"
grep -q "$MARKER" "$TMP" || die "HTML sem marcador $MARKER (baixou versão errada?)"
grep -q 'Valor / Odd' "$TMP" || die "HTML sem coluna Valor / Odd"
grep -q 'term-odd' "$TMP" || die "HTML sem class term-odd"
! grep -q '>Competição<' "$TMP" || die "HTML ainda contém Competição no header"

ts="$(date +%s)"
deployed=0
while IFS= read -r -d '' dest; do
  cp -a "$dest" "${dest}.bak-odd-valor-${ts}" 2>/dev/null || true
  cp -f "$TMP" "$dest"
  echo "  OK $dest"
  deployed=$((deployed + 1))
done < <(find "$WEB_ROOT" -type f \( -name 'app-protecoes.html' -o -path '*/app-protecoes.html' \) -print0 2>/dev/null)

# Caminhos canônicos extras
for dest in \
  "$WEB_ROOT/app-protecoes.html" \
  "$WEB_ROOT/v2/app-protecoes.html" \
  "$WEB_ROOT/static/v2/app-protecoes.html"
do
  [[ -d "$(dirname "$dest")" ]] || continue
  if [[ ! -f "$dest" ]] || ! grep -q "$MARKER" "$dest" 2>/dev/null; then
    mkdir -p "$(dirname "$dest")"
    cp -f "$TMP" "$dest"
    echo "  OK force $dest"
    deployed=$((deployed + 1))
  fi
done

rm -f "$TMP"
[[ "$deployed" -gt 0 ]] || die "nenhum app-protecoes.html encontrado em $WEB_ROOT"

# Verificação local
if grep -q "$MARKER" "$WEB_ROOT/app-protecoes.html" 2>/dev/null; then
  log "verificação: $WEB_ROOT/app-protecoes.html → $MARKER ✓"
else
  die "verificação falhou em $WEB_ROOT/app-protecoes.html"
fi

# Limpa cache nginx se existir
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

log "concluído — hard refresh (Ctrl+Shift+R) em /app-protecoes.html"
log "confira no HTML: meta arbishield-build=$MARKER"
