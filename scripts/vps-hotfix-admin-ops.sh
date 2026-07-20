#!/usr/bin/env bash
# Hotfix cirúrgico: Lançar Desafio (SPA) + Próximos jogos (BetBra).
# NÃO altera nginx, CSR boot, index.html nem estabilização global.
#
# Uso na VPS (root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-ops.sh)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-ops-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/4 — inject desafios (para de travar Lançar Desafio)"
download "deploy/vps-supabase/static/desafio-sugestoes-inject.js" "$WEB/assets/desafio-sugestoes-inject.js"
chmod 0644 "$WEB/assets/desafio-sugestoes-inject.js"

log "2/4 — página Gestão de Jogos (BetBra → mercados → lançar)"
download "deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
chmod 0644 "$WEB/admin-jogos-vps.html"

log "3/4 — shim serverFn (salvar desafio no SPA)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"

log "4/4 — worker pré-live :3098 (lista jogos + POST matches)"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"

if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  log "shim :3101 reiniciado"
else
  warn="AVISO: arbishield-serverfn-shim inativo — suba com vps-stabilize-arbishield.sh"
  echo "$warn" >&2
fi

if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  log "prelive :3098 reiniciado"
else
  echo "AVISO: arbishield-prelive-events inativo — suba com vps-stabilize-arbishield.sh" >&2
fi

echo
echo "OK — hotfix admin aplicado (site principal intacto)"
echo "  Desafios SPA:  https://arbishield.app/admin/desafios  → Lançar Desafio"
echo "  Jogos BetBra:  https://arbishield.app/admin/matches   → Próximos jogos"
echo
echo "Teste rápido:"
echo "  curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3098/api/arbishield/prelive-events"
echo "  curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3101/health"
