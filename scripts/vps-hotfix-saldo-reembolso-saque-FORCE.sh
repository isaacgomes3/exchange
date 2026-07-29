#!/usr/bin/env bash
# FORCE: para o shim, troca o arquivo, sobe de novo e valida o saque.
# Use quando o saque do Saldo Reembolso ainda der not_found.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-saque-FORCE.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> FORCE saque Saldo Reembolso ($(date -Is))"

# 1) Nginx (affiliate-withdraw já existe; garante deduction-withdraw também)
log "1) nginx"
while IFS= read -r -d '' conf; do
  grep -q 'affiliate-withdraw' "$conf" 2>/dev/null || continue
  grep -q 'deduction-withdraw' "$conf" && continue
  cp -a "$conf" "${conf}.bak-force-$(date +%s)"
  sed -i 's/affiliate-withdraw|/affiliate-withdraw|deduction-withdraw|/g' "$conf" || true
  sed -i 's/affiliate-withdraw)/affiliate-withdraw|deduction-withdraw)/g' "$conf" || true
  echo "  patched $conf"
done < <(find /etc/nginx -type f -print0 2>/dev/null)
if [[ -f /etc/nginx/sites-available/arbishield.app ]]; then
  tmp="$(mktemp)"
  curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" -o "$tmp" || true
  if grep -q 'deduction-withdraw' "$tmp" 2>/dev/null; then
    cp -a /etc/nginx/sites-available/arbishield.app \
      "/etc/nginx/sites-available/arbishield.app.bak-force-$(date +%s)"
    cp -f "$tmp" /etc/nginx/sites-available/arbishield.app
    echo "  republished arbishield.app"
  fi
  rm -f "$tmp"
fi
nginx -t && systemctl reload nginx

# 2) Descobrir ExecStart
log "2) stop shim + trocar arquivo"
SHIM_FILE="$(systemctl cat arbishield-serverfn-shim.service 2>/dev/null \
  | sed -n 's/^ExecStart=.*node[[:space:]]\+\([^[:space:]]*arbishield-serverfn-shim\.mjs\).*/\1/p' \
  | head -1 || true)"
for c in \
  "$SHIM_FILE" \
  /opt/arbishield/arbishield-serverfn-shim.mjs \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
do
  [[ -n "${c:-}" && -f "$c" ]] && SHIM_FILE="$c" && break
done
[[ -n "${SHIM_FILE:-}" && -f "$SHIM_FILE" ]] || die "shim não encontrado"
SHIM_DIR="$(dirname "$SHIM_FILE")"
echo "  SHIM_FILE=$SHIM_FILE"

systemctl stop arbishield-serverfn-shim.service || true
systemctl stop arbishield-serverfn-shim-teste.service 2>/dev/null || true
# mata processo residual na porta
fuser -k 3101/tcp 2>/dev/null || true
sleep 1

mkdir -p "$SHIM_DIR/lib" /opt/arbishield/lib /opt/arbishield/scripts/lib
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/lib/protection-flow-contract.mjs" -o "$SHIM_DIR/lib/protection-flow-contract.mjs"
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/lib/ 2>/dev/null || true
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/scripts/lib/ 2>/dev/null || true

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_FILE"
chmod 0755 "$SHIM_FILE"
cp -f "$SHIM_FILE" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
cp -f "$SHIM_FILE" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true

grep -q 'wallet === "reembolso"' "$SHIM_FILE" || die "shim sem desvio wallet=reembolso"
grep -q 'requestDeductionWithdrawal' "$SHIM_FILE" || die "shim sem requestDeductionWithdrawal"

# syntax check (não falha se node --check não gostar de top-level await em versão velha)
node --check "$SHIM_FILE" 2>/dev/null || echo "  AVISO: node --check falhou (pode ser versão); seguindo"

systemctl start arbishield-serverfn-shim.service || die "start shim falhou"
systemctl start arbishield-serverfn-shim-teste.service 2>/dev/null || true
sleep 2
systemctl is-active --quiet arbishield-serverfn-shim.service || {
  journalctl -u arbishield-serverfn-shim.service -n 40 --no-pager || true
  die "shim não ficou active — veja journal acima"
}

# 3) UI
log "3) UI"
for rel in \
  deploy/vps-supabase/static/v2/v2-financeiro.js \
  deploy/vps-supabase/static/v2/app-carteira.html
do
  name="$(basename "$rel")"
  tmp="$(mktemp)"
  curl -fsSL --retry 5 "$RAW/$rel" -o "$tmp"
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  mkdir -p "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
done

# 4) Smoke — affiliate-withdraw com wallet=reembolso NÃO pode ser not_found
#    nem "afiliado só nos dias 15 e 30" (shim antigo)
log "4) smoke"
BODY='{"amountCents":100,"pix_key":"smoke@test.com","wallet":"reembolso","saldo_reembolso":true}'
S1="$(curl -sS -m 5 -X POST "http://127.0.0.1:3101/api/arbishield/affiliate-withdraw" \
  -H 'Content-Type: application/json' -d "$BODY" || true)"
echo "  :3101 affiliate-withdraw → $S1"
echo "$S1" | grep -q 'not_found' && die "ainda not_found"
echo "$S1" | grep -Eqi '15 e 30|afiliado só' && die "ainda shim ANTIGO (regra de afiliado)"
# esperado: Não autorizado (sem JWT user) ou Valor/Pix/Saldo
echo "$S1" | grep -Eqi 'autorizado|inválido|Pix|Saldo|chave' \
  || echo "  AVISO: resposta inesperada (pode ser ok): $S1"

S2="$(curl -sS -m 5 -X POST "http://127.0.0.1:3101/api/arbishield/deduction-withdraw" \
  -H 'Content-Type: application/json' -d "$BODY" || true)"
echo "  :3101 deduction-withdraw → $S2"
echo "$S2" | grep -q 'not_found' && die "deduction-withdraw ainda not_found"

echo
echo "OK FORCE — saque Saldo Reembolso pronto"
echo "  1) Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "  2) Solicitar saque de novo"
