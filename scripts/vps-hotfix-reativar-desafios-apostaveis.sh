#!/usr/bin/env bash
# Reabre os desafios de hoje como APOSTÁVEIS de novo:
# - limpa soft-delete (se houver)
# - limpa void/settled_at das etapas
# - empurra starts_at para o futuro (padrão: agora + 90 min)
# - publica is_active=true
#
# Por que “sumiram” sem exclusão:
#   app-desafio esconde etapa com result=void/settled_at;
#   e após o kickoff o CTA vira “Jogo ao vivo” (não dá para entrar).
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-reativar-desafios-apostaveis.sh?ref=main&t=$(date +%s)")
#
# Opcional:
#   SHIFT_MINUTES=120 IDS=uuid1,uuid2 bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"
SHIFT_MINUTES="${SHIFT_MINUTES:-90}"
IDS="${IDS:-9dd0901f-a449-47c1-8443-c1b0c66303c4,e502804b-05ca-4c0d-8f69-a3a45d9d18ee,8beb938c-fa29-4bb6-9d97-fd1650bba3c4,b598561a-abe0-41c3-aeaa-5f1bd7c90d52}"
export IDS SHIFT_MINUTES

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v node >/dev/null || die "node"
command -v curl >/dev/null || die "curl"

API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
BUST="$(date +%s)"

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

log "reativar desafios apostáveis (shift=${SHIFT_MINUTES}min)"
export SUPABASE_URL SERVICE_KEY IDS SHIFT_MINUTES
node --input-type=module <<'NODE'
const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SERVICE_KEY;
const ids = String(process.env.IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
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
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${path}\n${String(text).slice(0, 400)}`);
  return data;
}

let ok = 0;
for (const id of ids) {
  console.log("—", id);
  const rows = await sb(
    `/rest/v1/desafios?select=id,number,title,status,is_active,deleted_at,metadata&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  const d = Array.isArray(rows) ? rows[0] : null;
  if (!d) {
    console.log("  skip: não encontrado");
    continue;
  }
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
        reactivated_at: nowIso,
        reactivated_via: "vps-hotfix-reativar-desafios-apostaveis",
        protect_from_casual_delete: true,
        previous_deleted_at: d.deleted_at || null,
      },
    },
  });

  const steps = await sb(
    `/rest/v1/desafio_steps?select=id,status,result,settled_at,deleted_at,match_label,starts_at,home_team,away_team&desafio_id=eq.${encodeURIComponent(id)}`
  );
  for (const s of Array.isArray(steps) ? steps : []) {
    const label = s.match_label || `${s.home_team || "?"} x ${s.away_team || "?"}`;
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
    console.log(
      `  step OK: ${label} | was status=${s.status} result=${s.result} settled=${!!s.settled_at} starts=${s.starts_at} → ${newStarts}`
    );
  }
  ok += 1;
  console.log(`  OK #${d.number} ${d.title} publicado + apostável`);
}
console.log(`\nOK — ${ok}/${ids.length} desafio(s) reativados (starts_at ≈ +${shiftMin} min)`);
NODE

log "publicar app-desafio (aviso ao vivo + normalize lista)"
mkdir -p "$WEB"
download "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html" "desafio-list-normalize-v1"
install -m 0644 "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=dz-reativar-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=dz-reativar-$BUST|g" \
  "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true

log "checar API pública"
TMP="$(mktemp)"
if curl -fsS -m 15 "https://arbishield.app/api/arbishield/desafios" -H "accept: application/json" -o "$TMP"; then
  node -e '
const rows=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const ids=new Set(String(process.env.IDS||"").split(",").map(s=>s.trim()).filter(Boolean));
const now=Date.now();
const active=(Array.isArray(rows)?rows:[]).filter(d=>d.is_active&&!d.deleted_at);
console.log("ativos publicos:", active.length);
let bettable=0;
for (const d of active) {
  if (ids.size && !ids.has(d.id)) continue;
  for (const s of (d.desafio_steps||[])) {
    if (s.deleted_at) continue;
    const finished = s.settled_at || ["void","win","lost","bateu"].includes(String(s.result||"").toLowerCase());
    const starts = s.starts_at ? Date.parse(s.starts_at) : NaN;
    const playable = !finished && Number.isFinite(starts) && starts > now;
    if (playable) bettable++;
    console.log(" -", (s.match_label||s.home_team), "playable="+playable, "status="+s.status, "result="+s.result, "starts="+s.starts_at);
  }
}
console.log("alvo apostaveis:", bettable);
' "$TMP"
fi
rm -f "$TMP"

echo
echo "OK — jogos reabertos para aposta."
echo "Hard refresh em /app-desafio.html e /admin-desafios.html (aba Ativos)."
echo "Se ainda ‘sumirem’: confira saldo Desafio do usuário (sem saldo a lista fica bloqueada)."
