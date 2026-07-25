#!/usr/bin/env bash
# Hotfix: libera POST /api/arbishield/deduction-withdraw no nginx (era 405)
# e atualiza shim + UI do Saldo Reembolso.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-saque.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> vps-hotfix-saldo-reembolso-saque.sh ($(date -Is))"

# 1) Nginx: incluir deduction-withdraw na whitelist do shim
log "1) nginx — liberar deduction-withdraw"
patched=0
while IFS= read -r -d '' conf; do
  if grep -q 'affiliate-withdraw' "$conf" && ! grep -q 'deduction-withdraw' "$conf"; then
    cp -a "$conf" "${conf}.bak-deduction-withdraw-$(date +%s)"
    sed -i 's/affiliate-withdraw|/affiliate-withdraw|deduction-withdraw|/g' "$conf"
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|deduction-withdraw)/g' "$conf"
    if grep -q 'deduction-withdraw' "$conf"; then
      echo "  OK $conf"
      patched=$((patched + 1))
    else
      echo "  AVISO: não patchou $conf"
    fi
  elif grep -q 'deduction-withdraw' "$conf"; then
    echo "  já ok $conf"
  fi
done < <(find /etc/nginx -type f \( -name '*.conf' -o -name '*arbishield*' \) -print0 2>/dev/null)

# também republica conf canônica do repo
for name in nginx-arbishield.app.conf nginx-cutover.conf; do
  dst=""
  case "$name" in
    nginx-arbishield.app.conf) dst="/etc/nginx/sites-available/arbishield.app" ;;
  esac
  if [[ -n "$dst" && -f "$dst" ]]; then
    tmp="$(mktemp)"
    if curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/$name" -o "$tmp"; then
      if grep -q 'deduction-withdraw' "$tmp"; then
        cp -a "$dst" "${dst}.bak-deduction-withdraw-$(date +%s)" 2>/dev/null || true
        cp -f "$tmp" "$dst"
        echo "  OK republish $dst"
        patched=$((patched + 1))
      fi
    fi
    rm -f "$tmp"
  fi
done

# sites-enabled symlink common paths
for conf in \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/conf.d/arbishield.conf
do
  [[ -f "$conf" || -L "$conf" ]] || continue
  real="$(readlink -f "$conf" 2>/dev/null || echo "$conf")"
  [[ -f "$real" ]] || continue
  if grep -q 'affiliate-withdraw' "$real" && ! grep -q 'deduction-withdraw' "$real"; then
    cp -a "$real" "${real}.bak-deduction-withdraw-$(date +%s)"
    sed -i 's/affiliate-withdraw|/affiliate-withdraw|deduction-withdraw|/g' "$real"
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|deduction-withdraw)/g' "$real"
    echo "  OK $real"
    patched=$((patched + 1))
  fi
done

nginx -t || die "nginx -t falhou"
systemctl reload nginx || die "nginx reload falhou"
log "nginx reload OK (patched≈$patched)"

# 2) Shim + contrato
log "2) shim + protection-flow-contract"
mkdir -p "$SHIM_DIR/lib" /opt/arbishield/lib /opt/arbishield/scripts/lib
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/lib/protection-flow-contract.mjs" -o "$SHIM_DIR/lib/protection-flow-contract.mjs"
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/lib/protection-flow-contract.mjs 2>/dev/null || true
cp -f "$SHIM_DIR/lib/protection-flow-contract.mjs" /opt/arbishield/scripts/lib/protection-flow-contract.mjs 2>/dev/null || true

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'deduction-withdraw' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem deduction-withdraw"
grep -q 'requestDeductionWithdrawal' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem requestDeductionWithdrawal"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

# 3) UI
log "3) UI carteira"
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

sleep 1
# smoke: rota não deve mais ser 405
CODE="$(curl -sS -o /tmp/deduction-withdraw-smoke.txt -w '%{http_code}' \
  -X POST http://127.0.0.1/api/arbishield/deduction-withdraw \
  -H 'Content-Type: application/json' \
  -d '{}' 2>/dev/null || echo 000)"
# via localhost may hit default server — also try host header
CODE2="$(curl -sS -o /tmp/deduction-withdraw-smoke2.txt -w '%{http_code}' \
  -X POST https://127.0.0.1/api/arbishield/deduction-withdraw \
  -H 'Host: arbishield.app' -H 'Content-Type: application/json' \
  -k -d '{}' 2>/dev/null || echo 000)"
echo "smoke HTTP $CODE / $CODE2 (esperado ≠ 405; tipicamente 400 sem token)"
if [[ "$CODE" == "405" && "$CODE2" == "405" ]]; then
  die "ainda 405 — confira o server block ativo do nginx"
fi

echo
echo "OK — saque Saldo Reembolso liberado"
echo "  Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "  Solicitar saque de novo"
