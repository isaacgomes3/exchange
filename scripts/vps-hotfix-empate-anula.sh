#!/usr/bin/env bash
# Empate Anula: Desafio devolve stake; Proteção devolve dedução.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-empate-anula.sh?ref=cursor/empate-anula-void-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/empate-anula-void-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install_file() {
  local rel="$1"
  local dest="$2"
  local marker="$3"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -qE "$marker" "$tmp" || die "$rel sem marker $marker"
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
  rm -f "$tmp"
}

log "1/5 contrato proteção v2 (Empate Anula)"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q 'protection-flow-contract-v2' "$tmp_c" || die "contrato sem v2"
grep -q 'isVoidSettleOutcome' "$tmp_c" || die "contrato sem void"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/5 shim (desafio-settle + match-settle)"
install_file "scripts/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  'desafio-empate-anula-v1|empate_anula|isVoidSettleOutcome'

log "3/5 prelive (match-settle void)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'isVoidSettleOutcome' "$tmp_pre" || die "prelive sem void"
grep -q 'empate_anula' "$tmp_pre" || die "prelive sem empate_anula"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

log "4/5 admin UIs"
for pair in \
  "deploy/vps-supabase/static/v2/admin-desafios.html:admin-desafios.html:Empate Anula" \
  "deploy/vps-supabase/static/v2/admin-jogos.html:admin-jogos.html:btnOutcomeVoid" \
  "deploy/vps-supabase/static/v2/app-desafio.html:app-desafio.html:empate_anula"; do
  IFS=: read -r rel name marker <<<"$pair"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -qE "$marker" "$tmp" || die "$name sem $marker"
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $name"
done

log "5/5 reiniciar serviços"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
fi
if pgrep -af 'arbishield-serverfn-shim\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-serverfn-shim\.mjs' || true
fi

log "OK Empate Anula"
log "Desafio admin: botão Empate Anula → devolve stake à carteira Desafio"
log "Jogos admin: outcome Empate Anula → devolve dedução no Saldo Reembolso"
log "Markers: protection-flow-contract-v2 · desafio-empate-anula-v1 · settle-empate-anula-deducao-v1"
