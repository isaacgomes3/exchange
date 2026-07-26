#!/usr/bin/env bash
# Hotfix: admin consegue finalizar desafio FT + mercado no Monitor de Desafios.
#
# Causas:
# 1) Sync inplay marcava finished mas mantinha status=live → nunca ia para Pendente
# 2) Monitor não buscava/exibia market_name_* e não tinha botões de encerrar
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-finalizar-monitor-6a41/scripts/vps-hotfix-desafio-finalizar-monitor-mercado.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-finalizar-monitor-6a41}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER_ADMIN="desafio-finalizar-ft-pending-v1"
MARKER_MONITOR="desafio-monitor-mercado-settle-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SCRIPTS_DIR/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

publish_html() {
  local rel="$1"
  local marker="$2"
  local needle="$3"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  grep -q "$needle" "$tmp" || die "$name sem $needle"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-fin-mkt-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  cp -f "$tmp" "$WEB/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || echo "  AVISO: nenhum $name em /var/www (copiado em $WEB / $WEB_ROOT)"
}

log "1/4 UI — admin-desafios.html ($MARKER_ADMIN)"
publish_html \
  "deploy/vps-supabase/static/v2/admin-desafios.html" \
  "$MARKER_ADMIN" \
  "stepIsFinishedFeed"

log "2/4 UI — admin-monitoring-desafios.html ($MARKER_MONITOR)"
publish_html \
  "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html" \
  "$MARKER_MONITOR" \
  "market_name_arbishield"
tmpm="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html" "$tmpm"
grep -q 'data-settle' "$tmpm" || die "monitor sem botões de encerrar"
grep -q 'Arbi:' "$tmpm" || die "monitor sem linha de mercado Arbi"
rm -f "$tmpm"

log "3/4 sync lib — FT → status pending"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs"
grep -q 'needsPendingStatus' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem needsPendingStatus"
grep -q 'info.finished) slimPatch.status = "pending"' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem slimPatch.status pending no FT"

# Cópia também sob /opt/arbishield se o worker carrega de lá
if [[ -d "$SHIM_DIR" ]]; then
  mkdir -p "$SHIM_DIR/scripts/lib"
  cp -f "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" "$SHIM_DIR/scripts/lib/betbra-inplay-sync.mjs" 2>/dev/null || true
fi

log "4/4 shim — settle resiliente (forfeit / settled_by)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
grep -q 'patch completo falhou, tentando mínimo' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem fallback de patch mínimo no settle"
grep -q 'forfeit falhou (etapa já encerrada)' "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem try/catch no forfeit"
if [[ -d "$SHIM_DIR" && "$SCRIPTS_DIR" != "$SHIM_DIR/scripts" ]]; then
  cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
fi

# Restart workers se existirem
for unit in arbishield-serverfn arbishield-serverfn-shim arbishield-prelive arbishield-betbra-inplay; do
  if systemctl list-unit-files "$unit.service" 2>/dev/null | grep -q "$unit"; then
    systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
  fi
done
# fallbacks comuns
for unit in \
  "$(systemctl list-units --type=service --all 2>/dev/null | awk '/serverfn|prelive|inplay/ {print $1}' | head -5)"
do
  [[ -n "${unit:-}" ]] || continue
  systemctl restart "$unit" 2>/dev/null && echo "  restarted $unit" || true
done

if command -v nginx >/dev/null 2>&1; then
  nginx -s reload 2>/dev/null || true
fi

log "OK — Ctrl+Shift+R no admin"
echo "  Gestão:  https://arbishield.app/admin-desafios.html  (marker $MARKER_ADMIN)"
echo "  Monitor: https://arbishield.app/admin-monitoring-desafios.html  (marker $MARKER_MONITOR)"
echo "  Esperado: jogos FT na aba Pendente + mercado Arbi/Casa no monitor + botões Bateu Arbi/Casa"
