#!/usr/bin/env bash
# Hotfix: proteção BACK grava market_id (NOT NULL em back_protections).
#
# Sintoma:
#   null value in column "market_id" of relation "back_protections"
#   violates not-null constraint
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-back-market-id.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-748fbe8ab8c024d660ca01a4c6756bc4d6a49915}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
MARKER="back-market-id-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR" "$SCRIPTS_DIR" /opt/arbishield/scripts

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 Backend — prelive createProtection com market_id ($MARKER)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$PRELIVE_DST" "$SHIM_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true

# Copia para o path real do ExecStart do systemd, se diferente
for u in arbishield-prelive-events.service arbishield-prelive.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-prelive-events\.mjs) ]]; then
      cp -f "$PRELIVE_DST" "${BASH_REMATCH[1]}"
      log "copiado para ExecStart: ${BASH_REMATCH[1]}"
    fi
  fi
done

grep -q "$MARKER" "$PRELIVE_DST" || die "prelive sem $MARKER"
grep -q 'market_id: resolvedMarketId' "$PRELIVE_DST" || die "prelive sem market_id no INSERT BACK"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  echo "AVISO: não reiniciou serviço prelive — reinicie manualmente"

log "2/2 UI — app-proteger.html (validação BACK sem market.id)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'Este mercado BACK está sem id' "$WEB/app-proteger.html" \
  || die "proteger sem validação market.id BACK"
grep -q "$MARKER" "$WEB/app-proteger.html" || die "proteger sem cache-bust $MARKER"

echo
echo "OK — BACK agora grava market_id em back_protections"
echo "  curl -s http://127.0.0.1:3098/health"
echo "  https://arbishield.app/app-proteger.html  (Ctrl+F5)"
echo "  Teste: ATIVAR PROTEÇÃO em um BACK com liquidez"
