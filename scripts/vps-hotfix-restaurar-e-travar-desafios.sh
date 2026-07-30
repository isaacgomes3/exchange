#!/usr/bin/env bash
# 1) Restaura os 4 desafios de hoje (Noah/Turku/Augsburg/Hradec)
# 2) Publica guard anti-exclusão (shim + admin-desafios)
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-restaurar-e-travar-desafios.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v curl >/dev/null || die "curl"
command -v node >/dev/null || die "node"
mkdir -p "$SCRIPTS_DIR" "$WEB"

download() {
  local rel="$1" out="$2" needle="${3:-}"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      mv -f "$tmp" "$out"; return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      mv -f "$tmp" "$out"; return 0
    fi
  fi
  rm -f "$tmp"
  die "nao baixou: $rel"
}

load_env() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue
    local k="${line%%=*}" v="${line#*=}"
    k="$(echo "$k" | xargs)"
    case "$k" in
      ARBISHIELD_*|SUPABASE_*|SERVICE_*|API_EXTERNAL_URL) export "$k=$v" ;;
    esac
  done < "$f"
}

load_env "$ENV_FILE" || load_env /opt/arbishield/.env || true
SUPABASE_URL="$(printf '%s' "${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}" | sed 's:/*$::')"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente"
[[ -n "$SUPABASE_URL" ]] || die "SUPABASE_URL ausente"

IDS="${IDS:-9dd0901f-a449-47c1-8443-c1b0c66303c4,e502804b-05ca-4c0d-8f69-a3a45d9d18ee,8beb938c-fa29-4bb6-9d97-fd1650bba3c4,b598561a-abe0-41c3-aeaa-5f1bd7c90d52}"

log "1/3 restaurar desafios no banco"
export SUPABASE_URL SERVICE_KEY IDS
node --input-type=module <<'NODE'
const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SERVICE_KEY;
const ids = String(process.env.IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const now = new Date().toISOString();
async function sb(path, opts = {}) {
  const res = await fetch(`${url}${path}`, {
    method: opts.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${path}\n${String(text).slice(0, 400)}`);
  return data;
}
let ok = 0;
for (const id of ids) {
  console.log("—", id);
  const rows = await sb(`/rest/v1/desafios?select=id,number,title,status,is_active,deleted_at,metadata&id=eq.${encodeURIComponent(id)}&limit=1`);
  const d = Array.isArray(rows) ? rows[0] : null;
  if (!d) { console.log("  skip"); continue; }
  const meta = d.metadata && typeof d.metadata === "object" ? d.metadata : {};
  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      deleted_at: null,
      status: "active",
      is_active: true,
      published_at: now,
      updated_at: now,
      metadata: {
        ...meta,
        restored_at: now,
        restored_via: "vps-hotfix-restaurar-e-travar-desafios",
        protect_from_casual_delete: true,
      },
    },
  });
  const steps = await sb(`/rest/v1/desafio_steps?select=id,status,result,settled_at,match_label,starts_at&desafio_id=eq.${encodeURIComponent(id)}`);
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s.settled_at) continue;
    const st = String(s.status || "").toLowerCase();
    const res = String(s.result || "").toLowerCase();
    const reopen =
      ["cancelled", "canceled"].includes(st) ||
      ["cancelled", "canceled", "void"].includes(res) ||
      !st;
    if (reopen) {
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        body: { status: "pending", result: null, updated_at: now },
      });
      console.log("  step reopen:", s.match_label || s.id);
    } else {
      console.log("  step keep:", s.match_label || s.id, st);
    }
  }
  ok += 1;
  console.log("  OK restored #"+d.number, d.title);
}
console.log(`OK — ${ok}/${ids.length} restaurados e publicados`);
NODE

log "2/3 publicar shim com delete-desafio-guard-v2"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "delete-desafio-guard-v2"
# also copy to scripts dir
cp -f "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
chmod 0644 "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || systemctl restart arbishield-serverfn.service 2>/dev/null || true
sleep 1

log "3/3 publicar admin-desafios (confirm + restore + force)"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "data-restore-desafio"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=desafio-guard-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=desafio-guard-$BUST|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

log "checar API publica"
curl -fsS -m 15 "https://arbishield.app/api/arbishield/desafios" -o /tmp/dz-after.json || true
node -e '
const rows=JSON.parse(require("fs").readFileSync("/tmp/dz-after.json","utf8"));
const active=(Array.isArray(rows)?rows:[]).filter(d=>d.is_active&&!d.deleted_at);
console.log("ativos publicos:", active.length);
for (const d of active) {
  for (const s of d.desafio_steps||[]) {
    if (s.deleted_at) continue;
    console.log(" - #"+d.number, s.match_label||s.home_team, s.status, s.starts_at);
  }
}
' 2>/dev/null || true

echo
echo "OK — jogos restaurados + exclusão travada (confirm EXCLUIR; etapas abertas exigem FORCAR)."
echo "Hard refresh no Monitor / Desafios / app-desafio."
