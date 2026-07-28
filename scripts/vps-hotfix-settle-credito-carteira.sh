#!/usr/bin/env bash
# OBSOLETO — proteção do zero. Não reinstala lógica antiga.
echo "ABORTADO: logica de protecao antiga excluida (protecao-do-zero)." >&2
echo "Use: scripts/vps-hotfix-protecao-do-zero.sh  (FLUXO_PROTECAO_V1)" >&2
echo "Depois implemente a nova logica em scripts/lib/protection-flow-scaffold.mjs" >&2
exit 1

# --- abaixo: legado (nao executa) ---
# Hotfix: crédito na carteira + layout correto de Jogos (não Desafio)
#
# Sintomas:
#   1) Encerrar ArbiShield/Exchange não credita Apostador
#   2) Hotfix anterior reverteu Admin Jogos para layout antigo (tipo desafio)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-settle-credito-carteira-723d/scripts/vps-hotfix-settle-credito-carteira.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-settle-credito-carteira-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

log "Prelive :3098 (crédito carteira v1)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
if [[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]]; then
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
fi
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'settle-credito-carteira-v1' "$PRELIVE_DST" || die "prelive sem fix settle-credito-carteira-v1"
grep -q 'creditWalletForSettlement' "$PRELIVE_DST" || die "prelive sem creditWalletForSettlement"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "Shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'settle-credito-carteira-v1' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem fix"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI Admin Jogos (layout proteção + crédito)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

# Layout correto de proteção (não desafio)
grep -q 'Lançar jogo' "$WEB/admin-jogos.html" || die "HTML sem botão Lançar jogo"
grep -q 'não.*Desafio\|nao.*Desafio\|não</em> é Desafio\|não</em> é Desafio' "$WEB/admin-jogos.html" || \
  grep -q 'Isso <em>não</em> é Desafio' "$WEB/admin-jogos.html" || die "HTML sem aviso ≠ Desafio"
grep -q 'data-pf="upcoming"' "$WEB/admin-jogos.html" || die "HTML sem aba Agendados (layout revertido)"
grep -q 'Gestão de jogos — cockpit' "$WEB/admin-jogos.html" || die "HTML sem cockpit de eventos"
grep -q 'openNormalLaunch' "$WEB/admin-jogos.html" || die "HTML sem openNormalLaunch"
grep -q 'Alterar horário\|scheduleModal' "$WEB/admin-jogos.html" || die "HTML sem Alterar horário"
# Crédito carteira
grep -q 'Reparar crédito carteira\|saldo reutilizável' "$WEB/admin-jogos.html" || die "HTML sem UI de crédito"

echo
echo "OK — Crédito + layout Jogos (proteção, não desafio)"
echo "  curl -s http://127.0.0.1:3098/health   # settle-credito-carteira-v1"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Abas: Agendados / Ao vivo / Pendente · botão + Lançar jogo (manual)"
