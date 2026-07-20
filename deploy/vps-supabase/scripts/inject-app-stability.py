#!/usr/bin/env python3
from pathlib import Path

p = Path("/var/www/arbishield/index.html")
t = p.read_text()
tag = '<script src="/app-stability.js"></script>'
if tag in t:
    print("index already has stability")
else:
    needle = '<script src="/assets/auth-boot-fix.js"></script>'
    if needle in t:
        t = t.replace(needle, tag + "\n    " + needle, 1)
        p.write_text(t)
        print("index injected before auth-boot-fix")
    elif "<body" in t:
        import re
        t2, n = re.subn(r"(<body[^>]*>)", r"\1\n    " + tag, t, count=1)
        if not n:
            raise SystemExit("body inject failed")
        p.write_text(t2)
        print("index injected after body")
    else:
        raise SystemExit("cannot inject")

# show confirmation
out = p.read_text()
print("has_stability", tag in out)
idx = out.find("app-stability")
print(out[max(0, idx - 80) : idx + 120])
