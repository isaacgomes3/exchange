#!/usr/bin/env python3
"""Desliga watchers Realtime/poll do shell admin que congelam o SPA.

Substitui cOe/fOe/mOe/sOe/Y3e por no-ops e reduz polling de depósitos.
"""
from __future__ import annotations

import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
ASSETS = WWW / "assets"

NOOPS = {
    "cOe": "function cOe(){return null}",  # toasts reembolso + realtime
    "fOe": "function fOe(){return null}",  # toasts contestação + realtime
    "mOe": "function mOe(){return null}",  # toasts saque + realtime
    "sOe": "function sOe(){return 0}",  # count + channel aleatório a cada mount
    "Y3e": "function Y3e(){return null}",  # chat flutuante sempre montado
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


def patch_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    original = text
    notes: list[str] = []

    for name, noop in NOOPS.items():
        marker = f"/*arbishield-noop:{name}*/"
        if marker in text or text.find(noop) >= 0 and f"function {name}()" in noop:
            # already no-op?
            span = extract_fn(text, name)
            if span and text[span[0] : span[1]] == noop:
                notes.append(f"{name}: já no-op")
                continue
        span = extract_fn(text, name)
        if not span:
            notes.append(f"{name}: não encontrado")
            continue
        a, b = span
        body = text[a:b]
        if "arbishield-noop" in body or body == noop:
            notes.append(f"{name}: já patchado")
            continue
        text = text[:a] + noop + marker + text[b:]
        notes.append(f"{name}: NO-OP ({b - a} bytes → {len(noop)})")

    # Slow manual deposits polling 10s → 120s
    old_iv = "queryKey:[\"adminPendingDeposits\"]"
    if old_iv in text:
        # replace nearby refetchInterval:1e4 once in that region
        idx = text.find(old_iv)
        region = text[idx : idx + 800]
        if "refetchInterval:1e4" in region:
            text = (
                text[:idx]
                + region.replace("refetchInterval:1e4", "refetchInterval:12e4", 1)
                + text[idx + 800 :]
            )
            notes.append("adminPendingDeposits: poll 10s → 120s")
        elif "refetchInterval:12e4" in region:
            notes.append("adminPendingDeposits: já 120s")
        else:
            notes.append("adminPendingDeposits: interval não encontrado")

    # Disable deposit realtime channel creation pattern (unique random channel)
    old_ch = ".channel(`admin-manual-deposits-${Math.random()"
    if old_ch in text:
        # Safer: leave channel but we already slowed poll; skip invasive edit
        notes.append("admin-manual-deposits channel: presente (poll já reduzido)")

    if text != original:
        bak = path.with_suffix(path.suffix + ".admin-watchers-bak")
        if not bak.exists():
            bak.write_text(original, encoding="utf-8")
        path.write_text(text, encoding="utf-8")
        notes.append("arquivo gravado")
    else:
        notes.append("nenhuma alteração")
    return notes


def main() -> None:
    files = sorted(
        p for p in ASSETS.glob("main-*.js") if ".bak" not in p.name and ".pre" not in p.name
    )
    if not files:
        raise SystemExit(f"nenhum main-*.js em {ASSETS}")
    for path in files:
        print(f"{path.name}:")
        for line in patch_file(path):
            print(f"  - {line}")
    print("done")


if __name__ == "__main__":
    main()
