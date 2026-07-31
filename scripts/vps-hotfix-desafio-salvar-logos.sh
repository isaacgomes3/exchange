#!/usr/bin/env bash
# Persiste logos ao salvar Desafio (home/away + casa/arbi).
# Antes: admin coletava home_logo/away_logo mas buildPayload não enviava.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-salvar-logos.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-a220dd63816e11bcaee852c227feea8aab7f750d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 UI — admin-desafios (payload com logos)"
dl "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
grep -q 'home_logo_url: a.home_logo' "$WEB/admin-desafios.html" || die "admin-desafios sem home_logo_url no payload"
grep -q 'casa_team_logo_url' "$WEB/admin-desafios.html" || die "admin-desafios sem casa_team_logo_url no payload"

log "2/2 API — serverfn-shim + prelive (persistir home/away logo)"
for f in arbishield-serverfn-shim.mjs arbishield-prelive-events.mjs; do
  dl "scripts/$f" "$SCRIPTS_DIR/$f"
  chmod 0644 "$SCRIPTS_DIR/$f"
done
grep -q 'home_logo_url' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" || die "shim sem home_logo_url"
grep -q 'home_logo_url' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem home_logo_url"

if command -v systemctl >/dev/null 2>&1; then
  systemctl restart arbishield-prelive 2>/dev/null || true
  systemctl restart arbishield-serverfn 2>/dev/null || true
  systemctl restart arbishield-api 2>/dev/null || true
fi

log "OK — próximos desafios salvarem logos. Hard refresh no admin."
