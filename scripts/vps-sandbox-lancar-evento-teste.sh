#!/usr/bin/env bash
# Lança ou revive evento de teste (publicado, odd 1.10 BACK).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-sandbox-lancar-evento-teste.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
DST_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$DST_DIR" /opt/arbishield-teste/scripts 2>/dev/null || true

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-sandbox-lancar-evento-teste.mjs?$(date +%s)" \
  -o "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"
cp -f "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs" \
  /opt/arbishield-teste/scripts/vps-sandbox-lancar-evento-teste.mjs 2>/dev/null || true
chmod 0755 "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"

# Garante que a UI não esconda sandbox_test (filtro antigo na produção)
python3 - <<'PY'
from pathlib import Path
import re
for p in Path("/var/www").rglob("app-proteger.html"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if "isSandboxMatch" not in t and "sandbox_test === true" not in t:
        continue
    n = re.sub(
        r"state\.matches = \(matchesRes\.data \|\| \[\]\)\.filter\(function \(m\) \{[\s\S]*?return isOnAvailableGrid\(m\);\s*\}\);",
        "state.matches = (matchesRes.data || []).filter(function (m) {\n"
        "            return isOnAvailableGrid(m);\n"
        "          });",
        t,
        count=1,
    )
    if n != t:
        p.write_text(n, encoding="utf-8")
        print("  UI: removeu filtro sandbox_test em", p)
PY

node "$DST_DIR/vps-sandbox-lancar-evento-teste.mjs"
