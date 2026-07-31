#!/usr/bin/env bash
# Hotfix: restaurar desafios soft-deletados + republicar trava anti-apagão.
#
# Causa (2026-07-31 ~18:59 UTC): #50–#59 foram soft-deleted em sequência via
# POST /api/arbishield/desafio-delete. A UI do cliente filtra deleted_at/status=deleted
# e is_active → "NENHUM DESAFIO DISPONÍVEL". Produção estava sem o guard
# protect-desafio-casual-v1 (Excluir visível em ativos; API aceitava só {id}).
#
# 1) Restaura os desafios (#50–#59) + desloca starts_at (apostáveis)
# 2) Publica shim delete-desafio-guard-v3 (bloqueia cancel/delete em protegidos)
# 3) Publica admin-desafios sem botões Cancelar/Excluir nos protegidos/ativos
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-restaurar-e-proteger-desafios.sh?ref=cursor/desafios-sumiram-restaurar-a632&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafios-sumiram-restaurar-a632}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"
SHIFT_MINUTES="${SHIFT_MINUTES:-90}"
# #50 Augsburg, #51 Noah, #52 Inter Turku, #53 Hradec, #54 Argeș, #55 Wisla,
# #56 Oddevold, #57 LASK, #58 CSKA 1948, #59 Briton Ferry — deleted 2026-07-31T18:59Z
IDS="${IDS:-8beb938c-fa29-4bb6-9d97-fd1650bba3c4,9dd0901f-a449-47c1-8443-c1b0c66303c4,e502804b-05ca-4c0d-8f69-a3a45d9d18ee,b598561a-abe0-41c3-aeaa-5f1bd7c90d52,d13d4386-ec7f-4c9c-ace7-5cf3d59388bd,4952ce60-2cc1-4b5c-8901-a5d7355285f6,04f1bf4d-fd27-475f-89ad-16b707f91ce4,31e1144b-ca41-481c-93eb-4a49ea088cf8,2b6e8331-2040-47ba-9162-be2ca47dccf3,8d66c73f-5c6e-4e52-8b37-6f2e16b4b472}"

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
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
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
export SUPABASE_URL SERVICE_KEY IDS SHIFT_MINUTES

log "1/3 restaurar + proteger + starts_at futuro"
node --input-type=module <<'NODE'
const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SERVICE_KEY;
const ids = String(process.env.IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const shiftMin = Math.max(15, Number(process.env.SHIFT_MINUTES) || 90);
const now = new Date();
const nowIso = now.toISOString();
const newStarts = new Date(now.getTime() + shiftMin * 60 * 1000).toISOString();
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
      published_at: nowIso,
      updated_at: nowIso,
      metadata: {
        ...meta,
        restored_at: nowIso,
        restored_via: "vps-hotfix-restaurar-e-proteger-desafios",
        protect_from_casual_delete: true,
        previous_deleted_at: d.deleted_at || meta.previous_deleted_at || null,
      },
    },
  });
  const steps = await sb(`/rest/v1/desafio_steps?select=id,status,result,settled_at,deleted_at,match_label,starts_at&desafio_id=eq.${encodeURIComponent(id)}`);
  for (const s of Array.isArray(steps) ? steps : []) {
    await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(s.id)}`, {
      method: "PATCH",
      body: {
        deleted_at: null,
        settled_at: null,
        result: null,
        status: "pending",
        starts_at: newStarts,
        updated_at: nowIso,
      },
    });
    console.log("  step OK", s.match_label || s.id, "→", newStarts);
  }
  ok += 1;
  console.log("  OK #"+d.number, d.title);
}
console.log(`OK — ${ok}/${ids.length} restaurados/protegidos (starts +${shiftMin}min)`);
NODE

log "2/3 shim protect-desafio-casual-v1 (+ bloqueio settle/void)"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "FORCAR_SETTLE_PROTEGIDO"
grep -q 'protect-desafio-casual-v1' "$SHIM_PATH" || die "shim sem protect-desafio-casual-v1"
install -m 0644 "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || systemctl restart arbishield-serverfn.service 2>/dev/null || true
sleep 1

log "3/3 admin-desafios (sem Cancelar/Excluir/Liquidar em protegido)"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "liquidação bloqueada"
install -m 0644 "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=protect-dz-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=protect-dz-$BUST|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
chmod 0644 "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

log "checar API"
TMP="$(mktemp)"
if curl -fsS -m 15 "https://arbishield.app/api/arbishield/desafios" -o "$TMP"; then
  node -e '
const rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const active=(Array.isArray(rows)?rows:[]).filter(d=>d.is_active&&!d.deleted_at);
console.log("ativos:", active.length);
for (const d of active) {
  const prot=!!(d.metadata&&d.metadata.protect_from_casual_delete);
  for (const s of d.desafio_steps||[]) {
    if (s.deleted_at) continue;
    console.log(" -", s.match_label||s.home_team, "prot="+prot, s.starts_at, s.status, s.result);
  }
}
' "$TMP"
fi
rm -f "$TMP"

echo
echo "OK — jogos restaurados e travados (Cancelar/Excluir bloqueados no protegido)."
echo "Hard refresh: /admin-desafios.html e /app-desafio.html"
echo
echo "NOTA: a tela MONITOR DE PROTEÇÕES (Em aberto) é outra coisa — são proteções de jogos,"
echo "não Desafios. Em aberto=0 significa que não há proteção aberta agora."
