#!/usr/bin/env bash
# Gestao de Jogos: por defeito NAO publicar na Fila (fica rascunho).
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
mkdir -p "$WEB" "$WEB_ROOT"
tmp="$(mktemp)"
ok=0
if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2   -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix"   "$API/deploy/vps-supabase/static/v2/admin-jogos.html?ref=${REF}&t=$(date +%s)" -o "$tmp"   && [[ -s "$tmp" ]]; then
  ok=1
fi
if [[ "$ok" -ne 1 ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2     "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?v=$BUST" -o "$tmp"
fi
[[ -s "$tmp" ]] || die "download vazio"
cp -f "$tmp" "$WEB/admin-jogos.html"
cp -f "$tmp" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
chmod 0644 "$WEB/admin-jogos.html"
rm -f "$tmp"
grep -q 'admin-jogos-sem-fila-default-v6' "$WEB/admin-jogos.html" || die "sem marker v6"
grep -q 'id="publishNow"' "$WEB/admin-jogos.html" || die "sem publishNow"
if grep -E 'id="publishNow"[^>]*checked' "$WEB/admin-jogos.html" >/dev/null; then
  die "publishNow ainda checked por defeito"
fi
grep -q 'id="manLiberarProtecao" aria-pressed="false"' "$WEB/admin-jogos.html"   || die "Liberar protecao ainda ON por defeito"
log "OK - Ctrl+Shift+R em /v2/admin-jogos.html"
log "Novos lancamentos ficam em rascunho (fora da Fila) por defeito"
