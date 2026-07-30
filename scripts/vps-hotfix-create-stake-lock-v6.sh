#!/usr/bin/env bash
# Hotfix VPS: ativa stake_lock_v1 na criação de proteção (API :3098 + shim).
#
# Sintoma no vídeo (2026-07-27): usuário inseriu R$ 1.000, toast dizia
# "stake travado R$ 1.000", mas Apostador só caiu R$ 96,11.
# Causa: API produção ainda em fee_upfront (cobra só a dedução LAY odd 10).
# Correção: publicar createProtection stake_lock (trava o stake inteiro).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-hotfix-create-stake-lock-v6.sh?$(date +%s)")
# Depois:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-check-pos-deploy-v10.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
MARKER="create-protection-stake-lock-v6"
RUNTIME_MARKER="protection-runtime-stake-lock-v10"
CONTRACT_VER="protection-flow-contract-v10"
# Meta vigente em app-proteger.html (arbishield-features / arbishield-build)
UI_META="proteger-stake-lock-v6"

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
grep -q "$RUNTIME_MARKER" "$tmp_c" || die "contrato sem $RUNTIME_MARKER"
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

log "2/5 prelive :3098 ($MARKER · $RUNTIME_MARKER)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -qE "$MARKER|CREATE_PROTECTION_FIX_MARKER" "$tmp_pre" || die "prelive sem $MARKER"
grep -qE "$RUNTIME_MARKER|PROTECTION_RUNTIME_HEALTH_MARKER" "$tmp_pre" || die "prelive sem $RUNTIME_MARKER"
grep -q 'createProtectionModel: PROTECTION_BILLING_MODEL_CANONICAL\|createProtectionModel: "stake_lock_v1"' "$tmp_pre" \
  || die "prelive sem createProtectionModel stake_lock"
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

log "3/5 shim :3101 ($MARKER · $RUNTIME_MARKER)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -qE "$MARKER|CREATE_PROTECTION_FIX_MARKER" "$tmp_shim" || die "shim sem $MARKER"
grep -qE "$RUNTIME_MARKER|PROTECTION_RUNTIME_HEALTH_MARKER" "$tmp_shim" || die "shim sem $RUNTIME_MARKER"
grep -q 'createProtectionModel: PROTECTION_BILLING_MODEL_CANONICAL\|createProtectionModel: "stake_lock_v1"' "$tmp_shim" \
  || die "shim sem createProtectionModel"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/5 reiniciar serviços (API antes da UI — não deixar processo velho no ar)"
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
echo "$H3098" | grep -q "$MARKER" || die "health :3098 sem $MARKER — API não atualizou (path do unit?)"
echo "$H3098" | grep -q "$RUNTIME_MARKER" || die "health :3098 sem $RUNTIME_MARKER"
echo "$H3098" | grep -q 'stake_lock_v1' || die "health :3098 sem stake_lock_v1"
echo "$H3098" | grep -q "$CONTRACT_VER" || die "health :3098 sem $CONTRACT_VER"
echo "$H3098" | grep -qE 'protection-fee-upfront-v[0-9]+' && die "REGRESSÃO fee_upfront no health" || true
echo "$H3098" | grep -q 'protection-flow-contract-v1"' && die "health ainda em contract-v1 (processo velho)" || true

log "5/5 UI app-proteger.html ($UI_META)"
tmp_ui="$(mktemp)"
UI_OK=0
if download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp_ui" \
  && grep -qE "$UI_META|proteger-sem-stake-equiv-v1|lockedCents" "$tmp_ui" \
  && grep -q 'data.lockedCents' "$tmp_ui" \
  && grep -q 'currentEventMaxCents' "$tmp_ui" \
  && grep -q 'Máx. efetivo neste evento' "$tmp_ui"; then
  n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-stake-lock-${BUST}" 2>/dev/null || true
    cp -f "$tmp_ui" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www /opt -type f -name 'app-proteger.html' -print0 2>/dev/null || true)
  [[ "$n" -gt 0 ]] && UI_OK=1 || echo "AVISO: nenhum app-proteger.html encontrado" >&2
  echo "  => $n arquivo(s)"
else
  echo "AVISO: UI não publicada (meta/download) — API stake_lock já reiniciada" >&2
fi
rm -f "$tmp_ui"

echo
echo "OK — createProtection agora trava o STAKE (não só a dedução)."
echo "  Markers: $CONTRACT_VER · $RUNTIME_MARKER · $MARKER · UI $UI_META (ok=$UI_OK)"
echo "  Teste: ativar R\$ 1.000 → Apostador cai R\$ 1.000 · Congelado sobe R\$ 1.000"
echo "  https://arbishield.app/app-proteger.html  (Ctrl+Shift+R)"
echo
echo "Validar pós-deploy:"
echo "  bash <(curl -fsSL \"$RAW/scripts/vps-check-pos-deploy-v10.sh?v=$BUST\")"
echo
echo "Obs: proteções já criadas em fee_upfront (ex.: a do vídeo, débito R\$ 96,11)"
echo "  continuam no modelo histórico no settle/cancel — não são reescritas."
