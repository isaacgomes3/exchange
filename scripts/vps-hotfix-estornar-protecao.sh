#!/usr/bin/env bash
# Fix: Cancelar e estornar no Monitor de Proteções
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-estornar-protecao-723d/scripts/vps-hotfix-estornar-protecao.sh" -o /tmp/hotfix-estorno.sh
#   bash /tmp/hotfix-estorno.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-estornar-protecao-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

log "1/3 — UI monitor"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-monitoring-protections.html" \
  -o "$WEB/admin-monitoring-protections.html"
chmod 0644 "$WEB/admin-monitoring-protections.html"
cp -f "$WEB/admin-monitoring-protections.html" "$WEB_ROOT/admin-monitoring-protections.html" 2>/dev/null || true
grep -q 'refundedCents' "$WEB/admin-monitoring-protections.html" || die "UI sem mensagem de refundedCents"
grep -q 'Processando' "$WEB/admin-monitoring-protections.html" || die "UI sem estado Processando"
# regressão: finally precisa dar paint() senão botões ficam cinza
grep -q 'finally' "$WEB/admin-monitoring-protections.html" || die "UI sem finally"
# texto de ajuda removido
if grep -q 'Encerrar: fecha a operação' "$WEB/admin-monitoring-protections.html"; then
  die "texto de ajuda Encerrar/Cancelar ainda presente"
fi

log "2/3 — shim cancelProtectionRefund"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
grep -q 'creditProtectionRefund' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem creditProtectionRefund"
grep -q 'healed' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem heal de estorno"

for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    echo "  ExecStart=$exec"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || echo "AVISO: não reiniciou shim"
sleep 1
curl -sS "http://127.0.0.1:3101/health" 2>/dev/null | head -c 200 || true
echo

log "3/3 — nginx protection-cancel"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield
do
  [[ -f "$conf" ]] || continue
  if grep -q 'protection-cancel' "$conf"; then
    echo "  nginx ok $conf"
    continue
  fi
  if grep -q 'affiliate-withdraw)' "$conf"; then
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|protection-close|protection-cancel)/' "$conf" || true
    echo "  nginx patched $conf"
  fi
done
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

echo
echo "OK — Ctrl+Shift+R em https://arbishield.app/admin-monitoring-protections.html"
echo "  Ver detalhes → Cancelar e estornar"
echo "  Se já estava cancelada sem crédito, o 2º clique recupera o estorno."
