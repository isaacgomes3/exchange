#!/usr/bin/env bash
# Atualiza app-desafio.html + v2.css (card com fundo estádio, Copiar, sem abas…).
# Usa jsDelivr + SHA do tip para evitar HTML antigo em cache.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-app-html.sh?v=14")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
DEST="$WEB/app-desafio.html"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB/brand"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"

RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then
    return 0
  fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "app-desafio.html"
fetch "deploy/vps-supabase/static/v2/app-desafio.html" "$DEST"
chmod 0644 "$DEST"
cp -f "$DEST" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true

grep -q 'data-casa-copy' "$DEST" || die "HTML sem botão Copiar"
grep -q 'stadium-hero' "$DEST" || die "HTML sem fundo estádio"
grep -q 'dz-v2-row-stake' "$DEST" || die "HTML sem campo stake alinhado à esquerda"
grep -q '3.1rem' "$DEST" || die "HTML sem X/horário 2× maior"
grep -q 'dz-v2-panel-market' "$DEST" || die "HTML sem mercado por painel (Arbi/Casa)"
grep -q 'resolveSideMarkets' "$DEST" || die "HTML sem resolveSideMarkets"
grep -q 'dz-v2-retorno' "$DEST" || die "HTML sem barra RETORNO CERTO"
grep -q 'background: #c9f223' "$DEST" || die "HTML sem barra retorno em verde limão"
grep -q 'desafioCompound\|stepIndex > 1\|Etapa 2+' "$DEST" || grep -q 'lucroCents' "$DEST" || die "HTML sem cálculo composto etapa 2+"
grep -q 'desafio-no-filter-tabs' "$DEST" || die "HTML sem marcador sem-abas"
grep -q 'dz-section-head' "$DEST" || die "HTML sem título Desafio Disponível/Em andamento"
grep -q 'data-f="Todos"' "$DEST" && die "HTML ainda tem abas Todos"

# Strip filters se sobrar
python3 - "$DEST" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
t2, n = re.subn(r'\s*<div class="dz-filters"[^>]*>[\s\S]*?</div>\s*', "\n\n", t, count=1)
if n:
    p.write_text(t2, encoding="utf-8")
    print(f"  removeu {n} bloco(s) dz-filters")
PY

log "v2.css (card estádio + perfil)"
fetch "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'stadium-hero.jpg' "$WEB/v2.css" || die "CSS sem stadium-hero"
grep -q '\.dz-v2-retorno' "$WEB/v2.css" || die "CSS sem .dz-v2-retorno"
grep -Eq 'dz-v2-retorno[\s\S]{0,200}#c9f223' "$WEB/v2.css" || grep -q 'background: #c9f223' "$WEB/v2.css" || die "CSS sem retorno limão"
grep -q '\.pf-page' "$WEB/v2.css" || die "CSS sem Meu Perfil (.pf-page)"

log "brand stadium (se faltar)"
for f in stadium-hero.jpg stadium-hero-sm.jpg; do
  if [[ ! -f "$WEB/brand/$f" ]]; then
    fetch "deploy/vps-supabase/static/v2/brand/$f" "$WEB/brand/$f" || true
  fi
  if [[ ! -f "$WEB/brand/$f" ]]; then
    # tenta espelhar da raiz brand do site
    [[ -f "$WEB_ROOT/brand/$f" ]] && cp -f "$WEB_ROOT/brand/$f" "$WEB/brand/$f" || true
  fi
  [[ -f "$WEB/brand/$f" ]] || log "aviso: $f não encontrado (nginx pode servir /brand/ da raiz)"
done

BYTES=$(wc -c < "$DEST" | tr -d ' ')
log "OK instalado em $DEST ($BYTES bytes)"

log "admin-desafio-lancar.html (comissão padrão 0)"
fetch "deploy/vps-supabase/static/v2/admin-desafio-lancar.html" "$WEB/admin-desafio-lancar.html"
chmod 0644 "$WEB/admin-desafio-lancar.html"
cp -f "$WEB/admin-desafio-lancar.html" "$WEB_ROOT/admin-desafio-lancar.html" 2>/dev/null || true
grep -q 'casa_commission_pct: "0"' "$WEB/admin-desafio-lancar.html" || die "lançar sem comissão casa padrão 0"

# Shim (lucro composto etapa 2+)
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
if [[ -n "${SHIM_PATH:-}" ]]; then
  log "Atualizando shim em $SHIM_PATH"
  fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
  chmod 0644 "$SHIM_PATH"
  grep -q 'desafioCompoundProfitCents' "$SHIM_PATH" || die "shim sem desafioCompoundProfitCents"
  # comissão casa default 0 no buildStepRow
  python3 - "$SHIM_PATH" <<'PY' || true
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
if "casa_commission_pct" in t and ": 4.5" in t:
    print("aviso: ainda há default 4.5 no shim — confira buildStepRow")
PY
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
else
  log "aviso: shim não encontrado — lucro composto no settle só após atualizar o shim"
fi

# prelive (append step) se existir no mesmo host
for PRE in /opt/arbishield/scripts/arbishield-prelive-events.mjs /opt/arbishield/arbishield-prelive-events.mjs; do
  if [[ -f "$PRE" ]]; then
    log "Atualizando prelive $PRE"
    fetch "scripts/arbishield-prelive-events.mjs" "$PRE" || true
    break
  fi
done

log "Ctrl+F5 em https://arbishield.app/admin-desafio-lancar.html"
