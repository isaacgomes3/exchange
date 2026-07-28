#!/usr/bin/env bash
# Hotfix: refresh de saldos após proteção + reparo de liquidação travada.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-protecao-47c1/scripts/vps-hotfix-saldo-protecao-refresh.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-saldo-protecao-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI — v2-shell.js (refresh saldos)"
dl "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'refreshBalances' "$WEB/v2-shell.js" || die "shell sem refreshBalances"
grep -q 'arbishield:balances-changed' "$WEB/v2-shell.js" || die "shell sem evento de saldo"

log "2/3 UI — app-proteger.html"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'balances-changed' "$WEB/app-proteger.html" || die "proteger sem refresh de saldo"

log "3/3 API — arbishield-prelive-events.mjs"
PRELIVE="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE"
chmod 0755 "$PRELIVE"
grep -q 'loadActive' "$PRELIVE" || die "prelive sem reparo de proteções ativas"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "OK — Ctrl+F5. Para reparar proteção já encerrada sem crédito:"
echo "  NAME=\"Isaac Gomes\" MATCH=\"Vitória\" FIX=1 node scripts/vps-audit-protecao-sem-credito.mjs"
