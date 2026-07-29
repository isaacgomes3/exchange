#!/usr/bin/env bash
# Libera /api/arbishield/exchange-session/balance no nginx do BotShield.
# Cole na VPS (root). Sem GitHub.
set -euo pipefail

python3 <<'PY'
from pathlib import Path

candidates = [
    Path("/etc/nginx/sites-available/botshield.arbishield.app"),
    Path("/etc/nginx/sites-enabled/botshield.arbishield.app"),
    Path("/etc/nginx/conf.d/botshield.arbishield.app.conf"),
]
old = (
    "exchange-session/connect|exchange-session/disconnect|"
    "exchange-session/status|exchange-orders"
)
new = (
    "exchange-session/connect|exchange-session/disconnect|"
    "exchange-session/status|exchange-session/balance|exchange-orders"
)
n = 0
seen = set()
for p in candidates:
    if not p.is_file():
        continue
    real = str(p.resolve())
    if real in seen:
        continue
    seen.add(real)
    t = p.read_text(encoding="utf-8")
    if "exchange-session/balance" in t:
        print("já ok:", p)
        n += 1
        continue
    if old not in t:
        raise SystemExit(f"âncora nginx não encontrada em {p}")
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("patched:", p)
    n += 1
if not n:
    raise SystemExit("ERRO: conf nginx botshield não encontrada")
print("OK arquivos nginx")
PY

nginx -t
systemctl reload nginx
echo "OK nginx — balance liberado."
echo "Hard refresh → Conta BetBra → Atualizar saldo."
