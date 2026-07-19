#!/usr/bin/env python3
"""CSR boot com bootstrap $_TSR (obrigatório) e sem HTML SSR da home."""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
INDEX = WWW / "index.html"
ASSETS = WWW / "assets"
BAK = WWW / "index.html.ssr-bak"


def patch_main(main_path: Path) -> None:
    main_src = main_path.read_text(encoding="utf-8", errors="replace")
    main_bak = main_path.with_suffix(".js.hydrate-bak")
    if not main_bak.exists():
        shutil.copy2(main_path, main_bak)

    old = "y.startTransition(()=>{coe.hydrateRoot(document,u.jsx(y.StrictMode,{children:u.jsx(cot,{})}))});"
    new = (
        "y.startTransition(()=>{"
        'document.body.innerHTML="";'
        "coe.createRoot(document.body).render(u.jsx(y.StrictMode,{children:u.jsx(cot,{})}))"
        "});"
    )
    if "coe.createRoot(document.body).render" in main_src:
        print("main já em createRoot")
    elif old not in main_src:
        if main_bak.exists():
            main_src = main_bak.read_text(encoding="utf-8", errors="replace")
        if old not in main_src:
            raise SystemExit("padrão hydrateRoot não encontrado")
        main_path.write_text(main_src.replace(old, new, 1), encoding="utf-8")
        print("main: hydrateRoot → createRoot")
    else:
        main_path.write_text(main_src.replace(old, new, 1), encoding="utf-8")
        print("main: hydrateRoot → createRoot")


def patch_runtime_stability(main_path: Path, assets: Path) -> None:
    """Evita freeze no /auth e hangs eternos no beforeLoad do /app."""
    mt = main_path.read_text(encoding="utf-8", errors="replace")
    replacements = [
        (
            'window.location.replace("/auth"),await new Promise(()=>{})',
            'window.location.replace("/auth"),await new Promise(e=>setTimeout(e,50))',
        ),
        (
            'window.location.replace("/auth?redirect=/m"),await new Promise(()=>{})',
            'window.location.replace("/auth?redirect=/m"),await new Promise(e=>setTimeout(e,50))',
        ),
    ]
    changed = 0
    for old, new in replacements:
        if old in mt:
            mt = mt.replace(old, new)
            changed += 1
    if changed:
        main_path.write_text(mt, encoding="utf-8")
        print(f"main: beforeLoad hang patched x{changed}")

    for auth in assets.glob("auth-*.js"):
        if auth.name.endswith(".bak") or ".anim-bak" in auth.name:
            continue
        t = auth.read_text(encoding="utf-8", errors="replace")
        orig = t
        t = t.replace("repeat:1/0", "repeat:0")
        t = t.replace("blur(40px)", "blur(8px)")
        old_login = (
            'localStorage.setItem("auth_login_pending_until",String(Date.now()+15e3)),'
            'C.success("Acesso Autorizado",{description:"Sincronizando com a rede global Arbishield."}),'
            "window.location.replace(Ae());return"
        )
        new_login = (
            'localStorage.setItem("auth_login_pending_until",String(Date.now()+15e3)),'
            'C.success("Acesso Autorizado",{description:"Sincronizando com a rede global Arbishield."}),'
            "await J.auth.getSession(),window.location.replace(Ae());return"
        )
        if old_login in t:
            t = t.replace(old_login, new_login, 1)
        if t != orig:
            auth.write_text(t, encoding="utf-8")
            print(f"auth chunk stabilized: {auth.name}")


def main() -> None:
    if BAK.exists():
        source_html = BAK.read_text(encoding="utf-8", errors="replace")
    else:
        source_html = INDEX.read_text(encoding="utf-8", errors="replace")
        BAK.write_text(source_html, encoding="utf-8")

    scripts = re.findall(r"<script\b[^>]*>[\s\S]*?</script>", source_html, re.I)
    scroll_script = next(
        (s for s in scripts if "scrollRestoration" in s or "storageKey" in s), ""
    )
    tsr_script = next((s for s in scripts if "$_TSR" in s and "$R" in s), "")
    if not tsr_script:
        raise SystemExit("script $_TSR não encontrado no backup SSR")

    tsr_script = re.sub(
        r"matches:\$R\[\d+\]=\[[\s\S]*?\],lastMatchId:\"\"",
        'matches:$R[12]=[],lastMatchId:""',
        tsr_script,
        count=1,
    )
    tsr_script = tsr_script.replace("ssr:!0", "ssr:!1")

    css: list[str] = []
    for m in re.finditer(r'href="(/assets/[^"]+\.css)"', source_html):
        if m.group(1) not in css:
            css.append(m.group(1))
    if not css:
        css = ["/assets/main-BB-HnZR4.css"]

    main_js = "/assets/main-D_khrzRh.js"
    m = re.search(r'import\("(/assets/main-[^"]+\.js)"\)', source_html)
    if m:
        main_js = m.group(1)

    title_m = re.search(r"<title[^>]*>[\s\S]*?</title>", source_html, re.I)
    title = title_m.group(0) if title_m else "<title>ArbiShield</title>"
    metas = re.findall(r"<meta(?![^>]*charset)[^>]*>", source_html, re.I)
    icon_links = [
        link
        for link in re.findall(r"<link[^>]*>", source_html, re.I)
        if any(k in link.lower() for k in ["icon", "apple-touch"])
    ]
    css_tags = "\n    ".join(
        f'<link rel="stylesheet" crossorigin href="{c}" />' for c in css
    )

    early = ""
    late = ""
    if (ASSETS / "auth-boot-fix.js").exists():
        early = '<script src="/assets/auth-boot-fix.js"></script>'
    if (ASSETS / "desafio-sugestoes-inject.js").exists():
        late = '<script src="/assets/desafio-sugestoes-inject.js" defer></script>'

    new_html = f"""<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <base href="/" />
    {title}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {"".join(metas)}
    {"".join(icon_links)}
    <link rel="manifest" href="/manifest.json" />
    {css_tags}
  </head>
  <body class="antialiased" style="background:#011a14;color:#f5f5f7;margin:0;min-height:100vh">
    {early}
    {scroll_script}
    {tsr_script}
    <script type="module" async>import("{main_js}")</script>
    {late}
  </body>
</html>
"""
    INDEX.write_text(new_html, encoding="utf-8")
    print(f"index CSR+TSR → {INDEX} ({len(new_html)} bytes)")

    main_path = WWW / main_js.lstrip("/")
    patch_main(main_path)
    patch_runtime_stability(main_path, ASSETS)

    (WWW / "manifest.json").write_text(
        json.dumps(
            {
                "name": "ArbiShield",
                "short_name": "ArbiShield",
                "start_url": "/",
                "display": "standalone",
                "background_color": "#011a14",
                "theme_color": "#011a14",
                "icons": [
                    {
                        "src": "/icons/icon-192.png",
                        "sizes": "192x192",
                        "type": "image/png",
                    },
                    {
                        "src": "/icons/icon-512.png",
                        "sizes": "512x512",
                        "type": "image/png",
                    },
                ],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    analytics = ASSETS / "analytics.functions-BM2kQUiD.js"
    if not analytics.exists():
        analytics.write_text(
            "export default {};\n"
            "export const track=()=>{};\n"
            "export const trackEvent=()=>{};\n"
            "export const initAnalytics=()=>{};\n",
            encoding="utf-8",
        )
        print("analytics stub ok")
    print("done")


if __name__ == "__main__":
    main()
