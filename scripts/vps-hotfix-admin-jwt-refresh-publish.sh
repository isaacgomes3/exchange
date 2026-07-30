#!/usr/bin/env bash
# Hotfix: Gestão de Jogos renova JWT ao publicar (evita PGRST303 JWT expired).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-jwt-refresh-publish.sh?ref=cursor/admin-jwt-refresh-publish-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/admin-jwt-refresh-publish-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

echo "==> vps-hotfix-admin-jwt-refresh-publish.sh ($(date -Is)) ref=$REF"

tmp="$(mktemp)"
if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/deploy/vps-supabase/static/v2/admin-jogos.html?ref=${REF}&t=$(date +%s%N)" -o "$tmp" \
  && [[ -s "$tmp" ]]; then
  :
else
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?v=$BUST&t=$(date +%s%N)" -o "$tmp"
fi
[[ -s "$tmp" ]] || die "download vazio admin-jogos.html"

grep -q 'restAuth' "$tmp" || die "admin-jogos sem restAuth"
grep -q 'ensureAuth' "$tmp" || die "admin-jogos sem ensureAuth"
grep -q 'JWT expired' "$tmp" || die "admin-jogos sem tratamento JWT expired"

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-jwt-publish-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'admin-jogos.html' -print0 2>/dev/null)

if [[ "$n" -eq 0 ]]; then
  mkdir -p "$WEB"
  cp -f "$tmp" "$WEB/admin-jogos.html"
  chmod 0644 "$WEB/admin-jogos.html"
  echo "  OK $WEB/admin-jogos.html (fallback)"
  n=1
fi
rm -f "$tmp"

echo ""
echo "OK ($n). Publicar rascunho renova a sessão sozinho."
echo "1) Hard refresh (Ctrl+Shift+R) em Gestão de Jogos"
echo "2) Se ainda pedir login, entre de novo uma vez e publique"
echo "Os rascunhos NÃO se perdem — só a sessão tinha expirado."
