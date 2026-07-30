#!/usr/bin/env bash
# Libera Finalizar (liquidar) + Cancelar em desafios PROTEGIDOS para:
#   isaacgomes3@gmail.com e carlos@arbishield.com
# (com confirmação FORCAR_* na UI). Demais admins continuam bloqueados.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-ops-isaac-carlos.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB"

download() {
  local rel="$1" out="$2" needle="${3:-}"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  rm -f "$tmp"
  die "nao baixou: $rel"
}

log "publicar admin-desafios.html (ops Isaac/Carlos)"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "protect-ops-isaac-carlos-v1"
install -m 0644 "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=ops-ic-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=ops-ic-$BUST|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
chmod 0644 "$WEB/admin-desafios.html" 2>/dev/null || true

grep -q 'protect-ops-isaac-carlos-v1' "$WEB/admin-desafios.html" || die "marker ausente"
grep -q 'carlos@arbishield.com' "$WEB/admin-desafios.html" || die "email carlos ausente"

echo
echo "OK — hard refresh em https://arbishield.app/admin-desafios.html"
echo "Logados como isaacgomes3@gmail.com ou carlos@arbishield.com:"
echo "  · veem Bateu ArbiShield / Casa / Empate Anula em protegidos"
echo "  · veem Cancelar · devolver saldo em protegidos"
echo "  · 2 confirmações + FORCAR_* no backend"
echo "Outros admins: protegido continua bloqueado."
