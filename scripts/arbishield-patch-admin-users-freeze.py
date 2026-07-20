#!/usr/bin/env python3
"""Destrava busca em /admin/users (agressivo).

Causa do freeze: cada tecla fazia setState → re-render da página inteira
+ filter/sort de todos os usuários + storm de serverFn (stats demo).

Estratégia:
1) input uncontrolled + debounce 400ms (zero setState enquanto digita)
2) useMemo no filter/sort
3) desliga stats demo
"""
from __future__ import annotations

import sys
from pathlib import Path

WWW = Path(sys.argv[1] if len(sys.argv) > 1 else "/var/www/arbishield")
ASSETS = WWW / "assets"


def replace_once(text: str, old: str, new: str) -> tuple[str, bool]:
    if old not in text:
        return text, False
    return text.replace(old, new, 1), True


def patch_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    original = text
    notes: list[str] = []

    # 1) Remover patches fracos anteriores de lDef (deferred / debounce hook)
    for old, label in [
        (
            '[l,c]=kt.useState(""),lDef=kt.useDeferredValue?kt.useDeferredValue(l):l',
            "remove useDeferredValue",
        ),
        (
            '[l,c]=kt.useState(""),[lDef,cDef]=kt.useState(""),'
            "kt.useEffect(function(){var t=setTimeout(function(){cDef(l)},400);"
            "return function(){clearTimeout(t)}},[l])",
            "remove debounce hook duplicado",
        ),
    ]:
        text, ok = replace_once(text, old, '[l,c]=kt.useState("")')
        notes.append(f"{label}: {'OK' if ok else 'n/a'}")

    # filtro deve usar `l` (termo só atualiza após debounce do input)
    text, ok = replace_once(
        text,
        'en=hr(lDef.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=lDef.replace(/\\D/g,"")',
        'en=hr(l.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=l.replace(/\\D/g,"")',
    )
    notes.append(f"filtro usa l: {'OK' if ok else 'n/a'}")

    text, ok = replace_once(
        text,
        "kt.useEffect(()=>{Qe(1)},[lDef,h,w,g,C,L]);",
        "kt.useEffect(()=>{Qe(1)},[l,h,w,g,C,L]);",
    )
    notes.append(f"reset página em l: {'OK' if ok else 'n/a'}")

    # 2) Input uncontrolled + debounce (não re-renderiza a cada tecla)
    input_new = (
        'defaultValue:"",onChange:j=>{'
        "var v=j.target.value;"
        "clearTimeout(window.__arbishieldUserSearchT);"
        "window.__arbishieldUserSearchT=setTimeout(function(){c(v)},400)"
        "}"
    )
    input_replaced = False
    for old in [
        "value:l,onChange:j=>c(j.target.value)",
        input_new,  # idempotent check below
    ]:
        if old == input_new:
            if input_new in text:
                input_replaced = True
            continue
        text, ok = replace_once(text, old, input_new)
        if ok:
            input_replaced = True
    notes.append(
        f"input debounce uncontrolled: {'OK' if input_replaced else 'FALHOU'}"
    )

    # 3) useMemo no filter+sort
    if "br=kt.useMemo(()=>n.filter" not in text:
        text, ok1 = replace_once(
            text,
            (
                'hr=j=>(j??"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase(),'
                'en=hr(l.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=l.replace(/\\D/g,""),'
                "br=n.filter"
            ),
            (
                'hr=j=>(j??"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase(),'
                'en=hr(l.trim()),tn=en.split(/\\s+/).filter(Boolean),Ke=l.replace(/\\D/g,""),'
                "br=kt.useMemo(()=>n.filter"
            ),
        )
        text, ok2 = replace_once(
            text,
            'return Re&&ke&&Yt&&Br&&(C==="all"||(C==="ok"?xn:!xn))}),Wr=[...br].sort(',
            (
                'return Re&&ke&&Yt&&Br&&(C==="all"||(C==="ok"?xn:!xn))}),'
                '[n,en,tn.join("\\0"),Ke,h,w,g,C]),'
                "Wr=kt.useMemo(()=>[...br].sort("
            ),
        )
        text, ok3 = replace_once(
            text,
            "default:return ke(me.created_at)-ke(j.created_at)}}),Ar=Wr.slice",
            "default:return ke(me.created_at)-ke(j.created_at)}}),[br,L]),Ar=Wr.slice",
        )
        notes.append(
            f"useMemo filter/sort: "
            f"{'OK' if (ok1 and ok2 and ok3) else f'parcial ({ok1},{ok2},{ok3})'}"
        )
    else:
        notes.append("useMemo filter/sort: já aplicado")

    # 4) Desliga stats demo (source do storm de re-renders)
    demo_ok = False
    for old in [
        'kt.useEffect(()=>{Ar.forEach(j=>{j.demo_balance_cents>0&&!Ne[j.id]&&Ve(j.id)})},[Ar.map(j=>j.id).join(",")]);',
        'kt.useEffect(()=>{Ar.forEach(j=>{j.demo_balance_cents>0&&!Ne[j.id]&&Ve(j.id)})},[Ar.map(j=>j.id).join(","),Ne]);',
    ]:
        text, ok = replace_once(text, old, "kt.useEffect(()=>{},[]);")
        demo_ok = demo_ok or ok
    notes.append(f"desliga effect demo: {'OK' if demo_ok or 'kt.useEffect(()=>{},[]);' in text else 'FALHOU'}")

    ve_ok = False
    for old in [
        'Ve=async j=>{if(Ie[j]||Ne[j])return;Ge(me=>({...me,[j]:!0}));try{const me=await _r(),Re=await Jf({data:{userId:j},...me});Je(ke=>({...ke,[j]:Re||{ok:1}}))}catch(me){Je(ke=>({...ke,[j]:{ok:0}}));console.error("Erro ao carregar stats demo:",me)}}',
        'Ve=async j=>{if(!Ie[j]){Ge(me=>({...me,[j]:!0}));try{const me=await _r(),Re=await Jf({data:{userId:j},...me});Je(ke=>({...ke,[j]:Re}))}catch(me){console.error("Erro ao carregar stats demo:",me)}finally{Ge(me=>({...me,[j]:!1}))}}',
        "Ve=async j=>{}",
    ]:
        if old == "Ve=async j=>{}" and old in text:
            ve_ok = True
            continue
        text, ok = replace_once(text, old, "Ve=async j=>{}")
        ve_ok = ve_ok or ok
    notes.append(f"Ve no-op: {'OK' if ve_ok else 'FALHOU'}")

    # Sanity: lDef não pode sobrar sem declaração
    if "lDef" in text and "[lDef," not in text and "lDef=" not in text:
        notes.append("AVISO: referências a lDef sem declaração")

    # 5) Desliga realtime profiles (flood de UPDATE re-renderiza a lista inteira)
    text, ok = replace_once(
        text,
        'kt.useEffect(()=>{if(!e&&r){Ee();const j=Ho.channel("admin-profiles-changes").on("postgres_changes",{event:"*",schema:"public",table:"profiles"},me=>{console.log("Real-time profile change received:",me),me.eventType==="UPDATE"?a(Re=>Re.map(ke=>ke.id===me.new.id?{...ke,...me.new}:ke)):me.eventType==="INSERT"?a(Re=>[me.new,...Re]):me.eventType==="DELETE"&&a(Re=>Re.filter(ke=>ke.id!==me.old.id))}).subscribe();return()=>{Ho.removeChannel(j)}}},[e,r])',
        'kt.useEffect(()=>{if(!e&&r){Ee()}},[e,r])',
    )
    notes.append(f"desliga realtime profiles: {'OK' if ok else 'n/a'}")

    if text != original:
        bak = path.with_suffix(path.suffix + ".users-freeze-bak")
        if not bak.exists():
            bak.write_text(original, encoding="utf-8")
        path.with_suffix(path.suffix + ".users-freeze-pre").write_text(
            original, encoding="utf-8"
        )
        path.write_text(text, encoding="utf-8")
        notes.append("arquivo gravado")
    else:
        notes.append("nenhuma alteração gravada")

    return notes


def main() -> None:
    files = sorted(
        p
        for p in ASSETS.glob("admin.users-*.js")
        if ".bak" not in p.name and ".pre" not in p.name
    )
    if not files:
        raise SystemExit(f"nenhum admin.users-*.js em {ASSETS}")
    for path in files:
        print(f"{path.name}:")
        for line in patch_file(path):
            print(f"  - {line}")
    print("done")


if __name__ == "__main__":
    main()
