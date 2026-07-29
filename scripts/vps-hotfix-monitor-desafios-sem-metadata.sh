#!/usr/bin/env bash
# Hotfix MÍNIMO: corrige erro
#   column desafio_steps_1.metadata does not exist
# no Monitor de Desafios.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-finalizar-monitor-6a41/scripts/vps-hotfix-monitor-desafios-sem-metadata.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-finalizar-monitor-6a41}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
MARKER="desafio-monitor-mercado-settle-v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl

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

tmp="$(mktemp)"
log "1/2 baixar admin-monitoring-desafios.html ($MARKER) ref=$REF"
download_repo_file "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html" "$tmp"
grep -q "$MARKER" "$tmp" || die "download sem marker $MARKER"
grep -q 'market_name_arbishield' "$tmp" || die "download sem market_name_arbishield"
grep -q 'data-settle' "$tmp" || die "download sem botões settle"
if grep -qE 'desafio_steps\([^)]*metadata' "$tmp"; then
  die "download ainda seleciona metadata — abortando"
fi
# não pode ser a v1 quebrada
if grep -q 'desafio-monitor-mercado-settle-v1' "$tmp"; then
  die "veio a v1 quebrada (ainda tem metadata)"
fi

log "2/2 publicar em TODOS os admin-monitoring-desafios.html"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-nometa-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www /opt/arbishield -type f -name "admin-monitoring-desafios.html" -print0 2>/dev/null || true)

for f in \
  "$WEB/admin-monitoring-desafios.html" \
  "$WEB_ROOT/admin-monitoring-desafios.html" \
  "$WEB_ROOT/sandbox/admin-monitoring-desafios.html" \
  "/var/www/html/admin-monitoring-desafios.html" \
  "/var/www/html/v2/admin-monitoring-desafios.html"
do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done

rm -f "$tmp"

if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

# Verificação local
check="$(curl -fsS "http://127.0.0.1/admin-monitoring-desafios.html" 2>/dev/null || true)"
if [[ -z "$check" ]]; then
  check="$(cat "$WEB_ROOT/admin-monitoring-desafios.html" 2>/dev/null || cat "$WEB/admin-monitoring-desafios.html" 2>/dev/null || true)"
fi
echo "$check" | grep -q "$MARKER" || die "após publish, arquivo local ainda sem $MARKER"
if echo "$check" | grep -qE 'desafio_steps\([^)]*metadata'; then
  die "após publish, ainda tem select metadata"
fi

log "OK — arquivos atualizados: $n"
echo "Marker: $MARKER"
echo "Ctrl+Shift+R em https://arbishield.app/admin-monitoring-desafios.html"
echo "Confira no código-fonte: $MARKER e NENHUM 'metadata)' no select"
