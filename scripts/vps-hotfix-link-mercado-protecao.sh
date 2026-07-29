#!/usr/bin/env bash
# Link do mercado (BetBra/casa) disponível na área do usuário:
# - grade Proteger Aposta (botão da casa)
# - drawer de proteção
# - Minhas Proteções (detalhe)
# - admin grava o link também em markets[]
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA_OU_BRANCH>/scripts/vps-hotfix-link-mercado-protecao.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/link-mercado-protecao-9c21}"
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

install_html() {
  local name="$1"
  local marker="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "deploy/vps-supabase/static/v2/$name" "$tmp"
  grep -q "$marker" "$tmp" || die "$name sem marker $marker"
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-link-mercado-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  for f in "$WEB/$name" "$WEB_ROOT/$name" "$WEB_ROOT/sandbox/$name"; do
    mkdir -p "$(dirname "$f")" 2>/dev/null || true
    [[ -d "$(dirname "$f")" ]] || continue
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done
  rm -f "$tmp"
}

log "1/4 UI app-proteger.html (botão casa + drawer)"
install_html "app-proteger.html" "proteger-link-mercado-v1"
grep -q 'term-house-link' "$WEB/app-proteger.html" || die "proteger sem term-house-link"
grep -q 'houseLinkHtml' "$WEB/app-proteger.html" || die "proteger sem houseLinkHtml"

log "2/4 UI app-protecoes.html (link no detalhe)"
install_html "app-protecoes.html" "Abrir mercado"
grep -q 'metadata' "$WEB/app-protecoes.html" || die "protecoes sem select metadata"

log "3/4 UI admin-jogos.html (espelha link nos markets)"
install_html "admin-jogos.html" "Espelha o link em cada mercado"
grep -q 'manExternalBetLink' "$WEB/admin-jogos.html" || die "admin sem manExternalBetLink"

log "4/4 prelive — markets[] com external_bet_link no manual"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'rowMarket.external_bet_link' "$tmp_pre" || die "prelive sem stamp de external_bet_link nos markets"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
# Copia também para o ExecStart real do service, se diferente
for u in arbishield-prelive-events.service arbishield-prelive.service; do
  exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null || true)"
  if [[ "$exec" =~ (/[^[:space:]]+arbishield-prelive-events\.mjs) ]]; then
    cp -f "$tmp_pre" "${BASH_REMATCH[1]}"
    chmod 0755 "${BASH_REMATCH[1]}"
    echo "  OK ${BASH_REMATCH[1]} (via $u)"
  fi
done
rm -f "$tmp_pre"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || \
  echo "AVISO: não reiniciou prelive (reinicie manualmente se preciso)"

log "OK — Ctrl+Shift+R em Proteger Aposta / Minhas Proteções / Gestão de Jogos"
echo "  https://arbishield.app/app-proteger.html"
echo "  https://arbishield.app/app-protecoes.html"
echo "  https://arbishield.app/admin-jogos.html"
