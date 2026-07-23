#!/usr/bin/env bash
# Hotfix: reconstruir Lançar Evento Manual (igual site antigo, ≠ Desafio)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/reconstruir-lancar-evento-manual-723d/scripts/vps-hotfix-lancar-evento-manual.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/reconstruir-lancar-evento-manual-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "UI Admin Jogos (formulário antigo)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
chmod 0644 "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true

grep -q 'Liberar proteção' "$WEB/admin-jogos.html" || die "HTML sem Liberar proteção"
grep -q 'Esconder do site' "$WEB/admin-jogos.html" || die "HTML sem Esconder do site"
grep -q 'Nome do evento' "$WEB/admin-jogos.html" || die "HTML sem Nome do evento"
grep -q 'manLiberarProtecao' "$WEB/admin-jogos.html" || die "HTML sem manLiberarProtecao"

log "Prelive (mercado padrão se lista vazia)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'LAY HOME' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem default LAY HOME"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

echo
echo "OK — Lançar evento manual (site antigo)"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Botão: Lançar evento manual → Liberar proteção / Live / Esconder"
