#!/usr/bin/env bash
# Transações admin: colunas CRIADO EM → NOME → VALOR; nome/valor negrito branco.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-admin-tx-cols.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
MARKER="admin-tx-cols-criado-nome-valor-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

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

publish() {
  local rel="$1"
  local marker="${2:-}"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  if [[ -n "$marker" ]]; then
    grep -qE "$marker" "$tmp" || die "$name sem marker $marker"
  fi
  local n=0
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  mkdir -p "$WEB_ROOT" "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || echo "  AVISO: nenhum $name em /var/www (copiado em $WEB_ROOT)"
}

log "Publicar Transações ($MARKER)"
publish "deploy/vps-supabase/static/v2/admin-transactions.html" "$MARKER"
publish "deploy/vps-supabase/static/v2/v2-pages.js" "ops-cell-emphasis"
publish "deploy/vps-supabase/static/v2/v2.css" "ops-cell-emphasis"

echo
echo "OK — colunas: CRIADO EM · NOME · VALOR (nome/valor negrito branco)"
echo "  https://arbishield.app/v2/admin-transactions.html  (Ctrl+F5)"
