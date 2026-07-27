#!/usr/bin/env bash
# Hotfix VPS v10: heal won_exchange incompleto + odd canônica.
# Impede: status terminal com stake não devolvido / fee odd errada.
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-exchange-heal-incompleto-v10.sh?$(date +%s)" -o /tmp/hf-v10.sh
#   bash /tmp/hf-v10.sh
#
# Depois (Carlos Sport@32 ainda em 8.976,41):
#   bash /tmp/force-905171.sh   # ou curl do vps-force-carlos-905171.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER_HEAL="settle-exchange-heal-incompleto-v10"
MARKER_ODD="settlement-odd-canonico-v10"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install_js() {
  local rel="$1" dest="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$MARKER_HEAL\|$MARKER_ODD\|protection-flow-contract-v10\|exchangeWalletHealNeeded" "$tmp" \
    || die "arquivo sem marker v10: $rel"
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  rm -f "$tmp"
  log "  OK $dest"
}

log "1/6 contrato v10"
install_js "scripts/lib/protection-flow-contract.mjs" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
cp -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" "$SHIM_DIR/lib/protection-flow-contract.mjs" 2>/dev/null || true
cp -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs" 2>/dev/null || true

log "2/6 prelive"
install_js "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
cp -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" 2>/dev/null || true

log "3/6 shim"
install_js "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" 2>/dev/null || true

log "4/6 force Carlos 905171 (odd32)"
tmp_f="$(mktemp)"
download_repo_file "scripts/vps-force-carlos-905171.mjs" "$tmp_f"
cp -f "$tmp_f" "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"
rm -f "$tmp_f"

log "5/6 reiniciar serviços"
restarted=0
for unit in arbishield-prelive arbishield-serverfn arbishield-shim arbishield; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${unit}"; then
    systemctl restart "$unit" && log "  restarted $unit" && restarted=1 || true
  fi
done
if [[ "$restarted" -eq 0 ]]; then
  pkill -f 'arbishield-prelive-events' 2>/dev/null || true
  pkill -f 'arbishield-serverfn-shim' 2>/dev/null || true
  log "  pkill enviado (subam via supervisor/systemd)"
fi

log "6/6 VERIFY markers"
node -e "
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const p = pathToFileURL('$SCRIPTS_DIR/lib/protection-flow-contract.mjs').href;
const m = await import(p);
if (m.PROTECTION_FLOW_CONTRACT_VERSION !== 'protection-flow-contract-v10') process.exit(1);
if (m.EXCHANGE_INCOMPLETE_HEAL_RULE !== 'settle-exchange-heal-incompleto-v10') process.exit(2);
if (m.SETTLEMENT_ODD_CANONICAL_RULE !== 'settlement-odd-canonico-v10') process.exit(3);
const fee = m.settlementDeductionCents({
  responsibility_cents: 100000,
  metadata: { billing_model: 'stake_lock_v1', stake_lock: true, market_type: 'LAY', market_odd: 32 }
});
if (fee !== 1581) { console.error('fee@32=', fee); process.exit(4); }
console.log('OK contrato v10 · LAY@32 fee', fee);
"

echo
echo "Hotfix v10 OK."
echo "  · Heal: won_exchange incompleto reprocessa (tx R\$0 não bloqueia)"
echo "  · Odd canônica: approved_odd > market_odd > row.odd"
echo "  · LAY 1000@32 → fee R\$15,81 (não 91,11)"
echo
echo "Se Carlos ainda está em R\$ 8.976,41:"
echo "  FIX=1 node $SCRIPTS_DIR/vps-force-carlos-905171.mjs"
echo "  (alvo R\$ 9.051,71)"
