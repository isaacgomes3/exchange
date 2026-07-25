#!/usr/bin/env bash
# Gestão de Jogos (BetBra): mostrar todas as odds por defeito + botões BACK/LAY.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA_OU_BRANCH>/scripts/vps-hotfix-admin-jogos-back-lay.sh")
#
# Opcional:
#   ARBISHIELD_REF=cursor/fix-proteger-js-e85c bash <(curl …)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
PRELIVE_DST="${ARBISHIELD_PRELIVE:-$SHIM_DIR/arbishield-prelive-events.mjs}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 UI — admin-jogos (todas as odds + BACK/LAY)"
dl "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

grep -q 'btn-side lay' "$WEB/admin-jogos.html" || die "sem botão LAY"
grep -q 'btn-side back' "$WEB/admin-jogos.html" || die "sem botão BACK"
grep -q 'runnerSideOdd' "$WEB/admin-jogos.html" || die "sem runnerSideOdd"
grep -q 'id="onlyWithOdds"' "$WEB/admin-jogos.html" || die "sem onlyWithOdds"
# por defeito unchecked (sem atributo checked na mesma linha)
if grep -E 'id="onlyWithOdds"[^>]*checked' "$WEB/admin-jogos.html" >/dev/null; then
  die "onlyWithOdds ainda checked por defeito"
fi

log "2/2 API — prelive (marketType BACK/LAY no lançamento)"
if [[ -f "$PRELIVE_DST" ]]; then
  dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
  chmod 0644 "$PRELIVE_DST"
  grep -q 'marketType || body.market_type' "$PRELIVE_DST" || die "prelive sem marketType"
  if command -v systemctl >/dev/null 2>&1; then
    for svc in arbishield-prelive arbishield-shim arbishield; do
      if systemctl list-unit-files | grep -q "^${svc}\.service"; then
        systemctl restart "$svc" || true
        log "restart $svc"
      fi
    done
  fi
else
  log "aviso: $PRELIVE_DST não existe — só UI atualizada"
fi

log "OK — hard refresh (Ctrl+Shift+R) em /v2/admin-jogos.html"
)
