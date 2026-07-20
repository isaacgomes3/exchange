#!/usr/bin/env python3
from pathlib import Path
import re

www = Path("/var/www/arbishield")
js = Path("/tmp/app-stability.js").read_text()
if "</script>" in js.lower():
    raise SystemExit("refusing js that contains script end tag")

inline = (
    '<script data-arbishield="stability-inline">\n'
    + js
    + "\n</script>\n"
)

index = www / "index.html"
t = index.read_text()
t = t.replace('<script src="/app-stability.js"></script>\n    ', "")
t = t.replace('<script src="/app-stability.js"></script>', "")
t = re.sub(
    r'<script data-arbishield="stability-inline">.*?</script>\s*',
    "",
    t,
    flags=re.S,
)
if "<head>" not in t:
    raise SystemExit("no <head>")
t = t.replace("<head>", "<head>\n    " + inline, 1)
index.write_text(t)
print("index_inline_ok", "stability-inline" in index.read_text())

# keep external file
(www / "app-stability.js").write_text(js)

auth = www / "auth-vps.html"
if auth.exists():
    at = auth.read_text()
    tag = '<script src="/app-stability.js"></script>'
    if tag not in at and "</head>" in at:
        at = at.replace("</head>", "  " + tag + "\n</head>", 1)
        auth.write_text(at)
        print("auth_vps_tagged")
    else:
        print("auth_vps_skip")

print("done", len(index.read_text()))
