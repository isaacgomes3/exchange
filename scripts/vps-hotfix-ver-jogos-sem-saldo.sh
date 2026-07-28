#!/usr/bin/env bash
# OBSOLETO — proteção do zero. Não reinstala lógica antiga.
echo "ABORTADO: logica de protecao antiga excluida (protecao-do-zero)." >&2
echo "Use: scripts/vps-hotfix-protecao-do-zero.sh  (stub 501)" >&2
echo "Depois implemente a nova logica em scripts/lib/protection-flow-scaffold.mjs" >&2
exit 1

# --- abaixo: legado (nao executa) ---
# Grade Proteger: jogos com liquidez; ação exige saldo.
# NÃO sobrescreve app-desafio. Exige odd/logos/filtro de liquidez.
#
# Na VPS (preferir vps-hotfix-proteger-so-com-liquidez.sh):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-ver-jogos-sem-saldo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-5d2843cc3f49c86222e2159c89134da067ec41c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 UI — app-proteger.html"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'hasProtectLiquidity' "$WEB/app-proteger.html" || die "proteger sem hasProtectLiquidity"
grep -q 'liqLeft(m) <= 0' "$WEB/app-proteger.html" || die "regressão: filtro de liquidez ausente"
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "regressão: odd readonly ausente"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "regressão: logos ausentes"

log "2/2 UI — v2.css"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q '\.term-team-logo' "$WEB/v2.css" || die "css sem logos"

log "OK — Ctrl+F5 em Proteger. (Desafio não é alterado por este hotfix.)"
echo "  Teste: https://arbishield.app/app-proteger.html"
