#!/usr/bin/env bash
# FORCE Apostador Carlos → R$ 8.976,41 · Congelado 0
# (stake do último jogo que não voltou)
#
# Na VPS (root) — COLE A SAÍDA SE FALHAR:
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-force-carlos-897641.sh?$(date +%s)" -o /tmp/force-carlos.sh
#   bash /tmp/force-carlos.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR"

log "Checando .env"
for f in \
  /opt/arbishield/deploy/vps-supabase/.env \
  /opt/arbishield/.env \
  /opt/arbishield/scripts/.env \
  /root/.arbishield.env
do
  if [[ -f "$f" ]]; then
    echo "  OK $f ($(wc -c <"$f") bytes)"
    grep -E '^(SERVICE_ROLE_KEY|ARBISHIELD_SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_URL|ARBISHIELD_SUPABASE_URL|API_EXTERNAL_URL)=' "$f" \
      | sed -E 's/=.*/=***/' || true
  else
    echo "  -- $f"
  fi
done

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "Hotfix settle v9 (devolve stake)"
tmp_hf="$(mktemp)"
if curl -fsSL --retry 3 "$RAW/scripts/vps-hotfix-exchange-so-deducao-v9.sh?v=$BUST" -o "$tmp_hf" && [[ -s "$tmp_hf" ]]; then
  bash "$tmp_hf" || echo "AVISO: hotfix com erro — sigo"
else
  echo "AVISO: hotfix não baixou — sigo"
fi
rm -f "$tmp_hf"

log "Baixar force script"
tmp="$(mktemp)"
download_repo_file "scripts/vps-force-carlos-897641.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-force-carlos-897641.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-force-carlos-897641.mjs"
rm -f "$tmp"

log "DRY-RUN (lista candidatos)"
node "$SCRIPTS_DIR/vps-force-carlos-897641.mjs" || true

log "FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-force-carlos-897641.mjs"

echo
echo "Se a tela ainda estiver errada:"
echo "  1) Ctrl+Shift+R no Financeiro"
echo "  2) sair e entrar de novo no Espelho"
echo "  3) cole TODA a saída deste script"
