#!/usr/bin/env bash
# FORCE: publica UI + settle do Saldo Reembolso nesta branch (sobrescreve extrato-tx-*).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/vps-hotfix-saldo-reembolso-FORCE.sh?$(date +%s)")
set -euo pipefail

REPO="isaacgomes3/exchange"
BRANCH="${ARBISHIELD_BRANCH:-cursor/manual-evento-escudo-times-bb44}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
BUST="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }

need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "Resolvendo commit da branch $BRANCH"
COMMIT_SHA="${ARBISHIELD_COMMIT:-}"
if [[ -z "$COMMIT_SHA" ]]; then
  COMMIT_SHA=$(curl -fsSL "https://api.github.com/repos/${REPO}/commits/${BRANCH}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])" 2>/dev/null || true)
fi
if [[ -z "$COMMIT_SHA" ]]; then
  RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
  log "  aviso: usando branch tip (pode ter cache CDN)"
else
  RAW="https://raw.githubusercontent.com/${REPO}/${COMMIT_SHA}"
  log "  commit ${COMMIT_SHA:0:12}"
fi

fetch() {
  local rel="$1" dest="$2"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "${RAW}/${rel}?t=${BUST}" -o "$dest"
  [[ -s "$dest" ]] || die "download vazio: $rel"
}

publish_name() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  fetch "$rel" "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-reembolso-force-${BUST}" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || log "  aviso: nenhum $name pré-existente em /var/www (copiado em $WEB)"
}

echo "==> FORCE Saldo Reembolso ($(date -Is))"

log "1/4 UI carteira + financeiro + shell"
publish_name "deploy/vps-supabase/static/v2/app-carteira.html"
publish_name "deploy/vps-supabase/static/v2/v2-financeiro.js"
publish_name "deploy/vps-supabase/static/v2/v2-shell.js"

grep -q 'carteira-saldo-reembolso-v1[56]\|saldo-reembolso-v1[56]' "$WEB/app-carteira.html" \
  || die "app-carteira.html sem marker saldo-reembolso (ainda extrato-tx?)"
grep -q 'finBalDeduction' "$WEB/app-carteira.html" || die "HTML sem #finBalDeduction"
grep -q 'finBalDeduction' "$WEB/v2-financeiro.js" || die "v2-financeiro.js sem finBalDeduction"
grep -q 'TRANSFER_DESAFIO_BLOCKED' "$WEB/v2-financeiro.js" || die "financeiro sem TRANSFER_DESAFIO_BLOCKED"
grep -q 'deduction_balance_cents' "$WEB/v2-shell.js" || die "shell sem deduction_balance_cents"
# Garante que NÃO ficou a build antiga
! grep -q 'extrato-tx-descricao-v1' "$WEB/app-carteira.html" \
  || die "HTML ainda tem extrato-tx-descricao-v1"

log "2/4 Prelive settle → deduction_balance_cents"
fetch "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'deduction_balance_cents' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem deduction_balance_cents"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

log "3/4 Shim transfer/saque/settle"
tmp_shim="$(mktemp)"
fetch "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'transfer-reembolso-desafio-atomic-v1' "$tmp_shim" || die "shim sem transfer Reembolso→Desafio"
grep -q 'requestDeductionWithdrawal' "$tmp_shim" || die "shim sem requestDeductionWithdrawal"
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "/opt/arbishield/arbishield-serverfn-shim.mjs" \
  "/opt/arbishield/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  [[ -d "$(dirname "$dest")" ]] || continue
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_shim"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true

log "4/4 Verificação local + script de reparo"
fetch "scripts/vps-repair-reembolso-from-real.mjs" "$SCRIPTS_DIR/vps-repair-reembolso-from-real.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-repair-reembolso-from-real.mjs"
cp -f "$SCRIPTS_DIR/vps-repair-reembolso-from-real.mjs" /opt/arbishield/scripts/vps-repair-reembolso-from-real.mjs 2>/dev/null || true

BUILD=$(grep -o 'content="saldo-reembolso-v[0-9]*"' "$WEB/app-carteira.html" | head -1 || echo "?")
echo "  build marker: $BUILD"
if curl -fsS "http://127.0.0.1/app-carteira.html" 2>/dev/null | grep -q 'saldo-reembolso-v1'; then
  echo "  nginx local: OK (saldo-reembolso)"
else
  echo "  AVISO: curl local ainda sem saldo-reembolso — confira root nginx"
  curl -fsS "http://127.0.0.1/app-carteira.html" 2>/dev/null | grep -o 'arbishield-build" content="[^"]*"' | head -1 || true
fi
if curl -fsS "http://127.0.0.1/v2-financeiro.js" 2>/dev/null | grep -q 'finBalDeduction'; then
  echo "  v2-financeiro.js: OK (finBalDeduction)"
else
  echo "  AVISO: JS local sem finBalDeduction"
fi

echo
echo "OK FORCE — Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "  Se o card mostrar R\$ 0,00 (não —) mas houver REEMBOLSO em Minhas Proteções,"
echo "  rode o reparo Real→Reembolso:"
echo "  NAME='CARLOS ROBERTO' FIX=1 node $SCRIPTS_DIR/vps-repair-reembolso-from-real.mjs"
