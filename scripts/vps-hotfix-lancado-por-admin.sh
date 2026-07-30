#!/usr/bin/env bash
# Hotfix: jogos e desafios mostram "Lançado por: <admin>".
# - matches: metadata.created_by / created_by_name (+ coluna created_by já existente)
# - desafios: ADD created_by + metadata; grava no create; UI admin lista o nome
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-lancado-por-admin.sh?ref=cursor/lancado-por-admin-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/lancado-por-admin-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR" "$SHIM_DIR"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

run_sql() {
  local sql="$1"
  if command -v docker >/dev/null 2>&1; then
    for ctr in supabase-db db postgres; do
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ctr"; then
        docker exec -i "$ctr" psql -U postgres -d postgres -c "$sql" && return 0
        docker exec -i "$ctr" psql -U supabase_admin -d postgres -c "$sql" && return 0
      fi
    done
    if [[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || [[ -f "$COMPOSE_DIR/compose.yml" ]]; then
      local db_ctr
      db_ctr="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
      if [[ -n "$db_ctr" ]]; then
        docker exec -i "$db_ctr" psql -U postgres -d postgres -c "$sql" && return 0
        docker exec -i "$db_ctr" psql -U supabase_admin -d postgres -c "$sql" && return 0
      fi
    fi
  fi
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -c "$sql" && return 0
  fi
  return 1
}

echo "==> vps-hotfix-lancado-por-admin.sh ($(date -Is)) ref=$REF"

log "1/5 schema desafios (created_by + metadata)"
SQL_DESAFIOS="$(cat <<'SQL'
ALTER TABLE public.desafios ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.desafios ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
SQL
)"
if run_sql "$SQL_DESAFIOS"; then
  echo "  OK ALTER desafios"
else
  echo "  AVISO: não foi possível ALTER desafios (UI ainda resolve via profiles se created_by existir)"
fi

log "2/5 prelive (created_by_name no lançamento)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'created_by_name' "$tmp_pre" || die "prelive sem created_by_name"
grep -q 'resolveAdminDisplayName' "$tmp_pre" || die "prelive sem resolveAdminDisplayName"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/5 shim (desafios created_by)"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'created_by_name' "$tmp_shim" || die "shim sem created_by_name"
grep -q 'enrichDesafiosWithCreatorNames' "$tmp_shim" || die "shim sem enrichDesafiosWithCreatorNames"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/5 admin UIs"
for pair in \
  "deploy/vps-supabase/static/v2/admin-jogos.html:admin-jogos.html:Lançado por:" \
  "deploy/vps-supabase/static/v2/admin-desafios.html:admin-desafios.html:Lançado por:"; do
  IFS=: read -r rel name marker <<<"$pair"
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -qF "$marker" "$tmp" || die "$name sem '$marker'"
  n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lancado-por-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  if [[ "$n" -eq 0 ]]; then
    mkdir -p "$WEB"
    cp -f "$tmp" "$WEB/$name"
    chmod 0644 "$WEB/$name"
    echo "  OK $WEB/$name (fallback)"
  fi
  rm -f "$tmp"
done

log "5/5 restart + backfill matches.metadata.created_by_name"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

if [[ -n "$SERVICE_KEY" ]]; then
  echo "==> backfill Lançado por (matches.metadata.created_by_name)…"
  SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" python3 - <<'PY' || echo "AVISO: backfill falhou (UI ainda resolve via profiles)"
import json, os, urllib.request, urllib.error

url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY") or ""
headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def get(path):
    req = urllib.request.Request(url + path, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())

def patch(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data, headers=headers, method="PATCH")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or "null")

matches = get(
    "/rest/v1/matches?deleted_at=is.null&select=id,created_by,metadata&created_by=not.is.null&limit=1000"
)
if not isinstance(matches, list):
    matches = []
need = []
admin_ids = set()
for m in matches:
    meta = m.get("metadata") if isinstance(m.get("metadata"), dict) else {}
    cid = m.get("created_by") or meta.get("created_by")
    if not cid:
        continue
    if meta.get("created_by_name"):
        continue
    need.append(m)
    admin_ids.add(str(cid))

name_map = {}
if admin_ids:
    ids = ",".join(urllib.request.quote(i, safe="") for i in admin_ids)
    # profiles-sem-coluna-email-v1
    profs = get(f"/rest/v1/profiles?select=id,full_name&id=in.({ids})")
    for p in profs or []:
        label = (p.get("full_name") or "").strip() or str(p.get("id"))[:8]
        name_map[str(p["id"])] = label

updated = 0
for m in need:
    meta = dict(m.get("metadata") or {}) if isinstance(m.get("metadata"), dict) else {}
    cid = str(m.get("created_by") or meta.get("created_by") or "")
    if not cid:
        continue
    meta["created_by"] = cid
    meta["created_by_name"] = name_map.get(cid) or cid[:8]
    try:
        patch(f"/rest/v1/matches?id=eq.{urllib.request.quote(m['id'], safe='')}", {"metadata": meta})
        updated += 1
    except Exception as e:
        print("  skip", m.get("id"), e)
print(f"  backfill matches: {updated}/{len(need)}")

# desafios com created_by sem nome em metadata
try:
    desafios = get(
        "/rest/v1/desafios?select=id,created_by,metadata&created_by=not.is.null&limit=1000"
    )
except Exception as e:
    print("  desafios skip (coluna?):", e)
    desafios = []
if not isinstance(desafios, list):
    desafios = []
d_need = []
d_ids = set()
for d in desafios:
    meta = d.get("metadata") if isinstance(d.get("metadata"), dict) else {}
    cid = d.get("created_by") or meta.get("created_by")
    if not cid or meta.get("created_by_name"):
        continue
    d_need.append(d)
    d_ids.add(str(cid))
for i in d_ids - set(name_map):
    try:
        # profiles-sem-coluna-email-v1
        profs = get(f"/rest/v1/profiles?select=id,full_name&id=eq.{urllib.request.quote(i, safe='')}&limit=1")
        p = (profs or [None])[0]
        if p:
            name_map[str(p["id"])] = (p.get("full_name") or "").strip() or i[:8]
    except Exception:
        name_map[i] = i[:8]
d_upd = 0
for d in d_need:
    meta = dict(d.get("metadata") or {}) if isinstance(d.get("metadata"), dict) else {}
    cid = str(d.get("created_by") or meta.get("created_by") or "")
    meta["created_by"] = cid
    meta["created_by_name"] = name_map.get(cid) or cid[:8]
    try:
        patch(f"/rest/v1/desafios?id=eq.{urllib.request.quote(d['id'], safe='')}", {"metadata": meta})
        d_upd += 1
    except Exception as e:
        print("  skip desafio", d.get("id"), e)
print(f"  backfill desafios: {d_upd}/{len(d_need)}")
PY
else
  echo "AVISO: SERVICE_ROLE_KEY ausente — pulando backfill"
fi

echo ""
echo "OK. Confira Gestão de Jogos e Gestão de Desafios: 'Lançado por: <admin>'."
echo "Hard refresh (Ctrl+Shift+R) se o browser cachear o HTML."
