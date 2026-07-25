#!/usr/bin/env bash
# FORCE: destrava Gestão de Reembolsos (HTML antigo com JS quebrado).
# Publica admin-refunds.html + admin-refunds.js + v2-pages.js em /var/www/arbishield.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-admin-refunds-UNSTUCK.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }

download_repo_file() {
  local rel="$1"
  local out="$2"
  # Prefer API (evita cache velho do raw.githubusercontent.com)
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}" -o "$out"; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/$rel?$(date +%s)" -o "$out"
}

echo "==> UNSTUCK admin-refunds ($(date -Is))"
mkdir -p "$WEB_ROOT" "$WEB_ROOT/v2"

publish_one() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"

  # destinos canônicos
  cp -f "$tmp" "$WEB_ROOT/$name"
  cp -f "$tmp" "$WEB_ROOT/v2/$name"
  chmod 0644 "$WEB_ROOT/$name" "$WEB_ROOT/v2/$name"
  echo "  OK $WEB_ROOT/$name"
  echo "  OK $WEB_ROOT/v2/$name"

  # qualquer outra cópia em /var/www
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-unstuck-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)

  rm -f "$tmp"
}

log "1) publicar arquivos"
publish_one deploy/vps-supabase/static/v2/v2-pages.js
publish_one deploy/vps-supabase/static/v2/admin-refunds.js
publish_one deploy/vps-supabase/static/v2/admin-refunds.html

log "2) validar conteúdo local"
grep -q 'admin-refunds-actions-v2' "$WEB_ROOT/admin-refunds.html" \
  || die "HTML sem marker admin-refunds-actions-v2"
grep -q 'admin-refunds.js' "$WEB_ROOT/admin-refunds.html" \
  || die "HTML não referencia admin-refunds.js"
grep -q 'admin-refunds-actions-v2' "$WEB_ROOT/admin-refunds.js" \
  || die "JS sem marker admin-refunds-actions-v2"
# o bug antigo: aspas quebradas no tbody inline
if grep -q 'tbody id="rfBody"' "$WEB_ROOT/admin-refunds.html" 2>/dev/null; then
  # só é erro se estiver DENTRO de string double-quoted quebrada — o marker novo usa arquivo externo
  if ! grep -q 'admin-refunds.js' "$WEB_ROOT/admin-refunds.html"; then
    die "HTML ainda parece ter JS inline quebrado"
  fi
fi
node --check "$WEB_ROOT/admin-refunds.js" 2>/dev/null \
  || die "admin-refunds.js com erro de sintaxe"

log "3) smoke HTTP local"
SMOKE="$(curl -fsS -m 8 "http://127.0.0.1/admin-refunds.html" 2>/dev/null || true)"
if [[ -z "$SMOKE" ]]; then
  SMOKE="$(curl -fsSk -m 8 "https://127.0.0.1/admin-refunds.html" 2>/dev/null || true)"
fi
echo "$SMOKE" | grep -q 'admin-refunds-actions-v2' \
  || die "nginx ainda serve HTML antigo (sem marker). Confira root=/var/www/arbishield"
echo "$SMOKE" | grep -q 'admin-refunds.js' \
  || die "HTML servido sem script admin-refunds.js"

# limpa cache nginx se existir
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true

echo
echo "OK UNSTUCK — Gestão de Reembolsos"
echo "  1) Feche a aba e abra de novo (ou Ctrl+Shift+R)"
echo "  2) https://arbishield.app/admin-refunds.html"
echo "  Se ainda travar, rode e cole a saída deste script."
