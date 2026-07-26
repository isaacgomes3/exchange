#!/usr/bin/env bash
# Publica UI: ocultar entradas erradas no espelho + auditoria Diego.
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
NAME="${NAME:-DIEGO HENRIQUE}"
ROOT="${ARBISHIELD_ROOT:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
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
  local marker="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "deploy/vps-supabase/static/v2/$name" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-ocultar-$(date +%s)" 2>/dev/null || true
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
publish_html "app-protecoes.html" "protecoes-ocultar-erro-v3"

log "2/3 app-proteger.html (espelho readonly)"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp"
if grep -q 'proteger-espelho-readonly-v13' "$tmp"; then
  publish_html "app-proteger.html" "proteger-espelho-readonly-v13"
else
  echo "  (pular proteger — marker ausente neste ref)"
fi
rm -f "$tmp"

log "3/3 auditar NAME=$NAME"
atmp="$(mktemp)"
download_repo_file "scripts/vps-audit-user-protecoes.mjs" "$atmp"
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
NAME="$NAME" node "$atmp" || true
rm -f "$atmp"

log "OK"
echo "No espelho: abra a proteção errada → «Ocultar da lista (erro de lançamento)»"
echo "Ou na VPS: HIDE_IDS=uuid1,uuid2 NAME=\"$NAME\" node scripts/vps-audit-user-protecoes.mjs"
echo "Ctrl+Shift+R em /app-protecoes.html"
