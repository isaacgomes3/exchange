#!/usr/bin/env python3
"""Destrava busca em /admin/users (bundle admin.users-*.js).

Causas do freeze:
1) filtro NFD+sort de toda a lista a cada tecla (sem useDeferredValue)
2) useEffect de stats demo depende de `Ne` → loop de setState + serverFn
3) Ve limpa flag de loading no finally → retries em cascata
"""
from __future__ import annotations

import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
ASSETS = WWW / "assets"

PATCHES = [
    (
        '[l,c]=kt.useState("")',
        '[l,c]=kt.useState(""),lDef=kt.useDeferredValue?kt.useDeferredValue(l):l',
        "useDeferredValue na busca",
    ),
    (
        'en=hr(l.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=l.replace(/\\D/g,"")',
        'en=hr(lDef.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=lDef.replace(/\\D/g,"")',
        "filtro usa valor deferred",
    ),
    (
        '},[Ar.map(j=>j.id).join(","),Ne]);',
        '},[Ar.map(j=>j.id).join(",")]);',
        "remove Ne das deps do useEffect demo",
    ),
    (
        'Ve=async j=>{if(!Ie[j]){Ge(me=>({...me,[j]:!0}));try{const me=await _r(),Re=await Jf({data:{userId:j},...me});Je(ke=>({...ke,[j]:Re}))}catch(me){console.error("Erro ao carregar stats demo:",me)}finally{Ge(me=>({...me,[j]:!1}))}}',
        'Ve=async j=>{if(Ie[j]||Ne[j])return;Ge(me=>({...me,[j]:!0}));try{const me=await _r(),Re=await Jf({data:{userId:j},...me});Je(ke=>({...ke,[j]:Re||{ok:1}}))}catch(me){Je(ke=>({...ke,[j]:{ok:0}}));console.error("Erro ao carregar stats demo:",me)}}',
        "Ve sem retry/loop de stats demo",
    ),
]


def patch_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    original = text
    applied: list[str] = []
    for old, new, label in PATCHES:
        if new in text and old not in text:
            applied.append(f"{label} (já aplicado)")
            continue
        if old not in text:
            applied.append(f"{label} (padrão não encontrado)")
            continue
        text = text.replace(old, new, 1)
        applied.append(f"{label} OK")
    if text != original:
        bak = path.with_suffix(path.suffix + ".users-freeze-bak")
        if not bak.exists():
            bak.write_text(original, encoding="utf-8")
        path.write_text(text, encoding="utf-8")
    return applied


def main() -> None:
    files = sorted(ASSETS.glob("admin.users-*.js"))
    files = [p for p in files if ".bak" not in p.name]
    if not files:
        raise SystemExit(f"nenhum admin.users-*.js em {ASSETS}")
    for path in files:
        results = patch_file(path)
        print(f"{path.name}:")
        for line in results:
            print(f"  - {line}")
    print("done")


if __name__ == "__main__":
    main()
