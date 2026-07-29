#!/usr/bin/env bash
# FIX COMPLETO saldo BotShield na VPS (root).
# - nginx com exchange-session/balance
# - UI Conta BetBra + Integrações
# Cole INTEIRO no SSH. Sem GitHub.
set -euo pipefail
WEB="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"
SHIM_PORT="${ARBISHIELD_SHIM_PORT:-3101}"
echo "==> fix-botshield-saldo-completo ($(date -Is))"
python3 - "$WEB" <<'PY'
import base64, zlib, hashlib, sys, os, subprocess
from pathlib import Path
web = Path(sys.argv[1])
web.mkdir(parents=True, exist_ok=True)

def decode(b64, sha):
    data = zlib.decompress(base64.b64decode(''.join(b64.split())))
    d = hashlib.sha256(data).hexdigest()
    if d != sha:
        raise SystemExit(f'SHA mismatch: {d} != {sha}')
    return data

nginx_ssl_b64 = '''eNq1VV2O2zYQfvcpBl4/2EBlyvYiLeynTYqiAYpkke0WBYpGoMWxRSxFKiTln8QbFCjQAxS9QNGH
HqBH8E16ko4ka/0j7yJ5qAQIFOebH858M7yA58bfJBKVgH9/+QMyLjUqEAhT4x10pTOKC9NrXcDX
r27GcFXu7/C//Q4putTAy2sQHH64viHYC7R+DDF9CQlBoOdSryAQe8U+t1NZL7OMdG5fjoEtuGXL
5ZLtpcGDCmFebX99DTzjFmMEbWiZMS5SqYtgjy2WJ3Hbf+D2zXcgpEXP+62WQ7tACx9aQI+SzqOG
r8LJ4e9P4/HP43qvwkeap/ho7JNWpW5i7qXR8PYjsP4SlQrutFlqxuMUgzjhSqGeI9s5Lx5rKDtn
zjx5QAic8Vz5yK8zhLbHlWeZovK0K8j9iesj4+hzq2EUDiDxPnNjxjqJcb5j8V2Ozke5lbWV+/OZ
ubwcgXOqmZ4jQWF9CEZ/dsbIQlRwRM4kxY/A0MdMoXeoY7vOPFNygewxI2yWK0VplbqfYTo5ZzG6
w/XnWs2sXJDa3qbUscrFmehMVuTcBeS0Ing/Nnq2D0QkRFSeNhULhZ3QVX5KnVhJ1D5K+SqaGrGO
nHyPMAx3YTzGlX1/1OEKXFXffuJTtTPOhYgS5IJK/GNwRdpVvwc3khLffrDRBq6WfO0mTaU3pkAF
3/M5tLUpHXxBPTgzSpnlXq9UvIDnyhDLJKdh4hM62vZP52RsQBw2rSYaIhSkPKbxR3jLugTblLDN
Ytjrsk2n1yT3ZXh5vhEqC7lPNpZ8bJw3ls9xM8t1XBZtM7c8S94pEnPlZYq9w9bJrFmto4w7V5Kb
Omcw/LIf0jugyRCGkxNkAYqI9a5wPegPTuUOfZ3Hb+mwUPbhEyBKNoUV0ESlZk0NEZkqYZ9U+MbY
JbcCRbGCToUo6reKZrWoWH2ikWtrvKnmxhMatxmlkVqjUyYgr/6ewL8wWmNZAGjv0O1TOBVEREVF
TO5h9CwMzwSgzyLua+69piNoR8PQoXPbvwzgiuYEzV7oEsvTwozIt38XkvFoEA4mMKPhPOXxHfiS
kePRkKbmgtiLelHcM6j5VGGvyTGeyYNeZN3aU1C4JhCLqyNvGgIh3aMy57nPXXN/yhXXMe4Fhk5q
3el/cUU0USwudFVju3LW63wi/8uE/c/8v6LGNVa+r/JcsYsf7k3OhBrV91plxEETdsStZye8OXuJ
eruOZlKhgw5dl+WHATucrvUF+h+ZmRTa'''
nginx_ssl_sha = 'c7af076edf8ee45678189cc91cb251ff58b5e1ecc4b12c1c2638f5ef357ae2aa'
nginx_http_b64 = '''eNq1VO9q2zAQ/56nOFJ/SGCOkq6wkXzqNkYLY5SlhcJYzdW+1GKy5ErnJuncsofYm+wR9iZ7kslV
03rJGvplNojT3e/+6Hcn7cAbw9Ncksrg9/cfcHB8fARGqyX0UDM5yAykZPnccL+zA/vlr58O3n2c
voDKEZRoERzZK2nh5BAIqJDs5cZjAhmVRjpgay4rjyWFkBo9g+n0w6DTadzIwrcO+E9Jx6Th9XDS
3n4ej7+MV7qATzQWBL4ad1fzAO25XIllOekEd5MiS6Ph7BbEYE5KxV+1mWuBaUFxmqNSpC9I3Cdv
PmsMg7hCK+bzuXiMOnlAZDTDSnHCy5Kgy7RgUSqUuhsgNyH1U3Hih5IDXOqMFmEd5Fyo+8oxy5Kc
MPPEnMb73ju0Jp5K9kkfYnQB1RyXbv28t3Amep6HGrNC6vpqt98TddRvn5O4shr2hnt/lb0WoeK8
tuS4dmwsXlA9q3Ta2F19YbHML5U3o2JZUL/NYmnNYpmU6BzkzOVYiNHuq8HQ/yPfx+FwsoZsQInv
qmtSjwajdbsjXtFxYBxDlPt1C+g0/uTLig+PILJUGKbEE2q3Orw3do42o6yRIAqIpg2LZLYyNdIz
gxxZwwYil+ZU0Bafk9ITmZE/UUNBFXZb8G+N1nTXAujeo7tPdxBL2Zo90aOFH3o/8bEj13At0hCu
3jBk0j1pc4xcuU39OSrUKT0ajKfCuvV9c102USJtfNWGOiTrR8+crpej4eh/T9e+vxbGyuvAc+gc
tnWTf5SaWPKvn1sFcbCCrfetfY/YLpOZVP75jSor7xYBov1ahAg3nT/IGuQ7'''
nginx_http_sha = 'f04b75a94399177c922ebc8562f017979d5bab720584b0a3e1fc19446e9c1ed3'
conta_b64 = '''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
/Ae7aXoh'''
conta_sha = '1a86defe11b9aaf08a436471c0a0e61c8652a73a0586c356d247acc7ce7c62e3'
integ_b64 = '''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
bv6UxPy10L8BUSKXEg=='''
integ_sha = 'a6480d746431a22064b71e4a9c85e20250b328c0dc314ca65b407eae440098d4'

