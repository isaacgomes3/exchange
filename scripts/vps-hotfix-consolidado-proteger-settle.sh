#!/usr/bin/env bash
# =============================================================================
# Hotfix CONSOLIDADO — Proteger + Settle + Saldo (único deploy)
# =============================================================================
#
# Resolve de uma vez:
#   1) Partidas visíveis na grade (mesmo sem liquidez restante)
#   2) Refresh Apostador/Congelado após criar proteção
#   3) Liquidação Exchange/ArbiShield credita/destrava carteira
#   4) Reparo de proteção encerrada sem crédito
#   5) Script de auditoria em /opt/arbishield/scripts/
#
# NÃO rode depois:
#   vps-hotfix-proteger-so-com-liquidez.sh  (reverte item 1)
#
# Na VPS (como root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-protecao-47c1/scripts/vps-hotfix-consolidado-proteger-settle.sh")
#
# Opcional — reparar proteção Vitória×Flamengo após o deploy:
#   NAME="Isaac Gomes" MATCH="Vitória" OUTCOME=exchange FIX=1 \
#     node /opt/arbishield/scripts/vps-audit-protecao-sem-credito.mjs
# =============================================================================
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-saldo-protecao-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SHIM_DIR"

dl() {
  local src="$1" dst="$2"
  log "  baixando $src"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/$src?v=$BUST" -o "$dst"
}

echo
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ArbiShield — Hotfix consolidado Proteger + Settle      ║"
echo "║  REF: $REF"
echo "╚══════════════════════════════════════════════════════════╝"
echo

# --- 1/6 UI Proteger ----------------------------------------------------------
log "1/6 UI — app-proteger.html (grade + refresh saldo)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'Sem partidas na janela agora' "$WEB/app-proteger.html" \
  || die "proteger: empty state errado"
grep -q 'balances-changed' "$WEB/app-proteger.html" \
  || die "proteger: sem refresh de saldo"
grep -q 'hasProtectLiquidity' "$WEB/app-proteger.html" \
  || die "proteger: sem hasProtectLiquidity"
# Anti-regressão: NÃO pode esconder jogos sem liquidez
if grep -q 'Sem partidas com liquidez' "$WEB/app-proteger.html"; then
  die "REGRESSÃO: ainda esconde jogos (Sem partidas com liquidez)"
fi
if grep -qE 'liqLeft\(m\) <= 0\) return false' "$WEB/app-proteger.html"; then
  die "REGRESSÃO: isOnAvailableGrid ainda filtra liqLeft <= 0"
fi

# --- 2/6 UI Shell -------------------------------------------------------------
log "2/6 UI — v2-shell.js (chips Apostador/Congelado)"
dl "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'refreshBalances' "$WEB/v2-shell.js" || die "shell sem refreshBalances"
grep -q 'arbishield:balances-changed' "$WEB/v2-shell.js" || die "shell sem evento de saldo"

# Bust cache do shell nos HTMLs que o referenciam
for f in "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" \
         "$WEB/app-protecoes.html" "$WEB_ROOT/app-protecoes.html" \
         "$WEB/app.html" "$WEB_ROOT/app.html"; do
  if [[ -f "$f" ]]; then
    sed -i -E "s|v2-shell\\.js(\\?v=[^\"']*)?|v2-shell.js?v=consolidadosaldo-${BUST}|g" "$f" 2>/dev/null || true
  fi
done

# --- 3/6 Admin Jogos ----------------------------------------------------------
log "3/6 UI — admin-jogos.html (modal Encerrar)"
dl "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'BATEU ARBISHIELD' "$WEB/admin-jogos.html" || die "admin-jogos sem outcome ArbiShield"
grep -q 'match-settle\|mode.*settle' "$WEB/admin-jogos.html" || die "admin-jogos sem settle"

# --- 4/6 API Prelive (:3098) --------------------------------------------------
log "4/6 API — arbishield-prelive-events.mjs"
PRELIVE="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE"
chmod 0755 "$PRELIVE"
cp -f "$PRELIVE" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$PRELIVE" /opt/arbishield/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'settle-arbishield-saldo-real-v1' "$PRELIVE" || die "prelive sem marker saldo real"
grep -q 'creditWalletForSettlement' "$PRELIVE" || die "prelive sem creditWalletForSettlement"
grep -q 'loadActive' "$PRELIVE" || die "prelive sem reparo loadActive"
grep -q 'protection-lock-v2' "$PRELIVE" || die "prelive sem protection-lock-v2"
# Anti-regressão: ArbiShield NÃO pode ir para reusable
if grep -q 'wonArbi ? "reusable_balance_cents"' "$PRELIVE"; then
  die "REGRESSÃO: prelive ainda credita ArbiShield em reusable"
fi
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  log "  (aviso) serviço prelive não reiniciado — reinicie manualmente se necessário"

# --- 5/6 Shim (:3101) ---------------------------------------------------------
log "5/6 API — arbishield-serverfn-shim.mjs"
SHIM="$SHIM_DIR/arbishield-serverfn-shim.mjs"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM"
chmod 0644 "$SHIM"
cp -f "$SHIM" /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'settle-arbishield-saldo-real-v1' "$SHIM" || die "shim sem marker saldo real"
if grep -q 'wonArbi ? "reusable_balance_cents"' "$SHIM"; then
  die "REGRESSÃO: shim ainda credita ArbiShield em reusable"
fi
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  log "  (aviso) serviço shim não reiniciado — reinicie manualmente se necessário"

# --- 6/6 Script de auditoria --------------------------------------------------
log "6/6 Script — vps-audit-protecao-sem-credito.mjs"
AUDIT="$SCRIPTS_DIR/vps-audit-protecao-sem-credito.mjs"
dl "scripts/vps-audit-protecao-sem-credito.mjs" "$AUDIT"
chmod 0755 "$AUDIT"
cp -f "$AUDIT" /opt/arbishield/scripts/vps-audit-protecao-sem-credito.mjs 2>/dev/null || true
grep -q 'protection_settlement' "$AUDIT" || die "audit sem protection_settlement"

# --- Health -------------------------------------------------------------------
echo
log "Health check"
if curl -fsS --max-time 3 http://127.0.0.1:3098/health >/dev/null 2>&1; then
  echo "  :3098 prelive  OK"
else
  echo "  :3098 prelive  (indisponível — confira systemctl status)"
fi
if curl -fsS --max-time 3 http://127.0.0.1:3101/health >/dev/null 2>&1; then
  echo "  :3101 shim     OK"
else
  echo "  :3101 shim     (indisponível ou sem /health)"
fi

echo
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  OK — Hotfix consolidado aplicado                       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo
echo "  1) Ctrl+F5 em:"
echo "       https://arbishield.app/app-proteger.html"
echo "       https://arbishield.app/v2/admin-jogos.html"
echo
echo "  2) Reparar proteção Vitória×Flamengo (Exchange = reembolso 0 + destrava):"
echo "       set -a && source /opt/arbishield/deploy/vps-supabase/.env && set +a"
echo "       NAME=\"Isaac Gomes\" MATCH=\"Vitória\" OUTCOME=exchange FIX=1 \\"
echo "         node $AUDIT"
echo
echo "  3) NÃO rode mais: vps-hotfix-proteger-so-com-liquidez.sh"
echo "     (ele esconde de novo os jogos sem liquidez)"
echo
