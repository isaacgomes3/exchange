#!/usr/bin/env bash
# Desafio v3: ícone à direita; bolinha transparente até resultado definitivo.
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
MARKER="desafio-mercado-vx-v3"

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

log "1/2 baixar e validar app-desafio.html ($MARKER)"
tmp="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp"
grep -q "$MARKER" "$tmp" || die "download sem marker $MARKER (ref=$REF)"
grep -q 'marketDecidedStatus' "$tmp" || die "sem marketDecidedStatus"
grep -q 'is-pending' "$tmp" || die "sem is-pending"
grep -q 'order: 2' "$tmp" || die "sem CSS order:2 (ícone à direita)"
# Não pode ser a v1 antiga
if grep -q 'function marketIsWinning' "$tmp"; then
  die "ainda veio marketIsWinning (v1) — confira REF=$REF"
fi

log "2/2 publicar em todos os app-desafio.html"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-mkt-vx3-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name "app-desafio.html" -print0 2>/dev/null || true)

for f in \
  "$WEB/app-desafio.html" \
  "$WEB_ROOT/app-desafio.html" \
  "$WEB_ROOT/sandbox/app-desafio.html" \
  "/var/www/html/app-desafio.html" \
  "/var/www/html/v2/app-desafio.html"
do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done

# bust opcional: tocar nginx cache se existir
if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

rm -f "$tmp"

# Verificação local
check="$(curl -fsS "http://127.0.0.1/app-desafio.html" 2>/dev/null || true)"
if [[ -z "$check" ]]; then
  check="$(cat "$WEB_ROOT/app-desafio.html" 2>/dev/null || cat "$WEB/app-desafio.html" 2>/dev/null || true)"
fi
echo "$check" | grep -q "$MARKER" || die "após publish, arquivo local ainda sem $MARKER"
echo "$check" | grep -q 'marketDecidedStatus' || die "após publish, sem marketDecidedStatus"

log "OK — arquivos atualizados: $n"
echo "Marker esperado no HTML: $MARKER"
echo "Ctrl+Shift+R (hard refresh) em https://arbishield.app/app-desafio.html"
echo "Confira no código-fonte: desafio-mercado-vx-v3 + bolinha is-pending à direita"
