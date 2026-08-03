#!/usr/bin/env bash
# Verifica/corrige rota balance no BotShield (cole na VPS root).
# O erro anterior era falso: curl em :80 recebe 301 HTML → HTTPS.
set -euo pipefail

echo "==> confs com balance?"
grep -Rns 'exchange-session/balance' /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ /etc/nginx/conf.d/ 2>/dev/null \
  || echo "(nenhuma — preciso patchar)"

# Se faltar, injeta na allowlist
python3 <<'PY'
from pathlib import Path
old = (
    "exchange-session/connect|exchange-session/disconnect|"
    "exchange-session/status|exchange-orders"
)
new = (
    "exchange-session/connect|exchange-session/disconnect|"
    "exchange-session/status|exchange-session/balance|exchange-orders"
)
paths = []
for root in (Path("/etc/nginx/sites-available"), Path("/etc/nginx/sites-enabled"), Path("/etc/nginx/conf.d")):
    if not root.is_dir():
        continue
    for p in root.iterdir():
        if not p.is_file() and not p.is_symlink():
            continue
        try:
            real = p.resolve()
        except Exception:
            continue
        if "botshield" not in real.name.lower() and "botshield" not in str(real).lower():
            # ler conteúdo
            try:
                t = real.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if "botshield" not in t.lower():
                continue
        else:
            try:
                t = real.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
        if "exchange-session/balance" in t:
            print("já ok:", real)
            continue
        if old not in t:
            print("sem âncora:", real)
            continue
        real.write_text(t.replace(old, new, 1), encoding="utf-8")
        print("patched:", real)
        paths.append(str(real))
print("done patch loop")
PY

nginx -t
systemctl reload nginx
echo "nginx: $(systemctl is-active nginx)"

echo ""
echo "==> 1) shim direto :3101 (sem auth → JSON 401/400 OK)"
curl -sS -o /tmp/bs-shim.json -w "HTTP %{http_code}\n" \
  -H "Accept: application/json" --max-time 10 \
  "http://127.0.0.1:3101/api/arbishield/exchange-session/balance?provider=betbra" || true
head -c 220 /tmp/bs-shim.json; echo

echo ""
echo "==> 2) via nginx HTTPS :443 (Host botshield) — este é o teste certo"
curl -skS -o /tmp/bs-ngx.json -w "HTTP %{http_code}\n" \
  -H "Accept: application/json" \
  -H "Host: botshield.arbishield.app" \
  --max-time 15 \
  "https://127.0.0.1/api/arbishield/exchange-session/balance?provider=betbra" || true
head -c 220 /tmp/bs-ngx.json; echo

if grep -qiE '<html|DOCTYPE' /tmp/bs-ngx.json 2>/dev/null; then
  echo ""
  echo "ERRO REAL: HTTPS ainda devolve HTML."
  echo "Mostrando location atual:"
  grep -n 'exchange-session' /etc/nginx/sites-enabled/botshield.arbishield.app \
    /etc/nginx/sites-available/botshield.arbishield.app \
    /etc/nginx/conf.d/botshield.arbishield.app.conf 2>/dev/null || true
  exit 1
fi

echo ""
echo "OK — rota balance proxyada (JSON do shim)."
echo "Hard refresh: https://botshield.arbishield.app/conta-betbra.html → Atualizar saldo"
