#!/usr/bin/env bash
# Gestão de Jogos (BetBra): todas as odds + BACK/LAY + link do mercado ao publicar.
# Baixa via GitHub API (evita cache velho do raw.githubusercontent.com).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-admin-jogos-back-lay.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
PRELIVE_DST="${ARBISHIELD_PRELIVE:-$SHIM_DIR/arbishield-prelive-events.mjs}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

# Prefer API (evita cache velho do raw.githubusercontent.com)
download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&$(date +%s)" -o "$out"; then
    [[ -s "$out" ]] && return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  chmod 0644 "$WEB/$name"
  # outras cópias em /var/www
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $WEB/$name ($(wc -c < "$WEB/$name" | tr -d ' ') bytes)"
}

log "1/3 UI — admin-jogos (odds + BACK/LAY + link do mercado)"
publish_web "deploy/vps-supabase/static/v2/admin-jogos.html"

grep -qE 'admin-jogos-(back-lay-link|betbra-first)-v[0-9]+' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem marker de build (ficheiro antigo/cache)"
grep -q 'settleHint' "$WEB/admin-jogos.html" && die "banner settleHint ainda presente" || true
# BetBra primeiro nos botões (btnAddMatch antes de btnManualMatch)
python3 -c '
import sys
html=open(sys.argv[1],encoding="utf-8").read()
i=html.find("id=\"btnAddMatch\"")
j=html.find("id=\"btnManualMatch\"")
sys.exit(0 if 0<=i<j else 1)
' "$WEB/admin-jogos.html" || die "BetBra não está primeiro nos botões"
grep -q 'var view = "prelive"' "$WEB/admin-jogos.html" || die "view default não é prelive"
grep -q 'btn-side lay' "$WEB/admin-jogos.html" || die "sem botão LAY"
grep -q 'btn-side back' "$WEB/admin-jogos.html" || die "sem botão BACK"
grep -q 'runnerSideOdd' "$WEB/admin-jogos.html" || die "sem runnerSideOdd"
grep -q 'external_bet_link' "$WEB/admin-jogos.html" || die "sem external_bet_link"
grep -q 'marketLink' "$WEB/admin-jogos.html" || die "sem marketLink no publish"
grep -q 'id="onlyWithOdds"' "$WEB/admin-jogos.html" || die "sem onlyWithOdds"
if grep -E 'id="onlyWithOdds"[^>]*checked' "$WEB/admin-jogos.html" >/dev/null; then
  die "onlyWithOdds ainda checked por defeito"
fi

log "2/3 UI — app-proteger (CTA Abrir mercado na BetBra)"
publish_web "deploy/vps-supabase/static/v2/app-proteger.html"
grep -q 'drawerBetLink' "$WEB/app-proteger.html" || die "sem drawerBetLink"
grep -q 'marketBetLink' "$WEB/app-proteger.html" || die "sem marketBetLink"

log "3/3 API — prelive (marketType + link no mercado)"
if [[ -f "$PRELIVE_DST" ]] || [[ -d "$SHIM_DIR" ]]; then
  mkdir -p "$(dirname "$PRELIVE_DST")"
  tmp="$(mktemp)"
  download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp" \
    || die "download falhou: prelive"
  cp -f "$tmp" "$PRELIVE_DST"
  chmod 0644 "$PRELIVE_DST"
  rm -f "$tmp"
  grep -q 'marketType || body.market_type' "$PRELIVE_DST" || die "prelive sem marketType"
  grep -q 'resolvedMarketLink' "$PRELIVE_DST" || die "prelive sem resolvedMarketLink"
  echo "  OK $PRELIVE_DST"
  if command -v systemctl >/dev/null 2>&1; then
    for svc in arbishield-prelive arbishield-shim arbishield; do
      if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
        systemctl restart "$svc" || true
        log "restart $svc"
      fi
    done
  fi
else
  log "aviso: $PRELIVE_DST não existe — só UI atualizada"
fi

log "OK — hard refresh (Ctrl+Shift+R) em admin-jogos e app-proteger"
)