nginx_ssl = decode(nginx_ssl_b64, nginx_ssl_sha)
nginx_http = decode(nginx_http_b64, nginx_http_sha)
conta = decode(conta_b64, conta_sha)
integ = decode(integ_b64, integ_sha)

# UI
(web / 'conta-betbra.html').write_bytes(conta)
(web / 'integracoes.html').write_bytes(integ)
print('OK UI', web / 'conta-betbra.html', web / 'integracoes.html')

# Nginx: patch TODAS as confs botshield + republicar template correto
has_cert = Path('/etc/letsencrypt/live/botshield.arbishield.app/fullchain.pem').is_file()
payload = nginx_ssl if has_cert else nginx_http
print('nginx mode:', 'ssl' if has_cert else 'http-only')

written = []
avail = Path('/etc/nginx/sites-available')
enabled = Path('/etc/nginx/sites-enabled')
confd = Path('/etc/nginx/conf.d')

if avail.is_dir():
    dest = avail / 'botshield.arbishield.app'
    dest.write_bytes(payload)
    written.append(str(dest))
    if enabled.is_dir():
        link = enabled / 'botshield.arbishield.app'
        if link.exists() or link.is_symlink():
            link.unlink()
        link.symlink_to(dest)
        written.append(str(link) + ' -> ' + str(dest))
elif confd.is_dir():
    dest = confd / 'botshield.arbishield.app.conf'
    dest.write_bytes(payload)
    written.append(str(dest))
else:
    raise SystemExit('ERRO: nem sites-available nem conf.d')

# Patch residual: qualquer arquivo nginx com allowlist antiga
old = (
    'exchange-session/connect|exchange-session/disconnect|'
    'exchange-session/status|exchange-orders'
)
new = (
    'exchange-session/connect|exchange-session/disconnect|'
    'exchange-session/status|exchange-session/balance|exchange-orders'
)
roots = [Path('/etc/nginx')]
for root in roots:
    for p in root.rglob('*'):
        if not p.is_file():
            continue
        name = p.name.lower()
        if 'botshield' not in name and 'botshield' not in str(p):
            # ainda assim varre se contém arbishield exchange-session
            try:
                t = p.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
            if 'exchange-session/status' in t and 'botshield' in t.lower():
                pass
            else:
                continue
        else:
            try:
                t = p.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue
        if 'exchange-session/balance' in t:
            print('nginx já tem balance:', p)
            continue
        if old in t:
            p.write_text(t.replace(old, new, 1), encoding='utf-8')
            print('nginx patched allowlist:', p)
            written.append(str(p))

for w in written:
    print('wrote', w)

# Verificar balance na conf ativa
ok_balance = False
for p in list(Path('/etc/nginx').rglob('*')):
    if not p.is_file():
        continue
    try:
        t = p.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        continue
    if 'botshield' in t.lower() and 'exchange-session/balance' in t:
        ok_balance = True
        print('CONFIRM balance em', p)
        break
if not ok_balance:
    raise SystemExit('ERRO: balance não ficou em nenhuma conf nginx')
print('PYTHON_OK')
PY

echo '==> nginx -t + reload'
nginx -t
systemctl reload nginx
systemctl is-active nginx || true

echo '==> teste local da rota balance'
# Sem auth → 401/400 do shim (JSON). NÃO testar :80 — redireciona 301 HTML.
code=$(curl -sS -o /tmp/bs-bal.json -w '%{http_code}' \
  -H 'Accept: application/json' \
  --max-time 10 \
  "http://127.0.0.1:${SHIM_PORT}/api/arbishield/exchange-session/balance?provider=betbra" || echo ERR)
echo "shim direto :${SHIM_PORT} => HTTP $code"
head -c 200 /tmp/bs-bal.json 2>/dev/null; echo

code2=$(curl -skS -o /tmp/bs-bal2.json -w '%{http_code}' \
  -H 'Accept: application/json' \
  -H 'Host: botshield.arbishield.app' \
  --max-time 15 \
  "https://127.0.0.1/api/arbishield/exchange-session/balance?provider=betbra" || echo ERR)
echo "nginx HTTPS host botshield => HTTP $code2"
head -c 200 /tmp/bs-bal2.json 2>/dev/null; echo
if grep -qiE '<html|DOCTYPE' /tmp/bs-bal2.json 2>/dev/null; then
  echo 'ERRO: nginx HTTPS ainda devolve HTML (rota não proxyada)' >&2
  exit 1
fi
echo
echo 'OK COMPLETO. Hard refresh (Ctrl+Shift+R) em:'
echo '  https://botshield.arbishield.app/conta-betbra.html'
echo 'Depois clique Atualizar saldo (ou aguarde auto-load).'
