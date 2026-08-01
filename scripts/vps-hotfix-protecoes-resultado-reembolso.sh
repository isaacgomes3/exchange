#!/usr/bin/env bash
# Gestão de Proteções: Resultado (Ganhou/Perdeu) + Reembolso ao lado do Status.
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
MARKER="protecoes-resultado-reembolso-v1"

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

publish_html() {
  local name="$1"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "deploy/vps-supabase/static/v2/$name" "$tmp"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-resultado-$(date +%s)" 2>/dev/null || true
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

log "1/2 validar app-protecoes.html ($MARKER)"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-protecoes.html" "$tmp"
grep -q "$MARKER" "$tmp" || die "protecoes sem marker $MARKER"
grep -q 'prot-result-meta' "$tmp" || die "protecoes sem prot-result-meta"
grep -q 'Resultado:' "$tmp" || die "protecoes sem Resultado:"
grep -q 'Reembolso:' "$tmp" || die "protecoes sem Reembolso:"
grep -q 'function resultInfo' "$tmp" || die "protecoes sem resultInfo"
rm -f "$tmp"

log "2/2 publicar app-protecoes.html"
publish_html "app-protecoes.html"

log "OK hotfix resultado/reembolso aplicado (ref=$REF)"
echo "Verifique: https://arbishield.app/v2/app-protecoes.html (hard refresh)"
echo "Marker esperado no HTML: $MARKER"
