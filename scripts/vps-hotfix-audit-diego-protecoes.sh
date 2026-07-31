#!/usr/bin/env bash
# Audita proteções do cliente DIEGO (ou NAME=...) na VPS.
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
NAME="${NAME:-DIEGO HENRIQUE}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

tmp="$(mktemp)"
rel="scripts/vps-audit-user-protecoes.mjs"
if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$tmp" \
  && [[ -s "$tmp" ]]; then
  :
else
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$tmp"
fi
[[ -s "$tmp" ]] || die "download vazio: $rel"
grep -q 'vps-audit-user-protecoes' "$tmp" || true

log "Publicar UI filtro user_id + espelho readonly"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

publish_html() {
  local name="$1"
  local marker="$2"
  local ftmp
  ftmp="$(mktemp)"
  local hrel="deploy/vps-supabase/static/v2/$name"
  if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$hrel?ref=${REF}&t=$(date +%s)" -o "$ftmp" \
    || [[ ! -s "$ftmp" ]]; then
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      "$RAW/$hrel?v=$BUST&t=$(date +%s)" -o "$ftmp"
  fi
  [[ -s "$ftmp" ]] || die "download vazio: $name"
  grep -q "$marker" "$ftmp" || die "$name sem marker $marker"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-filtro-$(date +%s)" 2>/dev/null || true
    cp -f "$ftmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name" "$WEB_ROOT/sandbox/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$ftmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$ftmp"
}

publish_html "app-protecoes.html" "protecoes-filtro-userid-v2"
publish_html "app-proteger.html" "proteger-espelho-readonly-v13"

log "Auditar NAME=$NAME"
if [[ -f "$ROOT/deploy/vps-supabase/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/deploy/vps-supabase/.env"
  set +a
elif [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

NAME="$NAME" node "$tmp"
rm -f "$tmp"
log "OK — confira se cada jogo tem wallet_tx e source do cliente"
echo "UI: Ctrl+Shift+R em /app-protecoes.html (marker protecoes-filtro-userid-v2)"
