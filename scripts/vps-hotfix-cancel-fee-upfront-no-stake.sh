#!/usr/bin/env bash
# Hotfix VPS: cancel fee_upfront NÃO devolve stake + clawback Carlos.
#
# Sintoma: cancel de proteção fee_upfront creditou R$ 1.000 (stake) quando
# só tinham sido cobrados R$ 96,11 (dedução) → Apostador inchou.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-cancel-fee-upfront-no-stake.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="cancel-fee-upfront-nao-devolve-stake-v6"
CONTRACT_VER="protection-flow-contract-v6"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

BK="/opt/arbishield/backups/cancel-fee-guard-$BUST"
mkdir -p "$BK"
log "Backup → $BK"

log "1/4 contrato ($MARKER)"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$CONTRACT_VER" "$tmp_c" || die "contrato sem $CONTRACT_VER"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
grep -q 'export function cancelRefundCents' "$tmp_c" || die "contrato sem cancelRefundCents"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/" 2>/dev/null || true
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 prelive :3098"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'cancelRefundCents' "$tmp_pre" || die "prelive sem cancelRefundCents"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 shim :3101"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -q 'cancelRefundCents' "$tmp_shim" || die "shim sem cancelRefundCents"
[[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] && \
  cp -a "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$BK/" || true
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "Reiniciar serviços"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 2
H3098="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
echo "  health :3098 → $H3098"
echo "$H3098" | grep -q "$MARKER" || die "health :3098 sem $MARKER"

log "4/4 clawback Carlos — padrão + forçado"
tmp_fix="$(mktemp)"
download_repo_file "scripts/vps-clawback-cancel-stake-fee-upfront.mjs" "$tmp_fix"
cp -f "$tmp_fix" "$SCRIPTS_DIR/vps-clawback-cancel-stake-fee-upfront.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-clawback-cancel-stake-fee-upfront.mjs"
mkdir -p "$SCRIPTS_DIR/lib"
# contract já publicado no passo 1
echo "  Clawback por padrão (proteção):"
(cd "$SCRIPTS_DIR" && node ./vps-clawback-cancel-stake-fee-upfront.mjs) || true
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-clawback-cancel-stake-fee-upfront.mjs) || true
rm -f "$tmp_fix"

tmp_force="$(mktemp)"
download_repo_file "scripts/vps-forcar-debito-carlos-windfall-cancel.mjs" "$tmp_force"
cp -f "$tmp_force" "$SCRIPTS_DIR/vps-forcar-debito-carlos-windfall-cancel.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-forcar-debito-carlos-windfall-cancel.mjs"
echo "  Débito forçado (se Real ainda = R\$ 10.971,41):"
(cd "$SCRIPTS_DIR" && node ./vps-forcar-debito-carlos-windfall-cancel.mjs) || true
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-forcar-debito-carlos-windfall-cancel.mjs)
rm -f "$tmp_force"

echo
echo "OK — cancel fee_upfront não devolve mais stake + saldo Carlos corrigido."
echo "  Marker: $MARKER"
echo "  Conferir Carlos: Saldo Real ≈ R\$ 10.067,52 (não R\$ 10.971,41)"
echo "  curl -s http://127.0.0.1:3098/health | grep cancelRefundGuard"
