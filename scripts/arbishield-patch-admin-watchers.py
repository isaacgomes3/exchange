#!/usr/bin/env python3
"""Desliga watchers Realtime/poll do shell admin + gera cópia cache-bust."""
from __future__ import annotations

import re
import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
ASSETS = WWW / "assets"
INDEX = WWW / "index.html"

NOOPS = {
    "cOe": "function cOe(){return null}",
    "fOe": "function fOe(){return null}",
    "mOe": "function mOe(){return null}",
    "sOe": "function sOe(){return 0}",
    "Y3e": "function Y3e(){return null}",
}


def extract_fn(text: str, name: str) -> tuple[int, int] | None:
    start = text.find(f"function {name}(")
    if start < 0:
        return None
    i = text.find("{", start)
    if i < 0:
        return None
    depth = 0
    for j in range(i, len(text)):
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return start, j + 1
    return None


def patch_text(text: str) -> tuple[str, list[str]]:
    notes: list[str] = []
    for name, noop in NOOPS.items():
        marker = f"/*arbishield-noop:{name}*/"
        span = extract_fn(text, name)
        if not span:
            notes.append(f"{name}: NÃO ENCONTRADO")
            continue
        a, b = span
        body = text[a:b]
        if body.startswith(noop) or marker in body:
            notes.append(f"{name}: já no-op")
            continue
        text = text[:a] + noop + marker + text[b:]
        notes.append(f"{name}: NO-OP ({b - a}→{len(noop)})")

    # Slow deposits poll
    idx = text.find('queryKey:["adminPendingDeposits"]')
    if idx >= 0:
        region = text[idx : idx + 900]
        if "refetchInterval:1e4" in region:
            text = (
                text[:idx]
                + region.replace("refetchInterval:1e4", "refetchInterval:12e4", 1)
                + text[idx + 900 :]
            )
            notes.append("deposits poll 10s→120s")
        elif "refetchInterval:12e4" in region:
            notes.append("deposits poll já 120s")

    # Neutraliza nomes de canal admin (mesmo se função voltar)
    for pat in [
        r"\.channel\(`admin-pending-contestations-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`\)",
        r"\.channel\(`admin-refund-requests-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`\)",
        r"\.channel\(`admin-refunds-contestations-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`\)",
        r"\.channel\(`admin-withdrawal-requests-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`\)",
        r"\.channel\(`admin-manual-deposits-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`\)",
    ]:
        text2, n = re.subn(pat, '.channel("arbishield-disabled")', text, count=5)
        if n:
            text = text2
            notes.append(f"channel rename x{n}")

    return text, notes


def update_index(new_main_name: str) -> str:
    if not INDEX.exists():
        return "index.html ausente"
    html = INDEX.read_text(encoding="utf-8", errors="replace")
    html2, n = re.subn(
        r"/assets/main-[A-Za-z0-9_-]+\.js",
        f"/assets/{new_main_name}",
        html,
    )
    # também o import() no TSR / module
    if n:
        INDEX.write_text(html2, encoding="utf-8")
        return f"index.html: {n} refs → {new_main_name}"
    return "index.html: nenhuma ref main-* encontrada"


def main() -> None:
    files = sorted(
        p
        for p in ASSETS.glob("main-*.js")
        if ".bak" not in p.name
        and "unfreeze" not in p.name
        and ".pre" not in p.name
    )
    if not files:
        raise SystemExit(f"nenhum main-*.js em {ASSETS}")

    source = files[0]
    # Prefer the canonical hashed main if several
    for p in files:
        if p.name.startswith("main-D_") or re.match(r"main-[A-Za-z0-9]+\.js$", p.name):
            source = p
            break

    original = source.read_text(encoding="utf-8", errors="replace")
    text, notes = patch_text(original)
    print(f"{source.name}:")
    for line in notes:
        print(f"  - {line}")

    bak = source.with_suffix(source.suffix + ".admin-watchers-bak")
    if not bak.exists():
        bak.write_text(original, encoding="utf-8")

    # Sempre grava no original + cópia cache-bust
    source.write_text(text, encoding="utf-8")
    bust = ASSETS / "main-arbishield-unfreeze.js"
    bust.write_text(text, encoding="utf-8")
    print(f"  - escrito {source.name}")
    print(f"  - cache-bust {bust.name}")

    print(update_index(bust.name))

    # Verificação
    noops = re.findall(r"arbishield-noop:[a-zA-Z0-9]+", text)
    print("verify:", sorted(set(noops)))
    if len(set(noops)) < 5:
        raise SystemExit("FALHA: menos de 5 no-ops — patch incompleto")
    print("done")


if __name__ == "__main__":
    main()
