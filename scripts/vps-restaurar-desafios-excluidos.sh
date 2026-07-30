#!/usr/bin/env bash
# Restaura desafios soft-deleted (lote 2026-07-30 ~15:13 UTC).
# Padrão: Noah×Zimbru + Inter Turku×Başakşehir (+ Hradec se achar) e republica.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-restaurar-desafios-excluidos.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
#
# Opcional: IDS="uuid1,uuid2" PUBLISH=1 bash ...
set -euo pipefail

ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"
PUBLISH="${PUBLISH:-1}"
# Publicados hoje e apagados no lote 15:12–15:13Z (estado = ativos de novo):
# Noah×Zimbru · Turku×Başakşehir · Augsburg×Bournemouth · Hradec×Tromsø
IDS_RAW="${IDS:-9dd0901f-a449-47c1-8443-c1b0c66303c4,e502804b-05ca-4c0d-8f69-a3a45d9d18ee,8beb938c-fa29-4bb6-9d97-fd1650bba3c4,b598561a-abe0-41c3-aeaa-5f1bd7c90d52}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v curl >/dev/null || die "curl nao encontrado"
command -v node >/dev/null || die "node nao encontrado"

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
  return 0
}

load_env "$ENV_FILE" || load_env /opt/arbishield/.env || true
SUPABASE_URL="$(
  printf '%s' "${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}" | sed 's:/*$::'
)"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente ($ENV_FILE)"
[[ -n "$SUPABASE_URL" ]] || die "SUPABASE_URL ausente"

export SUPABASE_URL SERVICE_KEY IDS_RAW PUBLISH

log "restaurar desafios publish=$PUBLISH"
log "url=$SUPABASE_URL"
log "ids=$IDS_RAW"

node --input-type=module <<'NODE'
const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SERVICE_KEY;
const publish = ["1", "true", "yes"].includes(
  String(process.env.PUBLISH || "1").toLowerCase()
);
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
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${path}\n${String(text).slice(0, 500)}`);
  }
  return data;
}

async function resolveHradec() {
  try {
    const rows = await sb(
      "/rest/v1/desafio_steps?select=desafio_id,match_label,home_team&or=(match_label.ilike.*Hradec*,home_team.ilike.*Hradec*)&order=created_at.desc&limit=5"
    );
    const hit = (Array.isArray(rows) ? rows : []).find((r) =>
      /hradec/i.test(String(r.match_label || r.home_team || ""))
    );
    return hit?.desafio_id || null;
  } catch {
    return null;
  }
}

const ids = String(process.env.IDS_RAW || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const hradec = await resolveHradec();
if (hradec && !ids.includes(hradec)) ids.push(hradec);

let ok = 0;
for (const id of ids) {
  console.log("—", id);
  const rows = await sb(
    `/rest/v1/desafios?select=id,title,number,status,is_active,deleted_at&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const d = Array.isArray(rows) ? rows[0] : null;
  if (!d) {
    console.log("  skip: nao encontrado");
    continue;
  }
  console.log(
    `  before: #${d.number} ${d.title} status=${d.status} active=${d.is_active} del=${d.deleted_at}`
  );
  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: {
      deleted_at: null,
      status: publish ? "active" : "draft",
      is_active: publish,
      updated_at: now,
      ...(publish ? { published_at: now } : {}),
    },
  });
  const steps = await sb(
    `/rest/v1/desafio_steps?select=id,status,result,settled_at,match_label,starts_at&desafio_id=eq.${encodeURIComponent(id)}`
  );
  let n = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (s.settled_at) continue;
    const st = String(s.status || "").toLowerCase();
    const res = String(s.result || "").toLowerCase();
    if (
      st === "cancelled" ||
      st === "canceled" ||
      res === "cancelled" ||
      res === "canceled"
    ) {
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
        method: "PATCH",
        body: { status: "pending", result: null, updated_at: now },
      });
      n += 1;
      console.log(`  step restored: ${s.match_label || s.id}`);
    } else {
      console.log(`  step keep: ${s.match_label || s.id} (${st || "pending"})`);
    }
  }
  ok += 1;
  console.log(`  OK restored steps=${n} published=${publish}`);
}
console.log(`\nOK — ${ok}/${ids.length} desafio(s) restaurado(s)`);
NODE

log "checar API publica"
TMP="$(mktemp)"
if curl -fsS -m 15 "https://arbishield.app/api/arbishield/desafios" -H "accept: application/json" -o "$TMP"; then
  node -e '
const rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const active=(Array.isArray(rows)?rows:[]).filter(d=>d.is_active&&!d.deleted_at);
console.log("ativos publicos:", active.length);
for (const d of active) {
  for (const s of (d.desafio_steps||[])) {
    if (s.deleted_at) continue;
    const st=String(s.status||"").toLowerCase();
    if (["done","settled","closed","cancelled"].includes(st)) continue;
    console.log(" -", "#"+d.number, s.match_label||s.home_team, st||"pending", s.starts_at);
  }
}
' "$TMP"
fi
rm -f "$TMP"
echo
echo "OK — hard refresh no app/desafio se ainda vazio."
