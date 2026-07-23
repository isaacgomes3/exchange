#!/usr/bin/env bash
# Desafio: (1) oculta jogos finalizados após Bateu
#          (2) restaura visual do card (HTML dz-v2 + CSS — fim dos logos gigantes)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-ocultar-finalizados.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-05dc16c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI — cards dz-v2 + filtrar finalizados"
for f in app-desafio.html v2.css; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
grep -q 'stepIsFinished' "$WEB/app-desafio.html" || die "app-desafio sem stepIsFinished"
grep -q '!stepIsFinished(s)' "$WEB/app-desafio.html" || die "app-desafio ainda lista etapas done"
grep -q 'dz-v2-logo' "$WEB/app-desafio.html" || die "app-desafio sem markup dz-v2"
grep -q 'dz-v2-match' "$WEB/v2.css" || die "v2.css sem estilos dz-v2-match"
grep -q 'width: 72px' "$WEB/v2.css" || die "v2.css sem tamanho fixo do logo"

log "2/3 Shim — desativa desafio quando todas as etapas encerram"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'desafioDeactivated' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desativação pós-settle"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "OK — visual restaurado; jogos finalizados fora da lista"
log "Hard refresh: /app-desafio.html (+ limpar cache de /v2.css)"
