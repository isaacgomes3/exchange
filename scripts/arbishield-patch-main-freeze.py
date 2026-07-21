#!/usr/bin/env python3
"""Remove hangs conhecidos do bundle main-*.js na VPS."""
from __future__ import annotations

import glob
import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
ASSETS = WWW / "assets"

REPLACEMENTS = [
    (
        "await new Promise(()=>{})",
        "await new Promise(e=>setTimeout(e,100))",
    ),
    (
        'window.location.replace("/auth"),await new Promise(()=>{})',
        'window.location.replace("/auth"),await new Promise(e=>setTimeout(e,50))',
    ),
    (
        'window.location.replace("/auth?redirect=/m"),await new Promise(()=>{})',
        'window.location.replace("/auth?redirect=/m"),await new Promise(e=>setTimeout(e,50))',
    ),
]


def patch_file(path: Path) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    original = text
    count = 0
    for old, new in REPLACEMENTS:
        if old in text:
            n = text.count(old)
            text = text.replace(old, new)
            count += n
    if text != original:
        bak = path.with_suffix(path.suffix + ".freeze-bak")
        if not bak.exists():
            bak.write_text(original, encoding="utf-8")
        path.write_text(text, encoding="utf-8")
    return count


def main() -> None:
    total = 0
    files = sorted(ASSETS.glob("main-*.js"))
    if not files:
        raise SystemExit(f"nenhum main-*.js em {ASSETS}")
    for path in files:
        if ".bak" in path.name or ".freeze-bak" in path.name:
            continue
        n = patch_file(path)
        if n:
            print(f"{path.name}: patched eternal Promise x{n}")
            total += n
    if total:
        print(f"done — {total} patch(es)")
    else:
        print("done — main já estava sem Promise eterno")


if __name__ == "__main__":
    main()
