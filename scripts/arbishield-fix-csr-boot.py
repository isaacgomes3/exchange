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
        return
    if old not in main_src:
        # tentar a partir do backup
        if main_bak.exists():
            main_src = main_bak.read_text(encoding="utf-8", errors="replace")
        if old not in main_src:
            raise SystemExit("padrão hydrateRoot não encontrado")
    main_path.write_text(main_src.replace(old, new, 1), encoding="utf-8")
    print("main: hydrateRoot → createRoot")


def main() -> None:
    if BAK.exists():
        source_html = BAK.read_text(encoding="utf-8", errors="replace")
    else:
        source_html = INDEX.read_text(encoding="utf-8", errors="replace")
        BAK.write_text(source_html, encoding="utf-8")

    scripts = re.findall(r"<script\b[^>]*>[\s\S]*?</script>", source_html, re.I)
    scroll_script = next((s for s in scripts if "scrollRestoration" in s or "storageKey" in s), "")
    tsr_script = next((s for s in scripts if "$_TSR" in s and "$R" in s), "")
    if not tsr_script:
        raise SystemExit("script $_TSR não encontrado no backup SSR")

    # Client resolve rota pela URL (sem matches SSR da home)
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
    inject = ""
    if (ASSETS / "desafio-sugestoes-inject.js").exists():
        inject = '<script src="/assets/desafio-sugestoes-inject.js" defer></script>'

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
    {scroll_script}
    {tsr_script}
    <script type="module" async>import("{main_js}")</script>
    {inject}
  </body>
</html>
"""
    INDEX.write_text(new_html, encoding="utf-8")
    print(f"index CSR+TSR → {INDEX} ({len(new_html)} bytes)")

    patch_main(WWW / main_js.lstrip("/"))

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
