#!/usr/bin/env python3
"""Gera scripts/vps-patch-botshield-saldo-topbar.sh a partir dos estáticos."""
import base64
import hashlib
import textwrap
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "deploy/vps-supabase/static/botshield/botshield-shell.js"
CSS = ROOT / "deploy/vps-supabase/static/botshield/botshield.css"
OUT = ROOT / "scripts/vps-patch-botshield-saldo-topbar.sh"


def pack(path: Path):
    data = path.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    b64 = base64.b64encode(zlib.compress(data, 9)).decode()
    wrapped = "\n".join(textwrap.wrap(b64, 76))
    return wrapped, sha, len(data)


def main():
    js_b64, js_sha, js_n = pack(JS)
    css_b64, css_sha, css_n = pack(CSS)
    parts = []
    parts.append("#!/usr/bin/env bash\n")
    parts.append(
        "# Mostra Saldo BetBra no topo de TODAS as páginas (Meus bots etc).\n"
    )
    parts.append(
        "# Também exibe motivo quando o saldo falha (sem conta / senha / erro BetBra).\n"
    )
    parts.append("# Cole inteiro na VPS (root).\n")
    parts.append("set -euo pipefail\n")
    parts.append('WEB="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"\n')
    parts.append("python3 - \"$WEB\" <<'PY'\n")
    parts.append("import base64, zlib, hashlib, sys\n")
    parts.append("from pathlib import Path\n")
    parts.append("web = Path(sys.argv[1]); web.mkdir(parents=True, exist_ok=True)\n")
    parts.append("def put(name, b64, sha):\n")
    parts.append(
        "    data = zlib.decompress(base64.b64decode(''.join(b64.split())))\n"
    )
    parts.append(
        "    if hashlib.sha256(data).hexdigest() != sha: raise SystemExit('SHA '+name)\n"
    )
    parts.append(
        "    p = web / name; p.write_bytes(data); print('OK', p, len(data))\n"
    )
    parts.append("put('botshield-shell.js', '''")
    parts.append(js_b64)
    parts.append("''', '" + js_sha + "')\n")
    parts.append("put('botshield.css', '''")
    parts.append(css_b64)
    parts.append("''', '" + css_sha + "')\n")
    parts.append(
        "assert 'bsBalanceChip' in (web/'botshield-shell.js').read_text()\n"
    )
    parts.append(
        "assert 'bsBalanceHint' in (web/'botshield-shell.js').read_text()\n"
    )
    parts.append("assert 'bal-chip' in (web/'botshield.css').read_text()\n")
    parts.append("print('TOPBAR SALDO OK')\n")
    parts.append("PY\n")
    parts.append(
        'echo "Hard refresh: https://botshield.arbishield.app/bots.html"\n'
    )
    OUT.write_text("".join(parts))
    print(f"OK {OUT} js={js_n} css={css_n}")


if __name__ == "__main__":
    main()
