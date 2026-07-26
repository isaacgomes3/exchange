#!/usr/bin/env bash
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
SHA=$(curl -fsS "https://api.github.com/repos/isaacgomes3/exchange/commits/${REF}" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")
DST=/opt/arbishield/scripts/vps-diagnosticar-grade-proteger.mjs
mkdir -p "$(dirname "$DST")"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/vps-diagnosticar-grade-proteger.mjs" -o "$DST"
chmod 0755 "$DST"
node "$DST"
