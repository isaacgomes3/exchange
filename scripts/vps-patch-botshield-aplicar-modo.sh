#!/usr/bin/env bash
# Colar inteiro na VPS (root). Patch pequeno — sem base64 / sem GitHub.
# Corrige: Aplicar modo BetBra com Conta BetBra salva (sem exigir token).
set -euo pipefail
WEB="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"
SHIM="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCR="${ARBISHIELD_SCRIPTS:-$SHIM/scripts}"

python3 - "$WEB" "$SHIM" "$SCR" <<'PY'
import sys
from pathlib import Path

web, shim, scr = sys.argv[1], sys.argv[2], sys.argv[3]
html_path = Path(web) / "integracoes.html"
svc_paths = [
    Path(scr) / "lib" / "exchange-orders-service.mjs",
    Path(shim) / "lib" / "exchange-orders-service.mjs",
    Path(shim) / "scripts" / "lib" / "exchange-orders-service.mjs",
]

# --- UI ---
if not html_path.is_file():
    raise SystemExit(f"ERRO: falta {html_path}")
html = html_path.read_text(encoding="utf-8")
if "useSaved" in html and "liveLabel" in html:
    print(f"UI já patchada: {html_path}")
else:
    old = '''      document.getElementById("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        err.classList.remove("show");
        const fd = new FormData(e.target);
        const provider = String(fd.get("provider") || "demo");
        const body = {
          provider,
          accessToken: String(fd.get("accessToken") || "").trim(),
        };
        if (provider === "demo" && !body.accessToken) body.accessToken = "demo";
        if (provider === "betbra" && !body.accessToken) {
          status.textContent =
            "Para BetBra live, salve login/senha em Conta BetBra (ou cole um token).";
          return;
        }
        try {
          const res = await fetch("/api/arbishield/exchange-session/connect", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + (await token()),
            },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Falha ao conectar");
          status.textContent =
            "Modo " +
            (json.provider || provider) +
            (json.demo ? " · demo" : " · live-ready");
        } catch (ex) {
          err.textContent = ex instanceof Error ? ex.message : String(ex);
          err.classList.add("show");
        }
      });'''
    new = '''      function liveLabel(json) {
        if (json && json.live === true) return " · LIVE ligado";
        if (json && json.live === false) return " · LIVE desligado na VPS";
        return "";
      }

      document.getElementById("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        err.classList.remove("show");
        const fd = new FormData(e.target);
        const provider = String(fd.get("provider") || "demo");
        const accessToken = String(fd.get("accessToken") || "").trim();
        const body = { provider };
        if (provider === "demo") {
          body.accessToken = accessToken || "demo";
        } else if (accessToken) {
          body.accessToken = accessToken;
        } else {
          body.useSaved = true;
        }
        try {
          const res = await fetch("/api/arbishield/exchange-session/connect", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + (await token()),
            },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Falha ao conectar");
          const mode =
            json.demo || provider === "demo"
              ? "demo"
              : json.reused
                ? "BetBra (conta salva)"
                : "BetBra";
          status.textContent =
            "Modo " + mode + (json.demo ? "" : " · live-ready") + liveLabel(json);
        } catch (ex) {
          err.textContent = ex instanceof Error ? ex.message : String(ex);
          err.classList.add("show");
        }
      });'''
    if old not in html:
        # fallback: só troca o early-return que bloqueia sem token
        needle = '''        if (provider === "betbra" && !body.accessToken) {
          status.textContent =
            "Para BetBra live, salve login/senha em Conta BetBra (ou cole um token).";
          return;
        }'''
        repl = '''        if (provider === "betbra" && !body.accessToken) {
          body.useSaved = true;
        }'''
        if needle not in html:
            raise SystemExit(
                "ERRO: padrão antigo da UI não encontrado — cole o arquivo integracoes.html manualmente"
            )
        html = html.replace(needle, repl, 1)
        print(f"UI patch mínimo OK: {html_path}")
    else:
        html = html.replace(old, new, 1)
        print(f"UI patch completo OK: {html_path}")
    html_path.write_text(html, encoding="utf-8")

