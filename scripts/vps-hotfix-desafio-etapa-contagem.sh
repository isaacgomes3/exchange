#!/usr/bin/env bash
# Corrige contagem da etapa do desafio (monitor / jornada / histórico do cliente).
# Etapa = circuito do USUÁRIO (vitórias + pendente). Evento/jogo NÃO mostra "Etapa".
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-etapa-contagem-8f4a/scripts/vps-hotfix-desafio-etapa-contagem.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-etapa-contagem-8f4a}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

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

publish_named() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-etapa-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  mkdir -p "$WEB" "$WEB_ROOT"
  cp -f "$tmp" "$WEB/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || echo "  AVISO: nenhum $name em /var/www (copiado em $WEB_ROOT)"
}

log "1/4 UI — monitor + jornada + cards"
for pair in \
  "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html|currentCycleParts|desafio-etapa-contagem-v4" \
  "deploy/vps-supabase/static/v2/app-desafio-jornada.html|j-journey-sticky|desafio-jornada-horizontal-v3" \
  "deploy/vps-supabase/static/v2/app-desafio.html|dzAndamento|desafio-em-andamento-v4"
do
  IFS='|' read -r rel needle marker <<<"$pair"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$needle" "$tmp" || die "$(basename "$rel") sem $needle"
  grep -q "$marker" "$tmp" || die "$(basename "$rel") sem $marker"
  if [[ "$rel" == *admin-monitoring-desafios.html ]]; then
    if grep -q '<th>Desafio</th>' "$tmp"; then
      die "monitor ainda tem coluna Desafio"
    fi
  fi
  if [[ "$rel" == *app-desafio-jornada.html ]]; then
    grep -q 'j-banner-slot' "$tmp" || die "jornada sem banner separado"
    grep -q 'j-event' "$tmp" || die "jornada sem card evento lançado"
    grep -q 'flex-direction: row' "$tmp" || die "jornada stepper não está horizontal"
    if grep -q 'j-map-banner' "$tmp"; then
      die "jornada ainda tem banner dentro do mapa"
    fi
    if grep -q 'won_external") return "won"' "$tmp"; then
      die "jornada ainda mapeia won_external como vitória"
    fi
  fi
  if [[ "$rel" == *app-desafio.html ]]; then
    grep -q 'dz-stepper' "$tmp" || die "app-desafio sem stepper horizontal"
    grep -q 'Desafio em andamento' "$tmp" || die "app-desafio sem seção em andamento"
    grep -q 'loadClientCircuit' "$tmp" || die "app-desafio sem loadClientCircuit"
    grep -q 'pendingStepIds' "$tmp" || die "app-desafio sem pendingStepIds"
    if grep -q 'dz-andamento-head' "$tmp"; then
      die "app-desafio ainda tem cabeçalho redundante Etapa/VER JORNADA"
    fi
    if grep -q 'próximo jogo jogável' "$tmp"; then
      die "app-desafio ainda promove jogo sem entrada a em andamento"
    fi
    if grep -q 'dz-v2-etapa' "$tmp"; then
      die "app-desafio.html ainda mostra Etapa no evento (dz-v2-etapa)"
    fi
  fi
  rm -f "$tmp"
  publish_named "$rel"
done

log "2/4 shim — jornada + histórico com etapa do circuito"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'indexesUnique' "$tmp_shim" || die "shim sem indexesUnique"
grep -q 'entryOrdinal' "$tmp_shim" || die "shim sem entryOrdinal"
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_shim"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true

log "3/4 smoke UI"
html="$(curl -fsS -m 8 "https://arbishield.app/admin-monitoring-desafios.html" 2>/dev/null || true)"
if echo "$html" | grep -q 'currentCycleParts' && echo "$html" | grep -q 'desafio-etapa-contagem-v4' && ! echo "$html" | grep -q '<th>Desafio</th>'; then
  echo "  smoke monitor → OK (cliente + etapa, sem coluna Desafio)"
else
  echo "  AVISO: monitor público ainda desatualizado (cache/path?)"
fi

log "4/4 done"
echo
echo "OK — Ctrl+Shift+R em:"
echo "  https://arbishield.app/admin-monitoring-desafios.html"
echo "  https://arbishield.app/app-desafio.html"
echo "  https://arbishield.app/app-desafio-jornada.html"
