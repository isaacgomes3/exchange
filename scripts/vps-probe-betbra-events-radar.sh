#!/usr/bin/env bash
# Probe do radar de movimento BetBra (eventsRadar + mradar).
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-probe-betbra-events-radar.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
OUT="${ARBISHIELD_RADAR_OUT:-/tmp/betbra-events-radar-probe.json}"
ENV_FILE="${ARBISHIELD_ENV_FILE:-$SHIM_DIR/.env}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/2 baixando probe"
tmp_lib="$(mktemp)"
tmp_probe="$(mktemp)"
download_repo_file "scripts/lib/betbra-events-radar.mjs" "$tmp_lib"
download_repo_file "scripts/vps-probe-betbra-events-radar.mjs" "$tmp_probe"
grep -q 'betbra-events-radar-v1' "$tmp_lib" || die "lib sem marker v1"

for dest in \
  "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-events-radar.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
done
cp -f "$tmp_probe" "$SCRIPTS_DIR/vps-probe-betbra-events-radar.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-probe-betbra-events-radar.mjs"
rm -f "$tmp_lib" "$tmp_probe"

log "2/2 rodando probe → $OUT"
PROBE_JS="$SCRIPTS_DIR/vps-probe-betbra-events-radar.mjs"
export ENV_FILE OUT PROBE_JS
node --input-type=module <<'EOF'
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const env = { ...process.env };
const envFile = process.env.ENV_FILE;
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (env[m[1]] == null || env[m[1]] === "") env[m[1]] = v;
  }
}
const r = spawnSync(
  process.execPath,
  [process.env.PROBE_JS, "--out", process.env.OUT],
  { env, stdio: "inherit" }
);
process.exit(r.status ?? 1);
EOF

log "OK. Para o endpoint HTTP: bash <(curl -fsSL \"$RAW/scripts/vps-hotfix-betbra-events-radar.sh?$BUST\")"
