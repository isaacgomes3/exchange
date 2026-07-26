#!/usr/bin/env bash
# Patch rapido: libera /api/.../exchange-session/local-bridge no nginx BotShield
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-patch-nginx-local-bridge.sh?ref=cursor/botshield-local-bridge-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
roots = [Path("/etc/nginx/sites-enabled"), Path("/etc/nginx/sites-available"), Path("/etc/nginx/conf.d")]
needle = "exchange-session/mexchange-account|"
insert = "exchange-session/mexchange-account|exchange-session/local-bridge|"
n = 0
for root in roots:
    if not root.is_dir():
        continue
    for p in root.iterdir():
        if not p.is_file():
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if "exchange-session/mexchange-account" not in t:
            continue
        if "exchange-session/local-bridge" in t:
            print("ja ok", p)
            n += 1
            continue
        if needle not in t:
            print("formato diferente:", p)
            continue
        p.write_text(t.replace(needle, insert, 1), encoding="utf-8")
        print("patched", p)
        n += 1
print("arquivos=", n)
if n == 0:
    raise SystemExit("nenhum conf com mexchange-account encontrado")
PY
nginx -t
systemctl reload nginx
echo "OK — nginx com local-bridge. Ctrl+Shift+R no painel e Testar bridge."
