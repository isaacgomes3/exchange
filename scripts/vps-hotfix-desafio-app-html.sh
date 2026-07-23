#!/usr/bin/env bash
# Atualiza SOMENTE app-desafio.html na VPS (abas fora + Copiar + stake editável).
# Usa jsDelivr + SHA do tip para evitar HTML antigo em cache.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-app-html.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
DEST="$WEB/app-desafio.html"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"

URL_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}/deploy/vps-supabase/static/v2/app-desafio.html"
URL_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/deploy/vps-supabase/static/v2/app-desafio.html?t=$(date +%s)"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log "baixando app-desafio.html"
if ! curl -fsSL "$URL_JS" -o "$TMP"; then
  log "jsDelivr falhou — raw.githubusercontent"
  curl -fsSL "$URL_GH" -o "$TMP"
fi

# Garantias mínimas do arquivo novo
grep -q 'data-casa-copy' "$TMP" || die "download sem botão Copiar"
grep -q 'data-stake-input' "$TMP" || die "download sem Entrar com editável"
grep -q 'desafio-no-filter-tabs' "$TMP" || die "download sem marcador sem-abas"
grep -q 'dz-section-head' "$TMP" || die "download sem título Desafio Disponível/Em andamento"
grep -q 'dz-dot-pulse' "$TMP" || die "download sem animação pulsante do ícone"
grep -q 'data-f="Todos"' "$TMP" && die "download ainda tem abas Todos"

# Strip + CSS hide (cinto de segurança)
python3 - "$TMP" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
t, n = re.subn(r'\s*<div class="dz-filters"[^>]*>[\s\S]*?</div>\s*', "\n\n", t, count=1)
css = """
    /* hotfix: esconde abas do Desafio */
    .dz-filters, #filters[role="tablist"], button.dz-filter {
      display: none !important; height: 0 !important; margin: 0 !important;
      padding: 0 !important; overflow: hidden !important; visibility: hidden !important;
    }
"""
if "hotfix: esconde abas do Desafio" not in t and "</style>" in t:
    t = t.replace("</style>", css + "\n  </style>", 1)
if n or True:
    p.write_text(t, encoding="utf-8")
print(f"  strip filters: {n}")
PY

cp -f "$TMP" "$DEST"
chmod 0644 "$DEST"
# espelho se existir path antigo
if [[ -d "$WEB_ROOT" ]]; then
  cp -f "$DEST" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
fi

# Prova final no arquivo instalado
grep -q 'data-casa-copy' "$DEST" || die "instalado sem Copiar"
grep -q 'data-f="Todos"' "$DEST" && die "instalado ainda tem abas"
BYTES=$(wc -c < "$DEST" | tr -d ' ')
log "OK instalado em $DEST ($BYTES bytes)"
log "Ctrl+F5 em https://arbishield.app/app-desafio.html"
