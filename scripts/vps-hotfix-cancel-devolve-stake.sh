#!/usr/bin/env bash
# Hotfix VPS: cancel stake_lock DEVE devolver o stake ao Apostador.
# Também repara cancelamentos que ficaram cancelled sem TX protection_refund.
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-cancel-devolve-stake.sh?$(date +%s)" -o /tmp/hf-cancel.sh
#   bash /tmp/hf-cancel.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="cancel-stake-lock-devolve-stake-v6"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
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

log "1/4 contrato"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q 'CANCEL_STAKE_LOCK_RETURN_STAKE\|cancel-stake-lock-devolve-stake-v6' "$tmp_c" \
  || die "contrato sem marker cancel stake_lock"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"; chmod 0644 "$dest"; echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/4 prelive"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'creditCancelRefundToWallet' "$tmp_pre" || die "prelive sem creditCancelRefundToWallet"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/4 shim + UI"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'async function claimProtectionCancelled' "$tmp_shim" || die "shim sem claimProtectionCancelled"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-protecoes.html" "$tmp_ui"
grep -q 'cancel-sem-estorno\|NÃO foi devolvido' "$tmp_ui" || die "UI sem guarda de estorno"
n=0
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"; chmod 0644 "$f"; n=$((n+1)); echo "  OK $f"
done < <(find /var/www /opt -type f -name 'app-protecoes.html' -print0 2>/dev/null || true)
rm -f "$tmp_ui"
echo "  => $n × app-protecoes.html"

log "4/4 restart"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 1
echo
echo "OK — Cancel stake_lock devolve stake:"
echo "  · claimProtectionCancelled restaurado no shim"
echo "  · cancel cancelled-sem-TX agora repara (+R\$ stake)"
echo "  · UI não mente mais com 'stake devolvido' quando refunded=0"
echo
echo "Se o saldo do cliente ainda estiver -R\$1000 após cancel:"
echo "  reabra Gestao de Protecoes e clique Cancelar de novo na mesma"
echo "  protecao (agora repara), ou rode o script de reparo."
