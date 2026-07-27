#!/usr/bin/env bash
# Hotfix VPS: ativa stake_lock_v1 na criação de proteção (API :3098 + shim).
#
# Sintoma no vídeo (2026-07-27): usuário inseriu R$ 1.000, toast dizia
# "stake travado R$ 1.000", mas Apostador só caiu R$ 96,11.
# Causa: API produção ainda em fee_upfront (cobra só a dedução LAY odd 10).
# Correção: publicar createProtection stake_lock (trava o stake inteiro).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-create-stake-lock-v6.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="create-protection-stake-lock-v6"
CONTRACT_VER="protection-flow-contract-v6"
UI_META="proteger-stake-lock-toast-v6d"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
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

BK="/opt/arbishield/backups/stake-lock-create-$BUST"
mkdir -p "$BK"
log "Backup → $BK"

log "1/5 contrato $CONTRACT_VER"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
grep -q "$CONTRACT_VER" "$tmp_c" || die "contrato sem $CONTRACT_VER"
grep -q 'stake_lock_v1' "$tmp_c" || die "contrato sem stake_lock_v1"
grep -q 'chargesDeductionOnCreate: false' "$tmp_c" || die "contrato ainda cobra dedução na criação"
for dest in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/lib/protection-flow-contract.mjs" \
  "$SHIM_DIR/scripts/lib/protection-flow-contract.mjs"; do
  mkdir -p "$(dirname "$dest")"
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/$(basename "$dest").$(echo "$dest" | tr '/' '_')" 2>/dev/null || true
  cp -f "$tmp_c" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_c"

log "2/5 prelive :3098 ($MARKER)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q "$MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -q 'createProtectionModel: "stake_lock_v1"' "$tmp_pre" || die "prelive sem createProtectionModel stake_lock"
grep -q 'v2_create_protection_stake_lock' "$tmp_pre" || die "prelive sem source stake_lock"
grep -q 'const lockCents = amountCents' "$tmp_pre" || die "prelive sem lockCents = amountCents"
# Regressão: create NÃO pode debitar só a fee na ativação
if grep -q 'v2_create_protection_fee_upfront' "$tmp_pre" && \
   ! grep -q 'v2_create_protection_stake_lock' "$tmp_pre"; then
  die "prelive parece fee_upfront-only na criação"
fi
# Nunca perder API de logos
grep -q 'searchFootballTeams' "$tmp_pre" || die "prelive sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$tmp_pre" || die "prelive sem rota football-teams"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs \
  /opt/arbishield/arbishield-prelive-events.mjs; do
  mkdir -p "$(dirname "$dest")" 2>/dev/null || true
  [[ -f "$dest" ]] && cp -a "$dest" "$BK/" 2>/dev/null || true
  cp -f "$tmp_pre" "$dest" 2>/dev/null || true
  [[ -f "$dest" ]] && echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/5 shim :3101 ($MARKER)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q "$MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -q 'createProtectionModel: "stake_lock_v1"' "$tmp_shim" || die "shim sem createProtectionModel"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/5 UI app-proteger.html ($UI_META)"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp_ui"
grep -q "$UI_META" "$tmp_ui" || die "UI sem meta $UI_META"
grep -q 'data.lockedCents' "$tmp_ui" || die "UI sem toast lockedCents da API"
grep -q 'currentEventMaxCents' "$tmp_ui" || die "UI sem currentEventMaxCents"
grep -q 'Máx. efetivo neste evento' "$tmp_ui" || die "UI sem Máx. efetivo"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-stake-lock-${BUST}" 2>/dev/null || true
  cp -f "$tmp_ui" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www /opt -type f -name 'app-proteger.html' -print0 2>/dev/null || true)
rm -f "$tmp_ui"
[[ "$n" -gt 0 ]] || die "nenhum app-proteger.html encontrado"
echo "  => $n arquivo(s)"

log "5/5 reiniciar serviços"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
# Força reload se unit não pegou o arquivo novo
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
  sleep 1
  systemctl start arbishield-prelive-events.service 2>/dev/null || \
    systemctl start arbishield-prelive.service 2>/dev/null || true
fi
if pgrep -af 'arbishield-serverfn-shim\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-serverfn-shim\.mjs' || true
  sleep 1
  systemctl start arbishield-serverfn-shim.service 2>/dev/null || true
fi
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

sleep 2
H3098="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
H3101="$(curl -fsS --max-time 8 http://127.0.0.1:3101/health || true)"
echo "  health :3098 → $H3098"
echo "  health :3101 → $H3101"
echo "$H3098" | grep -q "$MARKER" || die "health :3098 sem $MARKER — API não atualizou"
echo "$H3098" | grep -q 'stake_lock_v1' || die "health :3098 sem stake_lock_v1"
echo "$H3098" | grep -q "$CONTRACT_VER" || die "health :3098 sem $CONTRACT_VER"

echo
echo "OK — createProtection agora trava o STAKE (não só a dedução)."
echo "  Markers: $CONTRACT_VER · $MARKER · UI $UI_META"
echo "  Teste: ativar R\$ 1.000 → Apostador cai R\$ 1.000 · Congelado sobe R\$ 1.000"
echo "  https://arbishield.app/app-proteger.html  (Ctrl+Shift+R)"
echo
echo "Obs: proteções já criadas em fee_upfront (ex.: a do vídeo, débito R\$ 96,11)"
echo "  continuam no modelo histórico no settle/cancel — não são reescritas."
