#!/usr/bin/env bash
# Hotfix VPS: Dedução ArbiShield = lucro − 4,5% − 1,5%
# Ex.: lucro 111,11 → comissão 5,00 → usuário 15,00 → dedução 91,11
# No PERDEU/Exchange (stake_lock): cobra 91,11 + comissão 5,00 (= 96,11 total).
#
# Na VPS (root), preferir download em 2 passos:
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-deducao-menos-45-15.sh?$(date +%s)" -o /tmp/hf-deducao.sh
#   bash /tmp/hf-deducao.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="computeArbiShieldDeductionCents"
UI_MARK="deducao-menos-45-15-v6f"

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

log "1/5 contrato"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$MARKER" "$tmp_c" || die "contrato sem $MARKER"
grep -q 'lucro − 4,5% − 1,5%' "$tmp_c" || grep -q 'profit - commission - userProfit' "$tmp_c" || die "contrato sem fórmula nova"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"; chmod 0644 "$dest"; echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/5 prelive"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'feeUpfront' "$tmp_pre" || die "prelive sem feeUpfront"
grep -q 'settlementExchangeCommissionCents' "$tmp_pre" || die "prelive sem commission"
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

log "3/5 shim"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'profit - commission - userProfit' "$tmp_shim" || die "shim sem fórmula nova no fallback"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/5 UI (bilhete + protocolo + preview)"
for pair in \
  "deploy/vps-supabase/static/v2/app-proteger.html:app-proteger.html" \
  "deploy/vps-supabase/static/v2/app-protecoes.html:app-protecoes.html" \
  "deploy/vps-supabase/static/v2/proteger-preview-fix.js:proteger-preview-fix.js"
do
  rel="${pair%%:*}"; name="${pair##*:}"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  if [[ "$name" == app-proteger.html || "$name" == app-protecoes.html ]]; then
    grep -q "$UI_MARK\|lucroBruto - comissaoEx - seuLucro\|profitLive - commissionLive" "$tmp" \
      || die "$name sem marca da fórmula"
  fi
  n=0
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"; chmod 0644 "$f"; n=$((n+1)); echo "  OK $f"
  done < <(find /var/www /opt -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  => $n × $name"
done

log "5/5 restart"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
sleep 1
echo
echo "OK — Dedução = lucro − 4,5% − 1,5%:"
echo "  · Ex. LAY R\$1000 @10 → dedução R\$91,11 · comissão R\$5,00 · usuário R\$15,00"
echo "  · Protocolo ativo recalcula (não fica preso em R\$96,11 stored)"
echo "  · Settle stake_lock cobra 91,11 + 5,00 (total 96,11)"
echo "  · fee_upfront histórico: mantém stored; sem comissão extra no settle"
