#!/usr/bin/env bash
# Hotfix: proteção lock_fee_after_v1 (contrato v4)
# - Ativação: trava stake/responsabilidade (sem dedução)
# - Bateu Exchange: libera stake à origem + cobra dedução (REAL/DEMO)
# - Bateu ArbiShield: libera stake → Saldo Reembolso (sem dedução)
# - Empate Anula: libera stake à origem
# - Cancelar: devolve valor travado
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-lock-fee-apos-6a41/scripts/vps-hotfix-protecao-lock-fee-after.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-lock-fee-apos-6a41}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="proteger-lock-fee-after-v4"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SCRIPTS_DIR/lib"

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
  local rel="$1"
  local needle="$2"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$needle" "$tmp" || die "$name sem $needle"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lockfee-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  cp -f "$tmp" "$WEB/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  rm -f "$tmp"
}

log "1/5 contrato v4"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
grep -q 'lock_fee_after_v1' "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" || die "contrato sem lock_fee_after_v1"
grep -q 'protection-flow-contract-v4' "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" || die "contrato sem v4"
grep -q 'shouldChargeFeeAfterResult' "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" || die "contrato sem shouldChargeFeeAfterResult"
grep -q 'settlementCreditDestination' "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" || die "contrato sem settlementCreditDestination"

log "2/5 prelive create/settle/cancel"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0644 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'lock_fee_after' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem lock_fee_after"
grep -q 'chargeFeeAfterResult' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem chargeFeeAfterResult"
grep -q 'shouldChargeFeeAfterResult' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem shouldChargeFeeAfterResult"
grep -q 'settlementCreditDestination' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem settlementCreditDestination"
grep -q 'protection_lock' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem protection_lock"
grep -q 'Bateu Exchange' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem Bateu Exchange"

log "3/5 shim settle"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
grep -q 'chargeFeeAfterResult' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" || die "shim sem chargeFeeAfterResult"
grep -q 'shouldChargeFeeAfterResult' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" || die "shim sem shouldChargeFeeAfterResult"
grep -q 'settlementCreditDestination' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" || die "shim sem settlementCreditDestination"
grep -q 'settle-lock-fee-after-v4' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" || die "shim sem settle v4"

# Espelha sob /opt/arbishield se necessário
if [[ -d "$SHIM_DIR" ]]; then
  mkdir -p "$SHIM_DIR/scripts/lib"
  cp -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" "$SHIM_DIR/scripts/lib/" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$SHIM_DIR/scripts/" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/scripts/" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/" 2>/dev/null || true
fi

log "4/5 UI cliente"
publish_html "deploy/vps-supabase/static/v2/app-proteger.html" "$MARKER"
publish_html "deploy/vps-supabase/static/v2/app-protecoes.html" "stake/responsabilidade travado"
publish_html "deploy/vps-supabase/static/v2/admin-jogos.html" "lock_fee_after"

log "5/5 restart serviços"
for unit in arbishield-prelive arbishield-serverfn arbishield-serverfn-shim; do
  if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "$unit"; then
    systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
  fi
done
# fallback: qualquer unit com prelive/serverfn
while read -r unit; do
  [[ -n "$unit" ]] || continue
  systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
done < <(systemctl list-units --type=service --all 2>/dev/null | awk '/prelive|serverfn/ {print $1}' | head -8)

if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

log "OK — Ctrl+Shift+R em /app-proteger.html e /admin-jogos.html"
echo "Marker: $MARKER"
echo "Ativação trava stake; dedução só em Bateu Exchange; ArbiShield → Saldo Reembolso."