# --- service ---
USESAVED = r'''
    // Reaplicar modo BetBra com credenciais/token já salvos (sem reenviar senha)
    const useSaved =
      body?.useSaved === true ||
      body?.useSavedCredentials === true ||
      body?.reuseSession === true;
    if (!accessToken && !(login && password) && useSaved && provider !== "demo") {
      const existing = await sessionStatus(token, { provider });
      if (!existing?.connected) {
        const err = new Error(
          "Nenhuma Conta BetBra salva. Cadastre login/senha em Conta BetBra."
        );
        err.status = 400;
        throw err;
      }
      if (!existing.hasPassword && existing.authMode !== "token") {
        const err = new Error(
          "Conta BetBra incompleta (sem senha). Salve de novo em Conta BetBra ou cole um token."
        );
        err.status = 400;
        throw err;
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
        live:
          process.env.EXCHANGE_ORDERS_LIVE === "1" ||
          process.env.EXCHANGE_ORDERS_LIVE === "true",
      };
    }
'''

ANCHOR = """    if (!accessToken && login && password) {
      accessToken = `cred:${login}`;
    }
    if (!accessToken && !(login && password)) {"""

patched_any = False
found_any = False
for svc in svc_paths:
    if not svc.is_file():
        continue
    found_any = True
    text = svc.read_text(encoding="utf-8")
    if "useSaved" in text and "reuseSession" in text:
        print(f"service já patchado: {svc}")
        continue
    if ANCHOR not in text:
        raise SystemExit(f"ERRO: âncora não encontrada em {svc}")
    text = text.replace(
        ANCHOR,
        "    if (!accessToken && login && password) {\n"
        "      accessToken = `cred:${login}`;\n"
        "    }"
        + USESAVED
        + "    if (!accessToken && !(login && password)) {",
        1,
    )
    # status: incluir live
    old_disc = """      if (!conn) {
        return {
          ok: true,
          connected: false,
          provider,
          hasLogin: false,
          hasPassword: false,
          loginMasked: null,
        };
      }"""
    new_disc = """      const live =
        process.env.EXCHANGE_ORDERS_LIVE === "1" ||
        process.env.EXCHANGE_ORDERS_LIVE === "true";
      if (!conn) {
        return {
          ok: true,
          connected: false,
          provider,
          hasLogin: false,
          hasPassword: false,
          loginMasked: null,
          live,
        };
      }"""
    if old_disc in text and "loginMasked: null,\n          live," not in text:
        text = text.replace(old_disc, new_disc, 1)
    old_ok = """        connectedAt: conn.connected_at,
        demo: conn.provider === "demo",
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      };"""
    new_ok = """        connectedAt: conn.connected_at,
        demo: conn.provider === "demo",
        live,
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      };"""
    if old_ok in text and "demo: conn.provider === \"demo\",\n        live," not in text:
        # só se já inserimos const live acima; senão injeta live inline
        if "const live =" not in text.split("async function sessionStatus")[1][:800]:
            text = text.replace(
                old_ok,
                """        connectedAt: conn.connected_at,
        demo: conn.provider === "demo",
        live:
          process.env.EXCHANGE_ORDERS_LIVE === "1" ||
          process.env.EXCHANGE_ORDERS_LIVE === "true",
        contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      };""",
                1,
            )
        else:
            text = text.replace(old_ok, new_ok, 1)
    svc.write_text(text, encoding="utf-8")
    print(f"service OK: {svc}")
    patched_any = True

if not found_any:
    raise SystemExit("ERRO: exchange-orders-service.mjs não encontrado")

print("PATCH OK")
PY

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl is-active arbishield-serverfn-shim.service || true
echo ""
echo "OK. Hard refresh: https://botshield.arbishield.app/integracoes.html"
echo "Modo BetBra → Aplicar modo (sem token)."
