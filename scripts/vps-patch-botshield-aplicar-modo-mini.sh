#!/usr/bin/env bash
# Mini-patch (root). Sem base64 / sem GitHub. Cole inteiro.
set -euo pipefail
python3 - <<'PY'
from pathlib import Path

p = Path("/var/www/arbishield-botshield/integracoes.html")
t = p.read_text(encoding="utf-8")
old = (
    '        if (provider === "betbra" && !body.accessToken) {\n'
    '          status.textContent =\n'
    '            "Para BetBra live, salve login/senha em Conta BetBra (ou cole um token).";\n'
    '          return;\n'
    '        }'
)
new = (
    '        if (provider === "betbra" && !body.accessToken) {\n'
    '          body.useSaved = true;\n'
    '        }'
)
if "useSaved" in t:
    print("UI já ok")
elif old not in t:
    raise SystemExit("ERRO UI: padrão não encontrado")
else:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("UI OK")

block = '''
    const useSaved = body?.useSaved === true || body?.useSavedCredentials === true || body?.reuseSession === true;
    if (!accessToken && !(login && password) && useSaved && provider !== "demo") {
      const existing = await sessionStatus(token, { provider });
      if (!existing?.connected) {
        const err = new Error("Nenhuma Conta BetBra salva. Cadastre login/senha em Conta BetBra.");
        err.status = 400; throw err;
      }
      if (!existing.hasPassword && existing.authMode !== "token") {
        const err = new Error("Conta BetBra incompleta (sem senha). Salve de novo em Conta BetBra ou cole um token.");
        err.status = 400; throw err;
      }
      return {
        ok: true,
        connectionId: existing.connectionId,
        provider: existing.provider || provider,
        status: existing.status || "active",
        demo: false,
        hasLogin: !!existing.hasLogin,
        loginMasked: existing.loginMasked || null,
        authMode: existing.authMode || (existing.hasPassword ? "credentials" : "token"),
        reused: true,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
        adapter: adapter.provider,
        live: process.env.EXCHANGE_ORDERS_LIVE === "1" || process.env.EXCHANGE_ORDERS_LIVE === "true",
      };
    }
'''
anchor = (
    '    if (!accessToken && login && password) {\n'
    '      accessToken = `cred:${login}`;\n'
    '    }\n'
    '    if (!accessToken && !(login && password)) {'
)
repl = (
    '    if (!accessToken && login && password) {\n'
    '      accessToken = `cred:${login}`;\n'
    '    }'
    + block
    + '    if (!accessToken && !(login && password)) {'
)

n = 0
seen = set()
for s in (
    "/opt/arbishield/scripts/lib/exchange-orders-service.mjs",
    "/opt/arbishield/lib/exchange-orders-service.mjs",
):
    path = Path(s)
    if not path.is_file() or str(path.resolve()) in seen:
        continue
    seen.add(str(path.resolve()))
    text = path.read_text(encoding="utf-8")
    if "reuseSession" in text:
        print("svc já ok", s)
        n += 1
        continue
    if anchor not in text:
        raise SystemExit("ERRO svc: âncora não encontrada em " + s)
    path.write_text(text.replace(anchor, repl, 1), encoding="utf-8")
    print("svc OK", s)
    n += 1
if not n:
    raise SystemExit("ERRO: exchange-orders-service.mjs não encontrado")
print("PATCH OK")
PY
systemctl restart arbishield-serverfn-shim.service
systemctl is-active arbishield-serverfn-shim.service
echo "OK. Hard refresh em /integracoes.html → BetBra → Aplicar modo"
