#!/usr/bin/env bash
# Remove as abas Todos/Futebol/Hoje/Amanhã/Alta do app-desafio.html NA VPS,
# mesmo se o HTML estiver em versão antiga (não depende de baixar o arquivo certo).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-strip-filters.sh?v=1")
set -euo pipefail

WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
TARGETS=(
  "$WEB_ROOT/v2/app-desafio.html"
  "$WEB_ROOT/app-desafio.html"
)

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

patched=0
for f in "${TARGETS[@]}"; do
  [[ -f "$f" ]] || continue
  log "patch $f"
  python3 - "$f" <<'PY'
from pathlib import Path
import re, sys

p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
orig = t

t, n = re.subn(
    r'\s*<div class="dz-filters"[^>]*>[\s\S]*?</div>\s*',
    "\n\n",
    t,
    count=1,
)
print(f"  blocos dz-filters removidos: {n}")

# Remove botões soltos se o markup tiver mudado
t2, n2 = re.subn(
    r'\s*<button[^>]*class="dz-filter[^"]*"[^>]*>[\s\S]*?</button>\s*',
    "\n",
    t,
)
if n2:
    print(f"  botões dz-filter removidos: {n2}")
    t = t2

css = """
    /* hotfix: esconde abas do Desafio */
    .dz-filters,
    #filters[role="tablist"],
    button.dz-filter {
      display: none !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      visibility: hidden !important;
    }
"""
if "hotfix: esconde abas do Desafio" not in t and "</style>" in t:
    t = t.replace("</style>", css + "\n  </style>", 1)
    print("  CSS hide injetado")

if "desafio-no-filter-tabs" not in t and "Desafios disponíveis" in t:
    t = t.replace(
        '<div class="section-label">',
        '<!-- desafio-no-filter-tabs -->\n  <div class="section-label">',
        1,
    )

if t == orig:
    print("  (nenhuma alteração — já limpo?)")
else:
    p.write_text(t, encoding="utf-8")
    print("  gravado")

if 'data-f="Todos"' in t or 'id="filters"' in t:
    raise SystemExit("ainda há abas no HTML após o patch")
print("  OK sem abas")
PY
  patched=1
done

[[ "$patched" -eq 1 ]] || die "app-desafio.html não encontrado em $WEB_ROOT"
log "feito — Ctrl+F5 em /app-desafio.html"
