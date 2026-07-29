#!/usr/bin/env bash
# Hotfix: saque Saldo Reembolso — nginx + shim (corrige not_found / 405)
#
# Causa do "not_found": shim antigo sem a rota /api/arbishield/deduction-withdraw
# (NÃO tem relação com saldo DEMO — o card Saldo Reembolso é sacável igual.)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-saque.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> vps-hotfix-saldo-reembolso-saque.sh ($(date -Is))"

# ---------------------------------------------------------------------------
# 1) Nginx whitelist
# ---------------------------------------------------------------------------
log "1) nginx — liberar deduction-withdraw"
patched=0
while IFS= read -r -d '' conf; do
  grep -q 'affiliate-withdraw' "$conf" 2>/dev/null || continue
  if grep -q 'deduction-withdraw' "$conf"; then
    echo "  já ok $conf"
    continue
  fi
  cp -a "$conf" "${conf}.bak-deduction-withdraw-$(date +%s)"
  sed -i 's/affiliate-withdraw|/affiliate-withdraw|deduction-withdraw|/g' "$conf"
  sed -i 's/affiliate-withdraw)/affiliate-withdraw|deduction-withdraw)/g' "$conf"
  grep -q 'deduction-withdraw' "$conf" && echo "  OK $conf" && patched=$((patched+1))
done < <(find /etc/nginx -type f -print0 2>/dev/null)

# Republish canônico
if [[ -f /etc/nginx/sites-available/arbishield.app ]]; then
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" -o "$tmp" \
    && grep -q 'deduction-withdraw' "$tmp"; then
    cp -a /etc/nginx/sites-available/arbishield.app \
      "/etc/nginx/sites-available/arbishield.app.bak-deduction-withdraw-$(date +%s)"
    cp -f "$tmp" /etc/nginx/sites-available/arbishield.app
    echo "  OK republish sites-available/arbishield.app"
    patched=$((patched+1))
  fi
  rm -f "$tmp"
fi

nginx -t || die "nginx -t falhou"
systemctl reload nginx || die "nginx reload falhou"
log "nginx OK (patches=$patched)"

# ---------------------------------------------------------------------------
# 2) Descobrir caminho real do shim (systemctl ExecStart)
# ---------------------------------------------------------------------------
log "2) localizar shim em execução"
SHIM_FILE=""
if systemctl cat arbishield-serverfn-shim.service >/dev/null 2>&1; then
  SHIM_FILE="$(systemctl cat arbishield-serverfn-shim.service 2>/dev/null \
    | sed -n 's/^ExecStart=.*node[[:space:]]\+\([^[:space:]]*arbishield-serverfn-shim\.mjs\).*/\1/p' \
    | head -1)"
fi
# fallbacks
for c in \
  "$SHIM_FILE" \
  /opt/arbishield/arbishield-serverfn-shim.mjs \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs \
  "${ARBISHIELD_SHIM_DIR:-/opt/arbishield}/arbishield-serverfn-shim.mjs"
do
  [[ -n "$c" && -f "$c" ]] && SHIM_FILE="$c" && break
done
[[ -n "$SHIM_FILE" ]] || die "shim .mjs não encontrado"
SHIM_DIR="$(dirname "$SHIM_FILE")"
log "shim → $SHIM_FILE"

# ---------------------------------------------------------------------------
# 3) Deploy contrato + shim
# ---------------------------------------------------------------------------
log "3) deploy protection-flow-contract + shim"
mkdir -p "$SHIM_DIR/lib" /opt/arbishield/lib /opt/arbishield/scripts/lib
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/lib/protection-flow-contract.mjs" -o "$SHIM_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SHIM_DIR/lib/protection-flow-contract.mjs"
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/lib/protection-flow-contract.mjs 2>/dev/null || true
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/scripts/lib/protection-flow-contract.mjs 2>/dev/null || true
grep -q 'DO_NOT_CHANGE_PROTECTION_FLOW_WITHOUT_EXPLICIT_REQUEST' \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" || die "contrato inválido"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_FILE"
chmod 0755 "$SHIM_FILE"
# espelha nos caminhos comuns
cp -f "$SHIM_FILE" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
cp -f "$SHIM_FILE" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'deduction-withdraw' "$SHIM_FILE" || die "shim sem rota deduction-withdraw"
grep -q 'requestDeductionWithdrawal' "$SHIM_FILE" || die "shim sem requestDeductionWithdrawal"
grep -q 'protection-flow-contract' "$SHIM_FILE" || die "shim sem import do contrato"

# valida import local
node --check "$SHIM_FILE" || die "syntax error no shim"
node -e "import('file://$SHIM_DIR/lib/protection-flow-contract.mjs').then(()=>console.log('contract import OK')).catch(e=>{console.error(e); process.exit(1)})"

systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true
sleep 2
systemctl is-active --quiet arbishield-serverfn-shim.service || die "shim não está active"

# ---------------------------------------------------------------------------
# 4) UI
# ---------------------------------------------------------------------------
log "4) UI carteira"
for rel in \
  deploy/vps-supabase/static/v2/v2-financeiro.js \
  deploy/vps-supabase/static/v2/app-carteira.html
do
  name="$(basename "$rel")"
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$tmp"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-saque-reembolso-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  mkdir -p "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
done

# ---------------------------------------------------------------------------
# 5) Smoke — NÃO pode ser not_found
# ---------------------------------------------------------------------------
log "5) smoke deduction-withdraw"
BODY='{"amountCents":100,"pix_key":"smoke@test.com"}'
SMOKE="$(curl -sS -m 5 -X POST "http://127.0.0.1:3101/api/arbishield/deduction-withdraw" \
  -H 'Content-Type: application/json' -d "$BODY" || true)"
echo "  :3101 → $SMOKE"
echo "$SMOKE" | grep -q 'not_found' && die "shim ainda responde not_found — rota não carregou"

# via nginx (Host)
SMOKE2="$(curl -sS -m 5 -k -X POST "https://127.0.0.1/api/arbishield/deduction-withdraw" \
  -H 'Host: arbishield.app' -H 'Content-Type: application/json' -d "$BODY" || true)"
echo "  nginx → $SMOKE2"
echo "$SMOKE2" | grep -q 'not_found' && die "nginx ainda aponta shim antigo / rota ausente"
echo "$SMOKE2" | grep -q '405' && die "nginx ainda 405"

# Esperado: 400 com "Não autorizado" (sem JWT de usuário) OU mensagem de valor/pix
if echo "$SMOKE" | grep -Eqi 'autorizado|inválido|chave|Pix|Saldo'; then
  echo "  smoke OK (API respondeu regra de negócio)"
else
  warn_msg="resposta inesperada — confira manualmente: $SMOKE"
  echo "  AVISO: $warn_msg"
fi

echo
echo "OK — saque Saldo Reembolso (não depende de DEMO)"
echo "  Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "  Solicitar saque de novo"
