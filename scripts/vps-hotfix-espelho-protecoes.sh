#!/usr/bin/env bash
# Modo espelho: Minhas Proteções / Proteger / Desafio usam o userId do cliente.
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
    cp -a "$f" "${f}.bak-espelho-$(date +%s)" 2>/dev/null || true
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

log "1/3 app-protecoes.html"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-protecoes.html" "$tmp"
grep -q 'espelho-protecoes-v1' "$tmp" || die "protecoes sem marker"
grep -q 'getEffectiveUserId' "$tmp" || die "protecoes sem getEffectiveUserId"
grep -q 'viewUserId' "$tmp" || die "protecoes sem viewUserId"
rm -f "$tmp"
publish_html "app-protecoes.html"

log "2/3 app-proteger.html"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp"
grep -q 'viewUserId' "$tmp" || die "proteger sem viewUserId"
rm -f "$tmp"
publish_html "app-proteger.html"

log "3/3 app-desafio.html + jornada"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp"
grep -q 'viewUserId' "$tmp" || die "desafio sem viewUserId"
rm -f "$tmp"
publish_html "app-desafio.html"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio-jornada.html" "$tmp"
grep -q 'viewUserId' "$tmp" || die "jornada sem viewUserId"
rm -f "$tmp"
publish_html "app-desafio-jornada.html"

log "OK — Ctrl+Shift+R em /app-protecoes.html (modo espelho)"
echo "  Proteções/histórico passam a usar o cliente espelhado."
