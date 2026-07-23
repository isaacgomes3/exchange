#!/usr/bin/env bash
# Política: sem saldo reutilizável — só saldo real
#
# 1) Migra reusable→real em todos os perfis
# 2) Atualiza prelive/shim/UI
#
# Na VPS:
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/7c20b84/scripts/vps-hotfix-sem-saldo-reutilizavel.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-7c20b84}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
FIX="${FIX:-0}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need node
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR" /opt/arbishield/scripts

log "1/3 Backend — consolidar reusable no create/settle (prelive + shim)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs?v=$BUST" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
grep -q 'sem carteira reutilizável\|Consolida reutilizável\|reusable_balance_cents = 0' "$PRELIVE_DST" \
  || grep -q 'patch.reusable_balance_cents = 0' "$PRELIVE_DST" \
  || die "prelive sem consolidação reusable→0"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs?v=$BUST" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'tudo é saldo real\|reusable_balance_cents: 0' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem política só saldo real"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "2/3 UI — admin-users / carteira / financeiro (sem rótulo reutilizável)"
for f in admin-users.html app-carteira.html v2-financeiro.js; do
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/deploy/vps-supabase/static/v2/$f?v=$BUST" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
! grep -q 'reutilizável ' "$WEB/admin-users.html" || die "admin-users ainda mostra reutilizável"
grep -q 'saldo real' "$WEB/app-carteira.html" || die "carteira sem copy saldo real"

log "3/3 Migração em massa reusable→real"
MIG=/opt/arbishield/scripts/vps-migrar-reusable-para-real-todos.mjs
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-migrar-reusable-para-real-todos.mjs?v=$BUST" -o "$MIG"
chmod 0644 "$MIG"
grep -q 'migrar-reusable-para-real-todos-v1' "$MIG" || die "script migração inválido"
export FIX
node "$MIG"

echo
echo "OK — política: só saldo real"
echo "  Rode com FIX=1 para migrar os saldos reutilizáveis existentes"
echo "  Ctrl+F5 no admin/app"
